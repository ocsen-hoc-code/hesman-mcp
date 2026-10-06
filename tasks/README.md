# Tasks

This folder holds one spec per task, numbered in **recommended order**. The status overview lives in [`STATUS.md`](STATUS.md).

## Statuses

| Status | Meaning |
|---|---|
| `todo` | Not started. |
| `pending` | Started but not finished — in progress, or waiting on something (say what in *Progress notes*). |
| `done` | Meets **every** acceptance criterion and the *Verification* commands have been run. |

No other statuses. A cancelled task gets the reason in *Progress notes* and is removed from `STATUS.md`.

## Naming

`<milestone>-<sequence>-<short-name>.md` — e.g. `M0-03-language-registry.md`.
The sequence number is the recommended order; start a task only when everything in `depends_on` is `done`.

## Task template

```markdown
---
id: M0-01
title: Task title
status: todo          # todo | pending | done
priority: P0          # P0 blocks release · P1 high · P2 low
depends_on: []
updated: 2026-10-06
---

## Context              — why it matters, with evidence (file:line)
## Scope                — what to do
## Out of scope         — deliberately not done here
## Acceptance criteria  — verifiable checklist
## Verification         — commands to run
## Progress notes       — short log, newest first
```

## Changing a status

Update **both** places in the same commit:
1. `status` and `updated` in the task file's frontmatter.
2. The matching row in `STATUS.md`.

When a task moves to `done`, record the commit or PR that closed it in *Progress notes*.
