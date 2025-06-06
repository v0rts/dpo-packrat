/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as DBAPI from '../db';
import { Config, ENVIRONMENT_TYPE } from '../config';
import { ASL, LocalStore } from '../utils/localStore';
import { Logger as LOG, LogSection } from './logger/log';
import { Notify as NOTIFY, NotifyUserGroup, NotifyType, NotifyPackage, SlackChannel } from './notify/notify';

// temp definition for where IOResults will be
type IOResults = {
    success: boolean,
    message: string,
    data?: any
};

// cache for individual group IDs and emails
type GroupConfig = {
    emailAdmin:    string[],
    emailAll:      string[],
    slackAdmin:    string[] | undefined,
    slackAll:      string[] | undefined,
};

export class RecordKeeper {

    static LogSection = LogSection;
    static NotifyGroup = NotifyUserGroup;
    static NotifyType = NotifyType;
    static SlackChannel = SlackChannel;

    private static defaultEmail: string[] = ['packrat@si.edu'];
    private static notifyGroupConfig: GroupConfig = {
        emailAdmin: [],
        emailAll: [],
        slackAdmin: undefined,
        slackAll: undefined,
    };

    static async configure(): Promise<IOResults> {

        let targetRate: number = Config.log.targetRate;   // targeted posts per second (100-500)
        let burstRate: number = targetRate * 5;           // target rate when in burst mode and playing catchup
        let burstThreshold: number = burstRate;           // when queue is bigger than this size, trigger 'burst mode'

        //#region CONFIG:LOGGER
        // get our log path from the config
        const environment: ENVIRONMENT_TYPE = Config.environment.type;
        const logPath: string = Config.log.root ? Config.log.root : /* istanbul ignore next */ './var/logs';

        // our default Logger configuration options
        const useRateManager: boolean = true;             // do we manage our log output for greater consistency
        targetRate = Config.log.targetRate;   // 100-500/sec
        burstRate = targetRate * 2;
        burstThreshold = burstRate;

        // initialize logger sub-system
        const logResults = LOG.configure(logPath, environment, useRateManager, targetRate, burstRate, burstThreshold);
        if(logResults.success===false)
            return logResults;
        this.logInfo(LogSection.eSYS, logResults.message, { environment, path: logPath, useRateManager, targetRate, burstRate, burstThreshold }, 'Recordkeeper');
        //#endregion

        //#region CONFIG:NOTIFY:EMAIL
        targetRate = 1;   // sending too many triggers spam filters on network, delays are acceptable
        burstRate = 5;
        burstThreshold = 10;

        // update our default email to always 'dev' since something went wrong
        RecordKeeper.defaultEmail = ['packrat-dev@si.edu'];

        const emailResults = NOTIFY.configureEmail(Config.environment.type,targetRate,burstRate,burstThreshold);
        if(emailResults.success===false)
            return emailResults;
        this.logInfo(LogSection.eSYS, emailResults.message, { environment, ...emailResults.data }, 'Recordkeeper');

        // get our email addresses from the system. these can be cached because they will be
        // the same for all users and sessions.
        this.notifyGroupConfig.emailAdmin = await this.getEmailsFromGroup(NotifyUserGroup.EMAIL_ADMIN) ?? this.defaultEmail;
        this.notifyGroupConfig.emailAll = await this.getEmailsFromGroup(NotifyUserGroup.EMAIL_ALL) ?? this.defaultEmail;
        //#endregion

        //#region CONFIG:NOTIFY:SLACK
        // Slack API limits throughput to 1 message/sec. Not using burst mode here
        targetRate = 1;
        const slackResults = NOTIFY.configureSlack(environment,Config.slack.apiKey,targetRate);
        if(slackResults.success===false)
            return slackResults;
        this.logInfo(LogSection.eSYS, slackResults.message, { environment, ...slackResults.data }, 'Recordkeeper');

        // get our slack addresses from the system. they are cached as they will be the same
        // for all users and sessions.
        this.notifyGroupConfig.slackAdmin = await this.getSlackIDsFromGroup(NotifyUserGroup.SLACK_ADMIN);
        this.notifyGroupConfig.slackAll = await this.getSlackIDsFromGroup(NotifyUserGroup.SLACK_ALL);
        //#endregion

        return { success: true, message: 'configured record keeper' };
    }
    static cleanup(): IOResults {
        return { success: true, message: 'record keeper cleaned up' };
    }
    private static getContext(): { idUser: number, idRequest: number } {
        // get our user and request ids from the local store
        // TEST: does it maintain store context since static and not async
        const LS: LocalStore | undefined = ASL?.getStore();
        if(!LS)
            return { idUser: -1, idRequest: -1 };

        // if no user, return an error id. otherwise, return what we got
        return { idUser: LS.idUser ?? -1, idRequest: LS.idRequest };
    }

    //#region LOG
    // Log routines for specific levels
    static async logCritical(sec: LogSection, message: string, data?: any, caller?: string, audit: boolean = false): Promise<IOResults> {
        const { idUser, idRequest } = this.getContext();
        return LOG.critical(sec,message,data,caller,audit,idUser,idRequest);
    }
    static async logError(sec: LogSection, message: string, data?: any, caller?: string, audit: boolean = false): Promise<IOResults> {
        const { idUser, idRequest } = this.getContext();
        return LOG.error(sec,message,data,caller,audit,idUser,idRequest);
    }
    static async logWarning(sec: LogSection, message: string, data?: any, caller?: string, audit: boolean = false): Promise<IOResults> {
        const { idUser, idRequest } = this.getContext();
        return LOG.warning(sec,message,data,caller,audit,idUser,idRequest);
    }
    static async logInfo(sec: LogSection, message: string, data?: any, caller?: string, audit: boolean = false): Promise<IOResults> {
        const { idUser, idRequest } = this.getContext();
        return LOG.info(sec,message,data,caller,audit,idUser,idRequest);
    }
    static async logDebug(sec: LogSection, message: string, data?: any, caller?: string, audit: boolean = false): Promise<IOResults> {
        const { idUser, idRequest } = this.getContext();
        return LOG.debug(sec,message,data,caller,audit,idUser,idRequest);
    }

    // profiler functions
    // Usage: call 'profile' with a unique label and any needed metadata. This creates/starts a timer.
    //        to stop the timer and log the result, call profileEnd with the same label used to create it.
    static async profile(label: string, sec: LogSection, message: string, data?: any, caller?: string): Promise<IOResults> {
        const { idUser, idRequest } = this.getContext();
        return LOG.profile(label, sec, message, data, caller, idUser, idRequest);
    }
    static async profileEnd(label: string): Promise<IOResults> {
        return LOG.profileEnd(label);
    }

    // stats and utilities
    static logTotalCount(): number {
        return LOG.getStats().counts.total;
    }
    static async logTest(numLogs: number): Promise<IOResults> {
        return LOG.testLogs(numLogs);
    }
    //#endregion

    //#region NOTIFY
    static async sendMessage(type: NotifyType, group: NotifyUserGroup, subject: string, body: string, startDate?: Date, endDate?: Date, link?: { url: string, label: string }): Promise<IOResults> {
        // sends a message to both email and slack

        // send our message to email
        const emailResult = await RecordKeeper.sendEmail(type,group,subject,body,startDate,endDate,link);

        // figure out our slack channel based on message type if in production
        let slackChannel: SlackChannel = SlackChannel.PACKRAT_DEV;
        if(Config.environment.type===ENVIRONMENT_TYPE.PRODUCTION) {
            slackChannel = SlackChannel.PACKRAT_OPS;
            switch(type) {
                case NotifyType.SECURITY_NOTICE:
                case NotifyType.SYSTEM_ERROR:
                case NotifyType.UNDEFINED:
                    slackChannel = SlackChannel.PACKRAT_SYSTEM;
            }
        }

        // send our message to slack
        const slackResult = await RecordKeeper.sendSlack(type,group,subject,body,slackChannel,startDate,endDate,link);

        // determine if successful or not
        if(emailResult.success===false || slackResult.success===false) {
            const error: string = [emailResult.data?.error, slackResult.data?.error].filter(Boolean).join('| ');
            return { success: false, message: 'failed to send message', data: { error } };
        }

        return { success: true, message: 'sent message to email and slack' };
    }

    // emails
    private static async getEmailsFromGroup(group: NotifyUserGroup, forceUpdate: boolean = false): Promise<string[] | undefined> {

        switch(group) {

            case NotifyUserGroup.EMAIL_ALL: {
                // see if we already initialized this
                if(this.notifyGroupConfig.emailAll.length>0 && forceUpdate===true)
                    return this.notifyGroupConfig.emailAll;

                // fetch all users
                const allUsers: DBAPI.User[] | null = await DBAPI.User.fetchUserList('',DBAPI.eUserStatus.eActive);
                if(!allUsers || allUsers.length===0)
                    return this.defaultEmail;

                // build array of email addresses but only for those active
                const allEmails: string[] = allUsers.filter(u => u.Active && u.WorkflowNotificationTime).map(u => u.EmailAddress);
                this.notifyGroupConfig.emailAll = [...allEmails];

                // otherwise, grab all active Users from DB and their emails
                return this.notifyGroupConfig.emailAll;
            }

            case NotifyUserGroup.EMAIL_ADMIN: {

                // see if we already initialized this
                if(this.notifyGroupConfig.emailAdmin.length>0 && forceUpdate===true)
                    return this.notifyGroupConfig.emailAdmin;

                // grab all admin users
                const adminIDs: number[] = Config.auth.users.admin;
                const adminUsers: DBAPI.User[] | null = await DBAPI.User.fetchByIDs(adminIDs);
                if(!adminUsers || adminUsers.length===0)
                    return this.defaultEmail;

                // build array of email addresses but only for those active
                const adminEmails: string[] = adminUsers.filter(u => u.Active && u.WorkflowNotificationTime).map(u => u.EmailAddress);
                this.notifyGroupConfig.emailAdmin = [...adminEmails];

                // get ids from Config and then get their emails
                return this.notifyGroupConfig.emailAdmin;
            }

            case NotifyUserGroup.EMAIL_USER: {
                const { idUser } = this.getContext();
                const user: DBAPI.User | null = await DBAPI.User.fetch(idUser);

                // if no notification settings or user, nothing so email not sent
                if(!user || !user.WorkflowNotificationTime) {
                    this.logCritical(LogSection.eSYS,'email user not found',{ idUser, user },'RecordKeeper.getEmailsFromGroup');
                    return [];
                }

                return [user.EmailAddress];
            }
        }

        return undefined;
    }
    static async sendEmail(type: NotifyType, group: NotifyUserGroup, subject: string, body: string, startDate?: Date, endDate?: Date, link?: { url: string, label: string }): Promise<IOResults> {

        // build our package
        const params: NotifyPackage = {
            type,
            message: subject,
            detailsMessage: body,
            startDate: startDate ?? new Date(),
            sendTo: await this.getEmailsFromGroup(group)
        };

        // our optional elements
        if(endDate) params.endDate = endDate;
        if(link) params.detailsLink = link;

        // if sendTo is empty, don't send message
        if(!params.sendTo || params.sendTo.length===0)
            return { success: false, message: 'cannot send email. no user to send to.' };

        // send our message out.
        // we await the result so we can catch and audit the failure
        this.logDebug(LogSection.eSYS,'sending email',{ sendTo: params.sendTo },'RecordKeeper.sendEmail',true);
        const emailResult = await NOTIFY.sendEmailMessage(params);
        if(emailResult.success===false)
            this.logError(LogSection.eSYS,'failed to send email',{ sendTo: params.sendTo },'RecordKeeper.sendEmail',true);

        // return the results
        return emailResult;
    }
    static async sendEmailRaw(type: NotifyType, sendTo: string[], subject: string, textBody: string, htmlBody?: string): Promise<IOResults> {

        // if sendTo is empty, don't send message
        if(!sendTo || sendTo.length===0)
            return { success: false, message: 'cannot send raw email. no user to send to.' };

        // send our email but also log it for auditing
        // we wait for results so we can log the failure
        this.logDebug(LogSection.eSYS,'sending raw email',{ sendTo },'RecordKeeper.sendEmailRaw',true);
        const emailResult = await NOTIFY.sendEmailMessageRaw(type, sendTo, subject, textBody, htmlBody);
        if(emailResult.success===false)
            this.logError(LogSection.eSYS,'failed to send raw email',{ sendTo },'RecordKeeper.sendEmailRaw',true);

        return emailResult;
    }
    static async emailTest(numEmails: number): Promise<IOResults> {
        return NOTIFY.testEmail(numEmails);
    }

    // slack
    private static async getSlackIDsFromGroup(group: NotifyUserGroup, forceUpdate: boolean = false): Promise<string[] | undefined> {
        switch(group) {

            case NotifyUserGroup.SLACK_ALL: {
                // see if we already initialized this
                if(this.notifyGroupConfig.slackAll && this.notifyGroupConfig.slackAll.length>0 && forceUpdate===true)
                    return this.notifyGroupConfig.slackAll;

                // otherwise, grab all active Users from DB and their emails
                return ['everyone'];
            }

            case NotifyUserGroup.SLACK_ADMIN: {
                // see if we already initialized this
                if(this.notifyGroupConfig.slackAdmin && this.notifyGroupConfig.slackAdmin.length>0 && forceUpdate===true)
                    return this.notifyGroupConfig.slackAdmin;

                // get ids from Config and then get their emails
                return ['ericmaslowski'];
            }

            case NotifyUserGroup.SLACK_USER: {
                // const { idUser } = this.getContext();
                // TODO: from current user id
                return ['undefined'];
            }
        }

        return undefined;
    }
    static async sendSlack(type: NotifyType, group: NotifyUserGroup, subject: string, body: string, channel?: SlackChannel, startDate?: Date, endDate?: Date, link?: { url: string, label: string }): Promise<IOResults> {
        // build our package
        const params: NotifyPackage = {
            type,
            message: subject,
            detailsMessage: body,
            startDate: startDate ?? new Date(),
            endDate,
            detailsLink: link,
            sendTo: await RecordKeeper.getSlackIDsFromGroup(group)
        };

        // send our message out.
        // we await the result so we can catch the failure.
        RecordKeeper.logDebug(LogSection.eSYS,'sending slack message',{ sendTo: params.sendTo },'RecordKeeper.sendSlack',false);
        const slackResult = await NOTIFY.sendSlackMessage(params,channel);
        if(slackResult.success===false)
            RecordKeeper.logError(LogSection.eSYS,'failed to send slack message',{ error: slackResult.data.error, sendTo: params.sendTo },'RecordKeeper.sendSlack',false);

        // return the results
        return slackResult;
    }
    private static async clearSlackChannel(channel?: SlackChannel): Promise<IOResults> {
        const clearResult = await NOTIFY.clearSlackChannel(channel);
        if(clearResult.success===false)
            RecordKeeper.logDebug(LogSection.eSYS, 'failed to clear Slack channel', { error: clearResult.data.error }, 'RecordKeeper.clearSlackChannel' );
        else
            RecordKeeper.logDebug(LogSection.eSYS, 'cleared Slack channel', { channel: clearResult.data.channel, count: clearResult.data.count }, 'RecordKeeper.clearSlackChannel');

        return clearResult;
    }
    static async slackTest(numMessages: number, clearChannel: boolean=true, channel?: SlackChannel): Promise<IOResults> {
        channel = channel ?? SlackChannel.PACKRAT_DEV;
        if(clearChannel)
            await RecordKeeper.clearSlackChannel(channel);

        return NOTIFY.testSlack(numMessages,channel);
    }
    //#endregion
}
