export const CONFIG = {
    // API Endpoints
    PROJECTS_URL: 'https://cloudresourcemanager.googleapis.com/v1/projects',
    DATASETS_URL: (pid: string) => `https://bigquery.googleapis.com/bigquery/v2/projects/${pid}/datasets`,
    TABLES_URL: (pid: string, did: string) => `https://bigquery.googleapis.com/bigquery/v2/projects/${pid}/datasets/${did}/tables`,
    SCHEMA_URL: (pid: string, did: string, tid: string) => `https://bigquery.googleapis.com/bigquery/v2/projects/${pid}/datasets/${did}/tables/${tid}`,
    QUERIES_URL: (pid: string, loc: string) => `https://bigquerydatatransfer.googleapis.com/v1/projects/${pid}/locations/${loc}/transferConfigs`,
    QUERY_META_URL: (name: string) => `https://bigquerydatatransfer.googleapis.com/v1/${name}`,
    
    DATASTORE_RUN_QUERY_URL: (pid: string, db?: string) => 
        `https://datastore.googleapis.com/v1/projects/${pid}:runQuery` + (db ? `?databaseId=${db}` : ''),
    DATASTORE_LOOKUP_URL: (pid: string, db?: string) => 
        `https://datastore.googleapis.com/v1/projects/${pid}:lookup` + (db ? `?databaseId=${db}` : ''),
    DATASTORE_COMMIT_URL: (pid: string, db?: string) => 
        `https://datastore.googleapis.com/v1/projects/${pid}:commit` + (db ? `?databaseId=${db}` : ''),

    // Same-origin secured audit API (Firebase Hosting -> Cloud Function)
    FIRESTORE_DATABASES_URL: (pid: string) => `https://firestore.googleapis.com/v1/projects/${pid}/databases`,
    FIRESTORE_AUDIT_LOG_URL: '/api/audit_logs',

    // Asset paths
    TUDUM_SOUND_PATH: 'sounds/netflix-tudum.mp3',
    TUDUM_SOUND_PATH_SUB: '../sounds/netflix-tudum.mp3'
};
