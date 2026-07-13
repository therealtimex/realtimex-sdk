# Heartbeat Instructions

## Mission

Describe the ambient agent's standing responsibility.

## Tasks

The scheduler evaluates this `tasks:` block on every heartbeat tick and runs only tasks that are due.
The first task is treated as the default task unless another task has `default: true`.
Use `default: true` on exactly one task to make it the default manual heartbeat target.
Use `default: false` on the first task if you do not want any task to be auto-selected as default.
Use `interval` for simple timing. Supported units are `m`, `h`, and `d`, for example `3m`, `1h`, or `1d`.
Omit `interval` and `cron` to run on every scheduler check interval.
Use `interval: disabled` to keep a task in the file but skip it during scheduled heartbeat checks. Manual triggers can still run the task.
Use `cron` for complex schedules, for example `0 9 * * *`.
Agent tasks require `agent`, for example `@codex`.
Use `model` to run an agent task with a specific model, for example `gpt-5.5-medium`.
Use `skills` to prefer skills for an agent task, for example `agent-browser, realtimex-moderator-sdk`.
Use `executor: shell` and `command` to run a shell command instead of an agent. Shell tasks do not use `prompt`.
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

- name: default-review
  default: true
  interval: 30m
  agent: @codex
  model: gpt-5.5-medium
  skills: agent-browser, realtimex-moderator-sdk
  prompt: Review the workspace context and respond HEARTBEAT_OK when no action is needed
- name: weekday-morning-task
  cron: 0 9 * * 1-5
  agent: @codex
  prompt: Describe what should run on a cron schedule
- name: sync-metrics
  interval: 30m
  executor: shell
  command: bash ./scripts/sync-metrics.sh
- name: paused-task
  interval: disabled
  agent: @codex
  prompt: This task is skipped by scheduled heartbeat checks until re-enabled
- name: another-task
  agent: @codex
  prompt: Tasks without interval or cron run on every scheduler check interval

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
