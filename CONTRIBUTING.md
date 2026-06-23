# Contributing

Workflow conventions for the Topaz Showroom Intelligence monorepo. See [`CLAUDE.md`](CLAUDE.md)
for the full coding standards and domain constraints.

## Setup (prototype)

```bash
cd apps/prototype
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

## Development loop (TDD)

1. **Write the failing test first** (`tests/test_*.py`).
2. Implement the minimal code to pass.
3. Refactor; keep functions < 50 lines, files < 800.
4. Run the suite + linter before committing:
   ```bash
   python -m pytest tests/ -q
   ruff check src tests        # if ruff installed: pip install ruff
   ruff format --check src tests
   ```

## Rules that CI and review enforce

- **Pure-logic suite must pass without ML deps** (InsightFace/OpenCV/Twilio not installed).
  Keep heavy imports lazy/local — never at the top of a shared package module.
- **No secrets, `.env`, gallery, captures, or `visits.jsonl` in git.** Biometric data never
  enters version control.
- **Immutability** — return new objects, don't mutate inputs.
- **Config not constants** — thresholds/templates/paths/ports come from `config.py`/env.
- Honour the domain constraints in `CLAUDE.md` (consent-first, 24h window, live price/stock,
  staff-assist framing).

## Commits

Conventional commits:

```
feat: add salesperson assignment to enquiry flow
fix: handle empty gallery in identify()
test: cover media URL traversal guard
docs: update prototype run instructions
```

Branch off the default branch. Open a PR; CI must be green. Commit/push only when the
work is requested to be committed.

## Adding a new app/package

Each `apps/*` and `packages/*` is self-contained with its own README, deps, and tests.
Update [`docs/MONOREPO.md`](docs/MONOREPO.md) when you add one, and reuse the prototype's
proven modules rather than re-deriving them.
