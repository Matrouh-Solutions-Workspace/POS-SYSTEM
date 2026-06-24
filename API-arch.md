# SHIFT POS Cloud Sync API

## Purpose

SHIFT POS is local-first. SQLite remains the source of truth used by the running POS, and cloud sync is an asynchronous copy of master-device changes.

Only the device configured with `settings.networkMode = "master"` may sync. Standalone and side devices never call the cloud API. Every request is scoped to the valid local master license ID.

## Client configuration

The desktop build reads these values from `.env` or `.env.local`:

```env
API_SYNC_ENABLED=false
API_SYNC_URL=https://api.example.com/v1/sync/push
API_SYNC_TOKEN=
```

- `API_SYNC_ENABLED`: accepts `true`, `1`, `yes`, or `on`. Any other value disables cloud calls.
- `API_SYNC_URL`: exact URL receiving `POST` sync batches.
- `API_SYNC_TOKEN`: optional bearer token. Production deployments should set it or replace it with a device-token registration flow.

These values are embedded at build time. The same names may be supplied as operating-system environment variables at runtime to override the built values.

## When the client sends data

The client sends a batch when all conditions are true:

1. API sync is enabled.
2. The app is not paired as a side device.
3. Local settings identify this device as `master`.
4. `license.dat` is valid, unexpired, matches this hardware, and contains a non-empty `licenseId`.
5. The SQLite outbox contains pending operations.
6. The machine reports an online network connection.

The renderer checks every 30 seconds and when the machine returns online. The Electron main process repeats the authoritative master and license checks before making an HTTP request.

## Push endpoint

### `POST {API_SYNC_URL}`

Uploads at most 200 queued changes in creation order.

### Request headers

```http
Content-Type: application/json
Accept: application/json
Idempotency-Key: 9daa82d1-f4a0-45f2-a29a-7d79ffbf9011
X-License-ID: lic_customer_123
X-Device-ID: 61f4...hardware-hash
Authorization: Bearer <API_SYNC_TOKEN>
```

`Authorization` is omitted when `API_SYNC_TOKEN` is empty.

The server must not trust `licenseId` by itself as proof of authorization. At minimum, validate the bearer token and ensure it is allowed to act for the supplied license. A stronger design is a registration endpoint that exchanges a signed license/device challenge for a revocable device token.

### Request body

```json
{
  "schema": "shift-pos.sync.push.v1",
  "requestId": "9daa82d1-f4a0-45f2-a29a-7d79ffbf9011",
  "licenseId": "lic_customer_123",
  "deviceId": "61f4...hardware-hash",
  "appVersion": "2.2.1",
  "sentAt": 1782378000000,
  "operations": [
    {
      "id": "orders:order_42:1782377999000",
      "entityType": "orders",
      "entityId": "order_42",
      "operation": "set",
      "payload": {
        "id": "order_42",
        "status": "completed",
        "total": 250,
        "updatedAt": 1782377998000
      },
      "createdAt": 1782377999000,
      "attempts": 0
    },
    {
      "id": "users:user_9:1782377999500",
      "entityType": "users",
      "entityId": "user_9",
      "operation": "delete",
      "payload": {
        "id": "user_9"
      },
      "createdAt": 1782377999500,
      "attempts": 0
    }
  ]
}
```

### Required server behavior

- Resolve the tenant exclusively from the authenticated license identity.
- Verify the header and body `licenseId` values match.
- Reject a device that is not registered or permitted for that license.
- Treat each operation `id` as an idempotency key.
- Replaying an already accepted operation must return it in `accepted` without applying it twice.
- Apply `set` as an upsert under `(licenseId, entityType, entityId)`.
- Apply `delete` as a delete or tombstone under the same tenant key.
- Never permit one license to read or modify another license's records.
- Process operations transactionally when practical, or report each rejected operation explicitly.

### Success response

```json
{
  "requestId": "9daa82d1-f4a0-45f2-a29a-7d79ffbf9011",
  "accepted": [
    "orders:order_42:1782377999000"
  ],
  "rejected": [
    {
      "id": "users:user_9:1782377999500",
      "code": "VALIDATION_ERROR",
      "message": "User identifier is invalid",
      "retryable": false
    }
  ],
  "serverTime": 1782378000300
}
```

`accepted` is required, including when it is empty. `rejected` is optional.

The desktop marks only IDs listed in `accepted` as synced. Rejected or omitted IDs are marked failed and retried, up to the local retry limit.

### HTTP status codes

- `200 OK`: batch parsed and operation acknowledgements returned.
- `400 Bad Request`: malformed schema, body, or operation.
- `401 Unauthorized`: missing or invalid API/device token.
- `403 Forbidden`: token, license, or device mismatch; expired/revoked license.
- `409 Conflict`: request-level idempotency or ownership conflict.
- `413 Payload Too Large`: server batch limit exceeded.
- `422 Unprocessable Entity`: valid JSON with invalid domain fields.
- `429 Too Many Requests`: rate limited; include `Retry-After`.
- `500/502/503/504`: transient server failure.

For every non-2xx response, the client leaves the batch unsynced. Response bodies should use:

```json
{
  "error": {
    "code": "LICENSE_REVOKED",
    "message": "The master license is no longer authorized",
    "requestId": "9daa82d1-f4a0-45f2-a29a-7d79ffbf9011",
    "retryable": false
  }
}
```

## Data model

The current entity types are:

```text
users
menu_categories
menu_items
recipes
ingredients
inventory_transactions
orders
order_items
payments
dining_tables
floors
shifts
cash_drawer_transactions
suppliers
supplier_transactions
settings
audit_log
item_sizes
item_addons
kitchen_printers
```

The backend may use PostgreSQL, MySQL, SQL Server, a document database, or another store. The desktop contract does not expose backend database details.

Recommended unique keys:

```text
sync_operations: (license_id, operation_id)
entities:        (license_id, entity_type, entity_id)
devices:         (license_id, device_id)
```

## Ordering and conflict policy

There is currently one cloud-writing device per license: the master. Side devices write through the master's LAN API and therefore share the master's SQLite outbox.

The server should retain `createdAt`, but must use receipt order or a server sequence for audit purposes. If future versions allow cloud-to-device pull or multiple masters, add a monotonic server cursor and explicit conflict resolution before enabling those clients.

## Retry behavior

- Network errors, timeouts, invalid JSON responses, and non-2xx responses fail the whole batch.
- The client timeout is 20 seconds.
- Failed rows return to pending state on a later sync attempt.
- Rows stop being automatically reset after 10 failed attempts.
- Accepted operation IDs are never retried.
- The API must remain idempotent because a response can be lost after the server commits.

## Recommended future endpoints

These endpoints are not required by the current desktop implementation:

```text
POST /v1/devices/register   Exchange license proof for a revocable device token
POST /v1/sync/pull          Pull server changes using a monotonic cursor
GET  /v1/sync/status        License/device health and last accepted cursor
POST /v1/devices/revoke     Revoke a previously registered master device
```

Until a pull protocol and conflict policy are implemented, the cloud copy should be treated as backup/reporting data rather than a second writable source of truth.
