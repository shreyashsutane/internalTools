# GCP Infrastructure Manager - API Reference

This document highlights the endpoints called by the client-side code of the GCP Infrastructure Manager.

## Authentication
All requests require the `Authorization: Bearer <access_token>` header.
To retrieve account information for verification:
- **GET** `https://openidconnect.googleapis.com/v1/userinfo`

Tokens are sent in the Authorization header, held in memory only, and never placed in URLs or browser storage.

## Central Audit API

The browser calls same-origin Firebase Hosting routes. Hosting rewrites these paths
to the secured `auditApi` Cloud Function:

- **POST** `/api/audit_logs`
  - Validates the Google token and creates a log owned by the token's verified
    email.
  - Ignores any client attempt to choose the log owner.
  - Returns `{ "ok": true, "id": "<document-id>" }`.
- **POST** `/api/audit_logs/runQuery`
  - Returns only records whose `user` field matches the verified email.
  - Accepts an optional `limit` from 1 through 500.
- **POST** `/api/audit_logs/update`
  - Updates status, details, or backup state only after verifying that the
    existing record belongs to the signed-in user.

All three routes require an allowed browser origin, `Content-Type:
application/json`, and the bearer token. Responses are `no-store`. The browser
does not fall back to direct Firestore access.

### Audit and revert lifecycle

For Datastore copy/edit and scheduled-query synchronization, the client first
creates an `IN_PROGRESS` audit record with a minified reversible backup. It starts
the cloud mutation only after receiving the record ID, then updates the same
record to `SUCCESS`, `PARTIAL`, `FAILED`, or `CANCELLED`.

A user's revert button is populated only from that user's audit query. Revert
calls the Google Cloud API with the same user's current token; the central audit
service does not grant permissions on the source or target project.

## Resource Manager
Used to query available Google Cloud projects for source and target selections:
- **GET** `https://cloudresourcemanager.googleapis.com/v1/projects`

## BigQuery API

### Dataset Metadata (Read Only)
- **GET** `https://bigquery.googleapis.com/bigquery/v2/projects/{projectId}/datasets`

### Table Schema Metadata (Read Only)
- **GET** `https://bigquery.googleapis.com/bigquery/v2/projects/{projectId}/datasets/{datasetId}/tables`
- **GET** `https://bigquery.googleapis.com/bigquery/v2/projects/{projectId}/datasets/{datasetId}/tables/{tableId}`

The schema comparator has no BigQuery POST, PATCH, PUT, or DELETE operation.

### Scheduled Queries (BigQuery Data Transfer Service)
- **GET** `https://bigquerydatatransfer.googleapis.com/v1/projects/{projectId}/locations/{locationId}/transferConfigs`
- **POST** `https://bigquerydatatransfer.googleapis.com/v1/projects/{projectId}/locations/{locationId}/transferConfigs`

## Cloud Datastore API

### Metadata Lookup (Kinds)
- **POST** `https://datastore.googleapis.com/v1/projects/{projectId}:runQuery`
  - Query payload fetches entities of type `__kind__` to retrieve available Kinds.

### Schema & Entity Operations
- **POST** `https://datastore.googleapis.com/v1/projects/{projectId}:runQuery`
  - Fetches entities of a specific Kind (supporting filter mappings).
- **POST** `https://datastore.googleapis.com/v1/projects/{projectId}:lookup`
  - Lookup specific entities by key in batch.
- **POST** `https://datastore.googleapis.com/v1/projects/{projectId}:commit`
  - Commit entity mutations (insert, upsert, update, delete).

Datastore values remain in their native REST representation throughout copy and
revert (`integerValue`, `doubleValue`, `booleanValue`, `timestampValue`,
`keyValue`, `arrayValue`, `entityValue`, and the remaining Datastore types).
String properties containing JSON are minified before commit without changing the
Datastore type.

During revert, previous entities are restored with upserts first. Deletes are then
attempted separately. A delete permission error does not undo successful
restorations: remaining deletes are skipped and the revert is reported as
`PARTIAL`.
