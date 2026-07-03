-- Topaz CRM — 0006 · visits.captured_at (edge detection timestamp)
-- occurred_at = when the worker wrote the row (default now()).
-- captured_at = when the camera actually saw the face (edge-reported).
-- Under queue backlog these diverge; analytics should prefer captured_at.

alter table visits add column captured_at timestamptz;

-- Backfill: occurred_at is the best available proxy for historical rows.
update visits set captured_at = occurred_at where captured_at is null;
