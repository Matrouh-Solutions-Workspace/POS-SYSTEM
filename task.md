# SHIFT POS — Implementation Tasks

## Phase 1: Foundation (UI Component Library & Design Cleanup)
- `[x]` Centralize component types and constants into `src/renderer/src/features/manager/items/items-types.ts`.
- `[x]` Update existing usages of `FormModal` to match the new API (e.g. `ItemsPage.tsx`).
- `[x]` Refactor `CategoriesTab` out of `ItemsPage.tsx` into `src/renderer/src/features/manager/items/CategoriesTab.tsx` using `<FormModal>` and `<FormField>`.
- `[x]` Refactor `SizesTab` out of `ItemsPage.tsx` into `src/renderer/src/features/manager/items/SizesTab.tsx` using `<FormModal>` and `<FormField>`.
- `[x]` Refactor `AddonsTab` out of `ItemsPage.tsx` into `src/renderer/src/features/manager/items/AddonsTab.tsx` using `<FormModal>` and `<FormField>`.
- `[x]` Refactor `RawMaterialsTab` out of `ItemsPage.tsx` into `src/renderer/src/features/manager/items/RawMaterialsTab.tsx` using `<FormModal>` and `<FormField>`.
- `[x]` Refactor Add/Edit Item and Edit Recipe modals in `ItemsPage.tsx` to use `<FormModal>`.
  - `[x]` Modal.tsx — reusable modal with header, body, footer
  - `[x]` FormModal.tsx — create/edit modal with save/cancel
  - `[x]` FormField.tsx — label + input + error + hint
  - `[x]` ConfirmDialog.tsx — confirmation modal
  - `[x]` DataTable.tsx — sortable/filterable table
  - `[x]` EmptyState.tsx — icon + message + action
  - `[x]` LoadingSpinner.tsx — consistent loading
  - `[x]` Toast.tsx — notification toast
  - `[x]` SearchInput.tsx — debounced search
  - `[x]` FilterBar.tsx — horizontal filter strip
  - `[x]` StatCard.tsx — stat display card
  - `[x]` Badge.tsx — status/count badge
  - `[x]` index.ts — barrel export
- `[x]` **1.2** CSS design system cleanup
  - `[x]` Extract component CSS to components.css
  - `[x]` Add new component styles
  - `[x]` Standardize naming conventions
- `[x]` **1.3** Eliminate `window.confirm()` / `window.prompt()`
- `[x]` **1.4** Replace inline styles with CSS classes (across all pages)
  - `[x]` Create utilities.css
  - `[x]` Refactor POS features
  - `[x]` Refactor Layout and Orders features
  - `[x]` Refactor Manager features
  - `[x]` Refactor Auth and Settings features

## Phase 2 — POS Experience

- `[x]` **2.1** Break PosPage.tsx into smaller components
  - `[x]` pos-store.ts (Zustand)
  - `[x]` WeightPopup.tsx / SizePopup.tsx / AddonPopup.tsx
  - `[x]` CategoryBrowser.tsx
  - `[x]` ItemGrid.tsx
  - `[x]` CartPanel.tsx
  - `[x]` CheckoutModal.tsx
  - `[x]` OpeningCashModal.tsx / CloseShiftModal.tsx
  - `[x]` HeldOrdersPanel.tsx
- `[x]` **2.2** Category card navigation (drill-down)
- `[x]` **2.3** Breadcrumb / location indicator
- `[x]` **2.4** Refine cart panel UX

## Phase 3 — Unified Forms (Manager Pages)

- `[x]` **3.1** Refactor ItemsPage.tsx (tabs + modal forms)
- `[x]` **3.2** Refactor SuppliersPage.tsx (modal forms)
- `[x]` **3.3** Refactor AccountsPage.tsx (modal forms)
- `[x]` **3.4** Refactor SettingsPage.tsx (modular tabs)
- `[x]` **3.5** Refactor remaining pages (Shifts, Purchases, Reports, Audit, OrderHistory, FloorPlan)

## Phase 4 — README Critical Fixes

- `[x]` **4.1** Unify total/tax/service calculation
- `[x]` **4.2** Fix delivery payment recording
- `[x]` **4.3** Fix split payment validation
- `[x]` **4.4** Add payment idempotency
- `[x]` **4.5** Fix refund accounting
- `[x]` **4.6** Fix cancellation accounting
- `[x]` **4.7** Fix inventory migration
- `[x]` **4.8** Improve backup/restore safety

## Phase 5 — Security & Testing

- `[x]` **5.1** Replace password hashing
- `[x]` **5.2** Schema migration framework
- `[x]` **5.3** Atomic audit entries
- `[x]` **5.4** Fix report accuracy
- `[x]` **5.5** Add automated tests during dist:win and dist:win:publish
- `[x]` **5.6** Manager authorization for refunds/voids
- `[x]` **5.7** Remove licensing bypass
- `[x]` **5.8** Rotate credentials

## Phase 6 — Post-Launch

- `[ ]` **6.1** Improve action-level permissions
- `[ ]` **6.2** Harden Electron (sandbox, CSP, IPC)
- `[ ]` **6.3** DB health indicators
- `[ ]` **6.4** Backup status monitoring
- `[ ]` **6.5** Crash logging
- `[ ]` **6.6** LAN master/side mode
- `[ ]` **6.7** API sync
