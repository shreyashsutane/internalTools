# GCP Infrastructure Manager

A browser-based utility for read-only BigQuery schema comparison plus separately authorized scheduled-query and Datastore workflows.

## Key Features

1. **BigQuery Schema Comparator (Read Only)**:
   - Compare schemas (fields, types, modes) side-by-side between datasets.
   - Detect differences (added, missing, or modified columns).
   - Export comparison results without creating, copying, updating, overriding, or deleting schemas.

2. **Scheduled Query Transfer**:
   - Fetch BQ scheduled query configurations (`transferConfigs`) from a source project and location.
   - Recreate configurations in a target project and location with one-click copying.

3. **Cloud Datastore Entity Transfer**:
   - Scan Datastore entities of a specific Kind in the source project (supports advanced filters like `EQUAL`, `LESS_THAN`, `GREATER_THAN`, `HAS_ANCESTOR`).
   - Query target entities in batches to perform an immediate side-by-side comparison.
   - Interactively view difference logs highlighting exactly which properties have changed.
   - Apply a dynamic **Find & Replace** modification on string attributes during migration.
   - Preserve every Datastore REST value type during copy and revert; an integer remains an `integerValue`, a timestamp remains a `timestampValue`, and nested values retain their original types.
   - Minify valid JSON stored inside string properties before saving while retaining the field as a Datastore string.
   - Sync data in controlled batches to respect GCP request limits and avoid timeouts.

4. **Central Per-User Audit and Revert**:
   - Record authentication, mode selection, comparisons, exports, mutations,
     cancellations, exceptions, and reverts in the portal's centralized audit
     collection.
   - Derive ownership from the verified Google access token on the server. Users
     can retrieve and update only their own records; portal admins can view all
     records.
   - Persist an `IN_PROGRESS` audit backup before Datastore and scheduled-query
     writes. A mutation is blocked if its reversible backup cannot be recorded.
   - Run revert with the user's current GCP permissions. If Datastore delete
     permission is absent, restore previous entities with upserts, skip deletes,
     and report a partial result.

## Prerequisites

You need a temporary **GCP Access Token** with least-privilege IAM permissions. BigQuery comparison can use metadata read access; the scheduled-query and Datastore tools need separate permissions for their explicitly selected write operations.

To generate a token locally, execute:
```bash
gcloud auth print-access-token
```
Paste the token into the **Authenticate** input field inside the application.
The token is retained in memory only and is discarded on reload or page close.

The token is also sent to the same-origin central audit endpoint solely in the
`Authorization` header. The audit backend verifies it with Google and derives the
user's email; it never accepts a client-provided identity.

## Security Controls

- Exact trusted-origin checks and `POST`-only audit routes.
- Verified server-side identity with owner-scoped reads and updates.
- Admin-only direct Firestore rules.
- Request/body/backup size limits, schema validation, depth limits, and dangerous
  object-key rejection.
- Per-user audit rate limiting, no-store responses, no-referrer requests, output
  escaping, and restrictive hosting security headers.
- Dedicated least-privilege Cloud Function service account.
