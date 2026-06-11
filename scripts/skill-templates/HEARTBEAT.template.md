# Heartbeat Instructions

## Mission

Describe the ambient agent's standing responsibility.

## Scheduled tasks (optional)

Remove this section if you don't need recurring tasks.
When present, the scheduler runs only tasks that are due on each tick.
Tasks without an interval inherit the main check interval.
Use `interval` for simple timing. Supported units are `m`, `h`, and `d`, for example `3m`, `1h`, or `1d`.
Use `cron` for complex schedules, for example `0 9 * * *`.
Use `agent` to run a task with a specific terminal agent, for example `@codex-terminal`.
Use `model` to run a task with a specific model, for example `gpt-5.5-medium`.
Use `skills` to prefer skills for the task, for example `agent-browser, realtimex-moderator-sdk`.
Use `executor: shell` and `command` to run a shell command instead of an agent.
`agent`, `model`, `skills`, `executor`, `command`, `interval`, and `cron` are optional. If omitted, the task inherits from the main heartbeat executor.
When a shell command prints valid JSON, it can trigger additional tasks. Use one of these forms:

```json
["task-name-1", "task-name-2"]
```

```json
{
  "tasks": ["task-name-1", "task-name-2"],
  "reason": "metrics changed"
}
```

To trigger tasks in another workspace, include `workspace`:

```json
{
  "workspace": "other-workspace-slug",
  "tasks": ["task-name-1"],
  "reason": "shared dependency changed"
}
```

Only valid JSON triggers task dispatch. If the shell output is not valid JSON, no extra tasks are run.

tasks:

- name: example-task
  interval: 30m
  agent: @codex-terminal
  model: gpt-5.5-medium
  skills: agent-browser, realtimex-moderator-sdk
  prompt: Describe what the agent should do for this task
- name: weekday-morning-task
  cron: 0 9 * * 1-5
  prompt: Describe what should run on a cron schedule
- name: sync-metrics
  interval: 30m
  executor: shell
  command: bash ./scripts/sync-metrics.sh
- name: another-task
  prompt: Tasks without interval run at the main check interval

## Check for

- Pending tasks that require follow-up
- New events that need awareness

## When action is needed

- State what should trigger action
- Describe the preferred next step
- If calendar routine context is provided, use it only when a concise update would help

## When nothing is needed

- Reply exactly HEARTBEAT_OK

## Allowed actions

- Review the current workspace context
- Create or update relevant artifacts when necessary

## Never do

- Do not repeat old work without a clear reason
- Do not take destructive actions without explicit approval

## Style

- Be concise
- Prefer concrete updates over speculation
