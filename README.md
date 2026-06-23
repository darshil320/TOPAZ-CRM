# Topaz Showroom Intelligence & Sales Conversion System

Monorepo for the Topaz Furniture (Surat) showroom intelligence platform, built by **DMC Digital**.

> **Status:** Prototype phase. We are building the deal-closing prototype first — a live face-recognition → WhatsApp-alert demo — inside [`apps/prototype/`](apps/prototype/). The full phased build (Phase 1A → 1B → 2) follows the master implementation plan once the deal is signed.

## What this system is

A Sales Conversion Engine for a furniture showroom: recognise customers at the door (with consent), remember every visit, answer them on WhatsApp with an AI assistant grounded on real catalog + history, capture leads from Instagram/Facebook/Google, assign salespeople, and surface the whole pipeline on one dashboard.

## Monorepo layout

```
topaz-showroom-intelligence/
├── apps/
│   ├── prototype/     # ← BUILD NOW. Standalone face-rec → WhatsApp demo (laptop + webcam).
│   ├── edge/          # [planned] Jetson Orin Nano edge pipeline (RTSP → ArcFace → events)
│   ├── api/           # [planned] FastAPI backend (CRM, chatbot, webhooks, alerts)
│   └── dashboard/     # [planned] Next.js + Supabase realtime dashboard
├── packages/
│   └── shared/        # [planned] shared types / API contracts
├── infra/             # [planned] Docker, deploy config
└── docs/              # planning docs (see below)
```

See [`docs/MONOREPO.md`](docs/MONOREPO.md) for how each app maps to the master implementation plan, and [`docs/PROTOTYPE_PLAN.md`](docs/PROTOTYPE_PLAN.md) for the prototype build plan.

## Source planning documents

The full reconciled plan lives in the prospecting repo (`dmc-orchestrator/prospects/`):
`topaz-prd-v2.md` (technical) · `topaz-sow-v1.md` (scope) · `topaz-proposal-v2.md` (narrative) · `topaz-quote-v1.md` (pricing) · `topaz-feasibility-report.md` · `topaz-master-implementation-plan.md` (build order) · `topaz-prototype-and-kickoff-plan.md` (this prototype + kickoff).

## Quick start (prototype)

```bash
cd apps/prototype
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # configure notifier (console works with no creds)
python -m src.enroll --webcam --name "Hemant" --interest "7-seater sofa"
python -m src.demo            # live recognition → WhatsApp alert
python -m src.web             # (optional) live visit-log web view on http://localhost:8077
```

Full instructions: [`apps/prototype/README.md`](apps/prototype/README.md).
