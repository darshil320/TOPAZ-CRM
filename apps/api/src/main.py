"""FastAPI application factory.

Owns: /api/recognition, /api/health.
Stubs reserved: /api/whatsapp/webhook (Layer 2+), /api/customers (Layer 3+).
"""

from fastapi import FastAPI

from .api.recognition import router as recognition_router


def create_app() -> FastAPI:
    app = FastAPI(
        title="Topaz CRM API",
        version="0.1.0",
        docs_url=None,
        redoc_url=None,
    )

    app.include_router(recognition_router, prefix="/api")

    @app.get("/api/health", include_in_schema=False)
    async def health() -> dict:
        return {"status": "ok"}

    return app


app = create_app()
