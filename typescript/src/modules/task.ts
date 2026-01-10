/**
 * Task Module - Report task status to RealtimeX
 * Used by external agents/processors to update task status
 */

export interface TaskStatusResponse {
    success: boolean;
    task_uuid: string;
    status: string;
    message?: string;
}

export class TaskModule {
    private realtimexUrl: string;
    private appName?: string;
    private appId?: string;

    constructor(realtimexUrl: string, appName?: string, appId?: string) {
        this.realtimexUrl = realtimexUrl.replace(/\/$/, '');
        this.appName = appName;
        this.appId = appId;
    }

    /**
     * Mark task as processing
     */
    async start(taskUuid: string, machineId?: string): Promise<TaskStatusResponse> {
        return this._sendEvent('task-start', taskUuid, { machine_id: machineId });
    }

    /**
     * Mark task as completed with result
     */
    async complete(taskUuid: string, result?: object, machineId?: string): Promise<TaskStatusResponse> {
        return this._sendEvent('task-complete', taskUuid, { result, machine_id: machineId });
    }

    /**
     * Mark task as failed with error
     */
    async fail(taskUuid: string, error: string, machineId?: string): Promise<TaskStatusResponse> {
        return this._sendEvent('task-fail', taskUuid, { error, machine_id: machineId });
    }

    private async _sendEvent(
        event: 'task-start' | 'task-complete' | 'task-fail',
        taskUuid: string,
        extra: { result?: object; error?: string; machine_id?: string }
    ): Promise<TaskStatusResponse> {
        const response = await fetch(`${this.realtimexUrl}/webhooks/realtimex`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                app_name: this.appName,
                app_id: this.appId,
                event,
                payload: {
                    task_uuid: taskUuid,
                    ...extra,
                },
            }),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Failed to ${event}`);
        return data as TaskStatusResponse;
    }
}
