"""FastAPI application factory.

Routes:
  /api/enrollment            — kiosk customer registration (Layer 3)
  /api/recognition           — edge-worker ingestion (Layer 2)
  /api/whatsapp/webhook      — Meta Cloud API inbound events (Layer 2)
  /api/whatsapp/send         — dashboard → outbound message (Layer 2)
  /api/auth/link-salesperson — dashboard → first-login auth linking (Layer 3)
  /api/auth/send-sms-hook    — Supabase Send SMS Auth Hook → WhatsApp OTP (module 14)
  /api/workshops             — workshops CRUD + staff roster (Phase 2B · module 14)
  /api/media                 — signed upload → complete → thumbnail (Phase 2B)
  /api/production            — allocate + the stage machine (Phase 2B · modules 08/09)
  /api/routing               — multi-workshop route legs + templates (module 14)
  /api/transfers             — inter-workshop consignments, the mediator app (module 14)
  /api/job-cards             — render/send the money-free spec sheet (Phase 2B)
  /api/stage-plan            — per-stage day budgets, skip, snooze (0035)
  /api/documents             — delivery challan render + signed URL (0037)
  /api/health                — liveness probe
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .api.auth import router as auth_router
from .api.auth_hooks import router as auth_hooks_router
from .api.enrollment import router as enrollment_router
from .api.job_cards import router as job_cards_router
from .api.media import router as media_router
from .api.orders import router as orders_router
from .api.payments import router as payments_router
from .api.production import router as production_router
from .api.public import router as public_router
from .api.quotations import router as quotations_router
from .api.recognition import router as recognition_router
from .api.documents import router as documents_router
from .api.routing import router as routing_router
from .api.stage_plan import router as stage_plan_router
from .api.transfers import router as transfers_router
from .api.whatsapp import router as whatsapp_router
from .api.workshops import router as workshops_router


def create_app() -> FastAPI:
    app = FastAPI(
        title="Topaz CRM API",
        version="0.3.0",
        docs_url=None,
        redoc_url=None,
    )

    # ─── CORS ────────────────────────────────────────────────────────────────
    # The API shipped with none, which made every browser-side call to it fail
    # in a way that reads as "network error": the request goes out, the response
    # is withheld from JavaScript. The customer approval page was the one caller
    # and now routes through a same-origin server action instead, but this stays
    # so the next browser-side call is not silently dead on arrival.
    #
    # An explicit origin list, never "*" — public endpoints act on a capability
    # token in the URL, and credentials are allowed for future authenticated
    # browser calls (a wildcard is invalid with credentials anyway).
    settings = get_settings()
    origins = [settings.DASHBOARD_URL.rstrip("/")]
    origins += [o.strip().rstrip("/") for o in settings.CORS_EXTRA_ORIGINS.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=sorted(set(origins)),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["*"],
        max_age=600,
    )

    app.include_router(enrollment_router, prefix="/api")
    app.include_router(recognition_router, prefix="/api")
    app.include_router(whatsapp_router, prefix="/api")
    app.include_router(auth_router, prefix="/api")
    # Called directly by Supabase's infra, signed with Standard Webhooks — no
    # DASHBOARD_API_KEY dependency (see api/auth_hooks.py's module docstring).
    app.include_router(auth_hooks_router, prefix="/api")
    app.include_router(quotations_router, prefix="/api")
    app.include_router(orders_router, prefix="/api")
    app.include_router(payments_router, prefix="/api")
    # Phase 2B (Make): workshops, media, allocation.
    app.include_router(workshops_router, prefix="/api")
    app.include_router(media_router, prefix="/api")
    app.include_router(production_router, prefix="/api")
    app.include_router(job_cards_router, prefix="/api")
    # Module 14 (multi-workshop routing + the mediator app).
    app.include_router(routing_router, prefix="/api")
    app.include_router(transfers_router, prefix="/api")
    # Per-stage day budgets + reminders (0035).
    app.include_router(stage_plan_router, prefix="/api")
    # Delivery challans (0037).
    app.include_router(documents_router, prefix="/api")
    # Public, token-gated (no dashboard key) — customer approval flow.
    app.include_router(public_router, prefix="/api")

    @app.get("/api/health", include_in_schema=False)
    async def health() -> dict:
        return {"status": "ok"}

    return app


app = create_app()
