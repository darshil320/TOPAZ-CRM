# Plan 004: Workshop Queue Duration

## Overview
The workshop queue rows use `transition-all duration-500` for hovering or state changes. A half-second transition on a list row feels extremely sluggish and unresponsive. High-frequency list elements should respond in under 200ms.

## Target File
`apps/dashboard/src/app/workshop/WorkshopQueueClient.tsx`

## Current Code (Line 544)
```tsx
                  className={`h-full transition-all duration-500 ${
```

## Exact Fix
Change the duration to `200` or `150` and swap `transition-all` for `transition-colors` or `transition-[width,background-color]` to improve performance.

```tsx
                  className={`h-full transition-all duration-200 ease-out ${
```

*(Note: If it's animating a progress bar width, `transition-all duration-200 ease-out` is much better than `500`).*

## Verification
1. Open the Workshop Queue.
2. Trigger the state change or hover.
3. Observe a snappier, more immediate visual change that doesn't feel like lag.
