-- Topaz CRM — 0037 · delivery challan (the document that travels with the goods)
--
-- ─── A CHALLAN BELONGS TO A DELIVERY, NOT AN ORDER ───────────────────────────
-- This is the load-bearing modelling decision. A challan is the paper the lorry carries;
-- it lists what is physically on that lorry. With part-delivery (0039) a five-item order
-- can go out on two runs, and each run needs its OWN challan listing only its own goods.
-- Hanging the number off the order would produce one document that is wrong for both.
--
-- Consequence: this migration depends on 0039's `delivery_items` for the line list.
--
-- ─── LAYOUT IS NOT IN THE DATABASE ───────────────────────────────────────────
-- The visual format lives in ONE pure module (services/challan_html.py) plus its
-- template. This migration is only the fields that format needs to READ, and they are
-- taken from the client's own paper challan (sample "T.F 66", supplied 2026-08-04):
--
--   CHALLAN :- T.F 66            → deliveries.challan_no  (their prefix, continuous)
--   NAME / ADDRESS / MOBILE NO   → customers.name/phone + deliveries.delivery_address
--   D.P – ASG                    → deliveries.dp_code     (meaning TBC — see below)
--   TEMPO NUMBER                 → deliveries.vehicle_no  (0026, already exists)
--   DRIVER NAME + number         → salespersons.name/whatsapp via driver_salesperson_id
--   PRODUCT / RECEIVED (✓/X)     → delivery_items → order_items.description (0039)
--   Delivery rent                → deliveries.delivery_rent
--   Balance Amount               → computed: orders.grand_total − sum(payments.amount)
--
-- THEIR FORMAT CARRIES NO HSN, NO RATES AND NO GST BLOCK. It is a hand-over receipt with
-- a tick box per piece and two money lines, not a tax document — so nothing here needs a
-- tax column, and services/gst.py is deliberately not involved.
-- ════════════════════════════════════════════════════════════════════════════

-- `documents` gains the new kind. Same additive shape 0028 used for job cards.
alter table documents drop constraint if exists documents_kind_check;
alter table documents add constraint documents_kind_check
    check (kind in ('quotation_pdf', 'receipt_pdf', 'invoice_pdf',
                    'job_card_pdf', 'job_card_image', 'challan_pdf'));

-- ─── The challan number ──────────────────────────────────────────────────────
-- Stored on the delivery, not derived, and UNIQUE: the number is the reference a customer
-- or a checking officer quotes back weeks later, so it must be allocated ONCE and then
-- reused by every re-render. Re-generating bumps `documents.version`; the number does not
-- move.
--
-- FORMAT IS THEIRS: "T.F 66" — a prefix and a CONTINUOUS counter, with no fiscal year in
-- it. So the counter is stored under a fixed pseudo-FY ('ALL') rather than a real one:
-- allocate_number('CHL', '2627') would restart at 1 every April, and their pad does not.
--
-- ⚠️  OPS STEP BEFORE FIRST USE — sync with their paper book, or the app will start at
--     T.F 1 and duplicate numbers they have already issued by hand:
--
--       insert into doc_series (series, fiscal_year, last_no) values ('CHL', 'ALL', 66)
--       on conflict (series, fiscal_year) do update set last_no = excluded.last_no;
--
--     Not run here because only the client knows their true last number.
alter table deliveries
    add column if not exists challan_no text unique;

-- ─── Where the goods are going ───────────────────────────────────────────────
-- A challan without a ship-to address is not usable paperwork — it is the line the
-- driver and any checking officer read first. There is nowhere to put one today:
-- `customers` has no address column (0002) and neither did `deliveries` (0026). So the
-- address belongs to the DELIVERY, which is also the correct grain — the same customer's
-- second order may go to a different site.
--
-- Nullable, because a showroom collection has no delivery address.
alter table deliveries
    add column if not exists delivery_address text;

-- ─── Delivery rent ───────────────────────────────────────────────────────────
-- A money line on their challan ("Delivery rent :-"), left blank on the sample. Separate
-- from the order's totals: it is the transport charge for THIS run, so it belongs to the
-- delivery. Nullable — blank on the paper prints blank, which is what their pad does.
alter table deliveries
    add column if not exists delivery_rent numeric(12,2)
        check (delivery_rent is null or delivery_rent >= 0);

-- ─── "D.P – ASG" ─────────────────────────────────────────────────────────────
-- ⚠️  MEANING UNCONFIRMED. It appears on their challan directly under MOBILE NO and the
-- sample value is "ASG" — plausibly a dispatch point, a design partner, or a person's
-- initials. Stored as OPAQUE FREE TEXT so it prints correctly whatever it turns out to
-- be; do not give it a type or a lookup table until the client says what it is. Renaming
-- the label later is a template one-liner.
alter table deliveries
    add column if not exists dp_code text;

comment on column deliveries.dp_code is
    'The "D.P" line on the Topaz challan (sample value "ASG"). Meaning unconfirmed with '
    'the client — deliberately opaque free text, not an enum or FK.';

-- `vehicle_no` (their "TEMPO NUMBER") and `eway_bill_no` already exist on `deliveries`
-- from 0026. Their format does not print an e-way bill; the column stays because
-- interstate movement above the threshold legally requires one and the board shows it.

comment on column deliveries.challan_no is
    'Delivery challan number (CHL-<FY>-NNNN), allocated once by tasks/challan.py and '
    'reused by every re-render. A challan belongs to a DELIVERY because it lists the '
    'goods on one run — a partial delivery gets its own challan (0037).';
