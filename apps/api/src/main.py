"""FastAPI application factory.

Routes:
  /api/enrollment            — kiosk customer registration (Layer 3)
  /api/recognition           — edge-worker ingestion (Layer 2)
  /api/whatsapp/webhook      — Meta Cloud API inbound events (Layer 2)
  /api/whatsapp/send         — dashboard → outbound message (Layer 2)
  /api/auth/link-salesperson — dashboard → first-login auth linking (Layer 3)
  /api/health                — liveness probe
"""

from fastapi import FastAPI

from .api.auth import router as auth_router
from .api.enrollment import router as enrollment_router
from .api.orders import router as orders_router
from .api.payments import router as payments_router
from .api.public import router as public_router
from .api.quotations import router as quotations_router
from .api.recognition import router as recognition_router
from .api.whatsapp import router as whatsapp_router


def create_app() -> FastAPI:
    app = FastAPI(
        title="Topaz CRM API",
        version="0.3.0",
        docs_url=None,
        redoc_url=None,
    )

    app.include_router(enrollment_router, prefix="/api")
    app.include_router(recognition_router, prefix="/api")
    app.include_router(whatsapp_router, prefix="/api")
    app.include_router(auth_router, prefix="/api")
    app.include_router(quotations_router, prefix="/api")
    app.include_router(orders_router, prefix="/api")
    app.include_router(payments_router, prefix="/api")
    # Public, token-gated (no dashboard key) — customer approval flow.
    app.include_router(public_router, prefix="/api")

    @app.get("/api/health", include_in_schema=False)
    async def health() -> dict:
        return {"status": "ok"}

    return app


app = create_app()
