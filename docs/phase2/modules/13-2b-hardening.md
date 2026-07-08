# 13 — 2B hardening: workshop RLS, E2E, pilot, rollout

PLAN MODE REQUIRED (RLS).

## RLS completion
- workshop_manager: SELECT order_items/orders limited to assigned items — and BLIND to all money columns/tables (payments, schedules, quotation totals; expose item specs only — use a `workshop_items` view exposing safe columns; RLS on view pattern or column-level via view-only grant).
- delivery role placeholder policies (ready-status orders read).
- Extend test_rls.py: workshop manager cannot select payments (0 rows / error), cannot see other workshops' items, cannot see grand_total.

## E2E
- Playwright spec 2: allocate → PWA login (workshop role) → advance 3 stages w/ photo → board reflects → customer message row created → block/unblock.

## Reviews
- code-reviewer full 2B diff, empirical-verify top findings. security-reviewer: media signed URLs, workshop money-blindness, public surface re-check.

## Pilot (USER-led, AI support)
- Pick 1 workshop, 2-3 live orders. 2 weeks. Daily fix loop: pilot friction → same-day patches.
- Success bar: >80% stage events entered same-day (query audit), manager unaided after session 1.
- docs/phase2/UAT_2B.md + TRAINING_2B.md (Gujarati one-pager w/ screenshots).

## Rollout + close
- All workshops onboarded; training session 2; handover: docs/phase2/RUNBOOK.md (deploys, backups check, template management, common support fixes).
- STATE.md all modules → verified. Milestone invoice. Retro notes → seeds 2C scoping (delivery mgmt, reports pack, feedback/repeat nudges, search/calendar).

## Gates
- RLS suite + E2E green; reviewer findings closed; pilot success bar met; sign-off logged.
