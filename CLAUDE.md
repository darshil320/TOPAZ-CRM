# CLAUDE.md — Topaz Showroom Intelligence & Sales Conversion System

Project instructions for Claude Code (and any AI implementation agent) working in this
monorepo. **These instructions override default behaviour. Follow them exactly.**

---

## What this project is

A custom **Sales Conversion Engine** for Topaz Furniture (a Surat showroom), built by
**DMC Digital** (Darshil). It recognises customers at the door (with consent), remembers
every visit, answers them on WhatsApp with an AI assistant grounded on real catalog +
history, captures leads from Instagram/Facebook/Google, assigns salespeople, and surfaces
the pipeline on one dashboard.

We are currently in the **prototype phase** ([`apps/prototype/`](apps/prototype/)) — a
laptop-only face-recognition → WhatsApp-alert demo whose job is to **close the deal**. The
full phased build follows once signed.

## Document hierarchy (authoritative order)

When scope/price/design questions arise, defer in this order. The build documents live in
the sibling prospecting repo (`dmc-orchestrator/prospects/`):

1. **SOW** (`topaz-sow-v1.md`) — contractual scope. Wins on scope conflicts.
2. **Quote** (`topaz-quote-v1.md`) — binding pricing.
3. **PRD** (`topaz-prd-v2.md`) — technical spec / FR source of truth.
4. **Master Implementation Plan** (`topaz-master-implementation-plan.md`) — build order, epics, acceptance gates.
5. **Feasibility Report** — binding technical/legal constraints.

**The PRD may not expand scope beyond the SOW without a written Change Request** (SOW §11,
₹8,000/day T&M). If a task implies out-of-scope work, flag it — don't silently build it.

## Monorepo layout & phase mapping

| Folder | Phase | Status |
|---|---|---|
| `apps/prototype` | Pre-sales deal-closer | **Active** |
| `apps/edge` | 1A · M1 (Jetson RTSP→ArcFace) | Planned |
| `apps/api` | 1A M2/M6A · 1B M3/M4/M5 (FastAPI) | Planned |
| `apps/dashboard` | 1A M6A · 1B M6B (Next.js) | Planned |
| `packages/shared` | shared contracts | Planned |
| `infra` | Docker/deploy/Jetson provisioning | Planned |

See [`docs/MONOREPO.md`](docs/MONOREPO.md) for the prototype→production reuse map.

---

## Non-negotiable domain constraints

These come from the feasibility report and are **binding** — violating them is a defect:

1. **DPDPA consent-first (highest legal risk).** No face embedding, capture photo, or
   match may exist for anyone without prior, explicit `face_tracking` consent. In the real
   build this is a hard gate (DB FK + service check). Passive/ambient capture is unlawful.
2. **WhatsApp 24-hour window.** Free-form rich replies only inside an open customer-service
   window; outside it, only pre-approved templates. Every outbound message must route
   through one send chokepoint that branches on the window.
3. **Price/stock from live DB tool calls, never embeddings.** Embeddings discover; the DB
   answers price/stock/availability.
4. **Build WhatsApp on a BSP (AiSensy), not raw Meta Cloud API** — sidesteps Meta App Review.
5. **Face recognition is a staff-assist insight tool, not an access gate** (85–95% field
   accuracy). Always expose a NEW/REPEAT/**UNCERTAIN** band; never auto-assert identity.

---

## Coding standards (this repo)

Aligned with the team's global rules. Enforce them:

- **Immutability.** Never mutate inputs in place; return new objects (see
  `Gallery.with_person`). No hidden side effects.
- **Many small, focused files.** ~200–400 lines typical, 800 max. Functions < 50 lines.
  Organise by feature/domain.
- **Explicit error handling at every boundary.** No silent failures. User-facing messages
  must be actionable (see the notifier constructors).
- **Validate external input** (webhooks, env, API responses, file content) at the boundary.
- **No hardcoded values at decision points.** Thresholds, templates, paths, recipients,
  ports → config/env, never literals in logic.
- **Import-light packages.** Heavy deps (InsightFace, OpenCV, Twilio, requests) are imported
  *lazily inside the function/branch that needs them*, never at module top of a shared
  package. This keeps the pure-logic core testable without ML deps installed. **Preserve
  this discipline** — it's why `pytest` runs anywhere.
- **Pure core, isolated from I/O.** Decision logic (matching, message copy, media URLs, web
  rendering) lives in pure functions with unit tests; I/O (camera, network, files) wraps them.

## Testing (mandatory)

- **TDD:** write the failing test first, then the minimal implementation, then refactor.
- **Target 80%+ coverage** on the logic core. Every pure module has a `tests/test_*.py`.
- The prototype's pure-logic suite must pass **without** InsightFace/OpenCV/Twilio installed:
  ```bash
  cd apps/prototype && python -m pytest tests/ -q
  ```
- Camera/ML/network paths are integration-tested manually (documented in the app README),
  not in the unit suite.
- Fix the implementation, not the test — unless the test is demonstrably wrong.

## Git & commits

- Conventional commits: `feat: …`, `fix: …`, `refactor: …`, `docs: …`, `test: …`, `chore: …`, `perf: …`, `ci: …`.
- Branch off the default branch for changes; **commit/push only when asked.**
- Never commit secrets, `.env`, the gallery, captures, or `visits.jsonl` (see `.gitignore`).
  **Biometric data must never enter version control.**

## Security

- Secrets via environment only; validate presence at startup; fail fast if missing.
- Webhooks authenticated (shared secret / signature).
- Encryption at rest for embeddings + PII in the production build; face data on-prem by default.
- Sanitise any path derived from a request (see `web._safe_capture_path`).

---

## How to run the prototype

```bash
cd apps/prototype
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -m src.enroll --webcam --name "Hemant" --interest "7-seater sofa"
python -m src.demo        # live recognition → WhatsApp alert
python -m src.web         # live visit-log view on http://localhost:8077
python -m pytest tests/ -q
```

## When building the next phase

1. Read this file → the PRD (§6–14, your FR source) → the SOW (§3/§7, scope ceiling + acceptance).
2. Work epic-by-epic in the master plan's dependency order. One epic = migration → API →
   service → UI → tests.
3. Reuse the prototype core (`faces/matching.py`, `faces/recognizer.py`, `notify/*`, `web.py`)
   rather than re-deriving it (see `docs/MONOREPO.md`).
4. Compliance is code: the consent gate, the 24h-window branch, and "price only via tool call"
   ship as enforced checks, not afterthoughts.
5. "Done" = FRs satisfied + tests green + the relevant master-plan acceptance gate demonstrably passes.
