# Plan 001: Modals Physicality

## Overview
Custom modals in the app (e.g. `DeliveriesManagementClient`, `AssignModal`, etc.) use a fixed overlay (`fixed inset-0 bg-black/60`) but have no entry animations. When triggered, the black background and the modal instantly snap onto the screen. This breaks the illusion of physicality. We need to add standard Tailwind entry animations.

## Target Files
Any custom modal, notably:
- `apps/dashboard/src/app/dashboard/deliveries/DeliveriesManagementClient.tsx`
- `apps/dashboard/src/app/dashboard/production/allocate/AssignModal.tsx`

## Current Code Example (DeliveriesManagementClient.tsx:654)
```tsx
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-sf border border-ln rounded-2xl max-w-2xl w-full max-h-[92vh] overflow-y-auto p-6 space-y-4 shadow-2xl">
```

## Exact Fix
Add `animate-in fade-in duration-200 ease-out` to the outer overlay wrapper.
Add `animate-in zoom-in-95 duration-200 ease-out` to the inner modal window container.

```tsx
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200 ease-out">
          <div className="bg-sf border border-ln rounded-2xl max-w-2xl w-full max-h-[92vh] overflow-y-auto p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-200 ease-out" style={{ transformOrigin: "center" }}>
```

## Verification
1. Open the Delivery dashboard and click "Schedule Delivery".
2. Ensure the overlay gracefully fades in while the white modal scales up slightly from 95%.
