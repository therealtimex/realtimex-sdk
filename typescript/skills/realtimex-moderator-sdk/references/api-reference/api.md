# sdk.api — Agents, Workspaces, Threads, Tasks

> Auto-generated from `@realtimex/sdk` source · v**1.7.18** · 2026-05-18

## `ApiModule`

### Methods

```ts
async getAgents(): Promise<Agent[]>

async getWorkspaces(): Promise<Workspace[]>

async getThreads(workspaceSlug: string): Promise<Thread[]>

async getTask(taskUuid: string): Promise<Task>
```
