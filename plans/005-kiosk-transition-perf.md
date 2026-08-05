# Plan 005: Kiosk Transition Performance

## Overview
The Kiosk main card uses `transition-all duration-300 transform`. `transition-all` forces the browser to check layout and paint properties, causing dropped frames on lower-end devices.

## Target File
`apps/dashboard/src/app/kiosk/page.tsx`

## Current Code (Line 130)
```tsx
          className={`w-full bg-white/80 backdrop-blur-md border border-amber-100/50 rounded-3xl shadow-xl shadow-amber-950/5 p-6 md:p-10 transition-all duration-300 transform ${animClass}`}
```

## Exact Fix
Replace `transition-all` with `transition-[transform,opacity]` and slightly speed it up to `duration-200` with `ease-out`.

```tsx
          className={`w-full bg-white/80 backdrop-blur-md border border-amber-100/50 rounded-3xl shadow-xl shadow-amber-950/5 p-6 md:p-10 transition-[transform,opacity] duration-200 ease-out transform ${animClass}`}
```

## Verification
1. Open the Kiosk route (`/kiosk`).
2. Trigger the page transition (e.g., submitting a walk-in).
3. The fade/slide should execute cleanly without stuttering.
