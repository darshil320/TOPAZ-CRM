# apps/edge — Entrance Face Pipeline (Phase 1A · M1)

**Built.** Code-complete; not yet running unattended on-site (no autostart service —
see Track E / E2.5 in `docs/DEPLOYMENT.md`, the current status source of truth).

- Hardware: any USB webcam (e.g. Logitech C920) or existing CCTV over RTSP, on a
  generic mini-PC (Ubuntu or Windows, no GPU/Jetson required) — `CAMERA_SOURCE` accepts
  either a webcam index or an RTSP URL/device path.
- Pipeline (`src/main.py`): capture → InsightFace `buffalo_l` face detection (CPU by
  default, ONNXRuntime) → quality gate → consent resolution (`CONSENT_MODE=kiosk|open|off`)
  → cooldown → L2-normalize → upload crop to Supabase Storage → POST the recognition
  event to `apps/api` (`/api/recognition`), which owns matching/banding/alerting.
- Outbound only: edge never calls WhatsApp directly and never talks to Postgres directly
  for matching — `apps/api` does the ANN match and NEW/REPEAT/UNCERTAIN classification.
- Entrypoint: `python -m src.main` or the `topaz-edge` console script (`pyproject.toml`).
  No Dockerfile or systemd unit yet — ask for Track E step E2.5 to generate one.

**Reused from the prototype:** the recognition/consent core ports from
`apps/prototype/src/faces/*` (CPU InsightFace, no TensorRT/Jetson in this build).
