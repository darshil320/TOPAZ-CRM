# Phase 2B / Module 14 — demo script + one-page training (Make + Transit)

Companion to `TRAINING_2A.md` (Sell). Read `GO_LIVE_2B.md` first — this assumes the
pilot staff (§5 of that doc) already exist as real salespersons rows.

---

## Part 0 — Demo script (run this live, with Hemant watching)

**Setup, once, before Hemant arrives:** create one throwaway test order (not a real
customer's) with one item, confirmed. Add 2 real workshop-manager logins and 1
delivery login via `/owner/salespersons` (real phones — they'll each need to receive
one OTP during the demo). Appoint one as lead of Workshop A, one as sub-manager of
Workshop A, no one needed as lead of Workshop B for this demo (owner will stand in).

**The story to tell, in order — takes about 10 minutes:**

1. **You (owner), on `/dashboard/production/allocate` or the order page**: "Here's a
   sofa order. I'm going to tell the system: polish it at [Workshop A] for 5 days,
   then finish it at [Workshop B] for 4 days." Click **Plan route**. Point out the
   due date **has a time**, not just a day — "6 PM on the 1st of August, not just
   'August 1st'."
2. **Hand the phone to the sub-manager**: they log in, land on `/workshop`, see the
   item with the countdown to that same deadline. Tap through 2-3 stages (one needs
   a photo — show the camera opening). Say out loud: "notice they can't send it
   anywhere or accept anything — just update status."
3. **Tap the LAST stage this workshop owns** (e.g. polishing). The card disappears
   from their queue and a "📦 ready to send" notice appears. Say: "nobody had to
   remember to call a driver — the system just packaged it."
4. **Hand the phone to the delivery/courier login**: `/transit`, shows the run —
   from-address, to-address, phone numbers, what's inside (no price, ever). Tap
   **Collect** (camera opens, take a photo), **On the road**, **Delivered** (camera
   again).
5. **Hand the phone to the LEAD** (or use your own owner login, since owner can act
   as any lead): `/workshop` → **Incoming** section shows the arrived consignment →
   **Confirm receipt** (photo). Say: "this is the one step that's deliberately
   locked to the lead, not just anyone — someone has to be accountable for saying
   'yes, this physically arrived here'."
6. **Finish the remaining stages**, order flips to **ready**.
7. **Show `/dashboard/production`** — the live board — point at the deadline chip,
   the "Leg 2/2" badge, and (if it happened) the red overdue colour.

**What NOT to demo yet:** anything on a real customer's real order (Rajesh Mehta's,
Manoj's) — those are live production orders now carrying real route/stage data from
today's testing session; don't reset or reroute them in front of Hemant without
deciding first whether that data should stay.

---

## Part 1 — Daily training, role by role

### Owner/Admin — "set up staff and routes" (you'll do this once per workshop, rarely after)
1. **`/owner/salespersons`** → add people. Role **Workshop Manager** for anyone on a
   production floor, **Delivery** for anyone driving between workshops.
2. **`/owner/admin` → Workshop Staff** → pick a person, choose **Lead** (can send/
   receive goods) or **Sub-manager** (status updates only). One lead per workshop;
   promoting someone new automatically retires the old lead.
3. **`/owner/admin` → Route Templates** (optional) → save a route you use often
   ("Polish at Sharma 5 days, finish in-house 4 days") so it's one tap later instead
   of typing it every time.
4. **Bookmark reminder:** tell every workshop_manager/delivery hire to bookmark
   `/workshop` or `/transit` directly — logging in does **not** take them there
   automatically yet (known gap, `GO_LIVE_2B.md` §4).

### Salesperson/Owner — "plan the journey" (once per order item, when it needs more than one workshop)
1. Open the order → next to each item's workshop badge, or on the allocate screen →
   **Plan route**.
2. Pick a saved route, or build leg-by-leg: workshop → first stage → last stage →
   days. The system checks the stages tile with no gaps before it lets you save.
3. Set **when production starts** — every leg's deadline (date + time) is calculated
   from that, automatically.
4. **A late leg does NOT silently move.** If a workshop runs over, the deadline
   stays where it was — you'll see it turn red, and you (owner/admin) get a
   **Reflow route** action to deliberately push the remaining dates, with a reason.

### Workshop Lead — "run the floor, and own what leaves/arrives"
1. **`/workshop`** — your queue. Deadline (with time), which leg you're on
   ("Leg 1/2"), where it goes next.
2. Tap **✓ Stage done** per stage. Camera opens automatically on the stages that
   need a photo (frame work, finishing, quality inspection, dispatch) — you can't
   skip those.
3. **Blocked?** Tap the red button, type why. It stays visible until you unblock it.
4. When the last stage you own is done, the item either vanishes (finished route) or
   shows "ready to send" — a driver will come collect it, you don't have to call
   anyone.
5. **Incoming section, top of the screen:** when something arrives from another
   workshop, tap **Receive**, take a photo of what actually turned up. This is the
   one thing only YOU (not a sub-manager) can do — it's what makes the item
   officially yours from that moment.
6. **Early handover:** if a lorry is leaving right now and the work isn't quite at
   the leg's last stage, you can still tap **Hand over** manually.

### Workshop Sub-manager — "update status, nothing else"
- Same `/workshop` screen as the lead, same stage-tapping, same photos, same block/
  unblock. You will **not** see a Hand-over or Receive button — that's by design,
  not a bug. If goods need to move, tell your lead.

### Delivery / Courier — "collect, drive, drop off"
1. **`/transit`** — today's runs. Each card: collect from (address + tap-to-call),
   deliver to (same), what's inside (photo, size, material — **never a price**).
2. **Collect** → photo required (proof of condition when you picked it up).
3. **On the road** → no photo, just marks you're moving.
4. **Delivered** → photo required (proof of what you dropped off).
5. That's it — the run disappears from your list. The destination's lead confirms
   receipt on their own phone; that's not your job.

### Owner/Admin — daily oversight
- **`/dashboard/production`** — the live board. Deadline chips, which leg, in-transit
  badge. Red = attention needed.
- You get a WhatsApp alert automatically (once daily, 9 AM) for anything overdue or
  a consignment nobody's picked up — sent to you and the relevant workshop lead.

## Golden rules (module 14)
- **A deadline is set by planning a route — never typed directly onto a card.**
- **Only a lead moves custody** (hand-over/receive). A sub-manager updates status.
- **A courier never sees a price**, ever, on any screen.
- **Late is visible, never hidden** — dates don't silently slide; someone has to
  deliberately reflow them, with a reason, logged.
- **Rework is not automatic.** A failed inspection doesn't send an item backward —
  it gets blocked with a note until fixed by hand.
