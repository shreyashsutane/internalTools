# GCP Infrastructure Manager - API Reference

This document highlights the endpoints called by the client-side code of the GCP Infrastructure Manager.

## Authentication
All requests require the `Authorization: Bearer <access_token>` header.
To retrieve account information for verification:
- **GET** `https://www.googleapis.com/oauth2/v3/userinfo`

## Resource Manager
Used to query available Google Cloud projects for source and target selections:
- **GET** `https://cloudresourcemanager.googleapis.com/v1/projects`

## BigQuery API

### Dataset Management
- **GET** `https://bigquery.googleapis.com/bigquery/v2/projects/{projectId}/datasets`
- **POST** `https://bigquery.googleapis.com/bigquery/v2/projects/{projectId}/datasets`

### Table Management
- **GET** `https://bigquery.googleapis.com/bigquery/v2/projects/{projectId}/datasets/{datasetId}/tables`
- **GET** `https://bigquery.googleapis.com/bigquery/v2/projects/{projectId}/datasets/{datasetId}/tables/{tableId}`
- **POST** `https://bigquery.googleapis.com/bigquery/v2/projects/{projectId}/datasets/{datasetId}/tables`
- **PATCH** `https://bigquery.googleapis.com/bigquery/v2/projects/{projectId}/datasets/{datasetId}/tables/{tableId}`

### Scheduled Queries (BigQuery Data Transfer Service)
- **GET** `https://datatransfer.googleapis.com/v1/projects/{projectId}/locations/{locationId}/transferConfigs`
- **POST** `https://datatransfer.googleapis.com/v1/projects/{projectId}/locations/{locationId}/transferConfigs`

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
