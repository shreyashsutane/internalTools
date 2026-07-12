import { Utils } from './utils';
import { CONFIG } from './config';

let activeToken: string | null = null;

export const Api = {
    setToken: (token: string | null): void => {
        activeToken = token;
    },
    fetch: async (url: string, opts: RequestInit = {}): Promise<any> => {
        if (!activeToken) {
            throw new Error("No active access token provided.");
        }
        const headers = { 
            Authorization: `Bearer ${activeToken}`, 
            'Content-Type': 'application/json', 
            ...opts.headers 
        };
        const res = await fetch(url, { ...opts, headers });
        if (res.status === 401) {
            try {
                // Dynamically import UI to resolve circular dependency
                const { UI } = await import('./ui');
                const newToken = await UI.showTokenRenewalModal();
                activeToken = newToken;
                
                // Propagate to State and localStorage
                const { State } = await import('./state');
                State.token = newToken;
                localStorage.setItem('access_token', newToken);
                
                const tokenInp = Utils.$('inp-token') as HTMLInputElement | null;
                if (tokenInp) tokenInp.value = newToken;
                return Api.fetch(url, opts);
            } catch (err) {
                throw new Error("Auth Error");
            }
        }
        if (res.status === 429) { 
            await new Promise(r => setTimeout(r, 2000)); 
            return Api.fetch(url, opts); 
        }
        if (!res.ok) { 
            const e = await res.json().catch(() => ({})); 
            throw new Error(e.error?.message || `API Error ${res.status}`); 
        } 
        const text = await res.text();
        return text ? JSON.parse(text) : {};
    },
    getProjects: async (): Promise<{id: string, name: string}[]> => { 
        const d = await Api.fetch(CONFIG.PROJECTS_URL); 
        return (d.projects || []).map((p: any) => ({
            id: p.projectId, 
            name: p.name || ''
        })).sort((a: any, b: any) => a.id.localeCompare(b.id)); 
    },
    getDatasets: async (pid: string): Promise<string[]> => { 
        const d = await Api.fetch(CONFIG.DATASETS_URL(pid)); 
        return (d.datasets || []).map((x: any) => x.datasetReference.datasetId); 
    },
    getTables: async (pid: string, did: string): Promise<{dataset: string, table: string}[]> => { 
        const d = await Api.fetch(CONFIG.TABLES_URL(pid, did)); 
        return (d.tables || []).map((x: any) => ({
            dataset: did,
            table: x.tableReference.tableId
        })); 
    },
    getSchema: async (pid: string, did: string, tid: string): Promise<any[]> => { 
        const d = await Api.fetch(CONFIG.SCHEMA_URL(pid, did, tid)); 
        return d.schema?.fields || []; 
    },
    getDataset: async (pid: string, did: string): Promise<any> => { 
        return Api.fetch(CONFIG.DATASET_META_URL(pid, did)); 
    },
    createDataset: async (pid: string, did: string, location?: string): Promise<void> => { 
        try { 
            const body: any = { datasetReference: { projectId: pid, datasetId: did } }; 
            if (location) body.location = location; 
            await Api.fetch(CONFIG.DATASETS_URL(pid), { 
                method: 'POST', 
                body: JSON.stringify(body) 
            }); 
        } catch (e: any) { 
            if (!e.message.includes('Already Exists') && !e.message.includes('alreadyExists')) throw e; 
        } 
    },
    createTable: async (pid: string, did: string, tid: string, fields: any[]): Promise<any> => { 
        return Api.fetch(CONFIG.TABLES_URL(pid, did), { 
            method: 'POST', 
            body: JSON.stringify({
                tableReference: { projectId: pid, datasetId: did, tableId: tid },
                schema: { fields }
            }) 
        }); 
    },
    patchTable: async (pid: string, did: string, tid: string, fields: any[]): Promise<any> => { 
        return Api.fetch(CONFIG.SCHEMA_URL(pid, did, tid), { 
            method: 'PATCH', 
            body: JSON.stringify({
                tableReference: { projectId: pid, datasetId: did, tableId: tid },
                schema: { fields }
            }) 
        }); 
    },
    getQueries: async (pid: string, loc: string): Promise<any[]> => { 
        const d = await Api.fetch(CONFIG.QUERIES_URL(pid, loc)); 
        return (d.transferConfigs || []).filter((x: any) => x.dataSourceId === 'scheduled_query'); 
    },
    createQuery: async (pid: string, loc: string, cfg: any): Promise<any> => { 
        return Api.fetch(CONFIG.QUERIES_URL(pid, loc), { 
            method: 'POST', 
            body: JSON.stringify({
                displayName: cfg.displayName,
                dataSourceId: "scheduled_query",
                schedule: cfg.schedule,
                destinationDatasetId: cfg.destinationDatasetId,
                params: cfg.params
            }) 
        }); 
    },
    deleteTable: async (pid: string, did: string, tid: string): Promise<any> => { 
        return Api.fetch(CONFIG.SCHEMA_URL(pid, did, tid), { 
            method: 'DELETE' 
        }); 
    },
    deleteQuery: async (qName: string): Promise<any> => { 
        return Api.fetch(CONFIG.QUERY_META_URL(qName), { 
            method: 'DELETE' 
        }); 
    },
    getKinds: async (pid: string, databaseId?: string): Promise<string[]> => { 
        const db = (databaseId === '(default)' || !databaseId) ? '' : databaseId;
        const url = CONFIG.DATASTORE_RUN_QUERY_URL(pid, db);
        const partitionId: any = { projectId: pid };
        if (db) partitionId.databaseId = db;
        const d = await Api.fetch(url, { 
            method: 'POST', 
            body: JSON.stringify({ partitionId, query: { kind: [{ name: "__kind__" }] } }) 
        }); 
        return (d.batch?.entityResults || []).map((e: any) => e.entity.key.path[0].name); 
    },
    getProperties: async (pid: string, kind: string, databaseId?: string): Promise<string[]> => { 
        const db = (databaseId === '(default)' || !databaseId) ? '' : databaseId;
        const url = CONFIG.DATASTORE_RUN_QUERY_URL(pid, db);
        const partitionId: any = { projectId: pid };
        if (db) partitionId.databaseId = db;
        const d = await Api.fetch(url, { 
            method: 'POST', 
            body: JSON.stringify({ partitionId, query: { kind: [{ name: kind }], limit: 1 } }) 
        }); 
        return d.batch?.entityResults?.[0]?.entity.properties ? Object.keys(d.batch.entityResults[0].entity.properties) : []; 
    },
    runDatastoreQuery: async (pid: string, body: any, databaseId?: string): Promise<any> => { 
        const db = (databaseId === '(default)' || !databaseId) ? '' : databaseId;
        const url = CONFIG.DATASTORE_RUN_QUERY_URL(pid, db);
        return Api.fetch(url, { method: 'POST', body: JSON.stringify(body) }); 
    },
    lookupEntities: async (pid: string, keys: any[], databaseId?: string): Promise<any> => { 
        const db = (databaseId === '(default)' || !databaseId) ? '' : databaseId;
        const url = CONFIG.DATASTORE_LOOKUP_URL(pid, db);
        return Api.fetch(url, { method: 'POST', body: JSON.stringify({ keys }) }); 
    },
    commitDatastore: async (pid: string, mutations: any[], databaseId?: string): Promise<any> => { 
        const db = (databaseId === '(default)' || !databaseId) ? '' : databaseId;
        const url = CONFIG.DATASTORE_COMMIT_URL(pid, db);
        return Api.fetch(url, { method: 'POST', body: JSON.stringify({ mode: "NON_TRANSACTIONAL", mutations }) }); 
    }
};
