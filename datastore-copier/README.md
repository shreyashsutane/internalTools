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

3. **Cloud Datastore Entity Transfer & Comparison Engine**:
   - **Multi-Filter Query Engine**: Filter by property using explicit Datatypes (`String`, `Integer`, `Double`, `Boolean`, `Timestamp`, `Null`, `Auto`) with dynamic UI inputs (boolean toggles, ISO timestamps, numeric auto-coercion guards) combined into native `AND` composite filters.
   - **Smart SQL & Query Semantic Diffing**: Automatically normalizes and diffs SQL query strings (`queryString`, `query`, `sqlQuery`). String literals, backticked identifiers, and `{{variable}}` templates are protected from modification.
   - **`PROJECT MAPPED` Status**: Queries that match after target project substitution are classified with an emerald-green `PROJECT MAPPED` status and indexed in a dedicated `Mapped` filter tab.
   - **Context-Aware Modal & Formatter**: Dynamic diff modal supporting SQL, JSON, and Text modes with instant Format/Minify actions and debounced live-diff for 5,000+ line queries.
   - **Enterprise High-Throughput Batching**: Migrations of 1,000s of entities execute in progressive 50-entity batches with parallelized HTTP/2 lookups (`Promise.all`) and self-chunking commits (max 250 mutations / 4 MB per RPC) to strictly observe GCP Datastore quotas.
   - **Resilient 1-Click Revert**: Pre-mutation target snapshots are minified and stored in per-batch audit records for atomic 1-click revert, with graceful fallback for oversized (>700 KB) entities.
   - **Lossless Value Fidelity**: Preserves all Datastore REST value types (`integerValue`, `timestampValue`, `geoPointValue`, `blobValue`, `keyValue`, `mapValue`, `arrayValue`, `entityValue`) and minifies embedded JSON strings.
   - **Find & Replace**: Dynamic regex/literal substitution targeting all fields or specific properties.

4. **Central Per-User Audit and Revert**:
   - Record authentication, mode selection, comparisons, exports, mutations, cancellations, exceptions, and reverts in the portal's centralized audit collection.
   - Derive ownership from the verified Google access token on the server (`auditApi` running on Cloud Functions with 512 MiB RAM). Users can retrieve and update only their own records; portal admins can view all records.
   - Persist an `IN_PROGRESS` audit backup before Datastore and scheduled-query writes. A mutation is blocked if its reversible backup cannot be recorded.
   - Run revert with the user's current GCP permissions. If Datastore delete permission is absent, restore previous entities with upserts, skip deletes, and report a partial result.

## Prerequisites & Permissions

You need a temporary **GCP Access Token** generated via:
```bash
gcloud auth print-access-token
```
Paste the token into the **Authenticate** input field inside the application. The token is held **in-memory only** and discarded upon reload.

### Required GCP IAM Roles:
- **Source Project:** `roles/datastore.viewer` or `roles/datastore.user`
- **Target Project:** `roles/datastore.user` or `roles/datastore.owner`
- **BigQuery:** `roles/bigquery.metadataViewer` (read-only comparison)
- **Cross-Organization / Multi-Account:** Supported by granting the user's Google account IAM access to both projects or via the built-in **CSV Export/Import** workflow.

## Security Controls

- Exact trusted-origin checks and `POST`-only audit routes.
- Verified server-side identity with owner-scoped reads and updates.
- Admin-only direct Firestore rules.
- Request/body/backup size limits, schema validation, depth limits, and dangerous object-key rejection.
- Per-user audit rate limiting, no-store responses, no-referrer requests, output escaping, and restrictive hosting security headers.
- Dedicated least-privilege Cloud Function service account with 512 MiB memory allocation.
