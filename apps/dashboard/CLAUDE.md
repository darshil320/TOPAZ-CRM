# CLAUDE.md — Topaz CRM admin panel (visual redesign)

House rules for this redesign. `DESIGN_SYSTEM.md` is the source of truth for every
value; this file is the process rules for working in this repo.

## Scope

Visual layer + app shell only. No feature, route, or data changes. Same information,
same behavior, restyled.

## Rules

1. **Every color/size/radius comes from a token.** No raw hex, no arbitrary px in new
   code. Tokens live in `tokens.css` (raw CSS vars) and `tailwind.config.ts` (Tailwind
   utilities: `bg-sf`, `text-t1`, `border-ln`, `rounded-card`, etc.). If a value you need
   isn't in `DESIGN_SYSTEM.md`, stop and ask — don't invent one.
2. **Reuse a primitive before building a new one.** `Card`, `StatCard`, `ListRow`,
   `Button`, `Badge`, `Pill`, `SectionHeader`, `PageHeader`, `Popover`, `KbdChip` cover
   most cases. New component types need a reason — ask first.
3. **Elevation over color.** Emphasis = raise (`bg-sf` + `shadow-sh`), not tint.
4. **One accent per view.** One primary button per screen region.
5. **Numbers are monospace + tabular** (`font-mono`, `tabular-nums`) — money, counts,
   IDs, dates in tables. Always.
6. **Legacy shadcn tokens** (`bg-background`, `text-foreground`, `border-border`, etc.
   in `tailwind.config.ts`) still back pages not yet redesigned. Don't delete them
   until every page using them has been migrated to the new token set.
7. **Dark mode is designed per-surface**, not derived — check every new surface in
   both themes (`data-theme="dark"` on `<html>`) before calling it done.
8. **No new fonts.** Geist + Geist Mono only, loaded via `next/font/google` in
   `src/app/layout.tsx` (this repo's existing convention — not the CDN `@import` the
   drop-in `tokens.css` shipped with).

## Build order

1. Foundation — tokens, fonts, dark mode. *(done)*
2. Shell — `Sidebar` + `TopBar` + outlet (`DESIGN_SYSTEM.md` §4–5). Stop for review.
3. Primitives — `DESIGN_SYSTEM.md` §6. Stop for review.
4. Pages, one at a time, starting with Payments (has a prototype to diff against).
   Ask before adding any new component type.

## Reference

- `DESIGN_SYSTEM.md` — full visual spec.
- `reference/Topaz CRM Shell.dc.html` — HTML prototype, direction **1a — Quiet Rail**
  only (1b/1c are alternates, ignore). Reference, not code to copy.
- `tokens.css` / `tailwind.tokens.js` — token source, merged into `tailwind.config.ts`.
