# Plan 003: Popover Origin

## Overview
The custom `PopoverPanel` uses an animation defined in Tailwind as `popIn`. This correctly scales from `0.985` and translates Y. However, because `PopoverPanel` has no `transform-origin` specified, the browser scales it from its exact center. Popovers should scale and emerge from the button that triggered them (usually top or top-right/left).

## Target File
`apps/dashboard/src/components/ui/Popover.tsx`

## Current Code (Lines 44-45)
```tsx
  return (
    <div className={cn("bg-sf rounded-pop shadow-shp p-[5px] animate-popIn z-50", className)}>
```

## Exact Fix
Add `origin-top` as a default class so that the popover physically emerges from the trigger above it. (Component instances can override this with `origin-bottom` etc. via `className`).

```tsx
  return (
    <div className={cn("bg-sf rounded-pop shadow-shp p-[5px] animate-popIn z-50 origin-top", className)}>
```

## Verification
1. Click a dropdown or popover trigger (like the Account Menu).
2. The popover should seem to unfold/scale from the trigger rather than ballooning out from its own empty center.
