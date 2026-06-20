# SHIFT POS Rewrite Roadmap

This document describes the planned rebuild of SHIFT POS into a full cross-platform system that can run as standalone, master, or side device on both Windows and Android.

The future version should not depend on Firebase. It should be local-first, work offline, and sync through a backend API that can later use PostgreSQL, MySQL, SQL Server, or another database behind the API.

## Target Architecture

```text
Flutter App
  Windows / Android
  Standalone / Master / Side

Local Core
  SQLite
  Orders
  Shifts
  Inventory
  Suppliers
  Users and permissions
  Audit log
  Receipt and kitchen printing
  Reports
  Licensing

Sync Layer
  Local outbox
  API client
  Conflict handling
  Device identity
  Store identity

Backend API
  Stateless services
  Tenant/store isolation
  DB-independent business layer
  PostgreSQL/MySQL/etc. behind the API
  Load-balancer friendly
```

## Core Principles

- The app must be fully usable offline.
- SQLite is the source of truth for standalone/master local work.
- Side devices never write their own POS database; they connect to a master.
- Cloud sync must happen through an API, never direct database access.
- The app must not care whether the API uses PostgreSQL, MySQL, or another database.
- Business logic must live outside UI screens.
- Printing must be built as a real ESC/POS-compatible print pipeline.
- Every important manager action must create an audit log entry.
- Permissions must be enforced in both UI and service layers.
- The existing Electron app remains the production app until the rewrite reaches feature parity.

## Phase 0: Discovery and Feature Freeze

Goal: document the current system before rewriting it.

Tasks:
- Freeze major new features in the Electron app except critical fixes.
- Document all current workflows:
  - Login and permissions
  - POS order flow
  - Dine-in tables
  - Delivery/takeaway
  - Payments and split payments
  - Shifts
  - Inventory deduction
  - Purchases and suppliers
  - Reports
  - Receipts and kitchen printers
  - Backup/restore
  - Master/side LAN mode
  - Licensing
  - Audit log
- Export current TypeScript models into a reference document.
- Identify every current `electronAPI` capability that needs a future platform service.
- Define must-have parity for v1 of the rewritten app.

Deliverables:
- Current-system behavior document.
- Entity list and field map.
- Platform capability map.
- Rewrite acceptance checklist.

## Phase 1: New Data Model and Local Core

Goal: create the local-first foundation.

Tasks:
- Design the new SQLite schema.
- Add migration system from day one.
- Build repositories for:
  - Users
  - Roles and permissions
  - Categories and items
  - Tables
  - Orders
  - Order items
  - Payments
  - Shifts
  - Inventory transactions
  - Suppliers
  - Supplier transactions
  - Settings
  - Printers
  - Audit logs
  - Sync outbox
- Build pure business services:
  - Totals calculation
  - Tax and service charge
  - Discounts
  - Inventory deduction/reversal
  - Shift summary
  - Supplier balance
  - Audit event creation

Deliverables:
- SQLite schema.
- Migration runner.
- Local repository layer.
- Unit tests for calculations and stock movement.

## Phase 2: Flutter App Shell

Goal: create the cross-platform application base.

Tasks:
- Create Flutter project with Android and Windows targets.
- Add app routing.
- Add RTL Arabic layout foundation.
- Add theme system.
- Add authentication flow.
- Add role-based navigation.
- Add reusable UI components:
  - Buttons
  - Inputs
  - Tables
  - Dialogs
  - Tabs
  - Search/filter controls
  - Keyboard/focus handling
- Add platform service interfaces:
  - File picker
  - Backup/restore
  - Printing
  - Local server
  - Device identity
  - Updates

Deliverables:
- Runnable Android app.
- Runnable Windows app.
- Login screen.
- Permission-aware shell.
- Basic settings screen.

## Phase 3: POS Workflows

Goal: rebuild the cashier experience.

Tasks:
- Menu browsing and search.
- Cart management.
- Takeaway orders.
- Delivery orders.
- Dine-in table selection.
- Add items to an occupied table order.
- Payment flow:
  - Cash
  - Card
  - Split payment
  - Change calculation
- Current-shift order history.
- Refund/cancel rules.
- Order notes and item notes.
- Empty cart restaurant branding.

Deliverables:
- Full cashier workflow on Android and Windows.
- Local SQLite order persistence.
- Inventory deduction from POS orders.
- Audit events for cashier operations.

## Phase 4: Manager Workflows

Goal: rebuild management features with clean UI and strict permissions.

Tasks:
- Dashboard.
- Accounts and permissions.
- Items and categories.
- Sizes and addons.
- Ingredients/materials.
- Inventory current stock.
- Purchases.
- Suppliers and supplier debt.
- Supplier transaction log.
- Cashier history.
- Shift management.
- Reports.
- Audit log with filters and detail dialog.
- Settings:
  - Restaurant/receipt info
  - Tax and service charge
  - Backup settings
  - Printers
  - Network mode
  - Shortcuts/accessibility

Deliverables:
- Manager feature parity.
- Permission-gated tabs/cards/actions.
- Audit coverage for manager operations.

## Phase 5: Printing System

Goal: make printing predictable on both platforms.

Tasks:
- Build print document model:
  - Customer receipt
  - Kitchen ticket
  - Shift summary
  - Reports
- Build receipt template engine:
  - Section ordering
  - Hidden sections
  - Logo alignment
  - Logo max width
  - Item sorting
  - Tax/service/payment sections
- Build ESC/POS renderer.
- Build printer transports:
  - Network TCP printer
  - Windows system printer
  - Android Bluetooth printer
  - Android USB printer
  - PDF/export fallback
- Add test print flows.
- Add printer warning flows when no printer is configured.

Deliverables:
- ESC/POS-compatible receipt output.
- Kitchen batching by printer.
- Default printer per device.
- Receipt preview that matches print output as closely as possible.

## Phase 6: Master/Side LAN Mode

Goal: allow both Android and Windows to operate as standalone, master, or side device.

Tasks:
- Build local master HTTP API.
- Add pairing flow.
- Add device token management.
- Add side-device connection status.
- Add side-device auth through master.
- Route side-device reads/writes through master API.
- Route printing by device/default printer rules.
- Add token revocation and reconnect flow.
- Add foreground service support for Android master when needed.

Deliverables:
- Windows master with Android/Windows side devices.
- Android master with Android/Windows side devices.
- Side devices with no local POS database.
- Reconnect flow after revocation or network loss.

## Phase 7: API Sync Layer

Goal: prepare for future cloud sync and scaling.

Tasks:
- Define API contracts.
- Add local sync outbox.
- Add pull/push sync protocol.
- Add idempotency keys.
- Add device/store identity.
- Add conflict policy:
  - Orders are append/immutable where possible.
  - Inventory uses transactions, not blind stock overwrite.
  - Settings use versioning.
  - Users/permissions use updated-at/version checks.
- Add sync status UI.
- Add retry/backoff.
- Add API authentication.

Deliverables:
- App can sync with a backend API.
- App does not know the backend database type.
- Sync can work through a load-balanced stateless API.

## Phase 8: Backend API

Goal: provide a scalable backend that can use different databases.

Tasks:
- Build stateless API service.
- Add tenant/store isolation.
- Add authentication and device tokens.
- Add database abstraction/repository layer.
- Add migrations for selected backend database.
- Add endpoints for:
  - Auth
  - Devices
  - Orders
  - Inventory transactions
  - Suppliers
  - Shifts
  - Settings
  - Audit logs
  - Sync pull/push
- Add observability:
  - Logs
  - Metrics
  - Request IDs
  - Error tracking
- Add deployment strategy:
  - Docker
  - Reverse proxy/load balancer
  - Database backups
  - Environment-based config

Deliverables:
- Production-ready API contract.
- First backend implementation.
- Database-agnostic app sync.

## Phase 9: Migration from Electron

Goal: move existing customers safely.

Tasks:
- Build importer for current `offline-pos.sqlite`.
- Map old schema to new schema.
- Preserve:
  - Items
  - Categories
  - Users
  - Settings
  - Printers
  - Orders
  - Shifts
  - Inventory
  - Suppliers
  - Audit logs where possible
- Add dry-run validation.
- Add backup-before-import.
- Add migration report.

Deliverables:
- Migration tool.
- Import validation report.
- Rollback path.

## Phase 10: Testing and Release

Goal: reach production confidence.

Tasks:
- Unit tests for business logic.
- Integration tests for SQLite repositories.
- End-to-end tests for cashier and manager workflows.
- Printer simulator tests.
- LAN master/side tests.
- Android tablet testing.
- Windows POS testing.
- Offline/online sync tests.
- Backup/restore tests.
- Performance testing with large order history.

Deliverables:
- Release candidate.
- Installer/APK builds.
- Migration guide.
- Operator guide.
- Admin guide.

## Suggested Milestones

1. Core prototype:
   - Flutter app
   - SQLite
   - Login
   - Items
   - Basic POS order

2. POS MVP:
   - Takeaway/delivery/dine-in
   - Payments
   - Shifts
   - Basic receipt printing

3. Manager MVP:
   - Items
   - Inventory
   - Suppliers
   - Users
   - Reports

4. LAN MVP:
   - Master/side
   - Pairing
   - Side auth
   - Remote writes

5. Printing MVP:
   - ESC/POS receipts
   - Kitchen batching
   - Default printers

6. Sync MVP:
   - Outbox
   - API contract
   - Push/pull
   - Conflict handling

7. Production release:
   - Migration
   - Backups
   - Testing
   - Documentation

## Rough Effort Estimate

- POS MVP: 6-10 weeks.
- Full feature parity: 4-6 months.
- Sync-ready architecture and backend contract: 5-8 months.
- Production-grade Android and Windows release: 6-9+ months.

These estimates assume focused development and stable requirements.

## First Technical Decision

Recommended stack:

- App: Flutter.
- Local database: SQLite.
- Local API/master server: Dart HTTP server using shelf or equivalent.
- State management: Riverpod or Bloc.
- Printing: custom print document model plus ESC/POS renderer.
- Backend API: stateless REST API with database-independent service layer.
- Backend database: PostgreSQL first, with repository abstraction for future database changes.

The main rule: build the new app around stable domain services, not UI screens and platform calls.
