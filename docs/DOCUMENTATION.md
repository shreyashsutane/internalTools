# Dista Internal Tools Portal Documentation

Welcome to the central documentation page for the Dista Internal Tools portal.

This collection of utilities is designed to assist internal development, operational data migrations, and schema management across environments.

## Available Tools

### 1. GCP Infrastructure Manager
- **ID**: `datastore-copier`
- **Status**: Active
- **Purpose**: Manage, compare, and sync BigQuery table schemas, transfer scheduled query configurations, and copy Cloud Datastore entities.
- **Reference**: See the [Tool-Specific Documentation](../datastore-copier/README.md).

### 2. Tool 2 (Coming Soon)
- **Status**: Under Development
- **Purpose**: Future internal utility for automation tasks.

### 3. Tool 3 (Coming Soon)
- **Status**: Under Development
- **Purpose**: Future internal utility.

## General Usage Policies

1. **Permissions**: Ensure your local workstation or environment has correct cloud provider configurations. Active tokens are required for direct interactions.
2. **Backups**: Never run synchronization/transfer actions against production environments without taking snapshots or backups first.
3. **Internal Use Only**: These tools are intended for internal development and administration. Do not expose them externally or share credentials/access keys.
