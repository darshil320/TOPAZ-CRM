# Topaz CRM — Design System

The visual language for the Topaz admin panel. Every screen, existing or new, follows this.
Source of truth for values. If something isn't here, ask before inventing it.

---

## 0. The idea in one paragraph

Quiet surfaces, precise type, one accent. The interface is a graded stack of near-neutral
surfaces — rail, header, canvas — separated by tone and a hairline, never by a hard color
block. Emphasis comes from **elevation and weight**, not from color: the active nav item is a
white chip lifted off the rail, not a blue slab. Color is reserved for the accent (one action
per view) and for money that needs attention. Numbers are always monospaced and
tabular. Nothing decorative earns space.

**Do not** introduce: gradients as backgrounds, colored section headers, left-border accent
strips, glassmorphism, emoji, a second accent hue, or any font outside Geist.

---

## 1. Color tokens

Defined in `tokens.css`. Light is the base; `[data-theme="dark"]` overrides. Never write a
raw hex in component code.

### Surfaces — a four-step stack
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#ffffff` | `#08090c` | The content canvas. The deepest layer. |
| `--rail` | `#fafbfc` | `#0b0d11` | Sidebar background. One step off the canvas. |
| `--sf` | `#ffffff` | `#101318` | Cards, popovers, the **active nav chip**. Reads as raised. |
| `--sf2` | `#f3f4f7` | `#15181f` | Inset fields, search trigger, menu-row hover. |
| `--sf3` | `#eceef2` | `#1b1f27` | Nav-row hover, avatar backgrounds, kbd chips. |

Note the inversion in dark mode: `--sf` is *lighter* than `--bg`, so a raised element stays
raised. Never fake elevation with a border alone.

### Borders
| Token | Light | Dark | Use |
|---|---|---|---|
| `--ln` | `#e6e8ee` | `#1f232b` | Structural hairlines: card borders, rail edge, header rule. |
| `--ln2` | `#eff0f4` | `#171a21` | Dividers *inside* a surface (menu separators). |

### Text — three tones only
| Token | Light | Dark | Use |
|---|---|---|---|
| `--t1` | `#12141a` | `#eef0f5` | Primary: page titles, active nav, values, names. |
| `--t2` | `#59616f` | `#98a1b0` | Secondary: inactive nav, descriptions, sub-labels. |
| `--t3` | `#8b93a1` | `#69717f` | Tertiary: section labels, placeholders, icons at rest, meta. |

A fourth tone is a smell. If something needs to sit between `--t2` and `--t3`, change its
weight instead.

### Accent
| Token | Value | Use |
|---|---|---|
| `--acc` | `#4b56e6` | Primary button, active nav icon, focus ring, accent badges. |
| `--accS` | `color-mix(in oklab, var(--acc) 9%, #fff)` (dark: 24% into `#0a0b0e`) | Accent badge background. |
| `--accL` | `color-mix(in oklab, var(--acc) 20%, #fff)` (dark: 40%) | Hover border on interactive cards. |

Both soft variants derive from `--acc` via `color-mix`, so rebranding is a one-line change.
**One accent element per viewport region.** Two primary buttons on a screen means one of
them isn't primary.

### Semantic
| Token | Light | Dark | Use |
|---|---|---|---|
| `--pos` / `--posS` | `#0e8a5f` / `#e7f6ef` | `#3ddc9a` / `#0f2a20` | Available status, live presence, collected. |
| `--warn` / `--warnS` | `#a8560c` / `#fdf2e4` | `#f0a54a` / `#2a1d0c` | Outstanding and overdue money, notification dot. |

There is deliberately **no red**. Overdue money is amber; destructive confirmation dialogs are
the only place a red should ever be added, and it should be added to this table first.

### Shadows
| Token | Value (light) | Use |
|---|---|---|
| `--sh` | `0 1px 2px rgba(16,20,30,.06), 0 0 0 1px rgba(16,20,30,.05)` | The workhorse. Active nav chip, hovered rows. Shadow + hairline in one. |
| `--shp` | `0 18px 44px -16px rgba(14,20,40,.28), 0 0 0 1px rgba(16,20,30,.07)` | Popovers, menus, modals. Nothing else. |

Two shadows. Not three.

---

## 2. Typography

```
--f: 'Geist', 'SF Pro Text', -apple-system, 'Segoe UI', system-ui, sans-serif;
--m: 'Geist Mono', ui-monospace, SFMono-Regular, monospace;
```

Geist is variable — the odd weights below (450, 480, 560) are real and intentional. They give
UI text a settled feel that 400/500/600 can't. **If you substitute a static font, map
450→400, 480→500, 560→600.**

### Scale

| Role | Size | Weight | Tracking | Color | Family |
|---|---|---|---|---|---|
| Page title | 21px | 600 | `-.022em` | `--t1` | `--f` |
| Metric value | 18px | 600 | — | `--t1` | `--m` |
| Section header | 14px | 600 | `-.012em` | `--t1` | `--f` |
| Nav item, active | 13.5px | 560 | `-.008em` | `--t1` | `--f` |
| Nav item, rest | 13.5px | 480 | `-.008em` | `--t2` | `--f` |
| Body / breadcrumb | 13px | 450 | — | `--t2` | `--f` |
| Breadcrumb, current | 13px | 560 | `-.01em` | `--t1` | `--f` |
| Workspace name | 13.5px | 600 | `-.012em` | `--t1` | `--f` |
| List row primary | 13.5px | 600 | — | `--t1` | `--m` |
| Button label | 12.5px | 560 | `-.005em` | — | `--f` |
| Menu item | 12.5px | 480 | — | `--t1` | `--f` |
| Secondary / caption | 12px | 450 | — | `--t2` | `--f` |
| Meta, tabular | 12px | 500 | — | `--t2` | `--m` |
| Small meta | 11px | 450–500 | — | `--t3` | `--f` |
| **Overline label** | 10.5px | 600 | `.09em` | `--t3` | `--f` |
| **Card label** | 10px | 600 | `.08em` | `--t3` | `--f` |
| Kbd chip | 10.5px | 500 | — | `--t3` | `--m` |

Overline and card labels are always `text-transform: uppercase`. Nothing else ever is.

### Numerals
Any number a user compares — money, counts, IDs, dates in tables — uses `--m` with
`font-variant-numeric: tabular-nums`. Non-negotiable; it's most of why the UI reads precise.

Currency is always full precision in tables (`₹59,000.00`) and may abbreviate in stat cards
(`₹59,000`).

---

## 3. Space, radius, motion

### Spacing
Base unit 2px; the common steps are **4, 8, 10, 12, 14, 16, 20, 24, 26, 28**. The system runs
tight on purpose — this is a dense operational tool, not a marketing page.

- Sidebar padding: `12px 12px 10px`
- Content padding: `26px 28px`
- Card interior: `13px 14px`
- List row interior: `14px 16px`
- Nav row interior: `0 10px`
- Between nav groups: `14px` · between rows: `2px`
- Grid gap (cards): `11px`

### Radius
| Value | Applies to |
|---|---|
| `4px` | Kbd chips |
| `5px` | Count badges |
| `7px` | Icon buttons, menu rows, inset fields |
| `8px` | Nav rows, search trigger, primary button, logo tile |
| `9px` | Workspace + account buttons, collapsed nav icons |
| `10px` | Cards, list rows |
| `11px` | Popovers |
| `14px` | Window/shell corners |
| `99px` | Status pills, avatars |

Never fully-rounded rectangles. Never sharp corners.

### Density
`--row: 34px` and `--nfs: 13.5px` are the defaults. A compact mode
(`--row: 30px; --nfs: 13px; --gap: 1px`) is supported — expose it as a user preference if
you like, but the default is the designed state.

### Motion
Restrained. Nav and hover states change **instantly** — no transition. Only these move:

```css
@keyframes popIn   { from { opacity:0; transform:translateY(6px) scale(.985) } to { opacity:1; transform:none } }
@keyframes slideIn { from { opacity:0; transform:translateX(-8px) }            to { opacity:1; transform:none } }
@keyframes fadeIn  { from { opacity:0 }                                        to { opacity:1 } }
@keyframes livePulse { 0%,100% { box-shadow:0 0 0 0 color-mix(in oklab, var(--pos) 55%, transparent) } 70% { box-shadow:0 0 0 4px transparent } }
```

Popovers: `popIn .13s ease-out`. Panels: `slideIn .16s cubic-bezier(.22,1,.36,1)`. Live dots:
`livePulse 2.4s ease-out infinite`. Nothing else animates. Respect `prefers-reduced-motion`.

### Icons
Lucide. `24×24` viewBox, `fill:none`, `stroke:currentColor`, `stroke-linecap/linejoin:round`.

| Context | Size | Stroke |
|---|---|---|
| Nav row | 16.5px | 1.7 |
| Collapsed nav | 17px | 1.7 |
| Top-bar icon button | 16px | 1.7 |
| Menu row | 14.5px | 1.7 |
| Inline (search, chevrons) | 13–14px | 1.9–2.0 |
| Inside buttons | 13.5–14px | 2.1 |

Small icons get a heavier stroke so optical weight stays constant. Icons sit at `--t3` at
rest and `--acc` when their row is active.

---

## 4. The sidebar

`width: 268px` · `background: var(--rail)` · `border-right: 1px solid var(--ln)` ·
`padding: 12px 12px 10px` · `display:flex; flex-direction:column`.

Order, top to bottom: **workspace → search → nav → presence → account**.

### 4.1 Workspace button
Full width, `height:44px`, `padding:0 8px`, `border-radius:9px`, `border:1px solid transparent`, transparent background.
Hover: `background:var(--sf); border-color:var(--ln); box-shadow:var(--sh)`.
Contents (flex, `gap:10px`):
- Logo tile `27×27`, `radius:8px`, `background:var(--acc)`, glyph `#fff` 600/12.5px.
- Two stacked lines, `gap:1px`, both truncating: name (600/13.5px, `-.012em`, `--t1`) over context (500/11px, `--t3` — e.g. "Owner workspace · Andheri").
- Up/down chevron pair, 13px, `--t3`, `stroke-width:2`.

### 4.2 Search trigger
`margin-top:8px`, `height:32px`, `padding:0 9px`, `radius:8px`, `border:1px solid var(--ln)`, `background:var(--sf2)`.
Hover: `background:var(--sf); border-color:var(--acc)`.
Search icon 14px `--t3` · label "Search or jump to…" 450/12.5px `--t3` · ⌘K chip (500/10.5px `--m`, `--t3`, `background:var(--sf3)`, `radius:4px`, `padding:2px 5px`).

It is a **button that opens a palette**, not an input. Never put a real text field in the rail.

### 4.3 Nav
`margin-top:14px`, `flex:1`, `overflow-y:auto`, groups separated by `14px`.

**Group label** — 600/10.5px, `letter-spacing:.09em`, uppercase, `--t3`, `padding:0 10px`, `margin-bottom:5px`.
Groups today: "Management Overview" (owner only) and "Sales Engine".

**Row** — `height:var(--row)`, `padding:0 10px`, `radius:8px`, `gap:10px`, full width, left-aligned.

| State | Background | Icon | Label |
|---|---|---|---|
| Rest | transparent | `--t3` | 480/13.5px `--t2` |
| Hover | `--sf3` | `--t3` | 480/13.5px `--t2` |
| Active | `--sf` + `box-shadow:var(--sh)` | `--acc` | 560/13.5px `--t1` |

The active chip is the signature of this system. It must read as *lifted off* the rail — never
as a filled accent block.

**Count badges**, right-aligned, three tones:
- `accent` — 600/10.5px `--m`, color `--acc`, `background:var(--accS)`, `radius:5px`, `padding:2px 5px`. For things needing action (walk-in queue).
- `warn` — same geometry, `--warn` on `--warnS`. For money at risk.
- `plain` — 500/11px `--m`, `--t3`, no background. For ambient counts (open quotations).

Default to `plain`. A badge with a background is a claim on attention — earn it.

### 4.4 Presence — "On the floor"
`margin-top:12px`, `border-top:1px solid var(--ln)`, `padding-top:12px`, `gap:8px`.
Header row: 6px `--pos` dot with `livePulse` · overline label "ON THE FLOOR" · count right-aligned (500/11px `--m`, `--t3`).
Person rows: `padding:5px 4px`, `radius:7px`, `gap:9px`; hover `background:var(--sf3)`.
- Avatar 22px circle, `background:var(--sf3)`, initials 600/9.5px `--m` `--t2`.
- Name 500/12px `--t1`, truncating.
- Status 450/10.5px `--t3`, right ("12m", "Free").

This is the one piece of live data in the chrome. It's what makes the rail feel like an
operations tool rather than a menu. Keep it, and keep it honest — if presence data isn't
available, hide the block rather than faking it.

### 4.5 Account
`border-top:1px solid var(--ln)`, `padding-top:10px`, positioned relative (the popover anchors here).
Button: `height:42px`, `padding:0 8px`, `radius:9px`, `gap:9px`; hover `background:var(--sf); border-color:var(--ln); box-shadow:var(--sh)`.
- Avatar 26px circle `background:var(--acc)`, initials `#fff` 600/10.5px `--m`; 8px `--pos` presence dot bottom-right with `border:2px solid var(--rail)`.
- Name 560/12.5px `--t1` over meta 450/11px `--t3` ("Owner · Synced 2m ago").
- Chevron pair 13px `--t3`.

**Popover** — `position:absolute; bottom:52px; left:0`, `width:244px`, `background:var(--sf)`, `radius:11px`, `box-shadow:var(--shp)`, `padding:5px`, `animation:popIn .13s ease-out`.
Header block `padding:9px 10px 10px`, `border-bottom:1px solid var(--ln2)`: name 600/12.5px `--t1`, email 450/11.5px `--t3`.
Rows: `height:31px`, `padding:0 10px`, `radius:7px`, `gap:9px`; icon 14.5px `--t3`; label 480/12.5px `--t1`; optional shortcut 500/10px `--m` `--t3`, right. Hover `background:var(--sf2)`.
Contents: Profile · Preferences (⌘,) · Switch role · Theme · Help & docs — then a `1px var(--ln2)` divider inset `4px 6px` — then Sign out.

### 4.6 Collapsed rail
`width:64px`, centered column, `padding:12px 0 10px`, `gap:4px`.
Logo tile 29×29 with `margin-bottom:12px`. Nav buttons `38×38`, `radius:9px`, icon 17px.
Active: `background:var(--sf); box-shadow:var(--sh)`, icon `--acc`. Hover: `background:var(--sf3)`.
Group labels disappear; count badges become a 5px `--acc` dot at `top:7px; right:7px`.
Avatar pinned to the bottom. Every button needs a tooltip.

---

## 5. The top bar

`height:57px`, `border-bottom:1px solid var(--ln)`, `padding:0 20px 0 12px`, `gap:12px`, flex row, centered.

**Left:** collapse toggle (30×30, `radius:7px`, panel icon 16px `--t2`; hover `background:var(--sf2)`), then breadcrumb — ancestor 450/13px `--t3`, separator `/` at `opacity:.55`, current 560/13px `--t1` `-.01em`.

**Right,** in order:
1. **Status pill** — `height:29px`, `padding:0 10px 0 8px`, `radius:99px`, `background:var(--posS)`; 6px `--pos` dot; label 560/12px `--pos`.
2. **Notifications** — 30×30, `radius:7px`, bell 16px `--t2`; unread = 5px `--warn` dot at `top:6px; right:7px`.
3. **Divider** — `1px × 20px`, `var(--ln)`.
4. **Primary action** — `height:31px`, `padding:0 13px 0 10px`, `radius:8px`, `background:var(--acc)`, `box-shadow:0 1px 2px rgba(16,20,30,.14)`; plus icon 14px `#fff` `stroke-width:2.1`; label 560/12.5px `#fff` `-.005em`, `white-space:nowrap`. Hover `filter:brightness(1.08)`.

The account lives in the **sidebar**, not here — the top bar stays about *where you are* and
*what you can do*. One primary button, always rightmost.

---

## 6. Content primitives

### PageHeader
Title 600/21px `-.022em` `--t1`; subtitle 450/13px `--t2`, `margin-top:4px`.

### StatCard
`border:1px solid var(--ln)`, `radius:10px`, `padding:13px 14px`, `background:var(--sf)`.
Label 600/10px `.08em` uppercase `--t3`, single line with ellipsis.
Value 600/18px `--m` `--t1`, `margin-top:9px`, tabular.
Grid: `repeat(4, 1fr)`, `gap:11px`, `margin-top:20px`. No icons, no sparklines, no
percentage-change chips unless we design them.

### SectionHeader
`margin-top:24px`, baseline-aligned row: label 600/14px `-.012em` `--t1` · right-hand total 500/12px `--m` `--t2`.

### ListRow
`margin-top:10px`, `border:1px solid var(--ln)`, `radius:10px`, `background:var(--sf)`, `padding:14px 16px`, flex.
Primary 600/13.5px `--m` `--t1` (IDs and codes are monospace). Secondary 450/12px `--t2`, `margin-top:3px`. Trailing value 600/14px `--m`, tabular, semantic color.
Hover: `border-color:var(--accL)`.

Stacked rows carry their own border and `10px` gap — this system uses **card lists, not
bordered tables**. Use a real table only when there are more than five comparable columns.

### Button
| Variant | Height | Padding | Background | Border | Label |
|---|---|---|---|---|---|
| Primary | 31px | `0 13px 0 10px` | `--acc` | none | 560/12.5px `#fff` |
| Secondary | 29–31px | `0 12px` | `--sf` | `1px var(--ln)` | 560/12.5px `--t1` |
| Ghost icon | 30×30 | — | transparent | none | icon 16px `--t2` |

All `radius:7–8px`. Hover: primary `brightness(1.08)`; secondary `border-color:var(--accL); background:var(--sf2)`; ghost `background:var(--sf2)`.

### Pill / Badge / KbdChip
Pill: `radius:99px`, `height:29px`, semantic soft background, 560/12px semantic text, optional 6px dot.
Badge: see §4.3.
KbdChip: `background:var(--sf3)`, `radius:4px`, `padding:2px 5px`, 500/10.5px `--m` `--t3`.

### Popover
`background:var(--sf)`, `radius:11px`, `box-shadow:var(--shp)`, `padding:5px`, `animation:popIn .13s ease-out`. Rows per §4.5. Outside click and Escape close.

---

## 7. Rules for anything new

1. **Reach for a token.** No raw hex, no arbitrary px. If the value doesn't exist, the pattern
   probably shouldn't either — ask.
2. **Reuse a primitive.** New component types need a reason. Most "new" UI is a
   `Card` + `SectionHeader` + `ListRow` away.
3. **Elevation over color.** To emphasise something, raise it (`--sf` + `--sh`). Don't tint it.
4. **One accent per region.** One primary button per view.
5. **Numbers are monospace and tabular.** Always.
6. **Empty states get a sentence, not an illustration.** 450/13px `--t2`, centered, plus one
   secondary button if there's an action.
7. **Label everything in overline caps or not at all.** No title-case section headers floating
   above content.
8. **No new fonts, ever.**
9. **Dark mode is designed, not derived.** Check every new surface in both themes before
   calling it done.
10. **When in doubt, remove it.** Density is fine; noise is not.
