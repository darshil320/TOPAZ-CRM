"""Runtime configuration via environment variables (pydantic-settings)."""

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Supabase Postgres — must use asyncpg scheme for SQLAlchemy async engine.
    DATABASE_URL: str
    REDIS_URL: str = "redis://localhost:6379/0"

    # ─── API connection pool (database.get_api_session) ──────────────────────
    # A session-mode Supabase pooler has a finite client-connection budget that
    # the API shares with every Celery worker, so these are deployment facts.
    # pool_size + max_overflow is the ceiling this process can hold at once.
    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 5
    # Fail a saturated pool fast rather than hanging a manager's phone.
    DB_POOL_TIMEOUT_SECONDS: int = 10
    # Under Supabase's own idle-connection timeout, so a recycled connection is
    # replaced by us before it is closed under us.
    DB_POOL_RECYCLE_SECONDS: int = 900
    # SET THIS TRUE IF DATABASE_URL POINTS AT A TRANSACTION-MODE POOLER
    # (Supabase's port 6543). Transaction mode can hand consecutive statements to
    # different server connections, which invalidates SQLAlchemy's per-connection
    # prepared-statement cache and surfaces as intermittent
    # "prepared statement __asyncpg_stmt_N__ does not exist".
    # The deployed URL is the SESSION pooler (port 5432 — see docs/HANDOFF.md), where
    # a client connection owns its server connection and the cache is safe and faster,
    # hence the default. This was harmless while every request built its own engine;
    # it matters now that connections are reused.
    DB_DISABLE_PREPARED_STATEMENT_CACHE: bool = False

    # Pre-shared key the edge worker sends in the API-Key header.
    EDGE_API_KEY: str

    # Recognition band thresholds (tune from real-camera data per §19-D).
    MATCH_THRESHOLD: float = 0.45
    NEW_THRESHOLD: float = 0.30

    # pgvector HNSW search-time ef parameter (higher = better recall, slower).
    HNSW_EF_SEARCH: int = 40

    # Server-side floor on the edge-reported face quality score; detections
    # below it are dropped before matching (tune alongside the edge QUALITY_FLOOR).
    QUALITY_FLOOR: float = 0.2

    # WhatsApp Cloud API (Meta). Leave unset in dev to skip WA sends.
    WA_PHONE_NUMBER_ID: str | None = None   # WhatsApp Business phone-number ID
    WA_TOKEN: str | None = None              # Meta System User access token
    WA_WEBHOOK_VERIFY_TOKEN: str | None = None  # random string used in hub.verify
    WA_APP_SECRET: str | None = None         # Meta App Secret — signs X-Hub-Signature-256

    # §19-E kiosk consent seam: how long a kiosk enrollment stays claimable by
    # the entrance camera as a pending consent token.
    ENROLLMENT_PENDING_WINDOW_SECONDS: int = 120

    # Per-customer salesperson-alert throttle: once a REPEAT alert fires for a
    # customer, further REPEAT detections within this window do NOT re-alert or
    # re-draft (one alert per walk-in session, not per camera frame).
    ALERT_COOLDOWN_MINUTES: int = 30

    # Cadence engine (followups table + Celery beat).
    WELCOME_FOLLOWUP_DELAY_MINUTES: int = 120   # kiosk enrollment → welcome message
    FOLLOWUP_BATCH_SIZE: int = 25               # max sends per beat tick
    FOLLOWUP_STALE_DAYS: int = 3                # pending past due → cancelled

    # Showroom's public contact number — the FALLBACK advisor number in the welcome
    # message when the customer has not been claimed by a primary salesperson yet.
    # Never blank in practice: Meta rejects a template send with an empty parameter, so
    # an unclaimed customer must still get a real number to call.
    SHOWROOM_CONTACT_NUMBER: str = "+91 63563 20206"
    # Send the welcome via `topaz_welcome_v2` (adds {{advisor_phone}}) instead of
    # `topaz_welcome`. Held FALSE until WhatsApp Manager shows v2 APPROVED — flipping it
    # early makes every out-of-window welcome fail. Rollback = flip it back; v1 stays
    # live and registered throughout. The free-form (in-window) body carries the number
    # either way, so this flag only governs the template path.
    WELCOME_TEMPLATE_V2: bool = False

    # Dashboard URL — embedded in salesperson alert links.
    DASHBOARD_URL: str = "https://topaz.dmcdigital.in"

    # Extra browser origins allowed to read API responses, comma-separated.
    # DASHBOARD_URL is always allowed; this is for preview deployments and the
    # custom domain, e.g. "https://topaz-crm.vercel.app,https://www.topaz.dmcdigital.in".
    # Never "*": these endpoints act on a capability token in the URL.
    CORS_EXTRA_ORIGINS: str = ""

    # Pre-shared key for dashboard server actions → /api/whatsapp/send.
    DASHBOARD_API_KEY: str | None = None

    # Anthropic API key for AI draft generation. If unset, falls back to template.
    ANTHROPIC_API_KEY: str | None = None

    # ── Phase 2A (Sell) ──────────────────────────────────────────────────────
    # Home state for GST intra/inter-state split (place_of_supply drives the rest).
    HOME_STATE: str = "GJ"
    # Default quotation validity window (days) when the builder doesn't set one.
    QUOTE_VALIDITY_DAYS: int = 15

    # Supabase Storage bucket for generated PDFs (quotes, receipts). Private;
    # customer-facing links are short-lived signed URLs, never public.
    DOCUMENTS_BUCKET: str = "documents"
    # Feature flag: send the quote PDF to the CUSTOMER over WhatsApp. Held false
    # until WA-MEDIA-SPIKE + Meta Business Verification clear (STATE.md). When
    # false, /send still advances status + notifies staff, but skips the
    # customer document/template send (the public approval link still works).
    WA_MEDIA_ENABLED: bool = False
    # Default advance % expected when an order is created from an approved quote.
    DEFAULT_ADVANCE_PCT: int = 50

    # Delivery-challan number prefix. The client's pad reads "T.F 66", so the app matches
    # it. Not a literal at the call site — a showroom that renames its series must not
    # need a code change. The counter is continuous (no fiscal year); seed `doc_series`
    # with their real last number before first use (see migration 0037's ops note).
    CHALLAN_NO_PREFIX: str = "T.F"
    # Send a receipt to the customer over WhatsApp on payment. Held false until
    # the client confirms the policy (STATE.md open questions).
    SEND_RECEIPTS_TO_CUSTOMER: bool = False

    # ── Phase 2B (Make) ──────────────────────────────────────────────────────
    # Supabase Storage bucket for production/customer photos. PRIVATE — the browser
    # reads via short-lived signed URLs, uploads via service-role-signed upload URLs.
    # Face crops NEVER go here (they stay in FACE_CROP_BUCKET behind the consent gate).
    MEDIA_BUCKET: str = "media"
    # Upload ceiling enforced at /media/{id}/complete (the browser compresses first).
    MEDIA_MAX_BYTES: int = 8_000_000
    # Lifetime of a signed upload URL. Long enough for a slow 3G phone upload.
    MEDIA_UPLOAD_TTL_SECONDS: int = 900
    # Lifetime of a signed READ url handed to the dashboard/PWA gallery.
    MEDIA_URL_TTL_SECONDS: int = 3600
    # Longest edge of the generated thumbnail (tasks/media.py::make_thumb).
    MEDIA_THUMB_EDGE_PX: int = 400
    # JPEG quality for generated thumbnails.
    MEDIA_THUMB_QUALITY: int = 80
    # Accepted upload types live in ONE place: services/media_entities.MIME_EXTENSIONS,
    # which also owns the mime→extension mapping the Storage key depends on. A second
    # list here would be a decision point that silently does nothing when widened.

    # Ceiling on a single photo inlined into a job card PDF. Distinct from
    # MEDIA_MAX_BYTES: the renderer prefers 400px thumbnails, but falls back to the
    # full original whenever the thumbnail worker hasn't run, so without this a
    # multi-item card could pull tens of MB into the worker (plus ~33% base64) and
    # produce a PDF too big for WhatsApp to accept.
    JOB_CARD_MAX_INLINE_BYTES: int = 2_000_000

    # Job card delivery format. 'image' (default) sends JPEGs that open INLINE in
    # WhatsApp — no PDF viewer, no download, no taps, which is the whole point for a
    # workshop manager on a cheap Android. 'pdf' keeps the printable document for
    # anyone who wants to file or print it. Both render from the SAME HTML template.
    JOB_CARD_FORMAT: str = "image"
    # Fixed render width so every job card looks identical on every handset.
    JOB_CARD_IMAGE_WIDTH_PX: int = 1000
    # 2x device pixel ratio — small text must survive WhatsApp's own recompression.
    JOB_CARD_IMAGE_SCALE: int = 2
    JOB_CARD_IMAGE_QUALITY: int = 82
    # Rows per image. One tall JPEG of a 15-item order is an unreadable ribbon;
    # several legible images beat one useless one.
    JOB_CARD_ITEMS_PER_IMAGE: int = 4

    # Supabase project URL + service-role key — used by the worker to fetch the
    # private face-crop for the salesperson arrival alert. If either is unset the
    # alert gracefully falls back to text-only (no photo).
    SUPABASE_URL: str | None = None
    SUPABASE_SERVICE_ROLE_KEY: str | None = None
    FACE_CROP_BUCKET: str = "face-crops"

    # Supabase project JWT secret (HS256) — used to VERIFY the caller's access
    # token forwarded by dashboard server actions on money/write routes, so the
    # API derives identity + role from a verified token instead of trusting a
    # body field (§ security-review HIGH-3/HIGH-4). If unset, identity-gated
    # routes fail closed (503).
    SUPABASE_JWT_SECRET: str | None = None

    # ── Login OTP via WhatsApp (module 14 follow-up) ────────────────────────
    # Signing secret Supabase hands you when you create the "Send SMS" Auth Hook
    # pointed at POST /api/auth/send-sms-hook — copy it verbatim (Supabase's own
    # display format, `v1,whsec_...`). If unset, the hook endpoint fails closed
    # (401 on every call) rather than accepting an unsigned request.
    SUPABASE_SEND_SMS_HOOK_SECRET: str | None = None
    # Meta template name for the login code — an AUTHENTICATION-category template
    # (services/auth_otp.py explains why that category, not Utility). Not
    # hardcoded at the call site: the client may need to rename or re-submit it.
    WA_OTP_TEMPLATE_NAME: str = "topaz_login_otp"
    WA_OTP_TEMPLATE_LANG: str = "en"

    @field_validator("DATABASE_URL")
    @classmethod
    def require_asyncpg_scheme(cls, v: str) -> str:
        if not v.startswith("postgresql+asyncpg://"):
            raise ValueError(
                "DATABASE_URL must use the asyncpg driver scheme: "
                "postgresql+asyncpg://user:pass@host/db"
            )
        return v

    @field_validator("REDIS_URL")
    @classmethod
    def require_redis_scheme(cls, v: str) -> str:
        if not v.startswith("redis://") and not v.startswith("rediss://"):
            raise ValueError("REDIS_URL must start with redis:// or rediss://")
        return v

    @field_validator("EDGE_API_KEY")
    @classmethod
    def require_min_length(cls, v: str) -> str:
        if len(v) < 16:
            raise ValueError("EDGE_API_KEY must be at least 16 characters")
        return v

    @field_validator("SHOWROOM_CONTACT_NUMBER")
    @classmethod
    def require_dialable_number(cls, v: str) -> str:
        """Fail at STARTUP, not at send time.

        This value is the last line of defence against an empty `advisor_phone`, and an
        empty parameter makes Meta reject the whole welcome — a silent, per-customer
        failure discovered days later. Ten digits is the floor for an Indian mobile.
        """
        if sum(ch.isdigit() for ch in v) < 10:
            raise ValueError(
                "SHOWROOM_CONTACT_NUMBER must contain at least 10 digits — it is the "
                "fallback advisor number in the customer welcome message"
            )
        return v


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
