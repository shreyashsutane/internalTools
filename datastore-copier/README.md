# GCP Infrastructure Manager

A powerful administrative utility designed to manage and sync schemas and data across GCP projects.

## Key Features

1. **BigQuery Schema Sync**:
   - Compare schemas (fields, types, modes) side-by-side between datasets.
   - Detect differences (added, missing, or modified columns).
   - Sync target schemas (creating target datasets/tables or updating table schemas as needed).

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

To perform any read or write actions, you will need a valid **GCP Access Token** with appropriate IAM permissions (e.g., `BigQuery Admin`, `Datastore Owner`).

To generate a token locally, execute:
```bash
gcloud auth print-access-token
```
Paste the token into the **Authenticate** input field inside the application.
