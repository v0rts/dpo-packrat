/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import fetch, { RequestInit } from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';
import * as COL from '../interface';
import { PublishScene } from './PublishScene';
import { PublishSubject } from './PublishSubject';
import { Config } from '../../config';
import * as DBAPI from '../../db';
import * as CACHE from '../../cache';
import * as LOG from '../../utils/logger';
import * as H from '../../utils/helpers';
import * as COMMON from '@dpo-packrat/common';
import { EdanLicenseInfo } from '../interface';

interface HttpRequestResult {
    output: string;
    statusText: string;
    success: boolean;
}

const NAME_MAPPING_AUTHORITY: string = 'http://n2t.net/';
const NAME_ASSIGNING_AUTHORITY: string = '65665';
const DEFAULT_ARK_SHOULDER_MEDIA: string = 'uj5';   // c.f. https://confluence.si.edu/pages/viewpage.action?spaceKey=SGWG&title=ARK+Implementation+Notes
const DEFAULT_ARK_SHOULDER: string = 'hz4';         // and  https://confluence.si.edu/download/attachments/40698875/SI_ARK_DatasetIDs.xlsx?api=v2

enum eAPIType {
    eEDAN = 1,
    eEDAN3dApi = 2,
}

enum eHTTPMethod {
    eGet = 1,
    ePost = 2,
}

export class EdanCollection implements COL.ICollection {
    async queryCollection(query: string, rows: number, start: number, options: COL.CollectionQueryOptions | null): Promise<COL.CollectionQueryResults | null> {
        const records: COL.CollectionQueryResultRecord[] = [];
        const result: COL.CollectionQueryResults = {
            records,
            rowCount: 0,
        };

        const path: string = 'metadata/v2.0/metadata/search.htm';
        const filters: string[] = [];
        let gatherRaw: boolean = false;
        let gatherIDMap: boolean = false;

        if (!options)
            filters.push('"type:edanmdm"');
        else {
            if (options.recordType)
                filters.push(`"type:${options.recordType}"`);
            else if (!options.searchMetadata)
                filters.push('"type:edanmdm"');

            gatherRaw = options.gatherRaw ?? false;
            gatherIDMap = options.gatherIDMap ?? false;
        }

        let filter: string = '';
        if (filters.length > 0) {
            filter = '&fqs=[';
            for (let filterIndex = 0; filterIndex < filters.length; filterIndex++)
                filter = filter + (filterIndex == 0 ? '' : /* istanbul ignore next */ ',') + encodeURIComponent(filters[filterIndex]);
            filter += ']';
        }

        // in addition to URI encoding the query, also replace single quotes with %27
        const params: string = `q=${encodeURIComponent(query).replace(/'/g, '%27')}${filter}&rows=${rows}&start=${start}`;
        const reqResult: HttpRequestResult  = await this.sendRequest(eAPIType.eEDAN, eHTTPMethod.eGet, path, params);
        if (!reqResult.success) {
            LOG.error(`EdanCollection.queryCollection ${query}`, LOG.LS.eCOLL);
            return null;
        }

        let jsonResult: any | null          = null;
        try {
            jsonResult                      = reqResult.output ? JSON.parse(reqResult.output) : /* istanbul ignore next */ null;
        } catch (error) /* istanbul ignore next */ {
            LOG.error(`EdanCollection.queryCollection ${query}`, LOG.LS.eCOLL, error);
            return null;
        }

        // jsonResult.rows -- array of { ..., title, id, unitCode, ..., content };
        // content.descriptiveNonRepeating.title.content = name
        // content.descriptiveNonRepeating.record_ID = EDAN ID
        // content.descriptiveNonRepeating.unit_code = Unit
        // content.descriptiveNonRepeating.guid = ID
        /* istanbul ignore else */
        if (jsonResult) {
            /* istanbul ignore else */
            if (jsonResult.rowCount)
                result.rowCount = jsonResult.rowCount;

            /* istanbul ignore else */
            if (jsonResult.rows) {
                for (const row of jsonResult.rows) {
                    let name = row.title ? row.title : /* istanbul ignore next */ '';
                    let unit = row.unitCode ? row.unitCode : /* istanbul ignore next */ '';
                    let identifierPublic = row.id ? row.id : /* istanbul ignore next */ '';
                    let identifierCollection = row.id ? row.id : /* istanbul ignore next */ '';
                    let identifierMap: Map<string, string> | undefined = undefined;

                    /* istanbul ignore else */
                    if (row.content && row.content.descriptiveNonRepeating) {
                        const description = row.content.descriptiveNonRepeating;
                        /* istanbul ignore else */
                        if (description.title && description.title.content)
                            name = description.title.content;
                        /* istanbul ignore else */
                        if (description.unit_code)
                            unit = description.unit_code;
                        /* istanbul ignore else */
                        if (description.record_ID)
                            identifierCollection = description.record_ID;
                        /* istanbul ignore else */
                        if (description.guid)
                            identifierPublic = description.guid;
                    }

                    if (gatherIDMap) {
                        identifierMap = new Map<string, string>();

                        const IDs: [{ label?: string, content?: string }] | undefined = row.content?.freetext?.identifier;
                        if (IDs) {
                            for (const ID of IDs) {
                                const label = ID?.label;
                                const content = ID?.content;
                                if (label && content)
                                    identifierMap.set(label, content);
                            }
                        }
                    }

                    records.push({ name, unit, identifierPublic, identifierCollection, identifierMap, raw: gatherRaw ? row : undefined });
                }
            }
        }

        // LOG.info(`Collections Processed Results = ${JSON.stringify(result)}'\n\n'`, LOG.LS.eCOLL);
        // LOG.info(`EDAN Raw Results = ${reqResult.output}\n\n`, LOG.LS.eCOLL);
        return result;
    }

    async fetchContent(id?: string, url?: string): Promise<COL.EdanRecord | null> {
        LOG.info(`EdanCollection.fetchContent(${id}, ${url})`, LOG.LS.eCOLL);
        let params: string = '';
        if (id)
            params = `id=${encodeURIComponent(id)}`;
        else if (url)
            params = `url=${encodeURIComponent(url)}`;
        else
            return null;

        const reqResult: HttpRequestResult  = await this.sendRequest(eAPIType.eEDAN, eHTTPMethod.eGet, 'content/v2.0/content/getContent.htm', params);
        if (!reqResult.success) {
            LOG.error(`EdanCollection.fetchContent(${id}, ${url})`, LOG.LS.eCOLL);
            return null;
        }

        let jsonResult: any | null  = null;
        try {
            jsonResult              = reqResult.output ? JSON.parse(reqResult.output) : /* istanbul ignore next */ null;
        } catch (error) /* istanbul ignore next */ {
            LOG.error(`EdanCollection.fetchContent(${id}, ${url})`, LOG.LS.eCOLL, error);
            return null;
        }
        return jsonResult;
    }

    async publish(idSystemObject: number, ePublishState: number): Promise<boolean> {

        LOG.info(`EdanCollection.publish (idSystemObject: ${idSystemObject} | state: ${COMMON.ePublishedState[ePublishState]})`,LOG.LS.eDEBUG);

        switch (ePublishState) {
            case COMMON.ePublishedState.eNotPublished:
            case COMMON.ePublishedState.eAPIOnly:
            case COMMON.ePublishedState.ePublished:
            case COMMON.ePublishedState.eInternal:
                break;
            default:
                LOG.error(`EdanCollection.publish called with invalid ePublishState ${ePublishState} for idSystemObject ${idSystemObject}`, LOG.LS.eCOLL);
                return false;
        }

        const oID: DBAPI.ObjectIDAndType | undefined = await CACHE.SystemObjectCache.getObjectFromSystem(idSystemObject);
        if (!oID) {
            LOG.error(`EdanCollection.publish(${idSystemObject}) unable to compute object id and type`, LOG.LS.eCOLL);
            return false;
        }

        switch (oID.eObjectType) {
            case COMMON.eSystemObjectType.eScene: {
                const PS: PublishScene = new PublishScene(idSystemObject);
                return PS.publish(this, ePublishState);
            }
            case COMMON.eSystemObjectType.eSubject: {
                const PS: PublishSubject = new PublishSubject(idSystemObject);
                const PSRes: H.IOResults = await PS.publish(this);
                return PSRes.success;
            }
        }
        return false;
    }

    async createEdanMDM(edanmdm: COL.EdanMDMContent, status: number, publicSearch: boolean): Promise<COL.EdanRecord | null> {
        const body: any = {
            url: `edanmdm:${edanmdm.descriptiveNonRepeating.record_ID}`,
            status,
            publicSearch,
            type: 'edanmdm',
            content: edanmdm,
        };
        return this.upsertContent(body, 'createEdanMDM');
    }

    async createEdan3DPackage(path: string, sceneFile?: string | undefined): Promise<COL.EdanRecord | null> {
        // const body: any = sceneFile ? { resource: path.replace(/\.zip|-zip$/, ''), document: sceneFile } : { resource: path.replace(/\.zip|-zip$/, '') };
        const body: any = sceneFile ? { resource: path, document: sceneFile } : { resource: path };
        LOG.info(`createEdan3DPackage body:\n${H.Helpers.JSONStringify(body)}`,LOG.LS.eDEBUG);

        const edanRecord: COL.EdanRecord | null = await this.upsertResource(body, 'createEdan3DPackage');
        if(!edanRecord)
            return null;

        // returned URL may include a zip extension so we clean that out
        // only seems to happen when running locally with a Proxy
        const packageUrl: string = edanRecord.url.replace(/\.zip|-zip$/, '');
        if(edanRecord.url!==packageUrl)
            LOG.info(`EdanCollection.createEdan3DPackage returned url needed correction. (${edanRecord.url} -> ${packageUrl})`,LOG.LS.eCOLL);

        return { ...edanRecord, url: packageUrl };
    }

    async updateEdan3DPackage(url: string, title: string | undefined, sceneContent: COL.Edan3DPackageContent,
        status: number, publicSearch: boolean): Promise<COL.EdanRecord | null> {

        // make sure the url doesn't include file extensions
        // only seems to happen when running locally with a Proxy
        const packageUrl: string = url.replace(/\.zip|-zip$/, '');
        if(url!==packageUrl)
            LOG.info(`EdanCollection.updateEdan3DPackage incoming url needed correction. (${url} -> ${packageUrl})`,LOG.LS.eCOLL);

        const body: any = {
            url: packageUrl,
            title,
            status,
            publicSearch,
            type: '3d_package',
            content: sceneContent,
        };
        return this.upsertContent(body, 'updateEdan3DPackage');
    }


    /** c.f. http://dev.3d.api.si.edu/apidocs/#api-admin-upsertContent */
    private async upsertContent(body: any, caller: string): Promise<COL.EdanRecord | null> {
        LOG.info(`EdanCollection.upsertContent: ${JSON.stringify(body)}`, LOG.LS.eCOLL);
        const reqResult: HttpRequestResult = await this.sendRequest(eAPIType.eEDAN3dApi, eHTTPMethod.ePost, 'api/v1.0/admin/upsertContent', '', JSON.stringify(body), 'application/json');
        LOG.info(`EdanCollection.upsertContent result:\n${H.Helpers.JSONStringify(H.Helpers.JSONParse(reqResult.output))}`, LOG.LS.eCOLL);

        if (!reqResult.success) {
            LOG.error(`EdanCollection.${caller} failed with ${reqResult.statusText}: ${reqResult.output}`, LOG.LS.eCOLL);
            return null;
        }

        try {
            return JSON.parse(reqResult.output)?.response ?? null;
        } catch (error) {
            LOG.error(`EdanCollection.${caller} parse error: ${JSON.stringify(reqResult)}`, LOG.LS.eCOLL, error);
            return null;
        }
    }

    /** c.f. http://dev.3d.api.si.edu/apidocs/#api-admin-upsertResource */
    private async upsertResource(body: any, caller: string): Promise<COL.EdanRecord | null> {
        // LOG.info(`EdanCollection.upsertResource: ${JSON.stringify(body)}`, LOG.LS.eCOLL);
        const reqResult: HttpRequestResult = await this.sendRequest(eAPIType.eEDAN3dApi, eHTTPMethod.ePost, 'api/v1.0/admin/upsertResource', '', JSON.stringify(body), 'application/json');
        LOG.info(`EdanCollection.upsertResource result:\n${H.Helpers.JSONStringify(H.Helpers.JSONParse(reqResult.output))}`, LOG.LS.eDEBUG);

        if (!reqResult.success) {
            LOG.error(`EdanCollection.${caller} failed with ${reqResult.statusText}: ${reqResult.output}`, LOG.LS.eCOLL);
            return null;
        }

        try {
            return JSON.parse(reqResult.output)?.response ?? null;
        } catch (error) {
            LOG.error(`EdanCollection.${caller} parse error: ${JSON.stringify(reqResult)}`, LOG.LS.eCOLL, error);
            return null;
        }
    }

    // #region Identifier services
    /** c.f. https://ezid.cdlib.org/learn/id_concepts
     * prefix typically comes from the collecting unit or from the scanning organization (SI DPO);
     * specify true for prependNameAuthority to create an identifier which is a URL
     */
    generateArk(prefix: string | null, prependNameAuthority: boolean, isMedia: boolean): string {
        if (!prefix)
            prefix = isMedia ? DEFAULT_ARK_SHOULDER_MEDIA : DEFAULT_ARK_SHOULDER;
        const arkId: string = `ark:${NAME_ASSIGNING_AUTHORITY}/${prefix}${uuidv4()}`;
        return prependNameAuthority ? this.transformArkIntoUrl(arkId) : arkId;
    }

    // Basically this extracts the URL from the ark ID. Then returns it to ingestData.ts on line
    extractArkFromUrl(url: string): string | null {
        const arkPosition: number = url.indexOf('ark:');
        return (arkPosition > -1) ? url.substring(arkPosition) : null;
    }

    transformArkIntoUrl(arkId: string): string {
        return NAME_MAPPING_AUTHORITY + arkId;
    }

    getArkNameMappingAuthority(): string {
        return NAME_MAPPING_AUTHORITY;
    }

    getArkNameAssigningAuthority(): string {
        return NAME_ASSIGNING_AUTHORITY;
    }

    // EDAN Identifier
    checkEdanIdentifier(edan: string): string | null {
        const edanPosition: number = edan.indexOf('edanmdm:');
        return (edanPosition > -1) ? edan : null;
    }

    // #endregion

    // #region HTTP Helpers
    /**
     * Creates the header for the request to EDAN. Takes a uri, prepends a nonce, and appends
     * the date and appID key. Hashes as sha1() and base64_encode() the result.
     * @param uri The URI (string) to be hashed and encoded.
     * @returns Array containing all the header elements and signed header value
     */
    private encodeHeader(uri: string, contentType?: string | undefined): [string, string][] {
        const headers: [string, string][]   = [];
        const ipnonce: string               = (Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)).substring(0, 15);
        const dtNow: Date                   = new Date();
        let   dateString                    = new Date(dtNow.getTime() - (dtNow.getTimezoneOffset() * 60000)).toISOString();
        dateString                          = dateString.substring(0, dateString.length - 5).replace('T', ' '); // trim off final ".333Z"; replace "T" with " "
        const auth: string                  = `${ipnonce}\n${uri}\n${dateString}\n${Config.collection.edan.authKey}`;

        const hash: string                  = H.Helpers.computeHashFromString(auth, 'sha1');
        const authContent: string           = Buffer.from(hash).toString('base64'); // seems like a bug to base64 encode hex output, but that does the trick!

        headers.push(['X-AppId', Config.collection.edan.appId]);
        headers.push(['X-RequestDate', dateString]);
        headers.push(['X-AppVersion', 'Packrat-' + process.env.npm_package_version]);
        headers.push(['X-Nonce', ipnonce]);
        headers.push(['X-AuthContent', authContent]);
        if (contentType !== undefined)
            headers.push(['Content-Type', contentType]);
        return headers;
    }

    /**
     * Perform an HTTP GET request
     * @param path The URL path
     * @param params The URL params, which specify the query details
     */
    private async sendRequest(eType: eAPIType, eMethod: eHTTPMethod, path: string, params: string,
        body?: string | undefined, contentType?: string | undefined): Promise<HttpRequestResult> {

        let method: string = 'GET';
        switch (eMethod) {
            default:
            case undefined:
            case eHTTPMethod.eGet: method = 'GET'; break;
            case eHTTPMethod.ePost: method = 'POST'; break;
        }

        let server: string = Config.collection.edan.server;
        switch (eType) {
            default:
            case undefined:
            case eAPIType.eEDAN:  server = Config.collection.edan.server; break;
            case eAPIType.eEDAN3dApi: server = Config.collection.edan.api3d; break;
        }

        const url: string = `${server}${path}${params ? '?' + params : ''}`;
        try {
            // LOG.info(`EdanCollection.sendRequest: ${url}, ${body}`, LOG.LS.eCOLL);
            LOG.info(`EdanCollection.sendRequest: ${url}`, LOG.LS.eCOLL);
            const init: RequestInit = { method, body: body ?? undefined, headers: this.encodeHeader(params, contentType) };
            const res = await fetch(url, init);

            // debug statement for response
            // const headers: string[] = [];
            // res.headers.forEach((value, name) => { headers.push(`${name}: ${value}`); });
            // LOG.info(`EdanCollection.sendRequest [${res.status}:${res.statusText}] response from ${url} (params: ${params})\n${headers.join('\n\t')}`,LOG.LS.eDEBUG);

            return {
                output: await res.text(),
                statusText: res.statusText,
                success: res.ok
            };
        } catch (error) /* istanbul ignore next */ {
            LOG.error('EdanCollection.sendRequest', LOG.LS.eCOLL, error);
            return {
                output: JSON.stringify(error),
                statusText: 'node-fetch error',
                success: false
            };
        }
    }

    static computeLicenseInfo(licenseText?: string | undefined, licenseCodes?: string | undefined, usageText?: string | undefined): EdanLicenseInfo {
        const access: string = (licenseText && licenseText.toLowerCase() === 'cc0, publishable w/ downloads') ? 'CC0' : 'Usage conditions apply';
        return {
            access,
            codes: licenseCodes ?? '',
            text: usageText ?? '',
        };
    }
    // #endregion
}
