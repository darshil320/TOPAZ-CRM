# Prototype Build Plan — "Showroom Memory: Live Demo"

**Goal:** in person, enroll a face, walk past a webcam, and have a WhatsApp alert land on the owner's phone — *"Repeat customer visited — Hemant — last interested in 7-seater sofa."* That moment closes the deal.

## Design principles

1. **Runs on a laptop.** No Jetson, no IP camera, no install at Topaz. USB/built-in webcam only.
2. **Zero client dependency to run.** Console notifier works with no credentials. WhatsApp turns on when keys are added.
3. **Pluggable notifier.** Console → Twilio WhatsApp (easiest live demo) → AiSensy (the production BSP). One interface, swap by env var.
4. **Testable core, isolated from ML.** The matching logic, message builders, media-URL helper, and web renderer are pure Python — unit-tested without InsightFace/OpenCV installed.
5. **Not throwaway.** matching/recognizer/notifier/web modules port into Phase 1A (see `MONOREPO.md`).

## Architecture

```
 Webcam ─OpenCV──▶ FaceRecognizer (InsightFace buffalo_l, 512-d ArcFace)
                          │  embedding per detected face
                          ▼
                   Gallery.identify()  ── matching.py: cosine + NEW/REPEAT/UNCERTAIN bands
                          │
            ┌─────────────┼──────────────┐
         REPEAT          NEW           UNCERTAIN
            │             │                │ (no alert; would route to staff in prod)
            ▼             ▼
       repeat msg     new msg + photo capture
            │             │
            ▼             ▼
                   Notifier.send()  ── console | twilio_whatsapp | aisensy
                          │                    (photo attached via public URL if available)
                          ▼
                   VisitLog (append JSONL) ──▶ src/web.py live view (http://localhost:8077)
                          +  on-screen label
```

## Modules (`apps/prototype/src/`)

| File | Responsibility | Tested? |
|---|---|---|
| `faces/matching.py` | Pure cosine similarity + `classify()` bands | ✅ unit |
| `faces/recognizer.py` | InsightFace wrapper: frame → detected faces + embeddings | integration only |
| `faces/gallery.py` | Load/save/add enrolled faces (JSON); `identify()` | ✅ unit (logic) |
| `notify/base.py` | `Alert` dataclass (+ media_url) + `Notifier` ABC | — |
| `notify/messages.py` | Owner-alert copy (matches PRD §13.4) | ✅ unit |
| `notify/media.py` | Pure local-path → public-URL helper (for WhatsApp media) | ✅ unit |
| `notify/console.py` | Prints the alert (always works) | ✅ unit |
| `notify/twilio_whatsapp.py` | Twilio WhatsApp sender (text + media_url) | manual |
| `notify/aisensy.py` | AiSensy campaign-API sender (production BSP) | manual |
| `store/visit_log.py` | Append visits to JSONL; read recent | ✅ unit |
| `web.py` | stdlib live visit-log web view + `/captures` static serving | ✅ unit (renderer) |
| `config.py` | Env config + notifier factory | — |
| `enroll.py` | CLI: enroll a face (image file or webcam) | manual |
| `demo.py` | Live loop: detect → identify → alert → label | manual |

## Recognition tuning (defaults, all configurable)

- Model: `buffalo_l` (InsightFace), `normed_embedding` (L2-normalised → cosine = dot product).
- `MATCH_THRESHOLD = 0.45` → at/above ⇒ REPEAT (known person).
- `NEW_THRESHOLD = 0.30` → below ⇒ NEW. Between the two ⇒ UNCERTAIN (no auto-assert).
- `ALERT_COOLDOWN_SECONDS = 120` → don't re-alert the same person within the window.
- These mirror the master plan's "threshold + uncertain bucket" (A1) — tunable, never hardcoded.

## Photo attachment (WhatsApp media)

WhatsApp/Twilio can only attach media from a **public URL**. The flow:
1. `demo.py` saves the new-visitor face crop to `data/captures/`.
2. `src/web.py` serves `data/captures/` at `/captures/<file>`.
3. Expose the web view publicly (e.g. `ngrok http 8077`) and set `PUBLIC_BASE_URL` to that URL.
4. The notifier then attaches `{PUBLIC_BASE_URL}/captures/<file>` as media. No public URL → text-only (graceful).

## Live-demo controls (`demo.py`)

- `q` — quit.
- `e` — enroll the largest face currently on screen (prompts for name + interest). **The close: enroll Hemant on the spot, then let him walk back into frame.**

## Verifiable without a camera

```bash
cd apps/prototype
pip install pytest          # numpy/opencv/insightface NOT required for these
python -m pytest tests/ -v
```

## What to say at the demo

> "You said it's a lot to invest and you'd read and come back — completely fair. But a document can't show you it works. So I built a small piece of it. *(enroll Hemant, he steps away and back)* — that's your phone. One camera, one feature, a few days. The full system does this for every customer at your door, with consent, plus the WhatsApp assistant, the lead capture, and the one dashboard. We can start with just the foundation if you'd like the first step small."
