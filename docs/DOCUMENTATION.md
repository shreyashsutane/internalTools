# Internal Tools Portal Documentation

Welcome to the central documentation page for the Internal Tools portal.

This collection of utilities is designed to assist internal development, operational data migrations, and schema management across environments.

## Available Tools

### 1. GCP Infrastructure Manager
- **ID**: `datastore-copier`
- **Status**: Active
- **Purpose**: Compare BigQuery table schemas in read-only mode, transfer scheduled query configurations, and copy Cloud Datastore entities.
- **Reference**: See the [Tool-Specific Documentation](../datastore-copier/README.md).

### 2. Tool 2 (Coming Soon)
- **Status**: Under Development
- **Purpose**: Future internal utility for automation tasks.

### 3. Tool 3 (Coming Soon)
- **Status**: Under Development
- **Purpose**: Future internal utility.

## General Usage Policies

1. **Permissions**: Use least-privilege IAM. BigQuery schema comparison requires metadata read access only; write permissions apply only to the separate scheduled-query and Datastore tools.
2. **Backups**: Never run synchronization/transfer actions against production environments without taking snapshots or backups first.
3. **Internal Use Only**: These tools are intended for internal development and administration. Do not expose them externally or share credentials/access keys.

## Central Audit Ownership

Every user who successfully verifies a Google Cloud access token is recorded by the
central audit service. The user does not need IAM access to the portal's Firebase
project: the service validates the token, derives the verified email on the server,
and stores the log through a dedicated least-privilege service account.

- A signed-in user can read and update only audit records owned by the verified
  email in that user's token.
- Reversible Datastore and scheduled-query mutations create an `IN_PROGRESS`
  record containing the backup before the first cloud write. If that backup cannot
  be persisted, the mutation does not start.
- A user can revert only an operation present in their own audit history. The
  revert itself runs with that user's current Google Cloud token, so target-project
  IAM permissions still apply.
- If a Datastore revert cannot delete entities, it restores all possible previous
  entities with upserts and reports the skipped deletes as `PARTIAL`.
- Portal administrators use the protected admin page to view all users' records.
  Direct browser access to the `audit_logs` collection remains admin-only.

## External-Attack Protection

The audit API accepts only exact same-origin `POST` requests and requires a bearer
token in the `Authorization` header. It does not trust a client-supplied email.
Payload sizes, operation names, statuses, nesting depth, object keys, and document
IDs are validated. Per-user rate limiting, output encoding, no-store responses,
security headers, owner checks, and least-privilege service-account access reduce
token leakage, injection, cross-user access, abuse, and accidental exposure.
