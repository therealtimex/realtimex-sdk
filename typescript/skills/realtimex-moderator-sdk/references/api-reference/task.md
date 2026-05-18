# sdk.task — Task Lifecycle Reporting

> Auto-generated from `@realtimex/sdk` source · v**1.7.19** · 2026-05-18

## `TaskModule`

### Methods

```ts
// Configure callback signing behavior.
configureContract(config: { callbackSecret?: string; signCallbacksByDefault?: boolean }): void

// Claim a task before processing.
async claim(taskUuid: string, options: TaskEventOptions = {}): Promise<TaskStatusResponse>

// Alias for claim()
async claimed(taskUuid: string, options: TaskEventOptions = {}): Promise<TaskStatusResponse>

// Mark task as processing.
async start(taskUuid: string, machineIdOrOptions?: string | TaskEventOptions): Promise<TaskStatusResponse>

// Report incremental task progress.
async progress(taskUuid: string, progressData: Record<string, unknown> = {}, options: TaskEventOptions = {}): Promise<TaskStatusResponse>

// Mark task as completed with result.
async complete(taskUuid: string, result: Record<string, unknown> = {}, machineIdOrOptions?: string | TaskEventOptions): Promise<TaskStatusResponse>

// Mark task as failed with error.
async fail(taskUuid: string, error: string, machineIdOrOptions?: string | TaskEventOptions): Promise<TaskStatusResponse>

// Mark task as canceled.
async cancel(taskUuid: string, reason?: string, options: TaskEventOptions = {}): Promise<TaskStatusResponse>
```

## `TaskStatusResponse`

```ts
success: boolean
task_uuid: string
status: string
event_id?: string
attempt_id?: string
event_type?: ContractEventType | string
deduplicated?: boolean
duplicate?: boolean
message?: string
```

## `TaskEventOptions`

```ts
machineId?: string
attemptId?: string | number
eventId?: string
timestamp?: string
callbackUrl?: string
callbackSecret?: string
sign?: boolean
userEmail?: string
activityId?: string
tableName?: string
```
