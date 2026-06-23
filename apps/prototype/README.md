# Topaz Prototype — "Showroom Memory: Live Demo"

A laptop-only, deal-closing demo: enroll a face → walk past the webcam → a WhatsApp
owner-alert fires (with the visitor's photo). This is a real, working slice of Phase 1A
**M1** (face recognition + owner alert) — not a mockup, and not throwaway (its core ports
into the production build).

## What it does

- **Webcam → InsightFace (ArcFace 512-d) → match against enrolled gallery.**
- **New face** → `🔔 New customer visited` + saved photo → WhatsApp (photo attached if a public URL is configured).
- **Repeat face** → `🔔 Repeat customer visited — {name} — last interested in {interest}` → WhatsApp.
- **Uncertain** band → labelled on screen, no alert (in production this routes to staff confirm).
- Per-person alert cooldown so one walk-in = one alert. Every event is logged to `data/visits.jsonl`.
- **Live web view** (`python -m src.web`) shows recent visits + photos, auto-refreshing.

## What it deliberately leaves out

Consent flow, Jetson edge device, real DB, CRM data entry, the AI chatbot, lead capture,
the full dashboard, encryption/audit. Those are exactly what the full Phase 1A/1B build
adds — see [`../../docs/MONOREPO.md`](../../docs/MONOREPO.md). Say this out loud at the
demo so the prototype's simplicity reads as "early slice," not "the product."

## Setup

```bash
cd apps/prototype
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt          # downloads InsightFace model (~300MB) on first run
cp .env.example .env                      # console mode needs no edits
```

## Run — console mode (verify the flow, no WhatsApp creds)

```bash
# Enroll from a photo...
python -m src.enroll --image samples/hemant.jpg --name "Hemant" --interest "7-seater sofa"
# ...or from the webcam (SPACE to capture):
python -m src.enroll --webcam --name "Hemant" --interest "7-seater sofa"

# Start the live demo:
python -m src.demo
#   q = quit   ·   e = enroll the largest face on screen (great for enrolling Hemant live)
```

Alerts print to the terminal. When you're happy, flip to real WhatsApp.

## Run — real WhatsApp via Twilio (best for the live demo)

1. Set up a [Twilio WhatsApp sandbox](https://www.twilio.com/docs/whatsapp/sandbox); join it from each phone that should receive alerts (incl. Hemant's).
2. In `.env`:
   ```
   NOTIFIER=twilio
   OWNER_WHATSAPP=+91XXXXXXXXXX        # Hemant's number — he gets the buzz himself
   TWILIO_ACCOUNT_SID=...
   TWILIO_AUTH_TOKEN=...
   TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
   ```
3. `python -m src.demo` — alerts now land on WhatsApp.

## Live web view + photo attachment

```bash
python -m src.web        # http://localhost:8077 — recent visits + photos, auto-refresh
```

To attach the captured **photo** to WhatsApp alerts (WhatsApp needs a public URL):

```bash
python -m src.web               # terminal 1
ngrok http 8077                 # terminal 2 → https://xxxx.ngrok.io
# in .env:
PUBLIC_BASE_URL=https://xxxx.ngrok.io
```

Now new-visitor alerts include the photo. No `PUBLIC_BASE_URL` → text-only (still works).

## The killer demo move

Enroll Hemant (`e` key, or from a photo he sends), set `OWNER_WHATSAPP` to **his own
number**, then let him step in front of the camera. His phone buzzes:
*"Repeat customer visited — Hemant — last interested in 7-seater sofa."* That closes it.

## Tests

```bash
python -m pytest tests/ -v     # 43 tests, pure-logic core — no ML deps needed
```

The matching, gallery, message, media-URL, console-notifier, visit-log and web-renderer
logic are all unit-tested independently of InsightFace/OpenCV, so the suite runs anywhere
(verified: 43 passed).

## Layout

```
src/
  config.py            env config + notifier factory
  faces/
    matching.py        pure cosine + NEW/REPEAT/UNCERTAIN bands  (ported to edge in 1A)
    recognizer.py      InsightFace/ArcFace wrapper
    gallery.py         JSON-backed enrolled-face store
  notify/
    base.py            Alert (+ media_url) + Notifier interface
    messages.py        owner-alert copy (→ WhatsApp templates in prod)
    media.py           pure local-path → public-URL helper (WhatsApp media)
    console.py         prints alerts (no creds)
    twilio_whatsapp.py Twilio sandbox sender (text + media)
    aisensy.py         production BSP sender
  store/visit_log.py   append-only JSONL visit log
  web.py               live visit-log web view + /captures static serving
  enroll.py            CLI enrollment
  demo.py              live loop
tests/                 pure-logic unit tests (43)
```
