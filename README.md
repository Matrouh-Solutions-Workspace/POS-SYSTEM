# POS MVP Launch Assessment

## Private GitHub releases and updates

The repo can stay private. Publishing and update checks require a GitHub token with access to `xlargetomato/AbdoKoftaDesktop`.

- To publish a Windows release, put `GH_TOKEN=github_pat_...` in `.env.local` or set it as an OS environment variable, then run `npm run dist:win:publish`.
- For installed master devices checking private GitHub releases, set `GH_TOKEN`, `GITHUB_TOKEN`, or `SHIFT_POS_UPDATE_TOKEN` as an OS environment variable, or place a local token file at `%APPDATA%\shift-pos\updater-auth.json` with `{ "token": "github_pat_..." }`.
- Do not commit real tokens. Use a fine-scoped token that can read repository release assets. Side devices do not need a GitHub token; they update from the master over LAN.

## 1. System Assessment

**Verdict: Not ready for real restaurant deployment yet.**

The system has a strong functional base:

- Offline-first Electron application.
- SQLite with WAL mode.
- Atomic order, payment, inventory, and cash writes.
- Orders, dine-in, delivery, refunds, shifts, inventory, suppliers, reports, permissions, audit, backups, and printing.
- Good basic touch targets and Arabic RTL support.
- `npm run typecheck` and production build pass.

## Main Architectural Weaknesses

- Business rules live mostly in renderer services.
- SQLite is used as a generic JSON document store with limited database constraints.
- State is divided between Zustand, component state, SQLite, and `localStorage`.
- No schema migration framework.
- No automated test suite.
- LAN, sync, licensing, and updater features increase launch complexity.

## Deployment Recommendation

For the first restaurant:

- Deploy **standalone mode only**.
- Disable API sync.
- Disable LAN side-device mode.

Core sales accounting must be proven before adding distributed features.

---

# 2. MVP Readiness Score

**Overall Score: 44 / 100**

| Area | Score |
|---|---:|
| Feature coverage | 78 |
| Architecture | 62 |
| Database/offline reliability | 52 |
| Business correctness | 32 |
| UI/restaurant usability | 68 |
| Security | 30 |
| Testing/operations | 15 |

---

# 3. Findings And Required Modifications

| Issue | Current Implementation | Real-world Impact | Recommended Change | Priority | Effort |
|---|---|---|---|---|---|
| Displayed total differs from charged total | POS preview calculates tax as zero and ignores service, while saving applies both | Wrong displayed total, wrong change calculation, cash validation issues | Load settings before checkout and use one shared calculation result | Critical | Small |
| Delivery payments are not recorded | Only takeaway sets `isPaid`; delivery remains draft/unpaid despite selected payment | Missing revenue, payment, and drawer records | Mark delivery orders as paid when payment is supplied | Critical | Small |
| Split payments accept excess values | Validation only rejects totals below order total | Revenue and drawer can be overstated | Require exact total within rounding tolerance; define cash change handling | Critical | Small |
| Payment is not idempotent | `markOrderPaid` does not reject already paid orders | Double-click/retry can duplicate payments | Reject paid orders and add idempotency guard | Critical | Medium |
| Refunds can exceed original sale | No cumulative refund validation exists | Same item can be refunded repeatedly | Track refunded quantities and validate every refund line | Critical | Medium |
| Refund accounting is incorrect | Refund always creates `cash_out`, including card sales | Cash drawer and reports become inaccurate | Refund according to original payment method | Critical | Medium |
| Refund preview differs from saved refund | UI and service calculate different values | Operator approves wrong refund amount | Use one shared refund calculator | High | Small |
| Cancellation corrupts reconciliation | Uses negative order total without preserving payment split | Card/cash balances become incorrect | Reverse original payment records by payment method | Critical | Medium |
| Shifts may close with unpaid tables | Warning exists but closure is still allowed | Closed shift totals can change later | Block closure or transfer unpaid tables | High | Medium |
| Shifts can stay open indefinitely | No business-date validation | Multiple days can merge into one shift | Detect stale shifts on startup/login | High | Small |
| Stock migration may create false zero stock | Existing materialized stock is trusted if rows exist | Inventory may appear missing | Rebuild materialized stock through migration | Critical | Medium |
| No formal database migrations | Uses `CREATE IF NOT EXISTS` only | Schema upgrades can silently fail | Add sequential migration system | High | Medium |
| Restore process is unsafe | No explicit DB close/integrity verification | Failed restore may corrupt restaurant data | Validate backup, preserve current DB, restore safely | High | Medium |
| Weak password storage | Fast unsalted SHA-256 hashes | Offline password cracking risk | Use Argon2id/scrypt with unique salts | Critical | Medium |
| Credentials exist in Git history | `.env` contains operational credentials | Repository access exposes secrets | Rotate credentials and clean Git history | Critical | Small |
| Production activation bypass exists | Master key/hash exists in production source | Licensing can be bypassed | Remove production bypass | High | Small |
| Cashiers can void/refund orders | Broad permissions allow sensitive actions | Fraud or accidental losses | Require manager authorization | High | Medium |
| Audit is not guaranteed | Audit writes are fire-and-forget | Missing financial history | Make audit atomic with transactions | High | Medium |
| Reports silently truncate data | Reports load limited orders/items | Reports become inaccurate over time | Query complete date ranges directly from SQLite | High | Medium |
| No automated tests | No test files or test runner | Financial bugs reach production | Add unit and integration tests | Critical | Large |
| Electron hardening incomplete | Sandbox disabled, broad IPC access | Renderer compromise exposes data | Enable sandbox/CSP and validate IPC | Medium | Medium |
| Controls are too small | Some controls around 34px | Poor restaurant usability | Increase cashier controls to 44–48px | Medium | Small |
| Printing not fully validated | Chromium HTML printing only | Printer/cutter/margin issues possible | Validate supported printer models | High | Medium |

---

# 4. Launch Blockers

Do not deploy until these are fixed:

| # | Blocker |
|---|---|
| 1 | Total/tax/service calculation mismatch |
| 2 | Delivery payment recording |
| 3 | Duplicate and incorrect split payment handling |
| 4 | Refund and cancellation accounting |
| 5 | Inventory migration correctness |
| 6 | Password storage security |
| 7 | Reliable database restore |
| 8 | Automated tests for financial workflows |

---

# 5. Prioritized Roadmap

## Before First Deployment

| Task | Priority |
|---|---|
| Fix payment, delivery, total, cancellation, and refund issues | Critical |
| Rebuild inventory balances through migration | Critical |
| Add tests for order totals, payments, refunds, stock reversal, and shifts | Critical |
| Rotate exposed credentials | Critical |
| Require manager authorization for refunds/voids | High |
| Block closing shifts with unresolved orders | High |
| Test backup/restore on production-sized data | High |
| Test receipt and kitchen printers | High |
| Deploy standalone mode only | High |

---

## Before First Paying Customer

| Task | Priority |
|---|---|
| Replace password hashing | Critical |
| Add schema migrations | High |
| Make audit entries atomic | High |
| Remove report limits | High |
| Include refunds correctly in reports | High |
| Add crash logging | Medium |
| Run multi-day restaurant simulation | High |
| Create rollback and emergency operation procedures | High |

---

## After Launch

| Task | Priority |
|---|---|
| Improve action-level permissions | Medium |
| Harden Electron sandbox, CSP, and IPC validation | Medium |
| Add database health indicators | Medium |
| Add backup status monitoring | Medium |
| Introduce LAN master/side mode | Low |
| Enable API sync after conflict testing | Low |

---

# Final Assessment

No code was modified during this assessment.

## Verified

- Static type checking passes.
- Production build succeeds.

## Not Yet Validated

- Real printer behavior.
- SQLite recovery.
- Full restaurant workflow.
- Long-running production usage.

The system has enough foundation to become a production POS, but financial correctness, security, and operational reliability must be completed before real deployment.
