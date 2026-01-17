/**
 * API Module - Call RealtimeX public APIs
 */

import { Agent, Workspace, Thread, Task } from '../types';

export class ApiModule {
    private realtimexUrl: string;
    private appId: string;

    constructor(realtimexUrl: string, appId: string) {
        this.realtimexUrl = realtimexUrl.replace(/\/$/, '');
        this.appId = appId;
    }

    private getHeaders(): HeadersInit {
        return {
            'Content-Type': 'application/json',
            'x-app-id': this.appId,
        };
    }

    async getAgents(): Promise<Agent[]> {
        const response = await fetch(`${this.realtimexUrl}/agents`, {
            headers: this.getHeaders(),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to get agents');
        return data.agents;
    }

    async getWorkspaces(): Promise<Workspace[]> {
        const response = await fetch(`${this.realtimexUrl}/workspaces`, {
            headers: this.getHeaders(),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to get workspaces');
        return data.workspaces;
    }

    async getThreads(workspaceSlug: string): Promise<Thread[]> {
        const response = await fetch(`${this.realtimexUrl}/workspaces/${encodeURIComponent(workspaceSlug)}/threads`, {
            headers: this.getHeaders(),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to get threads');
        return data.threads;
    }

    async getTask(taskUuid: string): Promise<Task> {
        const response = await fetch(`${this.realtimexUrl}/task/${encodeURIComponent(taskUuid)}`, {
            headers: this.getHeaders(),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to get task');
        return { ...data.task, runs: data.runs };
    }
}
