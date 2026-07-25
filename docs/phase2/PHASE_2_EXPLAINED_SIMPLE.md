# Topaz System — Phase 2 in Plain English

**Who this is for:** anyone who wants to understand what we are building, without any
technical background. No code words. If you run the showroom, sell on the floor, work in
the workshop, or handle the money — this explains what changes for you.

**Last updated:** July 2026

---

## 1. The one-paragraph version

Topaz already has a system that spots customers at the door, tells the right salesperson on
WhatsApp, and follows up automatically. That's **Phase 1** — it's live and running today.
**Phase 2** takes the next step: it turns a walk-in into money. A salesperson can now build a
proper **quotation** (with correct GST), send it to the customer's phone as a neat PDF, the
customer taps **Approve** on their own phone, it becomes an **order** in one click, and the
accounts person tracks every **payment** against it. Then the order goes to the **workshop**,
where a manager updates progress from his phone stage by stage, and everyone — owner, sales,
and even the customer — can see how the furniture is coming along in real time.

Think of it this way:

- **Phase 1** = *"A customer walked in — go talk to them."*
- **Phase 2** = *"Now sell it, take the money, build it, and keep everyone informed until it ships."*

---

## 2. The whole journey, start to finish

Here is one customer's complete story through the finished system. Phase 1 handles the first
few steps (already built). Phase 2 handles everything from the quotation onward (what we're
building now).

```
 CUSTOMER WALKS IN
        │
        │  [PHASE 1 — already live]
        ▼
 Camera recognizes them (with their consent) → the right salesperson gets a WhatsApp alert
        │
        ▼
 Salesperson greets them by name, remembers what they liked last time
        │
        ▼
 AI assistant follows up on WhatsApp automatically over the next days
        │
        │  ─────────── PHASE 2 STARTS HERE ───────────
        │
        │  [PHASE 2A — "Sell"]
        ▼
 Salesperson builds a QUOTATION (picks items, adds discount, GST auto-calculated)
        │
        ▼
 Quote is sent to the customer's WhatsApp as a branded PDF
        │
        ▼
 Customer opens it on their phone, taps APPROVE (or "Request Changes")
        │
        ▼
 Approved quote becomes an ORDER in one click
        │
        ▼
 Accounts records the ADVANCE PAYMENT → the system tracks what's still owed
        │
        │  [PHASE 2B — "Make"]
        ▼
 Order is ASSIGNED to a workshop
        │
        ▼
 Workshop manager updates progress from his phone, stage by stage, with photos
        │
        ▼
 A LIVE BOARD shows everyone where each order is; customer gets tasteful updates
        │
        ▼
 When it's ready, remaining payment is collected
        │
        │  [PHASE 2C — "Deliver", later, needs a separate agreement]
        ▼
 Delivery + installation scheduled, proof photos, final reports
```

Every step above is one screen or one tap for the person doing it. The system does the maths,
the paperwork, and the reminders in the background.

---

## 3. Phase 2 has three parts

We deliver Phase 2 in three chunks, in order. Each chunk is useful on its own and gets signed
off (and invoiced) before the next begins.

| Part | Nickname | What it does | Status |
|---|---|---|---|
| **2A** | **"Sell"** | Quotation → send → approve → order → payments | The main build now |
| **2B** | **"Make"** | Assign to workshop → track production → live board → updates | After 2A signs off |
| **2C** | **"Deliver"** | Delivery, installation, reports, feedback | **Not agreed yet** — needs a separate written change request before we build it |

> **Important:** 2C is deliberately *not* in the current agreement. It's sketched out so the
> roadmap is complete, but building any of it requires a new signed change request. Nobody
> should assume it's coming for free.

---

## 4. Phase 2A — "Sell" (the money-making half)

This is the biggest and most important part. It's what lets Topaz go from *"nice chat"* to
*"signed order with an advance in the bank."*

### 4.1 Quotations

Today, a quote is probably made by hand in Excel or on paper. In the new system:

- The salesperson opens a **quote builder** on the dashboard.
- They add line items — either picked from a product list or typed in freely.
- They set quantity, price, and any discount.
- **GST is calculated automatically and correctly** — the system knows the rules (CGST/SGST
  within Gujarat, IGST outside), rounds to the paisa the way the tax authorities expect, and
  never makes a maths mistake.
- Each quote gets an automatic number like `QTN-2627-0001` (2627 = the April–March financial
  year). No two quotes ever get the same number, even if two salespeople save at the same
  second.
- Need to change a quote after sending? You **revise** it — the system keeps the old version
  frozen for the record and makes a fresh numbered copy. Nothing is ever quietly overwritten.

**Why this matters:** every quote is consistent, professional, GST-correct, and traceable.
No more "which version did we send them?"

### 4.2 The branded PDF + WhatsApp send

- One tap turns the quote into a **clean, branded PDF** — Topaz colours, item table, GST
  breakdown, amount in words, terms, validity date, signature block.
- The PDF is sent straight to the customer's **WhatsApp**.
- *(Small caveat: WhatsApp needs Meta's business verification fully cleared to send documents
  outside the 24-hour chat window. Until that clears, the approval still works perfectly — the
  customer just gets a link instead of the file directly. This is a known dependency we're
  managing, not a surprise.)*

### 4.3 The customer approves from their own phone

- The customer gets a private link. They open a simple, mobile-friendly page showing the quote
  summary and the PDF.
- Two buttons: **Approve** or **Request Changes**.
- When they tap Approve:
  - The quote's status flips to *approved*.
  - The salesperson gets an instant alert.
  - The customer's stage in the pipeline moves forward to *order confirmed*.
- It's **tap-proof**: if they double-tap Approve, it still counts as one approval — no
  duplicate orders.

**Why this matters:** the customer commits on their own phone, in their own time. You have a
timestamped record that they approved. No chasing signatures.

### 4.4 Approved quote → Order (one click)

- An approved quote becomes an **order** with one click. Every line, every total, every paisa
  is copied exactly — no re-typing, no drift.
- The order automatically knows the expected advance (e.g. 50% — configurable).
- Salespeople can also create a **manual order** for a walk-in who buys on the spot, and GST is
  still calculated correctly.
- Orders move through clear stages — *confirmed → in production → ready → delivered → installed
  → closed* — and the system **won't allow illegal jumps** (you can't mark something delivered
  before it's made). Cancelling requires a reason, which is logged.

### 4.5 Payments (the careful part)

Money handling is built to be strict and audit-proof:

- Accounts records a payment (advance, stage payment, final, or refund). The **outstanding
  balance updates automatically**.
- Every payment generates an **immutable receipt PDF**. "Immutable" means: once recorded, a
  payment can **never be edited or deleted**. If a correction is needed, you add a *reversal*
  entry — the original stays on the record forever. This is how proper accounting is done and
  how you stay audit-safe.
- The system **blocks over-payment** (paying more than the order total) unless an owner/admin
  explicitly overrides it. Refunds require admin permission.
- A **payment schedule** (e.g. 50% advance / 40% on ready / 10% on delivery) can be set, and
  the system sends **automatic WhatsApp reminders** when an instalment is due — without ever
  double-sending.

**Why this matters:** you always know exactly who owes what, receipts are automatic and
tamper-proof, and nobody can quietly fiddle a payment record.

### 4.6 Roles & permissions (who sees what)

Not everyone should see everything. Phase 2A locks this down properly:

- A **salesperson** sees only their own customers and quotes — not their colleagues'.
- **Accounts** can record payments but cannot edit or delete them.
- The **owner/admin** sees everything and manages staff, products, and settings.
- **Workshop staff** (in 2B) see production tasks but are completely **blind to money** — they
  never see prices, totals, or payments.

This isn't a "we trust the honour system" setup — it's enforced by the database itself and
proven with automated tests. A salesperson literally *cannot* pull up another salesperson's
deals.

---

## 5. Phase 2B — "Make" (the workshop half)

Once an order is confirmed and the advance is in, the furniture has to actually get built. 2B
makes that visible and trackable instead of a black box.

### 5.1 Assigning to a workshop

- The owner/admin assigns each order (or each item in it) to a **workshop** — either Topaz's
  own or an outside vendor.
- Each item has exactly one active workshop at a time, so there's never confusion about who's
  responsible.

### 5.2 The workshop manager's phone app

This is designed for a real person: think a 45-year-old workshop manager, mid-range Android
phone, more comfortable in **Gujarati** than English. So it's built to be dead simple:

- He logs in and sees **only his assigned items** as big cards — with a photo, the item, the
  order number, the customer's first name, and the **current stage in large Gujarati text**.
- Furniture moves through **11 production stages** (design approved → … → dispatch).
- To advance a stage: **tap the item → tap "Stage Done" → snap a photo → confirm.** Three taps.
- Some stages require a photo (proof of quality); the app enforces it.
- If something's stuck, he taps **"Blocked"** and adds a quick note (with a voice-to-text hint,
  so minimal typing).
- Everything is in **Gujarati first**, with an English toggle. Big buttons, icons over words.

It works like a phone app you can add to your home screen. *(One deliberate limit for now: it
needs a working internet connection to update — there's no offline queue in this version. If
the network is down, the daily watchdog, below, catches any gaps.)*

**Why this matters:** progress gets logged at the source, by the person doing the work, in
seconds — not scribbled on paper and lost.

### 5.3 The live board (everyone can see progress)

- Sales, owner, and admin see a **live board** — columns for each production stage, cards for
  each item.
- When the workshop manager advances a stage on his phone, the card **moves on everyone's board
  within about 2 seconds**. No refreshing, no phone calls asking "where's my sofa?"
- Each card shows the photo, which workshop, how many days it's been sitting in that stage, and
  a red flag if it's overdue or blocked.
- The order screen also gets a **Production tab** (progress like "6 of 11 stages done") and a
  **Photos tab** where staff can pick photos and **share them with the customer on WhatsApp**.

### 5.4 Customer updates + the delay watchdog

- Customers get **tasteful, capped** production updates — "your order has started," a photo when
  it's finishing, "ready for dispatch." **Maximum one production message per order per day**, so
  nobody feels spammed.
- Every morning, a **watchdog** checks for stuck orders (no update in 4+ days, or past due) and
  sends the **owner one summary WhatsApp**: what's stalled, what's overdue, plus the day's
  numbers (orders confirmed, payments received, quotes awaiting approval). Each workshop manager
  also gets a nudge about his own stuck items.

**Why this matters:** delays surface automatically instead of being discovered when the customer
calls angry. The owner gets one clean daily digest, not a flood of messages.

---

## 6. Phase 2C — "Deliver & Optimize" (future, not agreed yet)

Sketched for completeness. **Requires a separate signed agreement before any of it is built.**
Candidates:

- **Delivery management** — scheduling dispatch, delivery/installation proof photos, e-way bill
  *reminders* for large Gujarat city-to-city shipments, delivery-status messages to customers.
- **Reports pack** — sales conversion funnel, workshop speed analytics, collections/aging
  exports, a deeper owner dashboard.
- **Feedback & repeat business** — post-delivery feedback capture, repeat-purchase nudges.
- **Search & calendar** — search across all customers/quotes/orders, a delivery/appointment
  calendar.

---

## 7. What the whole system looks like (the big picture)

Here's every piece, in plain terms:

| Piece | Plain-English job | Phase |
|---|---|---|
| **Entrance camera + edge worker** | Spots faces at the door, respects consent, sends an event | 1 (live) |
| **Backend brain (on Railway)** | The engine — matches faces, handles WhatsApp, calculates GST, tracks orders & payments, drives the workshop logic | 1 + 2 |
| **Background workers** | Do the slow jobs quietly — send messages, make PDFs, run daily reminders and the watchdog | 1 + 2 |
| **Database (Supabase)** | The single source of truth — customers, quotes, orders, payments, production. Also enforces who-can-see-what | 1 + 2 |
| **Dashboard (the website)** | Where sales, accounts, and owner work — quotes, orders, payments, live board | 1 + 2 |
| **Workshop phone app** | The Gujarati-first, 3-tap app for updating production | 2B |
| **Customer's WhatsApp** | Where the customer receives quotes, approves, and gets updates | 1 + 2 |

The golden rule throughout: **the system does the maths and the paperwork; people just make
decisions.** GST is never typed by hand, receipts are never edited, numbers never collide,
and delays never go unnoticed.

---

## 8. The non-negotiable rules baked in

These are hard rules the system enforces, not "best efforts":

1. **Consent first (legal).** No customer's face data exists without their explicit consent —
   enforced by the database itself. (This is Phase 1, carried through.)
2. **Money is precise.** All money uses exact decimal maths, never rough decimals. GST rounds
   the correct way. Totals are always recalculated by the server — the system never trusts a
   number typed by a browser.
3. **Payments are immutable.** Recorded payments can't be edited or deleted — only reversed with
   a new entry. Full audit trail, always.
4. **Workshop staff are money-blind.** They physically cannot see prices or payments.
5. **WhatsApp respects the rules.** Free-form replies only inside the 24-hour window;
   pre-approved templates outside it. Customers are never spammed (production updates capped at
   one per order per day).
6. **Nothing goes out of agreed scope silently.** If a request would expand the project beyond
   what's contracted (e.g. full inventory, accounting/Tally sync, e-invoicing), we stop and
   raise it as a change request rather than quietly building it.

---

## 9. Rough timeline

- **Phase 2A ("Sell")** — about 4 weeks of build, then roughly 1 week of testing by Topaz staff
  before it goes live. Ends with the first real quote going out and a milestone invoice.
- **Phase 2B ("Make")** — about 4–5 weeks of build, then a ~2-week pilot with one real workshop
  before rolling out to all. Ends with a milestone invoice.
- **Realistically end-to-end:** roughly **3–4 months** of calendar time for one developer to take
  both 2A and 2B from start to signed-off, faster with two developers. (Testing and the workshop
  pilot run alongside where safe.)

Each part is genuinely usable the moment it ships — you can start selling with 2A before 2B's
workshop tracking is even built.

---

## 10. The bottom line

**Phase 1 got customers in the door and talking.**
**Phase 2 turns those conversations into orders, money in the bank, furniture that's built on
time, and a customer who's kept in the loop the whole way — with nobody doing GST maths by
hand or wondering where an order is.**

It's the difference between a smart doorbell and a full sales-and-production engine.
