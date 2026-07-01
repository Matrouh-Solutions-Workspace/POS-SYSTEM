# POS MVP Launch Assessment

Assessment date: 2026-07-01
Product version reviewed: 2.2.6
Scope: first real-world MVP launch in a single restaurant or cafe, primarily Windows desktop, local SQLite, optional LAN master/side mode.

This assessment is based on the current codebase shape and implemented modules, not on previous README notes.

## Executive Summary

The system is close to a functional restaurant MVP, but it is not yet ready to install in a real venue without a controlled pilot.

Most core workflows exist: cashier sales, dine-in, delivery contacts, order history, payment tracking, shifts, cash drawer activity, inventory basics, suppliers, reports, printing configuration, audit logs, licensing, backups, and LAN master/side mode.

The remaining risk is not missing features as much as launch reliability: Arabic text corruption in source-visible strings, insufficient real-device validation, weak relational integrity because most business data is stored as JSON documents, and business logic spread through renderer services.

Recommended MVP status: internal pilot ready after blockers are fixed, first paying customer ready after one full restaurant-day trial.

## MVP Readiness Score

Current score: 72 / 100

Breakdown:

| Area | Score | Notes |
|---|---:|---|
| Cashier sales workflow | 82 | Order creation, payment, dine-in, delivery, held orders, editing, and history are mostly present. |
| Shift and cash control | 76 | Shifts, closure preview, expected cash, unpaid totals, supplier/petty cash activity, and manager override exist. Needs real close-day testing. |
| Inventory and suppliers | 70 | Ingredients, FIFO-ish stock movement, suppliers, returns, and purchase flows exist. Needs data integrity hardening and validation checks. |
| Printing | 68 | Receipt, report, default printer, kitchen printer, and test print flows exist. Needs hardware certification on actual printers. |
| Data reliability | 64 | SQLite WAL and atomic batch writes exist, but JSON-document storage limits constraints, reporting integrity, and migration safety. |
| Security and permissions | 72 | Permissions, scrypt credentials, fresh login, and license checks exist. LAN API and local admin flows need hardening before wider rollout. |
| UI/UX for restaurant use | 74 | Arabic RTL interface and touch-oriented screens exist. Several layout fixes were done, but real cashier speed testing is still needed. |
| Reporting and audit trail | 70 | Reports, audit log, employee activity, rounding reports, exports, and shift summaries exist. Needs verification that all manager actions are consistently logged. |
| Deployment/update/backup | 68 | Installer, GitHub update config, startup registration, clean install option, backup settings, and restore exist. Needs full install/update/restore rehearsal. |

## Current System Assessment

### Architecture

Current implementation:
- Electron desktop app with React renderer, Electron main process, preload APIs, and shared TypeScript types.
- Renderer feature services contain much of the business logic.
- Main process owns SQLite access, printing, license, backups, updates, and LAN master/side HTTP transport.
- App supports standalone, master, and side modes.

Why it matters:
- This is acceptable for a first local MVP, but the renderer-heavy business logic makes long-term testing and correctness harder.
- Side/master mode adds operational complexity that must be tested separately from standalone mode.

Recommended change:
- For MVP, do not rewrite architecture. Freeze scope and harden the existing workflows.
- Add focused smoke tests/check scripts for critical flows: login, create order, pay order, close shift, backup, restore, print test.
- After MVP, gradually move critical business operations behind main-process or shared domain services.

Priority: High
Effort: Medium

### Database

Current implementation:
- SQLite database under user data.
- WAL enabled.
- Main table pattern stores most entities in `cached_documents` as JSON documents.
- Some specialized tables exist: `seed_auth`, `sync_outbox`, `ingredient_stock`, and `meta`.
- Atomic batch writes exist for multi-entity operations.
- Basic migration runner exists.
- Backup and restore APIs exist.

Why it matters:
- SQLite is a good MVP choice.
- JSON-document collections are fast to evolve, but they do not enforce foreign keys, required fields, uniqueness, or referential integrity.
- A bad write can create broken reports, orphaned order items, or inconsistent inventory if validation misses something.

Recommended change:
- Before first deployment, add a database health check screen or script that validates:
  - orders have matching order items,
  - payments reference real orders,
  - open shifts are not duplicated per cashier,
  - menu items referenced in orders still have snapshot names/prices,
  - inventory batches and transactions are internally consistent,
  - users with credentials have matching user documents.
- Run a backup and restore drill on the target machine.
- Keep JSON-document storage for MVP, but document it as a conscious temporary design.

Priority: Critical
Effort: Medium

### Business Logic

Current implementation:
- Order creation supports takeaway, dine-in, delivery, discounts, tax, service charge, delivery fee, cash/card/split payment, rounding, and inventory movements.
- Dine-in can create unpaid table orders and add items to an occupied table.
- Cancellations, refunds, order editing, and inventory reversal logic exist.
- Shift closure includes expected cash, supplier payments, petty expenses, unpaid totals, and manager override.
- Supplier and purchase workflows exist.
- Audit logging exists for many important actions.

Why it matters:
- The MVP feature surface is strong.
- The biggest launch risk is correctness under real restaurant pressure: editing, cancelling, refunding, and closing shifts after mixed payment orders.

Recommended change:
- Before deployment, run a scripted restaurant-day scenario:
  - open shift,
  - create takeaway cash/card/split orders,
  - create dine-in unpaid order,
  - add items to same table,
  - pay dine-in order,
  - create delivery order with saved contact,
  - cancel paid order,
  - refund part of an order,
  - record supplier payment and petty expense,
  - close shift and compare expected cash manually.
- Keep a signed paper checklist for the first live day.

Priority: Critical
Effort: Medium

### UI/UX

Current implementation:
- Arabic RTL UI.
- Manager and POS modes with permission-based navigation.
- Touch-friendly buttons and large table views.
- Keyboard shortcuts and arrow focus navigation exist.
- Several recent layout issues have been fixed.

Why it matters:
- Restaurant MVP success depends on speed and mistake prevention more than feature count.
- A cashier must be able to complete common orders without confusion during rush time.

Recommended change:
- Fix all visible mojibake/corrupted Arabic strings before launch.
- Test the app at the actual screen resolution of the POS machine.
- Validate touch targets, scrolling tables, modal placement, and receipt preview on the hardware.
- Make sure every destructive action has clear Arabic confirmation.

Priority: Critical
Effort: Medium

### Technical Quality

Current implementation:
- TypeScript typecheck and production build pass.
- Packaging scripts exist.
- Phase checks exist for license/password regressions.
- Runtime warnings remain around mixed static/dynamic imports.
- Some source files still show corrupted Arabic strings.

Why it matters:
- Passing build is necessary but not enough for a restaurant launch.
- Corrupted strings reduce trust immediately and can confuse staff.
- Lack of automated workflow tests means regressions can return quietly.

Recommended change:
- Add a small MVP verification command that runs:
  - typecheck,
  - build,
  - phase checks,
  - text scan for mojibake markers,
  - database schema/collection health check.
- Treat corrupted visible text as a launch blocker.

Priority: High
Effort: Medium

## Launch Blockers

These must be fixed before installing in a real restaurant:

1. Corrupted Arabic text risk
   Current implementation: several UI/service files contain visible mojibake-style strings in source.
   Why it matters: if any of these render in production, users see broken Arabic in errors, modals, reports, or audit logs.
   Recommended change: scan and fix all user-facing strings containing mojibake markers such as `Ã˜`, `Ã™`, `Ã¢`, or broken punctuation.
   Priority: Critical
   Effort: Medium

2. No documented end-to-end restaurant-day validation
   Current implementation: build/typecheck passes, but there is no complete cashier-day acceptance run recorded.
   Why it matters: MVP risk is in combined flows, not isolated screens.
   Recommended change: run and document the restaurant-day scenario listed above.
   Priority: Critical
   Effort: Medium

3. Printer behavior not certified on target hardware
   Current implementation: printer selection, default printers, test print, receipt/report/kitchen flows exist.
   Why it matters: failed printing during service is a real launch failure.
   Recommended change: test customer receipt, kitchen ticket, report print, missing-printer warning, and printer reconnect on the actual printer models.
   Priority: Critical
   Effort: Small

4. Backup/restore not proven on target machine
   Current implementation: backup and restore APIs exist with configurable backup behavior.
   Why it matters: the first customer must have a recovery path before going live.
   Recommended change: perform backup, delete/replace test DB, restore, and verify orders/settings/users are intact.
   Priority: Critical
   Effort: Small

5. Data integrity checks are not formalized
   Current implementation: many operations are batched atomically, but JSON-document storage does not enforce relational constraints.
   Why it matters: one inconsistent record can break reports, shift closure, or inventory counts.
   Recommended change: add a pre-launch health check for orphaned records, duplicate open shifts, invalid payments, and missing user credentials.
   Priority: High
   Effort: Medium

## Required Modifications Before MVP

| Requirement | Current state | Recommended change | Priority | Effort |
|---|---|---|---|---|
| Arabic text quality | Many screens are Arabic, but source contains corrupted strings in several modules. | Fix all visible corrupted strings and add a scan to prevent recurrence. | Critical | Medium |
| First-day workflow validation | Features exist but are not proven together. | Run one complete simulated restaurant day. | Critical | Medium |
| Printing validation | Feature exists. | Certify real receipt, kitchen, and report printers. | Critical | Small |
| Backup/recovery | Feature exists. | Run restore drill and document recovery steps. | Critical | Small |
| Shift reconciliation | Feature exists. | Compare app expected cash against manual cash/card/refund sheet. | High | Small |
| Data health | Not formalized. | Add health check for JSON collections and key relationships. | High | Medium |
| Permission verification | Permission system exists. | Verify cashier, supervisor, and manager cannot access unauthorized tabs/actions. | High | Small |
| Installer/update | Installer and update config exist. | Test clean install, upgrade install, startup registration, and private release update. | High | Small |
| LAN mode | Implemented. | Treat as pilot-only unless tested with master plus at least one side device for a full shift. | Medium | Medium |
| Reports | Implemented. | Validate totals against orders/payments/shifts for one test day. | Medium | Small |

## Prioritized Roadmap

### Before First Deployment

Goal: safe internal pilot on real POS hardware.

1. Fix corrupted Arabic strings across visible UI, reports, errors, audit details, and receipts.
2. Run typecheck, build, and phase checks.
3. Run a complete restaurant-day scenario on a test database.
4. Test receipt, kitchen, report, and PDF/CSV export on the real machine.
5. Test backup and restore on the real machine.
6. Test clean install and upgrade install.
7. Verify every login starts fresh and no previous session auto-resumes.
8. Verify role permissions for cashier, supervisor, and manager.
9. Confirm the database location and backup folder with the restaurant owner.

### Before First Paying Customer

Goal: one live pilot day with controlled risk.

1. Create real menu, tables, printer setup, users, and backup schedule.
2. Train one cashier and one manager on:
   - opening shift,
   - creating orders,
   - editing/cancelling/refunding,
   - delivery contacts,
   - printing retry,
   - closing shift,
   - backup location.
3. Run one quiet live shift with paper fallback ready.
4. Compare app reports with manual cash/card totals at end of shift.
5. Confirm restore works from the latest backup after the pilot.
6. Freeze features for the first customer; only fix bugs found in pilot.

### After Launch Improvements

Goal: reduce support load after the first customer is stable.

1. Add automated workflow tests for order/payment/shift/refund.
2. Move critical business logic into shared domain services with tests.
3. Add stronger database integrity checks and optional relational tables for critical entities.
4. Improve LAN security and observability if side devices become common.
5. Add structured diagnostic export for support.
6. Add a visible system health page for database, backup, printer, license, and network status.

## MVP Decision

Current decision: not ready for unsupervised production installation yet.

Recommended next milestone: controlled MVP pilot after the launch blockers are resolved.

Estimated distance from MVP:
- 2 to 4 focused days for blocker cleanup and validation if no major workflow bugs are found.
- 1 additional live pilot day before accepting a paying customer.

The product has enough core POS functionality for a first restaurant MVP. The next work should be boring and strict: fix visible text, prove the workflows, prove printing, prove backup/restore, and avoid adding new features until the first live shift is stable.
