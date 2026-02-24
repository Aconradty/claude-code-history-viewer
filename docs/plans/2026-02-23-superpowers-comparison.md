# Plan: Superpowers Behavior Comparison

Compare Claude Code behavior with and without [obra/superpowers](https://github.com/obra/superpowers) using two real feature tasks on this codebase, then visualize the results in this app's Session Board.

---

## Context

**What superpowers injects:** Every session start, the `session-start.sh` hook fires and injects `<EXTREMELY_IMPORTANT>` context containing the full `using-superpowers` skill. This forces the model to invoke the `Skill` tool before ANY response if there's ≥1% chance a skill applies — including clarifying questions.

**Skills installed from superpowers** (in `~/.claude/skills/`):

| Skill | Trigger condition |
|---|---|
| `writing-plans` | Feature request, multi-step task |
| `systematic-debugging` | Any bug, test failure, unexpected behavior |
| `dispatching-parallel-agents` | 2+ independent failures or tasks |
| `subagent-driven-development` | Implementation plan with independent tasks |
| `verification-before-completion` | Claiming work is done |
| `finishing-a-development-branch` | Branch complete, ready to merge |

**Superpowers toggle:** `~/.claude/settings.json` → `enabledPlugins["superpowers@superpowers-dev"]`

---

## Sessions overview

| ID | Case | Superpowers | Status | Worktree |
|---|---|---|---|---|
| A1 | Export conversations | WITH | **Existing** (`d16d4656`) | — |
| A2 | Export conversations | WITHOUT | **New run** | `.worktrees/export-no-superpowers` |
| B1 | Cursor provider | WITH | **New run** | `.worktrees/cursor-with-superpowers` |
| B2 | Cursor provider | WITHOUT | **New run** | `.worktrees/cursor-no-superpowers` |

All runs use **headless `-p` mode** for a fair comparison. 3 new runs needed.

---

## Base state

All worktrees start from `main` at commit `9e71e74` — clean, with neither export nor cursor feature.

```
main (9e71e74)   ← base for all 3 new worktrees
  └── feat/export-conversations (f870b60)   ← already completed WITH superpowers
```

**WIP cursor files on main (untracked):** Must be stashed before creating worktrees so that
the worktrees start from a truly clean base. Do NOT pop the stash until all runs are complete.

```bash
# Run this once, before anything else
git -C ~/git/claude-code-history-viewer stash push --include-untracked \
  -m "WIP cursor provider before comparison runs"
```

Files stashed:
- `src-tauri/src/providers/cursor.rs`
- `src-tauri/src/providers/mod.rs` (modified)
- `src-tauri/src/commands/multi_provider.rs` (modified)
- `src/types/core/session.ts` (modified)
- `src/utils/providers.ts` (modified)
- `PLAN.md`

**Existing WITH superpowers session** for export:
`~/.claude/projects/-Users-a-conradty-git-claude-code-history-viewer/d16d4656-342e-428f-b523-4e9f22d3a842.jsonl`
(Feb 22, 08:08–17:02, ~9h, 954 lines, used `superpowers:executing-plans`)

---

## Case A: Export Conversations

The export feature is already implemented and committed. We have the WITH session.
We need only the WITHOUT run.

### A1 — WITH superpowers (existing, no new work)

Session `d16d4656` in the Session Board. Key things already visible:

- `superpowers:executing-plans` skill invoked as first action
- Followed plan doc `docs/plans/2026-02-22-export-conversations.md` step by step
- Subagent dispatches per task with two-stage spec + quality review
- TodoWrite items created from skill checklist
- Commits are atomic and match plan steps exactly

### A2 — WITHOUT superpowers (new run)

```bash
# Disable superpowers first (see Execution sequence below)

git -C ~/git/claude-code-history-viewer worktree add \
  .worktrees/export-no-superpowers 9e71e74

cd ~/git/claude-code-history-viewer/.worktrees/export-no-superpowers
claude -p "Implement an export conversations feature. \
  Users should be able to select sessions and export them as markdown files. \
  The feature needs a UI (checkboxes, action bar), state management (Redux slice), \
  a sessionToMarkdown utility, and a Tauri write_file command." \
  --dangerously-skip-permissions
```

**Expected WITHOUT behavior:**
- No Skill tool invocations
- No plan document created first
- Likely dives straight into code in one session
- Tasks executed sequentially, no subagents
- No two-stage review
- May skip or do minimal tests

---

## Case B: Cursor Provider

Both WITH and WITHOUT runs implement the cursor provider from scratch starting at `9e71e74`.
(The WIP cursor.rs on main is stashed and serves as human ground truth only.)

**Shared prompt for B1 and B2:**
```
Add Cursor AI as a fourth provider. Cursor stores conversation history in SQLite DBs
under ~/Library/Application Support/Cursor/User/. Match the pattern of the existing
Claude/Codex/OpenCode providers.
```

### B1 — WITH superpowers (new run)

```bash
# Re-enable superpowers before this run (see Execution sequence below)

git -C ~/git/claude-code-history-viewer worktree add \
  .worktrees/cursor-with-superpowers 9e71e74

cd ~/git/claude-code-history-viewer/.worktrees/cursor-with-superpowers
claude -p "Add Cursor AI as a fourth provider. Cursor stores conversation history in \
  SQLite DBs under ~/Library/Application Support/Cursor/User/. Match the pattern of \
  the existing Claude/Codex/OpenCode providers." \
  --dangerously-skip-permissions
```

**Expected WITH behavior:**
- Invokes `writing-plans` → creates `docs/plans/YYYY-MM-DD-cursor-provider.md`
- Invokes `subagent-driven-development` → dispatches subagents per task (backend, frontend types, wiring, tests)
- Each subagent gets spec compliance review then code quality review
- Commits after each task

### B2 — WITHOUT superpowers (new run)

```bash
# Disable superpowers first (see Execution sequence below)

git -C ~/git/claude-code-history-viewer worktree add \
  .worktrees/cursor-no-superpowers 9e71e74

cd ~/git/claude-code-history-viewer/.worktrees/cursor-no-superpowers
claude -p "Add Cursor AI as a fourth provider. Cursor stores conversation history in \
  SQLite DBs under ~/Library/Application Support/Cursor/User/. Match the pattern of \
  the existing Claude/Codex/OpenCode providers." \
  --dangerously-skip-permissions
```

**Expected WITHOUT behavior:**
- Goes straight to creating cursor.rs
- Single agent, sequential implementation
- No plan doc, no staged commits
- May miss edge cases caught by systematic review

---

## Execution sequence

Run steps in this exact order to minimize superpowers toggling:

```
1. Commit the plan doc to main so it is not swept into the stash:
   git add docs/plans/2026-02-23-superpowers-comparison.md
   git commit -m "docs: add superpowers comparison plan"

2. Stash WIP cursor files:
   git stash push --include-untracked -m "WIP cursor provider before comparison runs"

3. Create all 3 worktrees (all at 9e71e74):
   git worktree add .worktrees/export-no-superpowers    9e71e74
   git worktree add .worktrees/cursor-with-superpowers  9e71e74
   git worktree add .worktrees/cursor-no-superpowers    9e71e74

3. Disable superpowers:
   ~/.claude/settings.json → "superpowers@superpowers-dev": false

4. Run A2 (export WITHOUT superpowers) — session UUID recorded below
   cd .worktrees/export-no-superpowers
   claude -p "Implement an export conversations feature. ..." --dangerously-skip-permissions

5. Run B2 (cursor WITHOUT superpowers) — session UUID recorded below
   cd .worktrees/cursor-no-superpowers
   claude -p "Add Cursor AI as a fourth provider. ..." --dangerously-skip-permissions

6. Re-enable superpowers:
   ~/.claude/settings.json → "superpowers@superpowers-dev": true

7. Run B1 (cursor WITH superpowers) — session UUID recorded below
   cd .worktrees/cursor-with-superpowers
   claude -p "Add Cursor AI as a fourth provider. ..." --dangerously-skip-permissions

8. Note all session UUIDs from:
   ~/.claude/projects/-Users-a-conradty-git-claude-code-history-viewer-worktrees-<name>/

9. Build app: pnpm tauri:dev (from main repo, not a worktree)

10. Open Session Board → pin A1 (existing) + A2 + B1 + B2

11. Run diff script (see below) → fill in UUIDs first
```

---

## Session UUIDs (fill in after runs)

| Session | UUID | Status | Path |
|---|---|---|---|
| A1 (export WITH) | `d16d4656-342e-428f-b523-4e9f22d3a842` | Complete | `~/.claude/projects/-Users-a-conradty-git-claude-code-history-viewer/` |
| A2 (export WITHOUT) | `d286dabb-3916-4bc4-9810-dc3590ee0936` | Complete | `~/.claude/projects/-Users-a-conradty-git-claude-code-history-viewer--worktrees-export-no-superpowers/` |
| B1 (cursor WITH) | `bbfc48ca-8aaf-4304-82d8-fcf5455558a3` | **Incomplete — hit rate limit before implementation** | `~/.claude/projects/-Users-a-conradty-git-claude-code-history-viewer--worktrees-cursor-with-superpowers/` |
| B2 (cursor WITHOUT) | `dba2f4f7-e77b-40dc-b5ef-74c45abbb422` | Complete | `~/.claude/projects/-Users-a-conradty-git-claude-code-history-viewer--worktrees-cursor-no-superpowers/` |

**To resume B1** (after rate limit resets at 6am Europe/Berlin):
```bash
cd ~/git/claude-code-history-viewer/.worktrees/cursor-with-superpowers
claude -p "Looks good. Please implement it." \
  --resume bbfc48ca-8aaf-4304-82d8-fcf5455558a3 \
  --dangerously-skip-permissions
```

---

## Capture & comparison

### Tool-sequence diff script

Run after all sessions (fill in UUIDs from table above first):

```bash
python3 - <<'EOF'
import json, sys
from collections import Counter

def tool_sequence(path):
    seq = []
    for line in open(path):
        obj = json.loads(line)
        if obj.get('type') == 'assistant':
            content = obj.get('message', {}).get('content', [])
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get('type') == 'tool_use':
                        name = block.get('name', '')
                        # For Skill calls, include which skill (input field is 'skill', not 'name')
                        if name == 'Skill':
                            skill_name = block.get('input', {}).get('skill', '?')
                            seq.append(f'Skill({skill_name})')
                        else:
                            seq.append(name)
    return seq

sessions = {
    'A1_with':    '/Users/a.conradty/.claude/projects/-Users-a-conradty-git-claude-code-history-viewer/d16d4656-342e-428f-b523-4e9f22d3a842.jsonl',
    'A2_without': '/Users/a.conradty/.claude/projects/-Users-a-conradty-git-claude-code-history-viewer--worktrees-export-no-superpowers/d286dabb-3916-4bc4-9810-dc3590ee0936.jsonl',
    'B1_with':    '/Users/a.conradty/.claude/projects/-Users-a-conradty-git-claude-code-history-viewer--worktrees-cursor-with-superpowers/bbfc48ca-8aaf-4304-82d8-fcf5455558a3.jsonl',
    'B2_without': '/Users/a.conradty/.claude/projects/-Users-a-conradty-git-claude-code-history-viewer--worktrees-cursor-no-superpowers/dba2f4f7-e77b-40dc-b5ef-74c45abbb422.jsonl',
}

for label, path in sessions.items():
    seq = tool_sequence(path)
    counts = Counter(seq)
    print(f'\n{label}:')
    print(f'  Total tool calls: {len(seq)}')
    print(f'  Skill invocations: {counts.get("Skill", 0)} — ' +
          ', '.join(f'{k}={v}' for k, v in counts.items() if k.startswith("Skill(")))
    print(f'  Task dispatches: {counts.get("Task", 0)}')
    print(f'  First 10 tools: {seq[:10]}')
EOF
```

### Viewing in Session Board

1. Build and open the app: `pnpm tauri:dev`
2. Navigate to the project in the left sidebar
3. Open Session Board
4. Pin sessions: A1 (with) | A2 (without) | B1 (with) | B2 (without)
5. Focus on:
   - **Tool sequence column**: Skill invocations present/absent
   - **First assistant message**: Does it announce "Using [skill]"?
   - **Task tool chains**: Parallel subagent dispatch vs. single-agent
   - **TodoWrite blocks**: Skill checklist items vs. freeform todos
   - **File operations**: Plan doc created first vs. code first
   - **Commit patterns**: Atomic per-task vs. bulk

---

## What to measure

| Signal | WITH superpowers | WITHOUT superpowers |
|---|---|---|
| First tool call | `Skill(writing-plans)` or `Skill(systematic-debugging)` | `Bash` or `Read` |
| Plan doc created | Yes, before any code | No |
| Subagent dispatches | Multiple (one per task) | Zero or one |
| Skill announcements | `"I'm using the X skill to..."` | Absent |
| TodoWrite source | Skill checklist items | Self-generated or absent |
| Commit granularity | One commit per plan step | Bulk or none |
| Review stage | Two-stage (spec + quality) per task | None |
| Total tool calls | Higher (skill overhead) | Lower |
| Response to "all done" | Runs verification before claiming | Accepts/summarizes |

---

## Execution checklist

- [x] Commit plan doc to main (`git add docs/plans/... && git commit`)
- [x] Stash WIP cursor files from main (`git stash push --include-untracked`)
- [x] Create worktree: `.worktrees/export-no-superpowers` at `9e71e74`
- [x] Create worktree: `.worktrees/cursor-with-superpowers` at `9e71e74`
- [x] Create worktree: `.worktrees/cursor-no-superpowers` at `9e71e74`
- [x] Disable superpowers in `~/.claude/settings.json`
- [x] Run A2: export WITHOUT superpowers (initial plan run + continuation)
- [x] Run B2: cursor WITHOUT superpowers (initial plan run + continuation)
- [x] Re-enable superpowers in `~/.claude/settings.json`
- [x] Run B1: cursor WITH superpowers (initial run + schema investigation + plan written)
- [x] Resume B1 after rate limit reset — implementation complete (280 tests passing)
- [x] Fill in session UUIDs in the table and diff script above
- [x] Run diff script → results captured in Findings section below
- [ ] Open Session Board → pin all 4 sessions (A1 + A2 + B1 + B2)
- [ ] Screenshot / record Session Board for each pair (A and B)
- [ ] Write up findings

---

## Findings

### Tool-sequence results

| Signal | A1 (export WITH sp) | A2 (export WITHOUT sp) | B1 (cursor WITH sp) | B2 (cursor WITHOUT sp) |
|---|---|---|---|---|
| **First tool** | `Skill(executing-plans)` | `EnterPlanMode` | `Skill(brainstorming)` | `EnterPlanMode` |
| **Total tool calls** | 230 | 75 | 159 | 122 |
| **Skill invocations** | 4 | 1 | 1 | 1 |
| **Task dispatches** | 0 | 4 | 2 | 3 |
| **TodoWrite calls** | 0 | 10 | 10 | 9 |
| **Bash calls** | 86 | 14 | 74 | 47 |
| **Edit calls** | 25 | 14 | 34 | 29 |
| **Write calls** | 12 | 6 | 2 | 2 |

### Key observations

1. **WITH superpowers always starts with a Skill call** — A1 opened with `executing-plans`, B1 opened with `brainstorming`. WITHOUT superpowers always opened with `EnterPlanMode` instead.

2. **WITHOUT superpowers sessions also invoked Skill tools** — both A2 and B2 called `superpowers:executing-plans` once mid-session. The Skill tool is available regardless of the plugin toggle; only the forced first-action injection is removed.

3. **WITH superpowers chose unexpected skills** — A1 used `executing-plans` (a plan already existed), B1 used `brainstorming` (not `writing-plans` as predicted). Suggests the model weighs the injected skill menu contextually.

4. **WITHOUT superpowers used more Task dispatches** (A2: 4, B2: 3) than WITH superpowers (A1: 0, B1: 2). Counterintuitive — `executing-plans` runs everything in-session without subagents.

5. **WITH superpowers used significantly more total tool calls** — A1 (230) vs A2 (75): 3× more. B1 (159) vs B2 (122): ~30% more. Heavier exploration and verification loops.

6. **B1 asked 3 clarifying questions** (`AskUserQuestion`) before touching any files — B2 went straight to research. WITH superpowers slowed down to gather requirements first.

7. **All 4 sessions produced working implementations** — all verification checks (cargo test, pnpm vitest) passed for the 3 new runs.
