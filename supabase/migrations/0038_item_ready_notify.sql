-- Topaz CRM — 0038 · "this item is finished" → tell the salesperson who sold it
--
-- The client's ask: when an item clears its last production stage, the assigned
-- salesperson should hear about it — they are the one who has to collect the balance and
-- book the delivery, and today they only find out by looking at the board.
--
-- ─── WHY A COLUMN AND NOT "just send it from the advance handler" ─────────────
-- The send is a Celery task with retries. `production_done_at` alone cannot tell a first
-- attempt from a retry, so a worker that dies after the WhatsApp leaves Meta but before
-- the task acks would message the salesperson again on the retry — and again, and again.
-- This column is the ATOMIC CLAIM:
--
--     UPDATE order_items SET ready_notified_at = now()
--      WHERE id = :id AND production_done_at IS NOT NULL AND ready_notified_at IS NULL
--      RETURNING id
--
-- No row back = somebody already claimed it (or the item is not actually finished), so
-- the task returns without sending. Same shape as the followup claim in tasks/followup.py
-- and the reminder claim in 0035.
--
-- NOT a trigger: the claim has to happen in the WORKER, immediately before the network
-- call. A trigger firing on `production_done_at` would stamp it at the moment the stage
-- was ticked, which is before anything has been sent — turning the claim into a lie.
-- ════════════════════════════════════════════════════════════════════════════

alter table order_items
    add column if not exists ready_notified_at timestamptz;

-- The claim's own predicate. Tiny partial index: finished-but-not-yet-notified is a
-- transient state a handful of rows are in at any moment, which is exactly the set a
-- recovery sweep would need to find.
create index if not exists order_items_ready_unnotified_idx
    on order_items (production_done_at)
    where production_done_at is not null and ready_notified_at is null;

-- ─── alerts: the new 'item_ready' signal ─────────────────────────────────────
-- `alerts.type` is a CHECK list (0010, widened by 0031 and 0035). The alert is the
-- DURABLE record — the dashboard shows "ready to deliver" even when WhatsApp is down —
-- and the message is only the nudge.
alter table alerts drop constraint if exists alerts_type_check;
alter table alerts add constraint alerts_type_check
    check (type in ('intent_call', 'intent_visit', 'confusion', 'buying_signal',
                    'leg_overdue', 'transfer_pending', 'production_blocked',
                    'stage_due', 'item_ready'));

-- ─── alerts.order_id ─────────────────────────────────────────────────────────
-- Every alert before this one was about a CONVERSATION, so `customer_id` was the whole
-- address and the feed's CTA could only ever open the customer page. An 'item_ready'
-- alert is about an ORDER, and the action it asks for (collect the balance, book the
-- delivery) lives on that order's page — so without this column the notification would
-- end at "go and find it".
--
-- Nullable: the four intent types have no order. ON DELETE SET NULL, not CASCADE — the
-- alert is a record that something happened and must outlive the row it pointed at.
--
-- No RLS change: alerts_select (0010) scopes on customer_id, which every alert still
-- carries, so this column widens nothing.
alter table alerts
    add column if not exists order_id uuid references orders(id) on delete set null;

create index if not exists alerts_order_idx on alerts (order_id) where order_id is not null;
