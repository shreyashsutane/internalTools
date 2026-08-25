import { State, QuestionEntity, BigQuerySchemaField, BigQueryResults } from './state';
import { Utils } from './utils';

const BASE_DATASTORE = 'https://datastore.googleapis.com/v1/projects';
const BASE_BIGQUERY = 'https://bigquery.googleapis.com/bigquery/v2/projects';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export const Api = {
    verifyToken: async (token: string): Promise<{ email: string; name?: string }> => {
        const res = await fetch(USERINFO_URL, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Invalid or expired Google Access Token.');
        return await res.json();
    },

    fetchAccessibleProjects: async (signal?: AbortSignal): Promise<{ projectId: string; name: string }[]> => {
        const projects: { projectId: string; name: string }[] = [];
        let pageToken = '';
        try {
            do {
                const url = `https://cloudresourcemanager.googleapis.com/v1/projects?pageSize=500${pageToken ? `&pageToken=${pageToken}` : ''}`;
                const res = await fetch(url, {
                    headers: { Authorization: `Bearer ${State.token}` },
                    signal
                });
                if (!res.ok) break;
                const data = await res.json();
                if (Array.isArray(data.projects)) {
                    for (const p of data.projects) {
                        if (p.projectId && p.lifecycleState === 'ACTIVE') {
                            projects.push({
                                projectId: p.projectId,
                                name: p.name || p.projectId
                            });
                        }
                    }
                }
                pageToken = data.nextPageToken || '';
            } while (pageToken);
        } catch {
            // Non-fatal if Resource Manager API scope is restricted
        }

        return projects.sort((a, b) => a.projectId.localeCompare(b.projectId));
    },

    fetchQuestions: async (
        projectId: string,
        databaseId = '(default)',
        signal?: AbortSignal
    ): Promise<QuestionEntity[]> => {
        const cleanDb = databaseId === '(default)' || !databaseId ? '' : databaseId;
        const url = `${BASE_DATASTORE}/${projectId}:runQuery`;
        const partitionId: any = { projectId };
        if (cleanDb) partitionId.databaseId = cleanDb;

        const body: any = {
            partitionId,
            query: {
                kind: [{ name: 'Questions' }]
            }
        };

        const questions: QuestionEntity[] = [];
        let cursor: string | null = null;

        do {
            if (cursor) body.query.startCursor = cursor;
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${State.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body),
                signal
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData?.error?.message || `Failed to fetch Questions (HTTP ${res.status})`);
            }

            const data = await res.json();
            const results = data.batch?.entityResults || [];
            cursor = data.batch?.moreResults === 'NO_MORE_RESULTS' ? null : (data.batch?.endCursor || null);

            for (const r of results) {
                const ent = r.entity;
                if (!ent || !ent.key) continue;

                const keyStr = (ent.key.path || [])
                    .map((p: any) => `${p.kind}:${p.name || p.id}`)
                    .join(' | ');

                const props = ent.properties || {};
                
                // Detect query field: queryString or query
                let queryField: 'queryString' | 'query' = 'queryString';
                let queryString = '';

                if (props.queryString?.stringValue) {
                    queryField = 'queryString';
                    queryString = props.queryString.stringValue;
                } else if (props.query?.stringValue) {
                    queryField = 'query';
                    queryString = props.query.stringValue;
                }

                // Reference Name
                const referenceName = props.referenceName?.stringValue ||
                    props.name?.stringValue ||
                    props.title?.stringValue ||
                    keyStr;

                questions.push({
                    key: ent.key,
                    keyStr,
                    referenceName,
                    queryField,
                    queryString,
                    properties: props
                });
            }
        } while (cursor);

        return questions;
    },

    dryRunBigQuery: async (
        projectId: string,
        query: string,
        signal?: AbortSignal
    ): Promise<{ totalBytesProcessed: number; formattedSize: string; estimatedCostUsd: string }> => {
        const url = `${BASE_BIGQUERY}/${projectId}/queries`;
        const body = {
            query,
            useLegacySql: false,
            dryRun: true
        };

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${State.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body),
            signal
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData?.error?.message || `Dry run failed (HTTP ${res.status})`);
        }

        const data = await res.json();
        const bytes = Number(data.totalBytesProcessed || 0);
        const tb = bytes / (1024 * 1024 * 1024 * 1024);
        const gb = bytes / (1024 * 1024 * 1024);
        const cost = tb * 6.25; // standard on-demand $6.25/TB

        let formattedCost = `$${cost.toFixed(4)}`;
        if (cost === 0) formattedCost = '$0.00 (Free)';
        else if (cost < 0.0001) formattedCost = '< $0.0001';

        return {
            totalBytesProcessed: bytes,
            formattedSize: `${gb.toFixed(3)} GB (${Utils.formatBytes(bytes)})`,
            estimatedCostUsd: formattedCost
        };
    },

    executeBigQuery: async (
        projectId: string,
        query: string,
        signal?: AbortSignal,
        onInitialData?: (initialResults: BigQueryResults, totalExpected: number) => void,
        onChunk?: (newRows: any[][], totalLoaded: number, totalExpected: number) => void
    ): Promise<BigQueryResults> => {
        const startTime = performance.now();
        const url = `${BASE_BIGQUERY}/${projectId}/queries`;

        const body = {
            query,
            useLegacySql: false,
            timeoutMs: 30000,
            maxResults: 20000
        };

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${State.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body),
            signal
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData?.error?.message || `BigQuery query failed (HTTP ${res.status})`);
        }

        const data = await res.json();
        const jobId = data.jobReference?.jobId;
        const location = data.jobReference?.location;

        let schema: BigQuerySchemaField[] = data.schema?.fields || [];
        const allRows: any[][] = [];
        let totalBytesBilled = data.totalBytesBilled || data.totalBytesProcessed || '0';
        const cacheHit = Boolean(data.cacheHit);
        const totalExpectedRows = Number(data.totalRows || 0);

        const parseRow = (rowObj: any): any[] => {
            if (!rowObj || !Array.isArray(rowObj.f)) return [];
            return rowObj.f.map((cell: any) => {
                if (cell === null || cell === undefined || cell.v === null) return null;
                return cell.v;
            });
        };

        // Ingest initial batch
        if (Array.isArray(data.rows)) {
            for (const r of data.rows) {
                allRows.push(parseRow(r));
            }
        }

        // Trigger INSTANT first render so user sees data in < 300ms!
        if (onInitialData) {
            onInitialData({
                schema,
                rows: allRows,
                totalRows: totalExpectedRows || allRows.length,
                executionTimeMs: Math.round(performance.now() - startTime),
                totalBytesBilled: Utils.formatBytes(Number(totalBytesBilled)),
                cacheHit
            }, totalExpectedRows);
        }

        let pageToken = data.pageToken;
        let jobComplete = data.jobComplete;

        // If job is complete and we have remaining rows, use parallel concurrent startIndex fetching!
        if (jobComplete && totalExpectedRows > allRows.length && jobId) {
            const chunkSize = 25000;
            const startOffsets: number[] = [];
            for (let offset = allRows.length; offset < totalExpectedRows; offset += chunkSize) {
                startOffsets.push(offset);
            }

            const MAX_CONCURRENT = 4;
            const fetchChunk = async (startIndex: number) => {
                if (signal?.aborted) return [];
                const chunkUrl = location
                    ? `${BASE_BIGQUERY}/${projectId}/queries/${jobId}?location=${location}&startIndex=${startIndex}&maxResults=${chunkSize}`
                    : `${BASE_BIGQUERY}/${projectId}/queries/${jobId}?startIndex=${startIndex}&maxResults=${chunkSize}`;

                const cRes = await fetch(chunkUrl, {
                    headers: { Authorization: `Bearer ${State.token}` },
                    signal
                });
                if (!cRes.ok) return [];
                const cData = await cRes.json();
                if (!Array.isArray(cData.rows)) return [];
                return cData.rows.map(parseRow);
            };

            for (let i = 0; i < startOffsets.length; i += MAX_CONCURRENT) {
                const batch = startOffsets.slice(i, i + MAX_CONCURRENT);
                const chunkResults = await Promise.all(batch.map(fetchChunk));
                for (const chunkRows of chunkResults) {
                    for (const row of chunkRows) {
                        allRows.push(row);
                    }
                    if (onChunk) onChunk(chunkRows, allRows.length, totalExpectedRows);
                }
            }
        } else {
            // Sequential fallback
            while (!jobComplete || pageToken) {
                if (signal?.aborted) throw new DOMException('Query Cancelled', 'AbortError');
                if (!jobComplete) await new Promise(r => setTimeout(r, 200));

                const getResultsUrl = location
                    ? `${BASE_BIGQUERY}/${projectId}/queries/${jobId}?location=${location}${pageToken ? `&pageToken=${pageToken}` : ''}&maxResults=30000`
                    : `${BASE_BIGQUERY}/${projectId}/queries/${jobId}?${pageToken ? `pageToken=${pageToken}` : ''}&maxResults=30000`;

                const pageRes = await fetch(getResultsUrl, {
                    headers: { Authorization: `Bearer ${State.token}` },
                    signal
                });

                if (!pageRes.ok) break;

                const pageData = await pageRes.json();
                jobComplete = pageData.jobComplete;
                pageToken = pageData.pageToken;

                if (pageData.schema?.fields) schema = pageData.schema.fields;
                if (pageData.totalBytesBilled) totalBytesBilled = pageData.totalBytesBilled;

                if (Array.isArray(pageData.rows)) {
                    const chunkRows = pageData.rows.map(parseRow);
                    for (const r of chunkRows) allRows.push(r);
                    if (onChunk) onChunk(chunkRows, allRows.length, totalExpectedRows);
                }
            }
        }

        const executionTimeMs = Math.round(performance.now() - startTime);

        return {
            schema,
            rows: allRows,
            totalRows: allRows.length,
            executionTimeMs,
            totalBytesBilled: Utils.formatBytes(Number(totalBytesBilled)),
            cacheHit
        };
    },

    saveQuestionEntity: async (
        projectId: string,
        question: QuestionEntity,
        newQuerySql: string,
        additionalProperties: Record<string, any> = {},
        databaseId = '(default)',
        signal?: AbortSignal
    ): Promise<void> => {
        const cleanDb = databaseId === '(default)' || !databaseId ? '' : databaseId;
        const url = `${BASE_DATASTORE}/${projectId}:commit`;

        // Clone entity properties
        const properties: Record<string, any> = JSON.parse(JSON.stringify(question.properties || {}));

        // 1. Update SQL query field
        properties[question.queryField] = { stringValue: newQuerySql };

        // 2. Automatically update updatedByName
        if (State.userName) {
            properties.updatedByName = { stringValue: State.userName };
        }

        // 3. Automatically update updatedAt timestamp
        const nowIso = new Date().toISOString();
        if (properties.updatedAt?.stringValue) {
            properties.updatedAt = { stringValue: nowIso };
        } else {
            properties.updatedAt = { timestampValue: nowIso };
        }

        // 4. Merge any additional modified properties (e.g. referenceName, description, config)
        for (const [key, val] of Object.entries(additionalProperties)) {
            properties[key] = val;
        }

        const mutation = {
            upsert: {
                key: question.key,
                properties
            }
        };

        const body: any = {
            mode: 'NON_TRANSACTIONAL',
            mutations: [mutation]
        };
        if (cleanDb) body.databaseId = cleanDb;

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${State.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body),
            signal
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData?.error?.message || `Failed to save entity to Datastore (HTTP ${res.status})`);
        }

        // Update local question state
        question.queryString = newQuerySql;
        question.properties = properties;
        if (properties.referenceName?.stringValue) {
            question.referenceName = properties.referenceName.stringValue;
        }
    },

    fetchAuditLogs: async (limit = 100): Promise<any[]> => {
        try {
            const res = await fetch('/api/audit_logs/runQuery', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${State.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ limit })
            });
            if (!res.ok) return [];
            const data = await res.json();
            return Array.isArray(data.logs) ? data.logs : [];
        } catch (e) {
            console.warn('Failed to fetch audit logs:', e);
            return [];
        }
    },

    recordAudit: async (
        operation: string,
        details: string,
        status: 'SUCCESS' | 'FAILED' | 'IN_PROGRESS' = 'SUCCESS',
        prevState?: any
    ): Promise<void> => {
        try {
            await fetch('/api/audit_logs', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${State.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    operation,
                    srcProject: State.projectId,
                    tgtProject: State.projectId,
                    status,
                    details,
                    prevState: prevState || null
                })
            });
        } catch (e) {
            console.warn('Audit recording non-fatal error:', e);
        }
    }
};
