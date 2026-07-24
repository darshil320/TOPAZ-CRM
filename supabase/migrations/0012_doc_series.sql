-- Topaz CRM — 0012 · document numbering series (Phase 2A foundation)
-- Gap-tolerant, collision-free document numbering for quotations/orders/receipts.
-- Series are per fiscal year (Apr–Mar), e.g. QTN-2627-0001. The fiscal-year string
-- is computed in the Python numbering service, never in SQL (PLAN.md decision 5).
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists doc_series (
    series      text not null,          -- 'QTN' | 'ORD' | 'RCP'
    fiscal_year text not null,          -- '2627' (FY 2026-27)
    last_no     int  not null default 0,
    primary key (series, fiscal_year)
);

-- Atomic allocator: upserts the (series, fy) row and returns the freshly
-- incremented number in a single statement. The ON CONFLICT DO UPDATE takes a row
-- lock, so concurrent callers serialise and never receive the same number.
-- Uniqueness is the ONLY guarantee — a rolled-back caller burns a number (gaps are
-- acceptable and expected). Never MAX()+1 (race) — PLAN.md decision 5.
create or replace function allocate_number(p_series text, p_fy text)
returns int language sql as $$
    insert into doc_series (series, fiscal_year, last_no)
    values (p_series, p_fy, 1)
    on conflict (series, fiscal_year)
    do update set last_no = doc_series.last_no + 1
    returning last_no;
$$;

comment on function allocate_number(text, text) is
    'Atomically allocate the next number for (series, fiscal_year). Unique, gap-tolerant.';

-- Numbering runs server-side only (FastAPI/Celery via the service role); no
-- authenticated/anon grants — the browser never allocates a number directly.
