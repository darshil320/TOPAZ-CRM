# Topaz CRM — Showroom Hardware Spec (for Topaz to procure)

> Topaz buys this directly from a local Surat CCTV/IT vendor against this sheet (keeps the full software budget working on software). **Order now** — delivery + install has a few days' lead time and gates go-live. Indicative total **₹30,000–45,000** one-time. This sheet is vendor-ready — hand it over as-is.

---

## Non-negotiable specs (don't let the vendor substitute these away)
- Camera **must output an RTSP stream** (our software reads RTSP). Confirm before buying.
- Camera **4MP or higher**, with good **low-light / IR** performance.
- Mount at **face height (~1.6–2.0 m)**, near-frontal, downward tilt **≤15°** — NOT a high ceiling corner (steep angles wreck face recognition).
- Entrance must not be **backlit**. People entering from bright daylight into a darker interior become silhouettes → unusable faces. Add the fill light (item 5).

## Bill of materials

| # | Item | Spec | Indicative ₹ |
|---|------|------|-------------:|
| 1 | **Entrance IP camera** | 4MP+, **RTSP**, IR/low-light, 2.8–4 mm lens (Hikvision / Dahua / CP Plus) | 3,000–6,000 |
| 2 | **Edge compute** *(recommended)* | Mini PC — Intel **N100/N305, 16 GB RAM, 256–512 GB SSD**. Runs recognition on CPU. | 18,000–28,000 |
| 2-alt | Edge compute *(budget)* | Raspberry Pi 5 (8 GB) + active cooling + NVMe/SSD — cheaper, slower; may force a lighter face model | 10,000–14,000 |
| 3 | **PoE switch / injector** | If the camera is PoE — one cable for power + data | ~1,500 |
| 4 | **UPS / power backup** | Keeps edge PC + router + camera alive through Surat power cuts (line-interactive UPS) | 2,500–4,000 |
| 5 | **Entrance fill light** | Warm LED panel so faces aren't backlit | 1,000–2,000 |
| 6 | **Cabling + mount + install** | Cat6 run entrance→edge, bracket, junction box, labour | 2,000–3,000 |

## Placement (give to the installer)
```
   [ Entrance door ]
         │   people walk in  →
         ▼
   ~1.5–3 m capture zone     ← camera sees faces frontally here
         ▲
   📷  camera @ 1.6–2.0 m height, ≤15° down-tilt, facing the incoming flow
   💡  fill light above/beside the door so faces are lit, not backlit
```

## What DMC needs handed over after install
- The camera's **RTSP URL** (`rtsp://user:pass@<cam-ip>:554/...`) and its LAN IP.
- The **edge PC on the same LAN**, with **stable internet** and **remote access** (so DMC deploys the recognition worker).
- Camera + edge PC + router all on the **UPS**.

## Why a mini PC over a Pi
buffalo_l (our face model) runs comfortably on a mini-PC CPU for one entrance. A Pi 5 works but is slower and may force a lighter model — for a paid product the mini PC is the safer, near-same-cost choice. **No GPU needed** for one entrance.

*TOPAZ-HARDWARE-SPEC · DMC Digital · 24 June 2026 · companion to EXECUTION_PLAN.md v2.3 §0 + §6*
