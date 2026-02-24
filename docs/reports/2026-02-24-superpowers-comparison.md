# Report: Claude Code — With vs Without Superpowers

**Date:** 2026-02-24
**Repo:** `~/git/claude-code-history-viewer`
**Plan:** `docs/plans/2026-02-23-superpowers-comparison.md`

---

## Setup

Two feature tasks, each run with and without the [obra/superpowers](https://github.com/obra/superpowers) plugin active. All runs started from commit `9e71e74` in isolated git worktrees. All runs used headless `claude -p ... --dangerously-skip-permissions`.

**Superpowers toggle:** `~/.claude/settings.json` → `enabledPlugins["superpowers@superpowers-dev"]`

| Session | Task | Superpowers | UUID |
|---|---|---|---|
| A1 | Export conversations | WITH | `d16d4656-342e-428f-b523-4e9f22d3a842` |
| A2 | Export conversations | WITHOUT | `d286dabb-3916-4bc4-9810-dc3590ee0936` |
| B1 | Cursor provider | WITH | `bbfc48ca-8aaf-4304-82d8-fcf5455558a3` |
| B2 | Cursor provider | WITHOUT | `dba2f4f7-e77b-40dc-b5ef-74c45abbb422` |

Session files are under `~/.claude/projects/-Users-a-conradty-git-claude-code-history-viewer--worktrees-<name>/`.

---

## Tool-sequence results

| Signal | A1 (export WITH) | A2 (export WITHOUT) | B1 (cursor WITH) | B2 (cursor WITHOUT) |
|---|---|---|---|---|
| **First tool** | `Skill(executing-plans)` | `EnterPlanMode` | `Skill(brainstorming)` | `EnterPlanMode` |
| **Total tool calls** | 230 | 75 | 159 | 122 |
| **Skill invocations** | 4 | 1 | 1 | 1 |
| **Skills used** | executing-plans, using-git-worktrees, brainstorming, writing-plans | executing-plans | brainstorming | executing-plans |
| **Task dispatches** | 0 | 4 | 2 | 3 |
| **TodoWrite calls** | 0 | 10 | 10 | 9 |
| **Bash calls** | 86 | 14 | 74 | 47 |
| **Edit calls** | 25 | 14 | 34 | 29 |
| **Write calls** | 12 | 6 | 2 | 2 |
| **AskUserQuestion** | 0 | 0 | 3 | 0 |
| **Outcome** | All checks passed | All checks passed | All checks passed | All checks passed |

---

## Observations

### 1. First tool call is the clearest signal

WITH superpowers, the first tool call is always a `Skill(...)` invocation. WITHOUT superpowers, the first tool call is always `EnterPlanMode`. This is the most reliable behavioral discriminator between the two conditions.

### 2. WITHOUT superpowers can still invoke Skill tools

Both A2 and B2 called `superpowers:executing-plans` once mid-session despite the plugin being disabled. The `Skill` tool remains registered in the tool set regardless of the plugin toggle — only the forced first-action injection is removed. This means "no superpowers" doesn't mean "no Skill calls"; it means the model is no longer coerced into making them.

### 3. WITH superpowers chose unexpected skills

- A1 used `superpowers:executing-plans` first — a plan doc already existed, so the model correctly picked the execution skill over writing-plans
- B1 used `superpowers:brainstorming` first — not `writing-plans` as predicted. The model assessed the ambiguity in the Cursor storage schema and chose to gather information before planning

This suggests the model weighs the injected skill menu contextually rather than defaulting to a fixed skill.

### 4. WITH superpowers = more total tool calls

- Export pair: A1 (230) vs A2 (75) — **3× more calls with superpowers**
- Cursor pair: B1 (159) vs B2 (122) — **~30% more calls with superpowers**

The overhead comes from skill loading, clarifying questions, and deeper verification loops before claiming completion.

### 5. WITHOUT superpowers used more Task dispatches

A2 dispatched 4 Task subagents; B2 dispatched 3. A1 dispatched 0; B1 dispatched 2. The WITHOUT sessions used Claude Code's `EnterPlanMode` → subagent pattern. The WITH sessions (especially A1 using `executing-plans`) ran everything in a single agent with no subagents, relying on the skill's structured loop instead.

### 6. WITH superpowers slowed down to ask questions

B1 asked 3 `AskUserQuestion` calls before touching any files, probing the Cursor SQLite schema. B2 went straight to a research loop. The brainstorming skill apparently instructs the model to surface unknowns before proceeding.

### 7. All implementations passed verification

All 4 sessions produced working code. The quality difference (if any) is not measurable from tool call counts alone — it would require a code review of each worktree's output.

---

## What to look at in the Session Board

Pin sessions A1 + A2 (export pair) and B1 + B2 (cursor pair) side by side.

**Strongest visual signals:**
- First assistant message: skill announcement vs. plan mode entry
- Early tool call sequence: Skill → TodoWrite → ... vs. EnterPlanMode → Task → Task → ...
- AskUserQuestion blocks (present only in B1)
- Total message count and Bash density

**Session paths for the viewer:**
```
A1: ~/.claude/projects/-Users-a-conradty-git-claude-code-history-viewer/
A2: ~/.claude/projects/-Users-a-conradty-git-claude-code-history-viewer--worktrees-export-no-superpowers/
B1: ~/.claude/projects/-Users-a-conradty-git-claude-code-history-viewer--worktrees-cursor-with-superpowers/
B2: ~/.claude/projects/-Users-a-conradty-git-claude-code-history-viewer--worktrees-cursor-no-superpowers/
```
