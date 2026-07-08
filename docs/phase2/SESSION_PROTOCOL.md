# Phase 2 build — session protocol (paste target module, follow strictly)

Build session for Topaz Phase 2. Target: docs/phase2/modules/<NN-name>.md — this module ONLY.

## Context discipline (strict)
- Read ONLY: STATE.md, the target module spec, and files the spec names under "files to touch".
  Grep before any other read. Never list/read whole directories. Never re-read a file you just edited.
- Do not restate the plan, the architecture, or prior modules. STATE.md is the memory.
- Delegate code-location questions to a search subagent; act on its file:line answer.
- Output discipline: no code dumps in chat, no long explanations — build, run gates, report pass/fail
  in ≤10 lines.

## Work loop
1. Read spec. If anything is ambiguous, make the convention-consistent choice and log it in STATE.md
   "decisions" — do not ask the user unless it's money/RLS/schema-irreversible.
2. Implement exactly the spec scope. No adjacent improvements, no refactors outside named files.
3. Run the module's test gates (unit + empirical temp-DB harness for repos; tsc for dashboard).
   Fix until green.
4. Update STATE.md (status, decisions, discoveries for later modules). Commit with conventional message.
5. Stop. Do not start the next module.

## Special rules
- Modules 01, 05, 06, 13: enter plan mode first; user reviews before build.
- Milestone reviews: run code-reviewer + security-reviewer agents only in modules 07 and 13
  (and database-reviewer on each migration in 01/08) — not per file.
- Never touch: apps/edge, recognition pipeline, kiosk flow, consent seam.
- Secrets: never print or commit .env values.
