import { Utils } from './utils';
import { CONFIG } from './config';

let activeToken: string | null = null;

const ALLOWED_API_ORIGINS = new Set([
    'https://bigquery.googleapis.com',
    'https://bigquerydatatransfer.googleapis.com',
    'https://cloudresourcemanager.googleapis.com',
    'https://datastore.googleapis.com',
    'https://firestore.googleapis.com'
]);

const assertAllowedApiUrl = (url: string): string => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !ALLOWED_API_ORIGINS.has(parsed.origin)) {
        throw new Error(`Blocked API destination: ${parsed.origin}`);
    }
    return parsed.toString();
};

const parseProjects = (payload: any): {id: string, name: string}[] =>
    (payload.projects || []).map((project: any) => ({
        id: project.projectId,
        name: project.name || ''
    })).sort((a: any, b: any) => a.id.localeCompare(b.id));

const throwIfAborted = (signal?: AbortSignal): void => {
    if (signal?.aborted) throw new DOMException('Process Cancelled', 'AbortError');
};

const abortableDelay = (milliseconds: number, signal?: AbortSignal): Promise<void> => {
    return new Promise((resolve, reject) => {
        throwIfAborted(signal);
        const timeout = window.setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, milliseconds);
        const onAbort = () => {
            window.clearTimeout(timeout);
            reject(new DOMException('Process Cancelled', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
};

const cleanDatabaseId = (databaseId?: string): string =>
    databaseId === '(default)' || !databaseId ? '' : databaseId;

export const Api = {
    setToken: (token: string | null): void => {
        activeToken = token;
    },
    validateToken: async (token: string): Promise<{email: string, projects: {id: string, name: string}[]}> => {
        const authHeaders = { Authorization: `Bearer ${token}` };
        const projectResponse = await fetch(CONFIG.PROJECTS_URL, {
            headers: authHeaders,
            cache: 'no-store',
            referrerPolicy: 'no-referrer'
        });
        if (projectResponse.status === 401) throw new Error('Invalid or expired token');
        if (!projectResponse.ok && projectResponse.status !== 403) {
            throw new Error(`Token validation failed (${projectResponse.status})`);
        }

        const projectPayload = projectResponse.ok
            ? await projectResponse.json()
            : { projects: [] };
        let email = 'Authenticated principal';
        try {
            const identityResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
                headers: authHeaders,
                cache: 'no-store',
                referrerPolicy: 'no-referrer'
            });
            if (identityResponse.ok) {
                const identity = await identityResponse.json();
                if (typeof identity.email === 'string' && identity.email) email = identity.email;
            }
        } catch {
            // Identity display is optional; resource access remains the source of truth.
        }
        return { email, projects: parseProjects(projectPayload) };
    },
    fetch: async (url: string, opts: RequestInit = {}): Promise<any> => {
        if (!activeToken) {
            throw new Error("No active access token provided.");
        }
        const safeUrl = assertAllowedApiUrl(url);
        let authRetries = 0;
        let rateLimitRetries = 0;
        while (true) {
            throwIfAborted(opts.signal || undefined);
            const headers = new Headers(opts.headers);
            headers.set('Authorization', `Bearer ${activeToken}`);
            if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
            const res = await fetch(safeUrl, {
                ...opts,
                headers,
                cache: 'no-store',
                referrerPolicy: 'no-referrer'
            });
            if (res.status === 401) {
                if (authRetries >= 1) throw new Error('Auth Error');
                authRetries++;
                try {
                    const { UI } = await import('./ui');
                    const newToken = await UI.showTokenRenewalModal();
                    activeToken = newToken;

                    const { State } = await import('./state');
                    State.token = newToken;

                    const tokenInp = Utils.$('inp-token') as HTMLInputElement | null;
                    if (tokenInp) tokenInp.value = newToken;
                    continue;
                } catch {
                    throw new Error("Auth Error");
                }
            }
            if (res.status === 429) {
                if (rateLimitRetries >= 5) {
                    throw new Error('API rate limit persisted after 5 retries.');
                }
                const retryAfter = Number(res.headers.get('Retry-After'));
                const delay = Number.isFinite(retryAfter) && retryAfter > 0
                    ? retryAfter * 1000
                    : Math.min(8000, 1000 * (2 ** rateLimitRetries));
                rateLimitRetries++;
                await abortableDelay(delay, opts.signal || undefined);
                continue;
            }
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                const error = new Error(e.error?.message || `API Error ${res.status}`) as Error & {
                    status?: number;
                    code?: string;
                };
                error.status = res.status;
                error.code = e.error?.status;
                throw error;
            }
            const text = await res.text();
            return text ? JSON.parse(text) : {};
        }
    },
    getProjects: async (): Promise<{id: string, name: string}[]> => {
        const d = await Api.fetch(CONFIG.PROJECTS_URL);
        return parseProjects(d);
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
    deleteQuery: async (qName: string): Promise<any> => {
        return Api.fetch(CONFIG.QUERY_META_URL(qName), {
            method: 'DELETE'
        });
    },
    getKinds: async (pid: string, databaseId?: string, signal?: AbortSignal): Promise<string[]> => {
        const db = cleanDatabaseId(databaseId);
        const url = CONFIG.DATASTORE_RUN_QUERY_URL(pid, db);
        const partitionId: any = { projectId: pid };
        if (db) partitionId.databaseId = db;
        const kinds = new Set<string>();
        let cursor: string | undefined;
        do {
            const query: any = { kind: [{ name: "__kind__" }], limit: 500 };
            if (cursor) query.startCursor = cursor;
            const d = await Api.fetch(url, {
                method: 'POST',
                body: JSON.stringify({ partitionId, query }),
                signal
            });
            for (const result of d.batch?.entityResults || []) {
                const name = result.entity?.key?.path?.[0]?.name;
                if (name) kinds.add(name);
            }
            cursor = d.batch?.moreResults === 'NO_MORE_RESULTS' ? undefined : d.batch?.endCursor;
        } while (cursor);
        return [...kinds].sort();
    },
    getProperties: async (pid: string, kind: string, databaseId?: string, signal?: AbortSignal): Promise<string[]> => {
        const db = cleanDatabaseId(databaseId);
        const url = CONFIG.DATASTORE_RUN_QUERY_URL(pid, db);
        const partitionId: any = { projectId: pid };
        if (db) partitionId.databaseId = db;
        const properties = new Set<string>();
        let cursor: string | undefined;
        try {
            do {
                const query: any = {
                    kind: [{ name: '__property__' }],
                    filter: {
                        propertyFilter: {
                            property: { name: '__key__' },
                            op: 'HAS_ANCESTOR',
                            value: {
                                keyValue: {
                                    partitionId,
                                    path: [{ kind: '__kind__', name: kind }]
                                }
                            }
                        }
                    },
                    limit: 500
                };
                if (cursor) query.startCursor = cursor;
                const d = await Api.fetch(url, {
                    method: 'POST',
                    body: JSON.stringify({ partitionId, query }),
                    signal
                });
                for (const result of d.batch?.entityResults || []) {
                    const path = result.entity?.key?.path || [];
                    const name = path[path.length - 1]?.name;
                    if (name) properties.add(name);
                }
                cursor = d.batch?.moreResults === 'NO_MORE_RESULTS' ? undefined : d.batch?.endCursor;
            } while (cursor);
        } catch (error) {
            console.warn('Datastore property metadata query failed; using entity sampling fallback.', error);
        }

        // If metadata query succeeded but returned 0 properties (e.g. unindexed properties), sample entities
        if (properties.size === 0) {
            cursor = undefined;
            let sampled = 0;
            try {
                do {
                    const query: any = { kind: [{ name: kind }], limit: Math.min(500, 1000 - sampled) };
                    if (cursor) query.startCursor = cursor;
                    const d = await Api.fetch(url, {
                        method: 'POST',
                        body: JSON.stringify({ partitionId, query }),
                        signal
                    });
                    const results = d.batch?.entityResults || [];
                    results.forEach((result: any) => {
                        Object.keys(result.entity?.properties || {}).forEach(name => properties.add(name));
                    });
                    sampled += results.length;
                    cursor = sampled >= 1000 || d.batch?.moreResults === 'NO_MORE_RESULTS'
                        ? undefined
                        : d.batch?.endCursor;
                } while (cursor);
            } catch (err) {
                console.warn('Entity sampling fallback failed:', err);
            }
        }
        return [...properties].sort();
    },
    runDatastoreQuery: async (pid: string, body: any, databaseId?: string, signal?: AbortSignal): Promise<any> => {
        const db = cleanDatabaseId(databaseId);
        const url = CONFIG.DATASTORE_RUN_QUERY_URL(pid, db);
        return Api.fetch(url, { method: 'POST', body: JSON.stringify(body), signal });
    },
    lookupEntities: async (pid: string, keys: any[], databaseId?: string, signal?: AbortSignal): Promise<any> => {
        const db = cleanDatabaseId(databaseId);
        const url = CONFIG.DATASTORE_LOOKUP_URL(pid, db);
        const found: any[] = [];
        const missing: any[] = [];

        for (let offset = 0; offset < keys.length; offset += 1000) {
            let pending = keys.slice(offset, offset + 1000);
            let deferredAttempts = 0;
            while (pending.length > 0) {
                throwIfAborted(signal);
                const response = await Api.fetch(url, {
                    method: 'POST',
                    body: JSON.stringify({ keys: pending }),
                    signal
                });
                found.push(...(response.found || []));
                missing.push(...(response.missing || []));
                pending = response.deferred || [];
                if (pending.length > 0) {
                    deferredAttempts++;
                    if (deferredAttempts > 5) {
                        throw new Error(`Datastore lookup left ${pending.length} keys deferred after 5 retries.`);
                    }
                    await abortableDelay(250 * deferredAttempts, signal);
                }
            }
        }
        return { found, missing, deferred: [] };
    },
    commitDatastore: async (pid: string, mutations: any[], databaseId?: string, signal?: AbortSignal): Promise<any> => {
        const db = cleanDatabaseId(databaseId);
        const url = CONFIG.DATASTORE_COMMIT_URL(pid, db);
        const MAX_MUTATIONS_PER_COMMIT = 250;
        const results: any[] = [];

        for (let i = 0; i < mutations.length; i += MAX_MUTATIONS_PER_COMMIT) {
            throwIfAborted(signal);
            const chunk = mutations.slice(i, i + MAX_MUTATIONS_PER_COMMIT);
            const res = await Api.fetch(url, {
                method: 'POST',
                body: JSON.stringify({ mode: "NON_TRANSACTIONAL", mutations: chunk }),
                signal
            });
            results.push(res);
        }
        return results.length === 1 ? results[0] : { mutationResults: results.flatMap(r => r.mutationResults || []) };
    }
};
