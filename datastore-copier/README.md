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

## Codebase Architecture & Lines of Code Breakdown

The GCP Infrastructure Manager consists of **15,094 total lines** (**14,270 lines** of authored source code across 20 files):

| File Path | Lines | Type | Key Architecture & Functional Role |
| :--- | :---: | :---: | :--- |
| [`src/app.ts`](src/app.ts) | **2,764** | TypeScript | Main application orchestrator, Datastore streaming, batch copy loops, UI state transitions, and post-copy modals. |
| [`src/ui.ts`](src/ui.ts) | **840** | TypeScript | UI view management, GQL live preview, filter synchronization, modal controllers, and notification toasts. |
| [`src/datastore-utils.ts`](src/datastore-utils.ts) | **758** | TypeScript | Fast-path AST diff engine, BigQuery SQL formatter, semantic JSON normalizer, and property value serializers. |
| [`src/assist.ts`](src/assist.ts) | **727** | TypeScript | Assist context evaluation engine, multi-screen state analysis, smart suggestion heuristics, and guidance alerts. |
| [`src/assist-ui.ts`](src/assist-ui.ts) | **563** | TypeScript | Mochi interactive AI mascot DOM rendering, reactive state animations, cursor evasion physics, and card overlays. |
| [`src/api.ts`](src/api.ts) | **505** | TypeScript | Google Cloud REST API client, Datastore entity lookups/commits, system kind exclusions (`__*__`), and BigQuery metadata fetcher. |
| [`src/audit.ts`](src/audit.ts) | **473** | TypeScript | Centralized audit log client, revert snapshot compression, multi-kind audit history rendering, and CSV compliance exports. |
| [`src/diff.ts`](src/diff.ts) | **402** | TypeScript | Property-level semantic diff visualizer, line-by-line syntax highlighters, and format switcher. |
| [`src/easter-egg.ts`](src/easter-egg.ts) | **275** | TypeScript | Interactive developer features, canvas particles, and keyboard combos. |
| [`src/revert.ts`](src/revert.ts) | **216** | TypeScript | 1-Click rollback engine, pre-mutation state decompression, chunked entity restoration, and delete-permission fallback. |
| [`src/state.ts`](src/state.ts) | **170** | TypeScript | Strictly in-memory application state manager, active filter memory, and memory-only token holder. |
| [`src/utils.ts`](src/utils.ts) | **131** | TypeScript | DOM helpers, string escaping, date formatters, and global ErrorBoundary exception handler. |
| [`src/sound.ts`](src/sound.ts) | **120** | TypeScript | Web Audio API synthesizer for tactile UI audio effects and completion chimes. |
| [`src/config.ts`](src/config.ts) | **25** | TypeScript | Central API routing and Cloud Functions audit endpoints configuration. |
| [`index.html`](index.html) | **941** | HTML | Primary application interface, accessible tabs, dynamic filter builders, and modals. |
| [`mascot-preview.html`](mascot-preview.html) | **787** | HTML | Standalone interactive canvas and animation preview for Mochi assistant. |
| [`rocket-loader-preview.html`](rocket-loader-preview.html) | **586** | HTML | High-fidelity rocket launch animation testing sandbox. |
| [`css/app.css`](css/app.css) | **1,858** | CSS | Complete design system, glassmorphic cards, rocket loader animations, badge pills, and dark mode theme. |
| [`script.js`](script.js) | **2,075** | JavaScript | Standalone legacy/reference browser implementation. |
| [`README.md`](README.md) | **54** | Markdown | Tool documentation and architecture guide. |
| [`js/app.js`](js/app.js) | **824** | Bundle | Bundled and minified production distribution (generated via esbuild). |
| **Total** | **15,094** | | **14,270 authored source lines / 7,769 TypeScript core lines** |

