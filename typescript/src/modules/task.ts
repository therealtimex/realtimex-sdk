/**
 * Task Module - Report task status to RealtimeX
 * Used by external agents/processors to update task status
 */

import {
    CONTRACT_EVENT_ID_HEADER,
    CONTRACT_SIGNATURE_HEADER,
    canonicalEventToLegacyAction,
    createContractEventId,
    normalizeAttemptId,
    signContractEvent,
} from './contract';
import { ContractEventType } from '../types';

export interface TaskStatusResponse {
    success: boolean;
    task_uuid: string;
    status: string;
    event_id?: string;
    attempt_id?: string;
    event_type?: ContractEventType | string;
    deduplicated?: boolean;
    duplicate?: boolean;
    message?: string;
}

export interface TaskEventOptions {
    machineId?: string;
    attemptId?: string | number;
    eventId?: string;
    timestamp?: string;
    callbackUrl?: string;
    callbackSecret?: string;
    sign?: boolean;
    userEmail?: string;
    activityId?: string;
    tableName?: string;
}

export class TaskModule {
    private realtimexUrl: string;
    private appName?: string;
    private appId?: string;
    private apiKey?: string;
    private callbackSecret?: string;
    private signCallbacksByDefault: boolean;

    constructor(realtimexUrl: string, appName?: string, appId?: string, apiKey?: string) {
        this.realtimexUrl = realtimexUrl.replace(/\/$/, '');
        this.appName = appName;
        this.appId = appId;
        this.apiKey = apiKey;
        this.callbackSecret = process.env.RTX_CONTRACT_CALLBACK_SECRET;
        this.signCallbacksByDefault = process.env.RTX_CONTRACT_SIGN_CALLBACKS === 'true';
    }

    /**
     * Configure callback signing behavior.
     */
    configureContract(config: { callbackSecret?: string; signCallbacksByDefault?: boolean }): void {
        if (typeof config.callbackSecret === 'string') {
            this.callbackSecret = config.callbackSecret;
        }
        if (typeof config.signCallbacksByDefault === 'boolean') {
            this.signCallbacksByDefault = config.signCallbacksByDefault;
        }
    }

    /**
     * Claim a task before processing.
     */
    async claim(taskUuid: string, options: TaskEventOptions = {}): Promise<TaskStatusResponse> {
        return this._sendEvent('task.claimed', taskUuid, {}, options);
    }

    /**
     * Alias for claim()
     */
    async claimed(taskUuid: string, options: TaskEventOptions = {}): Promise<TaskStatusResponse> {
        return this.claim(taskUuid, options);
    }

    /**
     * Mark task as processing.
     * Backward compatible signature: start(taskUuid, machineId?)
     */
    async start(taskUuid: string, machineIdOrOptions?: string | TaskEventOptions): Promise<TaskStatusResponse> {
        return this._sendEvent('task.started', taskUuid, {}, this._normalizeOptions(machineIdOrOptions));
    }

    /**
     * Report incremental task progress.
     */
    async progress(
        taskUuid: string,
        progressData: Record<string, unknown> = {},
        options: TaskEventOptions = {}
    ): Promise<TaskStatusResponse> {
        return this._sendEvent('task.progress', taskUuid, progressData, options);
    }

    /**
     * Mark task as completed with result.
     * Backward compatible signature: complete(taskUuid, result?, machineId?)
     */
    async complete(
        taskUuid: string,
        result: Record<string, unknown> = {},
        machineIdOrOptions?: string | TaskEventOptions
    ): Promise<TaskStatusResponse> {
        return this._sendEvent('task.completed', taskUuid, { result }, this._normalizeOptions(machineIdOrOptions));
    }

    /**
     * Mark task as failed with error.
     * Backward compatible signature: fail(taskUuid, error, machineId?)
     */
    async fail(
        taskUuid: string,
        error: string,
        machineIdOrOptions?: string | TaskEventOptions
    ): Promise<TaskStatusResponse> {
        return this._sendEvent('task.failed', taskUuid, { error }, this._normalizeOptions(machineIdOrOptions));
    }

    /**
     * Mark task as canceled.
     */
    async cancel(
        taskUuid: string,
        reason?: string,
        options: TaskEventOptions = {}
    ): Promise<TaskStatusResponse> {
        const payload = reason ? { error: reason } : {};
        return this._sendEvent('task.canceled', taskUuid, payload, options);
    }

    private _normalizeOptions(machineIdOrOptions?: string | TaskEventOptions): TaskEventOptions {
        if (!machineIdOrOptions) return {};
        if (typeof machineIdOrOptions === 'string') {
            return { machineId: machineIdOrOptions };
        }
        return machineIdOrOptions;
    }

    private async _sendEvent(
        event: ContractEventType,
        taskUuid: string,
        eventData: Record<string, unknown> = {},
        options: TaskEventOptions = {}
    ): Promise<TaskStatusResponse> {
        if (!taskUuid || !taskUuid.trim()) {
            throw new Error('taskUuid is required');
        }

        const attemptId = normalizeAttemptId(options.attemptId);
        const timestamp = options.timestamp || new Date().toISOString();
        const eventId = options.eventId || createContractEventId();
        const callbackUrl = options.callbackUrl;
        const targetUrl = callbackUrl || `${this.realtimexUrl}/webhooks/realtimex`;
        const sendingToMainWebhook = !callbackUrl;
        const includeAppAuth = sendingToMainWebhook || targetUrl.startsWith(this.realtimexUrl);
        const payloadData = eventData && typeof eventData === 'object' ? eventData : {};

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        headers[CONTRACT_EVENT_ID_HEADER] = eventId;

        if (includeAppAuth) {
            if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
            if (this.appId) headers['x-app-id'] = this.appId;
        }

        const callbackSecret = options.callbackSecret || this.callbackSecret;
        const shouldSign = options.sign ?? this.signCallbacksByDefault;
        if (shouldSign) {
            if (!callbackSecret) {
                throw new Error(
                    'Callback signing is enabled but no callbackSecret is configured. ' +
                    'Use task.configureContract({ callbackSecret }) or pass options.callbackSecret.'
                );
            }
            headers[CONTRACT_SIGNATURE_HEADER] = signContractEvent({
                secret: callbackSecret,
                eventId,
                eventType: event,
                taskId: taskUuid,
                attemptId,
                timestamp,
                payload: payloadData,
            });
        }

        const requestBody = sendingToMainWebhook
            ? {
                app_name: this.appName,
                app_id: this.appId,
                event,
                event_id: eventId,
                attempt_id: attemptId,
                payload: {
                    task_uuid: taskUuid,
                    machine_id: options.machineId,
                    timestamp,
                    attempt_id: attemptId,
                    ...payloadData,
                },
            }
            : {
                event,
                action: canonicalEventToLegacyAction(event),
                event_id: eventId,
                attempt_id: attemptId,
                machine_id: options.machineId,
                user_email: options.userEmail,
                activity_id: options.activityId,
                table_name: options.tableName,
                timestamp,
                data: payloadData,
            };

        const response = await fetch(targetUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
        });

        const responseData = await response.json();
        if (!response.ok) throw new Error(responseData.error || `Failed to ${event}`);
        return {
            ...(responseData as TaskStatusResponse),
            task_uuid: responseData.task_uuid || responseData.task_id || taskUuid,
            event_id: responseData.event_id || eventId,
            attempt_id: responseData.attempt_id || attemptId,
            event_type: responseData.event_type || event,
        };
    }
}
