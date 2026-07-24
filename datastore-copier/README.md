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
   - Sync data in controlled batches to respect GCP request limits and avoid timeouts.

## Prerequisites

You need a temporary **GCP Access Token** with least-privilege IAM permissions. BigQuery comparison can use metadata read access; the scheduled-query and Datastore tools need separate permissions for their explicitly selected write operations.

To generate a token locally, execute:
```bash
gcloud auth print-access-token
```
Paste the token into the **Authenticate** input field inside the application.
The token is retained in memory only and is discarded on reload or page close.
