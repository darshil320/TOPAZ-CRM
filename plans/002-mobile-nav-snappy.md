# Plan 002: Mobile Nav Bottom Sheet Snappy Entry

## Overview
The mobile navigation drawer acts as a bottom sheet. It currently uses `transition-transform duration-300 ease-in-out`. Using `ease-in-out` on entry feels rigid, as real physical objects decelerate as they arrive (ease-out). The 300ms duration also feels a bit sluggish for a high-frequency action.

## Target File
`apps/dashboard/src/components/MobileNav.tsx`

## Current Code (Lines 123)
```tsx
            className={`sm:hidden fixed bottom-0 inset-x-0 z-50 bg-sf rounded-t-2xl shadow-shp border-t border-ln transition-transform duration-300 ease-in-out pb-[env(safe-area-inset-bottom)] ${
```

## Exact Fix
Change `duration-300 ease-in-out` to `duration-200 ease-out`.

```tsx
            className={`sm:hidden fixed bottom-0 inset-x-0 z-50 bg-sf rounded-t-2xl shadow-shp border-t border-ln transition-transform duration-200 ease-out pb-[env(safe-area-inset-bottom)] ${
```

## Verification
1. Open the app on a mobile viewport size.
2. Toggle the bottom sheet navigation.
3. The sheet should slide up faster and decelerate naturally at the top, feeling more responsive to the tap.
