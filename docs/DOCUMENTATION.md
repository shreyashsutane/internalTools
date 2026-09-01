# Internal Tools Portal Documentation

Welcome to the central documentation page for the Internal Tools portal.

This collection of utilities is designed to assist internal development, operational data migrations, and schema management across environments.

## Available Tools

### 1. GCP Infrastructure Manager
- **ID**: `datastore-copier`
- **Status**: Active
- **Purpose**: Compare BigQuery table schemas in read-only mode, transfer scheduled query configurations, and copy Cloud Datastore entities across any GCP projects/organizations.
- **Key Capabilities**:
  - **Type-Aware Multi-Filtering**: Query Datastore entities using explicit datatypes (`String`, `Integer`, `Double`, `Boolean`, `Timestamp`, `Null`, `Auto`) combined into composite `AND` filters.
  - **SQL & Query Semantic Diffing**: Normalizes queries (`queryString`, `query`, `sqlQuery`) and detects project substitution matches (`PROJECT MAPPED` emerald badge).
  - **Enterprise Batching & Quotas**: Bounded 50-entity batches, parallel lookups (`Promise.all`), self-chunking commits (max 250 mutations per RPC), and 100% resilient revert snapshotting.
  - **Cross-Account Support**: Operates across projects, Google accounts, and organizations via Bearer tokens or CSV workflows.
- **Reference**: See the [Tool-Specific Documentation](../datastore-copier/README.md).

### 2. Tool 2 (Coming Soon)
- **Status**: Under Development
- **Purpose**: Future internal utility for automation tasks.

### 3. Tool 3 (Coming Soon)
- **Status**: Under Development
- **Purpose**: Future internal utility.

## General Usage Policies

1. **Permissions**: Use least-privilege IAM:
   - **Source Project**: `roles/datastore.viewer` or `roles/datastore.user`
   - **Target Project**: `roles/datastore.user` or `roles/datastore.owner`
   - **BigQuery**: `roles/bigquery.metadataViewer`
2. **Backups**: Every mutation automatically generates an audit revert snapshot prior to writing to the target environment.
3. **Internal & Cross-Project Use**: Operates directly in the user's browser with memory-only token handling.

## Central Audit Ownership

Every user who successfully verifies a Google Cloud access token is recorded by the central audit service. The user does not need IAM access to the portal's Firebase project: the service validates the token, derives the verified email on the server, and stores the log through a dedicated least-privilege service account (Cloud Functions 512 MiB).

- A signed-in user can read and update only audit records owned by the verified email in that user's token.
- Reversible Datastore and scheduled-query mutations create an `IN_PROGRESS` record containing the backup before the first cloud write.
- A user can revert only an operation present in their own audit history. The revert itself runs with that user's current Google Cloud token, so target-project IAM permissions still apply.
- If a Datastore revert cannot delete entities, it restores all possible previous entities with upserts and reports the skipped deletes as `PARTIAL`.
- Portal administrators use the protected admin page to view all users' records. Direct browser access to the `audit_logs` collection remains admin-only.

## External-Attack Protection

The audit API accepts only exact same-origin `POST` requests and requires a bearer token in the `Authorization` header. It does not trust a client-supplied email. Payload sizes, operation names, statuses, nesting depth, object keys, and document IDs are validated. Per-user rate limiting, output encoding, no-store responses, security headers, owner checks, and least-privilege service-account access reduce token leakage, injection, cross-user access, abuse, and accidental exposure.

## Codebase Metrics & Lines of Code Breakdown

### 1. Overall Portal Codebase
| Category / Layer | Files | Lines of Code | Description |
| :--- | :---: | :---: | :--- |
| **HTML (UI Pages & Documentation)** | 22 | **19,219** | Portal landing page, Datastore copier UI, SuperAdmin UI, and 19 interactive documentation guides. |
| **TypeScript (Frontend Source)** | 19 | **9,734** | Core business logic, Datastore streaming, AST/diff engines, Assist AI mascot (Mochi), and audit UI. |
| **JavaScript (Test Suites)** | 12 | **2,383** | Automated unit tests, security assertions, and backend integration test suites. |
| **CSS (Stylesheets)** | 2 | **2,091** | Custom design system, dark-mode styling, animations, and modal overlays. |
| **JavaScript (Backend Cloud Functions & Server)** | 6 | **1,138** | Secured Cloud Functions (`auditApi`), OAuth identity verification, rate limiting, and Gmail SMTP email alerts. |
| **Documentation (Markdown)** | 6 | **600** | Project documentation, setup guides, and walkthroughs. |
| **Configuration & Security Rules** | 5 | **227** | `firestore.rules`, `tsconfig.json`, `firebase.json`, and `package.json`. |
| **Generated Bundles (esbuild)** | 2 | **996** | Minified production bundles (`datastore-copier/js/app.js`, `superadmin/js/app.js`). |
| **Total Project Codebase** | **78** | **40,085** | *(Excluding `node_modules`, `.git`, and `.map` files)* |

### 2. GCP Infrastructure Manager (`datastore-copier/`) Specifically
| Component in GCP Infrastructure Manager | Files | Lines of Code | Description |
| :--- | :---: | :---: | :--- |
| **TypeScript Application Core (`src/`)** | 14 | **7,769** | `app.ts` (2,764), `ui.ts` (840), `datastore-utils.ts` (758), `assist.ts` (727), `assist-ui.ts` (563), `api.ts` (505), `audit.ts` (473), `diff.ts` (402), `easter-egg.ts` (275), `revert.ts` (216), `state.ts` (170), `utils.ts` (131), `sound.ts` (120), `config.ts` (25). |
| **HTML UI & Component Previews** | 3 | **2,314** | `index.html` (941), `mascot-preview.html` (787), `rocket-loader-preview.html` (586). |
| **CSS Stylesheet & Design System** | 1 | **1,858** | `css/app.css` (Glassmorphic cards, rocket launcher modal, dark grid, badge styling). |
| **Standalone / Legacy Scripts** | 1 | **2,075** | `script.js` (Standalone browser reference implementation). |
| **Documentation & Readme** | 1 | **54** | `README.md` |
| **Generated Production Bundle** | 1 | **824** | `js/app.js` (Compiled with esbuild) |
| **Total GCP Infrastructure Manager** | **21** | **15,094** | *(**14,270** lines of authored source code excluding compiled bundle)* |

### 3. GCP Infrastructure Manager Source File Roster
| File Path | Lines | Type | Primary Role & Responsibilities |
| :--- | :---: | :---: | :--- |
| `datastore-copier/src/app.ts` | **2,764** | TypeScript | Main application orchestrator, Datastore streaming, batch loops, UI transitions, post-copy modals. |
| `datastore-copier/src/ui.ts` | **840** | TypeScript | View manager, GQL live preview, filter synchronization, modal controllers, toasts. |
| `datastore-copier/src/datastore-utils.ts` | **758** | TypeScript | AST diff engine, BigQuery SQL formatter, semantic JSON normalizer, property serializers. |
| `datastore-copier/src/assist.ts` | **727** | TypeScript | Assist context evaluation, multi-screen state analysis, smart suggestion heuristics. |
| `datastore-copier/src/assist-ui.ts` | **563** | TypeScript | Mochi mascot DOM rendering, reactive state animations, cursor evasion physics. |
| `datastore-copier/src/api.ts` | **505** | TypeScript | Google Cloud REST API client, entity lookups/commits, system kind filters (`__*__`). |
| `datastore-copier/src/audit.ts` | **473** | TypeScript | Centralized audit client, revert snapshot compression, multi-kind history rendering. |
| `datastore-copier/src/diff.ts` | **402** | TypeScript | Property-level semantic diff visualizer, line-by-line syntax highlighters. |
| `datastore-copier/src/easter-egg.ts` | **275** | TypeScript | Interactive developer features, canvas particles, and keyboard combos. |
| `datastore-copier/src/revert.ts` | **216** | TypeScript | 1-Click rollback engine, pre-mutation state decompression, chunked restoration. |
| `datastore-copier/src/state.ts` | **170** | TypeScript | In-memory application state manager, active filter memory, ephemeral token holder. |
| `datastore-copier/src/utils.ts` | **131** | TypeScript | DOM helpers, string escaping, date formatters, ErrorBoundary handler. |
| `datastore-copier/src/sound.ts` | **120** | TypeScript | Web Audio API synthesizer for tactile UI audio effects and completion chimes. |
| `datastore-copier/src/config.ts` | **25** | TypeScript | Central API routing and Cloud Functions audit endpoints configuration. |
| `datastore-copier/index.html` | **941** | HTML | Primary application interface, accessible tabs, dynamic filter builders, and modals. |
| `datastore-copier/mascot-preview.html` | **787** | HTML | Standalone interactive canvas and animation preview for Mochi assistant. |
| `datastore-copier/rocket-loader-preview.html` | **586** | HTML | High-fidelity rocket launch animation testing sandbox. |
| `datastore-copier/css/app.css` | **1,858** | CSS | Complete design system, glassmorphic cards, rocket loader animations, badge pills. |
| `datastore-copier/script.js` | **2,075** | JavaScript | Standalone legacy/reference browser implementation. |
| `datastore-copier/README.md` | **54** | Markdown | Tool documentation and architecture guide. |
| `datastore-copier/js/app.js` | **824** | Bundle | Bundled and minified production distribution (generated via esbuild). |


