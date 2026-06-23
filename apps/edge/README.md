# apps/edge — Jetson Edge Pipeline (Phase 1A · M1)

**Planned.** Production on-prem face pipeline for the Bhatar entrance.

- Hardware: Hikvision DS-2CD2143G2-I (4MP PoE, RTSP) → NVIDIA Jetson Orin Nano.
- RTSP ingest → motion/face detect → multi-frame burst → ArcFace 512-d (InsightFace, TensorRT) → cosine match vs **consented** gallery → NEW/REPEAT/UNCERTAIN.
- Outbound HTTPS only: `POST /visits/events` to `apps/api`. Embeddings stay on-prem (encrypted).
- Heartbeat + graceful degrade to manual entry when offline.

**Reuses from prototype:** `faces/matching.py` (verbatim), `faces/recognizer.py` (ported to TensorRT provider).

See master plan §3–4, epics E1A-2 / E1A-7.
