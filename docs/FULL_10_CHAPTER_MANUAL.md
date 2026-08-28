# GCP Tools Portal: Complete 10-Chapter Master Manual

> **System Classification**: GCP Infrastructure Migration & Schema Comparison Suite  
> **Production Hardening Standard**: Pass (Score: 98 / 100)  
> **Live Portal URL**: [https://gcp-tools-portal.web.app](https://gcp-tools-portal.web.app)

---

## Table of Contents
1. [Chapter 01: Portal Architecture & System Overview](#chapter-01-portal-architecture--system-overview)
2. [Chapter 02: Authentication, Security & IAM Access Matrix](#chapter-02-authentication-security--iam-access-matrix)
3. [Chapter 03: Cloud Datastore Migration & Batching Engine](#chapter-03-cloud-datastore-migration--batching-engine)
4. [Chapter 04: BigQuery Schema Comparator & Scheduled Queries](#chapter-04-bigquery-schema-comparator--scheduled-queries)
5. [Chapter 05: Smart SQL Diffing & AST Normalization Engine](#chapter-05-smart-sql-diffing--ast-normalization-engine)
6. [Chapter 06: Data-Loss Prevention, Audit Logging & 1-Click Rollback](#chapter-06-data-loss-prevention-audit-logging--1-click-rollback)
7. [Chapter 07: Find & Replace, Entity Display Names & Data Cleaners](#chapter-07-find--replace-entity-display-names--data-cleaners)
8. [Chapter 08: SuperAdmin Governance Hub & Activity Telemetry](#chapter-08-superadmin-governance-hub--activity-telemetry)
9. [Chapter 09: Mochi Companion, Web Audio FX & Easter Eggs](#chapter-09-mochi-companion-web-audio-fx--easter-eggs)
10. [Chapter 10: Production Runbooks, Error Codes & Troubleshooting](#chapter-10-production-runbooks-error-codes--troubleshooting)

---

## Chapter 01: Portal Architecture & System Overview

### 1. The Dual-Application Ecosystem
The GCP Tools Portal is split into two specialized web applications sharing a common design token system, security policies, and centralized audit bus:
* **GCP Infrastructure Manager** (`/datastore-copier/index.html`): Read-only BigQuery schema comparison, multi-filter Datastore entity transfers, scheduled query replication, and the Mochi interactive assistant.
* **SuperAdmin Activity Hub** (`/superadmin/index.html`): Cross-project activity monitoring, Question Workbench, compliance receipt generation, and emergency rollback console.

### 2. The Four-Tier Zero-Knowledge Security Enclave
* **Tier 1: Static Edge CDN (Firebase Hosting)**: Serves immutable static HTML/JS with strict headers: CSP (`frame-ancestors 'none'`), COOP (`same-origin`), CORP (`same-origin`), HSTS (`max-age=31536000`), and `Cache-Control: no-store`.
* **Tier 2: Client Execution Enclave (Browser RAM)**: Sensitive OAuth bearer tokens live exclusively in a module closure (`State.token`) in volatile RAM. No tokens are written to `localStorage`, cookies, or URLs.
* **Tier 3: Direct GCP REST Mesh (Browser ↔ Google Cloud)**: All heavy Datastore and BigQuery API calls flow directly between the operator's browser and `googleapis.com` over TLS 1.3 without intermediary proxy inspection.
* **Tier 4: Serverless Audit & Safety Bus (Cloud Functions + Firestore)**: The `auditApi` microservice verifies OAuth tokens against Google OpenID servers, enforces transaction rate-limits (120 req/min), and stores immutable audit snapshots.

---

## Chapter 02: Authentication, Security & IAM Access Matrix

### 1. Generating Temporary Access Tokens
```bash
# In your local terminal or Google Cloud Shell:
gcloud auth print-access-token
```
* Generates an ephemeral `ya29...` OAuth 2.0 bearer token valid for 3,600 seconds (1 hour).
* When pasted into the portal, the token is held in volatile memory and completely purged upon tab close or page reload.

### 2. Least-Privilege IAM Access Matrix
| Component / Target | Recommended IAM Role | Exact Permissions Needed |
| :--- | :--- | :--- |
| **Source Datastore Project** | `roles/datastore.viewer` | `datastore.entities.get`, `datastore.entities.list` |
| **Target Datastore Project** | `roles/datastore.user` | `datastore.entities.create`, `datastore.entities.update`, `datastore.entities.delete` |
| **BigQuery Schema Comparator** | `roles/bigquery.metadataViewer` | `bigquery.tables.get`, `bigquery.datasets.get` |
| **Scheduled Query Transfer** | `roles/bigquery.admin` | `bigquery.transfers.update` |

---

## Chapter 03: Cloud Datastore Migration & Batching Engine

### 1. Safe Chunking & Quota Protection
Cloud Datastore limits single commit requests to **500 mutations** and **10 MB**. The portal conservatively enforces:
* **Max 250 mutations** per RPC commit request.
* **Max 4.0 MB** payload buffer ceiling.
* **50-entity lookup streams** running via parallel HTTP/2 multiplexing (`Promise.all`).

### 2. Dual-Strategy Schema Discovery
1. **Statistical Entity Sampling**: Ephemerally inspects 20 sample entities to discover actual dynamic runtime properties.
2. **Metadata Kind Queries**: Fallback to `__property__` namespace metadata if no entities exist.

### 3. Lossless Type Fidelity
* `integerValue`: Stored as strings to protect 64-bit precision against JavaScript floating point truncation.
* `timestampValue`: RFC 3339 UTC timestamps preserved with zero timezone drift.
* `blobValue`: Preserved via raw byte base64 encoding.
* `keyValue`: Preserved with hierarchy, re-targeting only the partition project ID.

---

## Chapter 04: BigQuery Schema Comparator & Scheduled Queries

### 1. Read-Only Schema Diffing
* Executes only `GET` metadata requests against BigQuery v2 APIs.
* Classifies differences into:
  * 🟢 **Added Columns**: Present in source, missing in target.
  * 🔴 **Missing Columns**: Present in target, absent in source.
  * 🟡 **Type Mismatches**: Field exists in both but data types differ (e.g. `INT64` vs `STRING`).

### 2. Scheduled Query Transfer
* Copies BigQuery `transferConfigs` seamlessly between projects and regions without manual parameter transcription.

---

## Chapter 05: Smart SQL Diffing & AST Normalization Engine

### 1. The AST Normalizer Pipeline
1. Strips all single-line (`-- ...`) and multi-line (`/* ... */`) SQL comments.
2. Normalizes indentation and collapses redundant whitespace.
3. Shields template parameters (e.g. `{{run_date}}`, `{{target_dataset}}`).
4. Performs AST project mapping (e.g. `prod-analytics-us` $\rightarrow$ `staging-target-us`).

### 2. The `PROJECT MAPPED` Status
* When queries are identical in logic, CTEs, selections, and filters—differing only by project substitution—they are awarded the glowing emerald **PROJECT MAPPED** badge.

---

## Chapter 06: Data-Loss Prevention, Audit Logging & 1-Click Rollback

### 1. Pre-Mutation Snapshotting
* Before a single write or update RPC is transmitted to Google Cloud, the pre-existing state of all target entities is captured and saved in Cloud Firestore under an `IN_PROGRESS` audit record.

### 2. 1-Click Revert Algorithm
* Deletes all newly created entities.
* Restores all modified entities to their exact pre-mutation JSON snapshots.
* If delete permissions are missing, falls back to restoring upserts and marks audit status as **PARTIAL** with leftover keys documented.

---

## Chapter 07: Find & Replace, Entity Display Names & Data Cleaners

### 1. Display Name Resolution Hierarchy
Entities are labeled using a prioritized property cascade:
1. `chainName`
2. `referenceName`
3. `displayName`
4. `jobName` / `title`
5. `name`
6. `__key__.id`

### 2. Scoped Regex Targeting
* Operators can restrict find-and-replace rules to specific properties (e.g. `database_url`), preventing unintended replacements in other properties.

---

## Chapter 08: SuperAdmin Governance Hub & Activity Telemetry

### 1. Centralized Audit Telemetry
* Live streaming of all migration operations across all projects.
* Search and filter by operator, source project, target project, and status (`SUCCESS`, `PARTIAL`, `FAILED`, `CANCELLED`, `REVERTED`).

### 2. Compliance Export
* Export signed audit trail receipts in structured JSON and CSV formats for compliance audits.

---

## Chapter 09: Mochi Companion, Web Audio FX & Easter Eggs

### 1. Interactive Companion Mechanics
* **Magnetic Step Docking**: Follows the active form step.
* **140px Cursor Evasion**: Glides smoothly away when the operator's mouse approaches clickable controls.
* **Moods**: Idle, Thinking (🔮), Happy (💖), Grumpy (💢), and Overheat Rage (💥).

### 2. Procedural Web Audio Engine
* Uses browser `AudioContext` with zero downloaded audio files:
  * Happy chime: 587Hz & 880Hz sine wave ascending sequence.
  * Grumpy buzz: 130Hz sawtooth wave.
  * Rage overload: 95Hz low sweep.

### 3. The D-0198 Easter Egg
* Triggers: typing `d0198`, `d-0198`, `shreyash`, or 5 rapid clicks on Mochi.
* Displays a 10-second suspense terminal horror glitch, followed by CRT shutdown collapse and automatic return to the active screen.

---

## Chapter 10: Production Runbooks, Error Codes & Troubleshooting

### 1. Error Code Matrix
| Error Code | Meaning | Immediate Action |
| :--- | :--- | :--- |
| `401 INVALID_TOKEN` | Token expired (1-hr limit). | Run `gcloud auth print-access-token` in Cloud Shell and paste. |
| `403 FORBIDDEN` | Missing IAM role. | Request project admin to bind `roles/datastore.user`. |
| `413 PAYLOAD_TOO_LARGE` | Snapshot > 700 KB. | Apply property filters or reduce batch size. |
| `429 RATE_LIMITED` | Exceeded 120 req/min. | Wait 60s for sliding window reset. |

### 2. Disaster Recovery Runbook
* If an accidental overwrite occurs, locate the operation in the Audit Log and click **Revert**.
* The portal restores previous entity values losslessly in bounded chunks.
