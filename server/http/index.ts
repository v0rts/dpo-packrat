import { passport, authCorsConfig, authSession, AuthRouter } from '../auth';
import { ApolloServerOptions, computeGQLQuery } from '../graphql';
import { EventFactory } from '../event/interface/EventFactory';
import { ASL, LocalStore } from '../utils/localStore';
import { Config } from '../config';
import * as LOG from '../utils/logger';
import * as H from '../utils/helpers';
import { UsageMonitor } from '../utils/osStats';
import { RecordKeeper } from '../records/recordKeeper';

import { logtest } from './routes/logtest';
import { heartbeat } from './routes/heartbeat';
import { solrindex, solrindexprofiled } from './routes/solrindex';
// import { migrate } from './routes/migrate';
import { Downloader, download } from './routes/download';
import { errorhandler } from './routes/errorhandler';
import { WebDAVServer } from './routes/WebDAVServer';
import { getCookResource } from './routes/resources';

import { play } from './routes/sandbox';

import { generateDownloads } from './routes/api/generateDownloads';
import { generateScene } from './routes/api/generateVoyagerScene';
import { getProjects, getProjectScenes } from './routes/api/project';
import { createReport, getReportList, getReportFile } from './routes/api/report';

import express, { Request, Express, RequestHandler } from 'express';
import cors from 'cors';
import { ApolloServer } from 'apollo-server-express';
import cookieParser from 'cookie-parser';
import { v2 as webdav } from 'webdav-server';
import graphqlUploadExpress from 'graphql-upload/graphqlUploadExpress.js';
import * as path from 'path';

require('json-bigint-patch'); // patch JSON.stringify's handling of BigInt

const monitorCPU: boolean = true;
const monitorMem: boolean = true;
const monitorVerboseSamples: number = 300;

/**
 * Singleton instance of HttpServer is retrieved via HttpServer.getInstance()
 * This object instantiates express(), wires together middleware, and perform initialization tasks
 */
export class HttpServer {
    public app: Express = express();
    private WDSV: WebDAVServer | null = null;
    private static _singleton: HttpServer | null = null;

    static async getInstance(): Promise<HttpServer | null> {
        if (!HttpServer._singleton) {
            HttpServer._singleton = new HttpServer();
            await HttpServer._singleton.initializeServer();
        }
        return HttpServer._singleton;
    }

    private async initializeServer(): Promise<boolean> {
        LOG.info('**************************', LOG.LS.eSYS);
        LOG.info('Packrat Server Initialized', LOG.LS.eSYS);

        // get our webDAV server
        this.WDSV = await WebDAVServer.server();
        if (this.WDSV) {
            LOG.info('initialized WebDAV Server', LOG.LS.eSYS);
        } else {
            LOG.error('Failed to initialize WebDAV server', LOG.LS.eSYS);
            return false;
        }

        // configure our routes/endpoints
        const res: boolean = await this.configureMiddlewareAndRoutes();

        // call to initalize the EventFactory, which in turn will initialize the AuditEventGenerator, supplying the IEventEngine
        EventFactory.getInstance();
        if (monitorCPU) {
            const monitor: UsageMonitor = new UsageMonitor(1000, 90, 10, monitorMem, 90, 10, monitorVerboseSamples); // sample every second, alert if > 90% for more than 10 samples in a row, monitorVerboseSamples -> verbose logging, when != 0, every monitorVerboseSamples samples
            monitor.start();
        }

        // initialize notification system
        const notifyResult: H.IOResults = await RecordKeeper.configure();
        if(notifyResult.success===false)
            LOG.error(`FAILED to configure Notification system. no notices will be sent (${notifyResult.error})`,LOG.LS.eSYS);
        else
            LOG.info(`Notification system is running: ${Config.environment.type}`,LOG.LS.eSYS);

        // return our response
        return res;
    }

    static bodyProcessorExclusions: RegExp = /^\/(?!webdav).*$/;
    private async configureMiddlewareAndRoutes(): Promise<boolean> {

        // First step is to modify the request body as needed. We do this first
        // because the express.json() 3rd party library breaks any context created
        // by the AsyncLocalStore as it waits for the request/body to arrive.
        //
        // limiting the maximum JSON payload size to avoid issues with Express trying
        // to parse very large JSON requests. Set to the maximum chunk size for uploads.
        // note: this should not be necessary due to use of multipart/form, but is a precaution
        // note: cannot skip graphql for uploads since body holds details about the request being made
        this.app.use(HttpServer.bodyProcessorExclusions, (req, _res, next)=>{
            // do not extract webdav PUT bodies into request.body element
            express.json({ limit: '100MB' })(req, _res, next); // as RequestHandler;
        });
        this.app.use(HttpServer.bodyProcessorExclusions, express.urlencoded({ extended: true, limit: '100MB' }) as RequestHandler);

        // early stage request debugging middleware
        // this.app.use(HttpServer.logRequestDetailed);

        // get our cookie and auth system rolling. We do this here so we can extract
        // our user information (if present) and have it for creating the LocalStore.
        this.app.use(cors(authCorsConfig));
        this.app.use(cookieParser());
        this.app.use(authSession);
        this.app.use(passport.initialize());
        this.app.use(passport.session());

        // create our LocalStore for all future interactions
        this.app.use(HttpServer.logRequest);
        this.app.use(HttpServer.assignLocalStore);

        // if we have a WebDAV server (always), attach it to express
        if(this.WDSV)
            this.app.use(webdav.extensions.express(WebDAVServer.httpRoute, this.WDSV.webdav()));

        // authentication and graphQL endpoints
        this.app.use('/auth', AuthRouter);
        this.app.use('/graphql', graphqlUploadExpress({
            maxFileSize: 30 * 1024 * 1024 * 1024, // 30 GB
            maxFiles: 10,
            tmpdir: path.join(Config.storage.rootStaging,'tmp'),
            debug: true,
        }));

        // start our ApolloServer
        const server = new ApolloServer(ApolloServerOptions);
        await server.start();
        server.applyMiddleware({ app: this.app, cors: false });

        // utility endpoints
        this.app.get('/logtest', logtest);
        this.app.get('/heartbeat', heartbeat);
        this.app.get('/solrindex', solrindex);
        this.app.get('/solrindexprofiled', solrindexprofiled);
        // this.app.get('/migrate', migrate);
        // this.app.get('/migrate/*', migrate);
        this.app.get(`${Downloader.httpRoute}*`, download);

        // Packrat API endpoints
        this.app.get('/resources/cook', getCookResource);

        this.app.get('/api/project',getProjects);                   // get basic listing info for all projects
        this.app.get('/api/project/:id/scenes',getProjectScenes);   // get all scenes for a specific project

        this.app.get('/api/scene/gen-downloads', generateDownloads);
        this.app.post('/api/scene/gen-downloads', generateDownloads);

        this.app.get('/api/workflow/gen-scene', generateScene);
        this.app.post('/api/workflow/gen-scene', generateScene);

        this.app.get('/api/report/:type/:date/:format',getReportFile);  // get a specific report file
        this.app.get('/api/report/:type',getReportList);                // get a list of reports for the given type
        this.app.post('/api/report/:type', createReport);               // run report creation for asset-files

        this.app.get('/api/sandbox/play',play);

        // if we're here then we handle any errors that may have surfaced
        this.app.use(errorhandler); // keep last

        // if we're not testing then open up server on the correct port
        if (process.env.NODE_ENV !== 'test') {
            const server = this.app.listen(Config.http.port, () => {
                LOG.info(`Server is running on port ${Config.http.port}`, LOG.LS.eSYS);
            });

            // Set keep-alive parameters on the server
            server.timeout = 60 * 60 * 1000; // 1hr
            server.keepAliveTimeout = 6000 * 1000; //600000; // 10 minutes
            server.headersTimeout = 6100 * 1000;   //610000;  // Slightly larger than keepAliveTimeout
        }

        // only gets here if no other route is satisfied
        return true;
    }

    // creates a LocalStore populated with the next requestID
    private static assignLocalStore(req: Request, _res, next): void {
        const user = req['user'];
        const idUser = user ? user['idUser'] : undefined;
        ASL.run(new LocalStore(true, idUser), () => {
            LOG.info(`HTTP.idRequestMiddleware creating new LocalStore (url: ${req.originalUrl} | idUser: ${idUser})`,LOG.LS.eHTTP);
            next();
        });
    }

    // utility routines and middleware
    private static logRequest(req: Request, _res, next): void {
        // figure out who is calling this
        const user = req['user'];
        const idUser = user ? user['idUser'] : undefined;

        // our method (GET, POST, ...)
        let method = req.method.toUpperCase();

        // get our query
        let query = req.originalUrl;
        let queryParams = H.Helpers.JSONStringify(req.query);
        if(req.originalUrl.includes('/graphql')) {
            method = 'GQL';
            const queryGQL = computeGQLQuery(req);
            if(queryGQL && queryGQL !== '__schema') {
                query = queryGQL;
                queryParams = H.Helpers.JSONStringify(req.body.variables);
            } else
                query = `Unknown GraphQL: ${query}|${req.path}`;
        }
        LOG.info(`[REQUEST] ${method} request [${query}] made by user ${idUser}. (${queryParams})`,LOG.LS.eHTTP);
        next();
    }
    // private static logRequestDetailed(req: Request, _res, next): void {
    //     // move routine higher if debugging potential issues with the JSON body.
    //     // placed here so GraphQL details are available (from the the body)
    //     const startBytes = req.socket.bytesRead;
    //     const reqCache: Request = req;

    //     LOG.info(`[REQUEST START] ${req.method} ${req.originalUrl} (Content-Length: ${req.headers['content-length'] || 'unknown'})`,LOG.LS.eDEBUG);
    //     LOG.info(`[REQUEST START] ${H.Helpers.JSONStringify(H.Helpers.cleanExpressRequest(reqCache,true,true))}`,LOG.LS.eDEBUG);

    //     req.on('end', () => {
    //         const totalBytes = req.socket.bytesRead - startBytes;
    //         LOG.info(`[REQUEST END] ${req.method} ${req.originalUrl} (body: ${totalBytes} bytes)`,LOG.LS.eDEBUG);
    //     });

    //     req.on('close', ()=>{
    //         LOG.info(`[REQUEST CLOSE]  ${req.method} ${req.originalUrl}`,LOG.LS.eDEBUG);
    //     });

    //     next();
    // };

    // private static checkLocalStore(label: string) {
    //     return function (_req, _res, next) {
    //         //LOG.info(`HTTP.checkLocalStore [${label}]. (url: ${req.originalUrl} | ${H.Helpers.JSONStringify(ASL.getStore())})`,LOG.LS.eDEBUG);
    //         ASL.checkLocalStore(label);
    //         next();
    //     };
    // }
}

process.on('uncaughtException', (err) => {
    LOG.error('*** UNCAUGHT EXCEPTION ***', LOG.LS.eSYS, err);

    // For the time being, we prevent Node from exiting.
    // Once we've installed a process monitor in staging & production, like PM2, change this to
    // exit with a non-zero exit code
    // process.exit(1);
});

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // LOG.error('*** UNCAUGHT REJECTION ***', LOG.LS.eSYS, reason);
});