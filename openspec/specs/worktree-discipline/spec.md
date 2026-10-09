# worktree-discipline Specification

## Purpose

Worktree discipline guarantees no work ever lands directly on main and no work starts from a dirty tree, including trivial ops tasks that skip OpenSpec/BMAD ceremony.

## Requirements

### Requirement: Never work on main

All implementation and planning writes for an item SHALL happen in its worktree/branch. Direct commits to `main` are forbidden.

#### Scenario: Main commit attempt

- **WHEN** an agent attempts to commit item work on main
- **THEN** the guard aborts with "work on ticket branch" before writing

### Requirement: Dirty main aborts

Before creating a worktree, the guard SHALL check `git status --porcelain` on main. Any output aborts with "main is dirty, address it first" — no stash-and-continue, no exceptions.

#### Scenario: Clean main proceeds

- **WHEN** main is clean
- **THEN** the guard creates `.worktrees/<item-id>/` on branch `ticket/<id>-<slug>` and records both in the item file

#### Scenario: Guard runs before writing

- **WHEN** an item's ticket file is written before the guard runs
- **THEN** the guard aborts on the uncommitted file; correct order is guard-create first, then write inside the new worktree

### Requirement: Trivial ops still obey git discipline

Ops tasks that skip OpenSpec/BMAD ceremony SHALL still pass the main-clean check and work in a worktree on a ticket branch.

#### Scenario: Trivial fix flow

- **WHEN** a trivial ops task (e.g. bump an action version) is executed
- **THEN** it is built and committed on its ticket branch and merged to main, with the item file recording worktree and branch
