import { State } from './state';
import { Utils } from './utils';
import { Api } from './api';
import { CONFIG } from './config';
import { executeDatastoreRevert, executeScheduledQueryRevert } from './revert';
import { compressJsonToBase64, decompressJsonFromBase64, mapConcurrent } from './datastore-utils';

const MAX_AUDIT_PREV_STATE_BYTES = 700_000;
const MAX_AUDIT_CHUNK_DATA_BYTES = 650_000;

export interface PreparedPrevState {
    inline: any;
    chunks?: string[];
}

const createChunkRevision = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID().replace(/-/g, '');
    }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
};

const copyManifestMetadata = (prevState: any): Record<string, any> => {
    const metadata: Record<string, any> = {};
    for (const key of ['type', 'kind', 'kinds', 'srcDb', 'tgtDb', 'dbId', 'batch', 'count']) {
        if (prevState?.[key] !== undefined) metadata[key] = prevState[key];
    }
    if (metadata.count === undefined && Array.isArray(prevState?.backupData)) {
        metadata.count = prevState.backupData.length;
    }
    return metadata;
};

export const preparePrevState = async (prevState: any): Promise<PreparedPrevState> => {
    const size = AuditLog.getPrevStateSize(prevState);
    if (size <= MAX_AUDIT_PREV_STATE_BYTES) return { inline: prevState };

    const compressed = await compressJsonToBase64(prevState);
    const compressedState = {
        ...copyManifestMetadata(prevState),
        compressed: true,
        data: compressed
    };
    if (AuditLog.canPersistPrevState(compressedState)) return { inline: compressedState };

    const chunks: string[] = [];
    for (let offset = 0; offset < compressed.length; offset += MAX_AUDIT_CHUNK_DATA_BYTES) {
        chunks.push(compressed.slice(offset, offset + MAX_AUDIT_CHUNK_DATA_BYTES));
    }
    if (chunks.length > 110) {
        throw new Error('Audit backup requires more than 110 chunks; reduce the copy batch size.');
    }
    const revision = createChunkRevision();
    return {
        inline: {
            ...copyManifestMetadata(prevState),
            chunked: true,
            backupComplete: false,
            encoding: 'gzip-base64',
            chunkRevision: revision,
            chunkCount: chunks.length,
            originalBytes: size,
            compressedBytes: compressed.length
        },
        chunks
    };
};

export const AuditLog = {
    request: async (path: string, body: Record<string, any>): Promise<any> => {
        if (!State.token) throw new Error('No active access token is available for audit logging.');
        if (State.token === 'test-token' || State.token === 'mock-token') {
            if (path.endsWith('/runQuery')) {
                return { logs: [] };
            }
            return { ok: true, id: 'test-log-' + Date.now() };
        }
        const response = await fetch(path, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${State.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body),
            cache: 'no-store',
            referrerPolicy: 'no-referrer'
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload?.error?.message || `Audit service error (${response.status})`);
        }
        return payload;
    },
    readLogs: async (limit = 25): Promise<any[]> => {
        try {
            if (!State.token) return [];
            const data = await AuditLog.request(
                `${CONFIG.FIRESTORE_AUDIT_LOG_URL}/runQuery`,
                { limit }
            );
            const ownLogs = Array.isArray(data.logs) ? data.logs : [];
            ownLogs.forEach((log: any) => {
                if (typeof log.prevState === 'string') {
                    try { log.prevState = JSON.parse(log.prevState); } catch { log.prevState = null; }
                }
            });
            return ownLogs.sort((a: any, b: any) =>
                new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
            );
        } catch(e) {
            console.error("Failed to read audit logs:", e);
            return [];
        }
    },
    getPrevStateSize: (prevState: any): number => {
        return prevState ? new TextEncoder().encode(JSON.stringify(prevState)).byteLength : 0;
    },
    canPersistPrevState: (prevState: any): boolean => {
        return AuditLog.getPrevStateSize(prevState) <= MAX_AUDIT_PREV_STATE_BYTES;
    },
    persistChunks: async (id: string, prepared: PreparedPrevState): Promise<any> => {
        const chunks = prepared.chunks;
        if (!chunks) return prepared.inline;
        const manifest = prepared.inline;
        await mapConcurrent(chunks, 4, async (chunk, index) => {
            await AuditLog.request(`${CONFIG.FIRESTORE_AUDIT_LOG_URL}/chunks`, {
                action: 'write',
                id,
                revision: manifest.chunkRevision,
                index,
                count: chunks.length,
                data: chunk
            });
        });
        return { ...manifest, backupComplete: true };
    },
    resolvePrevState: async (id: string, prevState: any): Promise<any> => {
        let state = prevState;
        if (typeof state === 'string') state = JSON.parse(state);
        if (state?.chunked) {
            if (state.backupComplete !== true) {
                throw new Error('The audit backup is incomplete and cannot be used for revert.');
            }
            const indexes = Array.from({ length: state.chunkCount }, (_, index) => index);
            const chunks = await mapConcurrent(indexes, 4, async index => {
                const result = await AuditLog.request(`${CONFIG.FIRESTORE_AUDIT_LOG_URL}/chunks`, {
                    action: 'read',
                    id,
                    revision: state.chunkRevision,
                    index,
                    count: state.chunkCount
                });
                if (typeof result.data !== 'string') {
                    throw new Error(`Audit backup chunk ${index + 1} is missing.`);
                }
                return result.data;
            });
            state = await decompressJsonFromBase64(chunks.join(''));
        } else if (state?.compressed && state?.data) {
            state = await decompressJsonFromBase64(state.data);
        }
        return state;
    },
    addLog: async (operation: string, srcProject: string, tgtProject: string, details: string, status: string, prevState: any = null, skipRender = false): Promise<string | null> => {
        try {
            if (!State.token) return null;
            const prepared = prevState ? await preparePrevState(prevState) : { inline: null };
            const result = await AuditLog.request(CONFIG.FIRESTORE_AUDIT_LOG_URL, {
                operation,
                srcProject: srcProject || '—',
                tgtProject: tgtProject || '—',
                status: prepared.chunks ? 'IN_PROGRESS' : (status || 'SUCCESS'),
                details: details || '',
                prevState: prepared.inline
            });
            if (typeof result.id !== 'string') return null;
            let finalManifest = prepared.inline;
            if (prepared.chunks) {
                finalManifest = await AuditLog.persistChunks(result.id, prepared);
                await AuditLog.request(`${CONFIG.FIRESTORE_AUDIT_LOG_URL}/update`, {
                    id: result.id,
                    status: status || 'SUCCESS',
                    details: details || '',
                    prevState: finalManifest
                });
            }

            // Optimistic in-memory update: instant local addition without re-querying Firestore
            const newLog = {
                id: result.id,
                operation,
                srcProject: srcProject || '—',
                tgtProject: tgtProject || '—',
                status: status || 'SUCCESS',
                details: details || '',
                timestamp: new Date().toISOString(),
                timestampEpochMs: Date.now(),
                user: State.authEmail || 'User',
                prevState: finalManifest
            };
            cachedUserLogs = [newLog, ...cachedUserLogs.filter((l: any) => l.id !== result.id)];
            try {
                localStorage.setItem('normal_portal_cached_logs', JSON.stringify(cachedUserLogs));
                sessionStorage.setItem('normal_portal_cached_logs', JSON.stringify(cachedUserLogs));
            } catch(e) {}
            AuditLog.updateStats(cachedUserLogs);

            if (!skipRender) {
                AuditLog.initControls();
                AuditLog.renderCurrentPage();
            }
            return typeof result.id === 'string' ? result.id : null;
        } catch(e) {
            console.error("Failed to add audit log:", e);
            return null;
        }
    },
    updateLog: async (id: string, status: string, details: string, prevState?: any, skipRender = false): Promise<boolean> => {
        try {
            const body: Record<string, any> = { id, status, details };
            let finalPrev = prevState;
            if (prevState !== undefined) {
                const prepared = prevState ? await preparePrevState(prevState) : { inline: null };
                body.prevState = await AuditLog.persistChunks(id, prepared);
                finalPrev = body.prevState;
            }
            await AuditLog.request(`${CONFIG.FIRESTORE_AUDIT_LOG_URL}/update`, body);

            // Optimistic in-memory update for fast response
            const existing = cachedUserLogs.find((l: any) => l.id === id);
            if (existing) {
                existing.status = status;
                existing.details = details;
                if (prevState !== undefined) existing.prevState = finalPrev;
                AuditLog.updateStats(cachedUserLogs);
                if (!skipRender) {
                    AuditLog.initControls();
                    AuditLog.renderCurrentPage();
                }
            }
            return true;
        } catch (error) {
            console.error('Failed to update audit log:', error);
            return false;
        }
    },
    exportLogs: async (): Promise<void> => {
        const logs = await AuditLog.readLogs();
        if (logs.length === 0) {
            Utils.toast("No logs to export", "warn");
            return;
        }
        const jsonStr = JSON.stringify(logs, null, 2);
        const blob = new Blob([jsonStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `audit_logs_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        Utils.toast("Logs exported successfully", "ok");
        const logged = await AuditLog.addLog(
            'AUDIT_EXPORT',
            '—',
            '—',
            `Exported ${logs.length} own audit log entries.`,
            'SUCCESS'
        );
        if (!logged) Utils.toast('Audit export succeeded, but the export action could not be logged.', 'warn');
    },
    revertLog: async (logId: string): Promise<void> => {
        let log = cachedUserLogs.find((x: any) => x.id === logId);
        if (!log) {
            const logs = await AuditLog.readLogs(100);
            log = logs.find((x: any) => x.id === logId);
        }
        if (!log) {
            Utils.toast("Log entry not found", "err");
            return;
        }
        if (!log.prevState) {
            Utils.toast("No backup state available to revert this action.", "warn");
            return;
        }
        let requestedState: any;
        try {
            requestedState = await AuditLog.resolvePrevState(log.id, log.prevState);
        } catch (error) {
            console.error('Failed to load audit backup:', error);
            Utils.toast("Backup state is invalid or incomplete and cannot be reverted.", "err");
            return;
        }
        if (requestedState?.type === 'BQ_SCHEMA_SYNC') {
            Utils.toast("BigQuery Schema Comparator is read-only. Historical schema changes cannot be applied or reverted here.", "warn");
            return;
        }

        const { UI } = await import('./ui');
        const { App } = await import('./app');

        UI.openModal(`
            <div class="p-5 text-left">
                <h3 class="font-semibold mb-4 text-base">Revert Operation</h3>
                <div class="warning-box"><i class="fa-solid fa-triangle-exclamation"></i><div><strong>Destructive Action!</strong> This will restore the previous state and overwrite or delete changes made during the operation on <strong>${new Date(log.timestamp).toLocaleString()}</strong>.</div></div>
                <p class="text-sm mt-4 mb-4">Are you sure you want to revert this operation for target project <strong>${Utils.escapeHtml(log.tgtProject)}</strong>?</p>
                <div class="flex justify-end gap-2">
                    <button class="btn btn-s" id="btn-revert-cancel">Cancel</button>
                    <button class="btn btn-p btn-d" id="btn-revert-confirm">Confirm & Revert</button>
                </div>
            </div>
        `);

        Utils.$('btn-revert-cancel')!.onclick = () => {
            UI.closeModal();
        };

        Utils.$('btn-revert-confirm')!.onclick = async () => {
            UI.closeModal();
            Utils.show('sec-loading');
            Utils.$('load-title')!.textContent = "Reverting Changes...";
            Utils.$('load-msg')!.textContent = "Restoring previous state...";
            try {
                const state = requestedState;
                if (state.type === 'QUERY_SYNC') {
                    const result = await executeScheduledQueryRevert(
                        Api,
                        log.tgtProject,
                        state.backupData
                    );
                    const status = result.failed === 0
                        ? 'SUCCESS'
                        : (result.restored + result.deleted > 0 ? 'PARTIAL' : 'FAILED');
                    Utils.toast(
                        `Scheduled-query revert complete. Restored: ${result.restored}, Deleted: ${result.deleted}, Failed: ${result.failed}`,
                        result.failed > 0 ? 'warn' : 'ok'
                    );
                    const logged = await AuditLog.addLog(
                        'QUERY_REVERT',
                        '—',
                        log.tgtProject,
                        `Reverted scheduled-query sync from log ${logId}. Restored: ${result.restored}; deleted: ${result.deleted}; failed: ${result.failed}.`,
                        status
                    );
                    if (!logged) Utils.toast('Revert completed, but its audit result could not be persisted.', 'warn');
                    if (result.errors.length > 0) {
                        console.error('Scheduled-query revert item failures:', result.errors);
                    }
                    if (State.mode === 'query' && State.query.src) await App.runQueryFetch();
                } else if (state.type === 'DATASTORE_COPY' || state.type === 'DATASTORE_EDIT') {
                    const result = await executeDatastoreRevert(Api, log.tgtProject, state);
                    const partial = result.skippedDeletes > 0;
                    const status = partial ? 'PARTIAL' : 'SUCCESS';
                    const permissionNote = partial
                        ? ` Skipped ${result.skippedDeletes} delete(s) because the user lacks delete permission.`
                        : '';
                    const kindsLabel = Array.isArray(state.kinds) && state.kinds.length > 0
                        ? state.kinds.join(', ')
                        : (state.kind || 'all');
                    const subject = state.type === 'DATASTORE_COPY'
                        ? `${state.backupData?.length || 0} copied entities (kind(s): ${kindsLabel})`
                        : `inline edit of entity ${state.keyStr}`;
                    Utils.toast(
                        `Datastore revert complete. Restored: ${result.restored}, Deleted: ${result.deleted}.${permissionNote}`,
                        partial ? 'warn' : 'ok'
                    );
                    const logged = await AuditLog.addLog(
                        state.type === 'DATASTORE_COPY' ? 'DATASTORE_REVERT' : 'DATASTORE_EDIT_REVERT',
                        '—',
                        log.tgtProject,
                        `Reverted ${subject} from log ${logId}. Restored: ${result.restored}; deleted: ${result.deleted}; permission-skipped deletes: ${result.skippedDeletes}.`,
                        status
                    );
                    if (!logged) Utils.toast('Revert completed, but its audit result could not be persisted.', 'warn');
                    if (State.mode === 'ds' && State.ds.src) await App.runDsAnalyze();
                }
            } catch(err: any) {
                console.error("Revert failed:", err);
                Utils.toast(`Revert failed: ${err.message}`, "err");
            } finally {
                Utils.hide('sec-loading');
                await AuditLog.renderLogs();
            }
        };
    },
    renderLogs: async (forceFetch = false): Promise<void> => {
        const container = Utils.$('audit-table-body');
        if (!container) return;

        // 1. Instant 0ms cache restore from localStorage
        if (cachedUserLogs.length === 0) {
            try {
                const saved = localStorage.getItem('normal_portal_cached_logs') || sessionStorage.getItem('normal_portal_cached_logs');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        cachedUserLogs = parsed;
                        AuditLog.updateStats(cachedUserLogs);
                        AuditLog.initControls();
                        AuditLog.renderCurrentPage();
                    }
                }
            } catch (e) {}
        }

        // 2. If still empty, display spinner
        if (cachedUserLogs.length === 0) {
            container.innerHTML = `
                <tr>
                    <td colspan="8" class="px-6 py-8 text-center text-xs" style="color:var(--muted)">
                        <i class="fa-solid fa-spinner fa-spin text-xl mb-2 block text-cyan-400"></i>
                        Loading operations audit trail from Firestore...
                    </td>
                </tr>
            `;
        }

        // 3. Fast background fetch (limit 25)
        const fetchPromise = AuditLog.readLogs(25).then(logs => {
            if (Array.isArray(logs) && logs.length > 0) {
                cachedUserLogs = logs;
                try {
                    localStorage.setItem('normal_portal_cached_logs', JSON.stringify(logs));
                    sessionStorage.setItem('normal_portal_cached_logs', JSON.stringify(logs));
                } catch (e) {}
                AuditLog.updateStats(cachedUserLogs);
                AuditLog.renderCurrentPage();
            }
        }).catch(err => {
            console.warn("Failed to background refresh audit logs:", err);
        });

        AuditLog.initControls();
        if (cachedUserLogs.length > 0) {
            AuditLog.renderCurrentPage();
        } else {
            await fetchPromise;
        }
    },
    updateStats: (logs: any[]): void => {
        const totalEl = Utils.$('audit-stat-total');
        const successEl = Utils.$('audit-stat-success');
        const failedEl = Utils.$('audit-stat-failed');
        const revertibleEl = Utils.$('audit-stat-revertible');

        const total = logs.length;
        const success = logs.filter(l => l.status === 'SUCCESS').length;
        const failed = logs.filter(l => l.status === 'FAILED' || l.status === 'CANCELLED').length;
        const revertible = logs.filter(l => Boolean(l.prevState && l.prevState.type !== 'BQ_SCHEMA_SYNC')).length;

        if (totalEl) totalEl.textContent = String(total);
        if (successEl) successEl.textContent = total > 0 ? `${Math.round((success / total) * 100)}%` : '0%';
        if (failedEl) failedEl.textContent = String(failed);
        if (revertibleEl) revertibleEl.textContent = String(revertible);
    },
    initControls: (): void => {
        if (auditUiInitialized) return;
        auditUiInitialized = true;

        const searchInp = Utils.$('audit-search-input') as HTMLInputElement | null;
        if (searchInp) {
            searchInp.oninput = () => {
                auditFilterState.search = searchInp.value.trim().toLowerCase();
                auditFilterState.page = 1;
                AuditLog.renderCurrentPage();
            };
        }

        const opFilter = Utils.$('audit-op-filter') as HTMLSelectElement | null;
        if (opFilter) {
            opFilter.onchange = () => {
                auditFilterState.op = opFilter.value;
                auditFilterState.page = 1;
                AuditLog.renderCurrentPage();
            };
        }

        const dateFilter = Utils.$('audit-date-filter') as HTMLSelectElement | null;
        if (dateFilter) {
            dateFilter.onchange = () => {
                auditFilterState.dateRange = dateFilter.value;
                auditFilterState.page = 1;
                AuditLog.renderCurrentPage();
            };
        }

        const pillContainer = Utils.$('audit-status-pills');
        if (pillContainer) {
            pillContainer.querySelectorAll('.audit-pill').forEach(btn => {
                btn.addEventListener('click', () => {
                    pillContainer.querySelectorAll('.audit-pill').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    auditFilterState.status = (btn as HTMLElement).dataset.status || 'ALL';
                    auditFilterState.page = 1;
                    AuditLog.renderCurrentPage();
                });
            });
        }

        const pageSizeSel = Utils.$('audit-page-size') as HTMLSelectElement | null;
        if (pageSizeSel) {
            pageSizeSel.onchange = () => {
                auditFilterState.pageSize = parseInt(pageSizeSel.value, 10) || 25;
                auditFilterState.page = 1;
                AuditLog.renderCurrentPage();
            };
        }

        const prevBtn = Utils.$('audit-prev-page');
        if (prevBtn) {
            prevBtn.onclick = () => {
                if (auditFilterState.page > 1) {
                    auditFilterState.page--;
                    AuditLog.renderCurrentPage();
                }
            };
        }

        const nextBtn = Utils.$('audit-next-page');
        if (nextBtn) {
            nextBtn.onclick = () => {
                auditFilterState.page++;
                AuditLog.renderCurrentPage();
            };
        }

        const refreshBtn = Utils.$('btn-audit-refresh');
        if (refreshBtn) {
            refreshBtn.onclick = async () => {
                refreshBtn.setAttribute('disabled', 'true');
                await AuditLog.renderLogs(true);
                refreshBtn.removeAttribute('disabled');
                Utils.toast('Audit logs refreshed from Firestore', 'ok');
            };
        }
    },
    getFilteredLogs: (): any[] => {
        const now = Date.now();
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        return cachedUserLogs.filter(log => {
            // 1. Status Filter
            if (auditFilterState.status === 'SUCCESS' && log.status !== 'SUCCESS') return false;
            if (auditFilterState.status === 'FAILED' && log.status !== 'FAILED') return false;
            if (auditFilterState.status === 'PARTIAL_CANCEL' && log.status !== 'PARTIAL' && log.status !== 'CANCELLED') return false;
            if (auditFilterState.status === 'REVERTIBLE') {
                const hasRev = Boolean(log.prevState && log.prevState.type !== 'BQ_SCHEMA_SYNC');
                if (!hasRev) return false;
            }

            // 2. Operation Filter
            if (auditFilterState.op !== 'ALL' && log.operation !== auditFilterState.op) return false;

            // 3. Date Range Filter
            const logEpoch = new Date(log.timestamp).getTime();
            if (auditFilterState.dateRange === 'TODAY' && logEpoch < startOfToday.getTime()) return false;
            if (auditFilterState.dateRange === '24H' && logEpoch < now - 24 * 3600 * 1000) return false;
            if (auditFilterState.dateRange === '7D' && logEpoch < now - 7 * 24 * 3600 * 1000) return false;

            // 4. Search Query
            if (auditFilterState.search) {
                const q = auditFilterState.search;
                const match = (
                    (log.user || '').toLowerCase().includes(q) ||
                    (log.operation || '').toLowerCase().includes(q) ||
                    (log.srcProject || '').toLowerCase().includes(q) ||
                    (log.tgtProject || '').toLowerCase().includes(q) ||
                    (log.details || '').toLowerCase().includes(q) ||
                    (log.id || '').toLowerCase().includes(q)
                );
                if (!match) return false;
            }

            return true;
        });
    },
    renderCurrentPage: (): void => {
        const container = Utils.$('audit-table-body');
        if (!container) return;

        const filtered = AuditLog.getFilteredLogs();
        const total = filtered.length;
        const totalPages = Math.max(1, Math.ceil(total / auditFilterState.pageSize));
        if (auditFilterState.page > totalPages) auditFilterState.page = totalPages;

        const startIndex = (auditFilterState.page - 1) * auditFilterState.pageSize;
        const pageItems = filtered.slice(startIndex, startIndex + auditFilterState.pageSize);

        // Update Pagination Controls
        const countEl = Utils.$('audit-pagination-count');
        const indicatorEl = Utils.$('audit-page-indicator');
        const prevBtn = Utils.$('audit-prev-page') as HTMLButtonElement | null;
        const nextBtn = Utils.$('audit-next-page') as HTMLButtonElement | null;

        if (countEl) {
            const end = Math.min(startIndex + auditFilterState.pageSize, total);
            countEl.textContent = total === 0 ? 'Showing 0 of 0 logs' : `Showing ${startIndex + 1}–${end} of ${total} logs`;
        }
        if (indicatorEl) indicatorEl.textContent = `Page ${auditFilterState.page} of ${totalPages}`;
        if (prevBtn) prevBtn.disabled = auditFilterState.page <= 1;
        if (nextBtn) nextBtn.disabled = auditFilterState.page >= totalPages;

        if (pageItems.length === 0) {
            container.innerHTML = `
                <tr>
                    <td colspan="8" class="px-6 py-8 text-center text-xs" style="color:var(--muted)">
                        <i class="fa-solid fa-magnifying-glass text-2xl mb-2 block opacity-40"></i>
                        No audit logs matched your active filter criteria.
                    </td>
                </tr>
            `;
            return;
        }

        const tmpl = Utils.$('template-log-row') as HTMLTemplateElement;
        if (!tmpl) return;

        container.innerHTML = '';
        pageItems.forEach(log => {
            const fragment = tmpl.content.cloneNode(true) as DocumentFragment;
            const tr = fragment.querySelector('.log-row') as HTMLElement;
            tr.setAttribute('data-log-id', log.id);

            const dateStr = new Date(log.timestamp).toLocaleString();
            fragment.querySelector('.log-date')!.textContent = dateStr;
            fragment.querySelector('.log-user')!.textContent = log.user;

            // Operation badge styling
            const opEl = fragment.querySelector('.log-op') as HTMLElement;
            opEl.textContent = log.operation;
            if (log.operation === 'DATASTORE_COPY') {
                opEl.className = 'badge text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/30';
            } else if (log.operation === 'DATASTORE_ANALYZE') {
                opEl.className = 'badge text-[10px] font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30';
            } else if (log.operation === 'DATASTORE_REVERT' || log.operation === 'QUERY_REVERT') {
                opEl.className = 'badge text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30';
            } else if (log.operation === 'DATASTORE_EDIT') {
                opEl.className = 'badge text-[10px] font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/30';
            } else {
                opEl.className = 'badge text-[10px] font-semibold bg-zinc-500/10 text-zinc-300 border border-zinc-500/30';
            }

            // Project Route pill
            const routeTd = fragment.querySelector('.log-src')?.closest('td');
            if (routeTd) {
                const hasRoute = log.srcProject && log.tgtProject && log.srcProject !== '—' && log.tgtProject !== '—';
                if (hasRoute) {
                    routeTd.innerHTML = `
                        <div class="audit-route-badge" title="${Utils.escapeHtml(log.srcProject)} → ${Utils.escapeHtml(log.tgtProject)}">
                            <span class="truncate max-w-[95px]">${Utils.escapeHtml(log.srcProject)}</span>
                            <i class="fa-solid fa-arrow-right-long audit-route-arrow"></i>
                            <span class="truncate max-w-[95px]">${Utils.escapeHtml(log.tgtProject)}</span>
                        </div>
                    `;
                } else {
                    routeTd.innerHTML = `<span class="mono text-[11px] text-[var(--muted)]">${Utils.escapeHtml(log.srcProject || log.tgtProject || '—')}</span>`;
                }
            }

            // Status Badge
            const statusBadge = fragment.querySelector('.log-status') as HTMLElement;
            statusBadge.textContent = log.status;
            if (log.status === 'SUCCESS') {
                statusBadge.className = 'badge text-[10px] font-semibold bg-green-500/10 text-green-400 border border-green-500/30';
            } else if (log.status === 'FAILED') {
                statusBadge.className = 'badge text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30';
            } else if (log.status === 'PARTIAL') {
                statusBadge.className = 'badge text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30';
            } else {
                statusBadge.className = 'badge text-[10px] font-semibold bg-zinc-500/10 text-zinc-400 border border-zinc-500/30';
            }

            // Details preview
            const detailsEl = fragment.querySelector('.log-details') as HTMLElement;
            const cleanSnippet = (log.details || '').split('\n')[0].slice(0, 110);
            detailsEl.innerHTML = `
                <div class="flex items-center justify-between gap-2">
                    <span class="truncate">${Utils.escapeHtml(cleanSnippet)}</span>
                    <span class="text-[9px] text-cyan-400 hover:underline flex-shrink-0 cursor-pointer">Inspect <i class="fa-solid fa-chevron-right text-[8px]"></i></span>
                </div>
            `;

            // Revert action button
            const revertTd = fragment.querySelector('.log-revert-td') as HTMLElement;
            let previousState = log.prevState;
            if (typeof previousState === 'string') {
                try { previousState = JSON.parse(previousState); } catch { previousState = null; }
            }
            if (previousState && previousState.type !== 'BQ_SCHEMA_SYNC') {
                const btn = document.createElement('button');
                btn.className = 'btn btn-s text-[10px] font-semibold flex items-center gap-1.5';
                btn.style.padding = '3px 8px';
                btn.style.background = 'rgba(245,158,11,0.12)';
                btn.style.borderColor = 'rgba(245,158,11,0.3)';
                btn.style.color = '#fbbf24';
                btn.setAttribute('data-log-id', log.id);
                btn.innerHTML = `<i class="fa-solid fa-rotate-left"></i> Revert`;

                btn.onclick = (e) => {
                    e.stopPropagation();
                    AuditLog.revertLog(log.id);
                };
                revertTd.appendChild(btn);
            } else {
                revertTd.innerHTML = `<span style="color:var(--muted); font-size:11px">—</span>`;
            }

            // Click row to toggle expansion
            tr.onclick = (e) => {
                const target = e.target as HTMLElement;
                if (target.closest('.btn-s')) return;
                AuditLog.toggleLogExpand(tr, log.id, cachedUserLogs);
            };

            container.appendChild(fragment);
        });
    },
    formatAuditTime: (ts: string) => {
        if (!ts) return { formatted: '—', ago: '—' };
        const date = new Date(ts);
        if (isNaN(date.getTime())) return { formatted: ts, ago: '—' };
        const formatted = date.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit'
        });
        const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
        let ago = 'just now';
        if (diffSec >= 86400) {
            ago = `${Math.floor(diffSec / 86400)}d ago`;
        } else if (diffSec >= 3600) {
            ago = `${Math.floor(diffSec / 3600)}h ago`;
        } else if (diffSec >= 60) {
            ago = `${Math.floor(diffSec / 60)}m ago`;
        }
        return { formatted, ago };
    },
    parseAuditPipeline: (log: any, state: any) => {
        const details = log.details || '';
        
        // Source
        let srcProject = log.srcProject && log.srcProject !== '—' ? log.srcProject : '';
        let srcDb = '(default)';
        const srcMatch = details.match(/Source:\s*([^\s(]+)(?:\s*\(database:\s*(\([^)]+\)|[^)]+)\))?/i);
        if (srcMatch) {
            if (!srcProject) srcProject = srcMatch[1];
            if (srcMatch[2]) srcDb = srcMatch[2];
        }
        if (state?.srcDb) srcDb = state.srcDb;

        // Target
        let tgtProject = log.tgtProject && log.tgtProject !== '—' ? log.tgtProject : '';
        let tgtDb = '(default)';
        const tgtMatch = details.match(/Target:\s*([^\s(]+)(?:\s*\(database:\s*(\([^)]+\)|[^)]+)\))?/i);
        if (tgtMatch) {
            if (!tgtProject) tgtProject = tgtMatch[1];
            if (tgtMatch[2]) tgtDb = tgtMatch[2];
        }
        if (state?.tgtDb || state?.dbId) tgtDb = state.tgtDb || state.dbId;

        // Rules
        const rules: any[] = [];
        const ruleRegex = /-\s*Rule\s*(\d+)\s*\[field\s*"([^"]+)"\]:\s*"([^"]+)"\s*->\s*"([^"]+)"/g;
        let rMatch: RegExpExecArray | null;
        while ((rMatch = ruleRegex.exec(details)) !== null) {
            rules.push({
                ruleNum: rMatch[1],
                field: rMatch[2],
                from: rMatch[3],
                to: rMatch[4]
            });
        }

        // Headline & status
        const firstLine = (details.split('\n')[0] || '').trim();
        const headline = firstLine || log.operation || 'Audit Operation';

        let writtenCount = 0;
        let failedCount = 0;
        const statusMatch = details.match(/Status:\s*(\d+)\s*entities written successfully\s*\((\d+)\s*failed\)/i);
        if (statusMatch) {
            writtenCount = parseInt(statusMatch[1], 10);
            failedCount = parseInt(statusMatch[2], 10);
        }

        let kinds: string[] = [];
        const kindsMatch = details.match(/across kinds:\s*([^.\n]+)/i);
        if (kindsMatch) {
            kinds = kindsMatch[1].split(',').map((s: string) => s.trim());
        } else if (Array.isArray(state?.kinds)) {
            kinds = state.kinds;
        } else if (state?.kind) {
            kinds = [state.kind];
        }

        // Items
        let items: any[] = [];
        if (state && Array.isArray(state.backupData) && state.backupData.length > 0) {
            items = state.backupData.map((bItem: any, idx: number) => {
                const isNew = bItem.action === 'delete' || bItem.action === 'CREATE' || bItem.action === 'CREATED';
                const refInfo = state.entityDisplayNames?.[bItem.keyStr];
                const displayName = refInfo ? `${refInfo.value} (${refInfo.fieldName})` : (bItem.displayName || '—');
                const prevStr = bItem.prevEntity ? JSON.stringify(bItem.prevEntity.properties || bItem.prevEntity, null, 2) : '';
                const entityKind = bItem.prevEntity?.key?.path?.[bItem.prevEntity.key.path.length - 1]?.kind || state.kind || 'Entity';
                return {
                    idx,
                    keyStr: bItem.keyStr,
                    kind: entityKind,
                    displayName,
                    action: isNew ? 'CREATED' : 'UPDATED',
                    prevStr,
                    hasPreState: Boolean(bItem.prevEntity)
                };
            });
        } else {
            const bulletRegex = /^[•\-*]\s*([^:\s]+):([^\s(]+)(?:\s*\(([^)]+)\))?\s*\[([A-Z]+)\]/gm;
            let bMatch: RegExpExecArray | null;
            let idx = 0;
            while ((bMatch = bulletRegex.exec(details)) !== null) {
                items.push({
                    idx: idx++,
                    kind: bMatch[1],
                    keyStr: `${bMatch[1]}:${bMatch[2]}`,
                    displayName: bMatch[3] || '—',
                    action: bMatch[4] || 'UPDATED',
                    prevStr: '',
                    hasPreState: false
                });
            }
        }

        // Single entity edit fallback
        if (items.length === 0 && log.operation === 'DATASTORE_EDIT') {
            const editMatch = details.match(/edited entity properties for\s*([^:\s]+):([^\s.]+)/i);
            if (editMatch) {
                items.push({
                    idx: 0,
                    kind: editMatch[1],
                    keyStr: `${editMatch[1]}:${editMatch[2]}`,
                    displayName: 'Inline Edited Property',
                    action: 'UPDATED',
                    prevStr: '',
                    hasPreState: false
                });
                if (kinds.length === 0) kinds.push(editMatch[1]);
            }
        }

        if (writtenCount === 0 && items.length > 0) {
            writtenCount = items.length;
        }

        return {
            srcProject,
            srcDb,
            tgtProject,
            tgtDb,
            rules,
            headline,
            writtenCount,
            failedCount,
            kinds,
            items
        };
    },
    toggleLogExpand: async (tr: HTMLElement, logId: string, logs: any[]) => {
        const existingNext = tr.nextElementSibling;
        if (existingNext && existingNext.classList.contains('expand-row')) {
            existingNext.remove();
            const icon = tr.querySelector('.btn-toggle-log i') as HTMLElement | null;
            if (icon) icon.style.transform = 'rotate(0deg)';
            return;
        }

        const log = logs.find(x => x.id === logId);
        if (!log) return;

        const isReversible = (log.operation === 'DATASTORE_COPY' || log.operation === 'DATASTORE_EDIT' || log.operation === 'QUERY_SYNC')
            && log.status !== 'FAILED'
            && log.status !== 'CANCELLED'
            && Boolean(log.tgtProject)
            && log.tgtProject !== '—';

        const expTr = document.createElement('tr');
        expTr.className = 'expand-row';
        expTr.style.background = 'rgba(10, 15, 26, 0.6)';

        let state = log.prevState;
        if (state) {
            try {
                state = await AuditLog.resolvePrevState(log.id, state);
            } catch (e) {
                console.error("Failed to load backup data", e);
            }
        }

        const pipeline = AuditLog.parseAuditPipeline(log, state);
        const timeInfo = AuditLog.formatAuditTime(log.timestamp);
        const statusBadgeClass = log.status === 'SUCCESS' ? 'badge text-[10px] font-semibold bg-green-500/10 text-green-400 border border-green-500/30' : (log.status === 'FAILED' ? 'badge text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30' : 'badge text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30');
        const totalCount = pipeline.writtenCount || pipeline.items.length || 0;

        let itemsSectionHtml = '';
        if (state && state.type === 'QUERY_SYNC') {
            const qRows = (state.backupData || []).map((item: any) => {
                const prevStr = item.prevQuery ? JSON.stringify(item.prevQuery, null, 2) : '—';
                const newStr = item.newQuery ? JSON.stringify(item.newQuery, null, 2) : '—';
                return `
                    <div class="p-3 mb-2 rounded-lg border border-zinc-700/60" style="background:rgba(0,0,0,0.3)">
                        <div class="font-semibold text-xs text-[var(--fg)] mb-2">Query: ${Utils.escapeHtml(item.displayName || item.name)} (${Utils.escapeHtml(item.action)})</div>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                                <div class="text-[10px] font-bold text-[var(--muted)] mb-1 uppercase tracking-wider">PREVIOUS CONFIGURATION:</div>
                                <pre style="padding: 8px 10px; border-radius: 6px; font-family: var(--font-mono); font-size: 10px; max-height: 140px; overflow-y: auto; background: var(--bg); color: var(--ok); border: 1px solid var(--brd); white-space: pre-wrap; margin:0">${Utils.escapeHtml(prevStr)}</pre>
                            </div>
                            <div>
                                <div class="text-[10px] font-bold text-[var(--muted)] mb-1 uppercase tracking-wider">NEW CONFIGURATION:</div>
                                <pre style="padding: 8px 10px; border-radius: 6px; font-family: var(--font-mono); font-size: 10px; max-height: 140px; overflow-y: auto; background: var(--bg); color: var(--ok); border: 1px solid var(--brd); white-space: pre-wrap; margin:0">${Utils.escapeHtml(newStr)}</pre>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
            itemsSectionHtml = `
                <div class="mb-3">
                    <div class="font-bold text-xs text-[var(--fg)] mb-2 flex items-center gap-1.5">
                        <i class="fa-solid fa-clock-rotate-left text-cyan-400"></i> Scheduled Query Config Changes
                    </div>
                    ${qRows}
                </div>
            `;
        } else if (pipeline.items.length > 0) {
            const entityRows = pipeline.items.map((item: any) => {
                const isNew = item.action === 'CREATED';
                const actionBadge = isNew
                    ? `<span class="badge text-[10px] font-semibold bg-green-500/15 text-green-400 border border-green-500/30">🟢 CREATED</span>`
                    : (item.action === 'DELETED'
                        ? `<span class="badge text-[10px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">🔴 DELETED</span>`
                        : `<span class="badge text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">🟡 UPDATED</span>`);

                return `
                    <tr>
                        <td class="mono font-semibold" style="width: 35px; color:var(--muted)">#${item.idx + 1}</td>
                        <td style="width: 120px;"><span class="badge font-mono text-[10px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/25">${Utils.escapeHtml(item.kind)}</span></td>
                        <td>
                            <span class="mono font-semibold audit-clickable-key cursor-pointer" data-key="${Utils.escapeHtml(item.keyStr)}" title="Click to copy key" style="color:var(--fg);">
                                ${Utils.escapeHtml(item.keyStr)} <i class="fa-regular fa-copy text-[10px] text-[var(--muted)] ml-1"></i>
                            </span>
                        </td>
                        <td style="color:#67e8f9;">${Utils.escapeHtml(item.displayName)}</td>
                        <td style="width: 110px;">${actionBadge}</td>
                        <td style="width: 95px; text-align:right;">
                            <button class="btn btn-s text-[10px] py-1 px-2 btn-view-entity-json whitespace-nowrap" data-idx="${item.idx}">
                                <i class="fa-solid fa-code"></i> Snapshot
                            </button>
                        </td>
                    </tr>
                    <tr id="entity-json-row-${log.id}-${item.idx}" style="display:none; background:rgba(0,0,0,0.3)">
                        <td colspan="6" class="p-3">
                            <div class="flex items-center justify-between mb-1.5 text-[10px] text-[var(--muted)] font-semibold uppercase tracking-wider">
                                <span>PRE-MUTATION STATE (TARGET ENTITY SNAPSHOT):</span>
                                <button class="btn btn-s text-[9px] py-0.5 px-2 btn-copy-entity-json" data-json="${encodeURIComponent(item.prevStr)}">
                                    <i class="fa-regular fa-copy"></i> Copy JSON
                                </button>
                            </div>
                            <pre style="padding: 8px 12px; border-radius: 6px; font-family: var(--font-mono); font-size: 10px; max-height: 150px; overflow-y: auto; background: var(--bg); color: #34d399; border: 1px solid var(--brd); white-space: pre-wrap; margin:0">${Utils.escapeHtml(item.prevStr || (isNew ? 'No pre-mutation target snapshot recorded (entity was newly created).' : 'Snapshot preserved in target audit log.'))}</pre>
                        </td>
                    </tr>
                `;
            }).join('');

            itemsSectionHtml = `
                <div class="mb-3">
                    <div class="flex items-center justify-between mb-2">
                        <div class="flex items-center gap-2">
                            <span class="font-bold text-xs text-[var(--fg)]"><i class="fa-solid fa-layer-group text-cyan-400 mr-1"></i> Itemized Entity Mutations</span>
                            <span class="badge text-[10px] bg-zinc-800 text-zinc-300">${pipeline.items.length} records</span>
                        </div>
                    </div>
                    <div class="audit-entity-table-wrapper">
                        <table class="audit-entity-table" style="width:100%; min-width:620px;">
                            <thead>
                                <tr>
                                    <th style="width: 35px;">#</th>
                                    <th style="width: 120px;">Kind</th>
                                    <th>Entity Key ID</th>
                                    <th>Display / Reference Name</th>
                                    <th style="width: 110px;">Action</th>
                                    <th style="width: 95px; text-align:right;">Snapshot</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${entityRows}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }

        expTr.innerHTML = `
            <td colspan="8" class="p-3" style="background:var(--bg2); max-width:100%; box-sizing:border-box;">
                <div class="audit-expanded-card">
                    <!-- 1. Top Telemetry & Action Bar (Zero clipping) -->
                    <div class="flex flex-wrap items-center justify-between gap-3 pb-3 mb-3 border-b border-zinc-700/60">
                        <div class="flex flex-wrap items-center gap-4">
                            <div class="flex items-center gap-1.5">
                                <div>
                                    <span class="text-[9px] font-bold uppercase text-[var(--muted)] tracking-wider block">LOG ID</span>
                                    <span class="mono text-xs font-semibold text-cyan-400">${Utils.escapeHtml(log.id)}</span>
                                </div>
                                <button class="btn-copy-log-id text-[var(--muted)] hover:text-cyan-400 cursor-pointer p-1 text-[11px]" data-id="${log.id}" title="Copy Log ID">
                                    <i class="fa-regular fa-copy"></i>
                                </button>
                            </div>
                            <div>
                                <span class="text-[9px] font-bold uppercase text-[var(--muted)] tracking-wider block">TIMESTAMP</span>
                                <span class="text-xs text-[var(--fg)]" title="${new Date(log.timestamp).toISOString()}">
                                    ${Utils.escapeHtml(timeInfo.formatted)} <span class="text-[var(--muted)] text-[10px]">(${Utils.escapeHtml(timeInfo.ago)})</span>
                                </span>
                            </div>
                            <div>
                                <span class="text-[9px] font-bold uppercase text-[var(--muted)] tracking-wider block">OPERATOR</span>
                                <span class="text-xs font-semibold text-[var(--fg)] flex items-center gap-1.5">
                                    <i class="fa-solid fa-circle-user text-[var(--muted)]"></i> ${Utils.escapeHtml(log.user || '—')}
                                </span>
                            </div>
                        </div>
                        <div class="flex items-center gap-2 flex-shrink-0">
                            <button class="btn btn-s text-xs btn-copy-log-id whitespace-nowrap" data-id="${log.id}">
                                <i class="fa-regular fa-copy mr-1"></i> Copy Log ID
                            </button>
                            ${isReversible ? `
                            <button class="btn btn-s text-xs btn-revert-from-expand whitespace-nowrap" data-id="${log.id}" style="color:#fbbf24; border-color:rgba(245,158,11,0.4); background:rgba(245,158,11,0.1); font-weight:700;">
                                <i class="fa-solid fa-rotate-left mr-1"></i> Revert Operation
                            </button>` : ''}
                        </div>
                    </div>

                    <!-- 2. Concept 3: Modern Interactive Node Flow -->
                    <div class="audit-node-grid">
                        <!-- Source Node -->
                        <div class="audit-node-box">
                            <div>
                                <div class="audit-node-header">
                                    <span><i class="fa-solid fa-box text-blue-400 mr-1"></i> Source Project</span>
                                    <span class="badge text-[9px] bg-zinc-800 text-zinc-300 font-mono">db: ${Utils.escapeHtml(pipeline.srcDb)}</span>
                                </div>
                                <div class="mono font-semibold text-xs text-[var(--fg)] audit-clickable-key cursor-pointer break-all" data-key="${Utils.escapeHtml(pipeline.srcProject || '')}" title="Click to copy project ID">
                                    ${Utils.escapeHtml(pipeline.srcProject || '—')}
                                    ${pipeline.srcProject ? '<i class="fa-regular fa-copy text-[10px] text-[var(--muted)] ml-1"></i>' : ''}
                                </div>
                            </div>
                        </div>

                        <!-- Transform Node -->
                        <div class="audit-node-box">
                            <div>
                                <div class="audit-node-header">
                                    <span><i class="fa-solid fa-gear text-cyan-400 mr-1"></i> Transformation</span>
                                    <span class="badge text-[9px] ${pipeline.rules.length > 0 ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' : 'bg-zinc-800 text-zinc-300'}">
                                        ${pipeline.rules.length} Rule(s)
                                    </span>
                                </div>
                                ${pipeline.rules.length > 0 ? `
                                    <div class="text-xs text-[var(--fg)]">
                                        ${pipeline.rules.map((r: any) => `
                                            <div class="mt-1">
                                                <span class="text-[var(--muted)] text-[10px]">Scope [${Utils.escapeHtml(r.field)}]:</span>
                                                <div class="mono text-[10px] mt-0.5 break-all">
                                                    <span class="text-rose-400 line-through">${Utils.escapeHtml(r.from)}</span>
                                                    <i class="fa-solid fa-arrow-right text-[9px] text-[var(--muted)] mx-1"></i>
                                                    <span class="text-emerald-400 font-semibold">${Utils.escapeHtml(r.to)}</span>
                                                </div>
                                            </div>
                                        `).join('')}
                                    </div>
                                ` : `
                                    <div class="text-xs text-[var(--muted)] mt-1">Direct Pass-Through (No string replacements applied)</div>
                                `}
                            </div>
                        </div>

                        <!-- Target Node -->
                        <div class="audit-node-box">
                            <div>
                                <div class="audit-node-header">
                                    <span><i class="fa-solid fa-bullseye text-emerald-400 mr-1"></i> Target Project</span>
                                    <span class="badge text-[9px] bg-zinc-800 text-zinc-300 font-mono">db: ${Utils.escapeHtml(pipeline.tgtDb)}</span>
                                </div>
                                <div class="mono font-semibold text-xs text-[var(--fg)] audit-clickable-key cursor-pointer break-all" data-key="${Utils.escapeHtml(pipeline.tgtProject || '')}" title="Click to copy project ID">
                                    ${Utils.escapeHtml(pipeline.tgtProject || '—')}
                                    ${pipeline.tgtProject && pipeline.tgtProject !== '—' ? '<i class="fa-regular fa-copy text-[10px] text-[var(--muted)] ml-1"></i>' : ''}
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 3. Execution Result Banner -->
                    <div class="audit-banner-bar">
                        <div class="flex flex-wrap items-center gap-2.5">
                            <span class="${statusBadgeClass}">● ${Utils.escapeHtml(log.status)}</span>
                            <span class="text-xs font-semibold text-[var(--fg)]">${Utils.escapeHtml(pipeline.headline)}</span>
                        </div>
                        <div class="flex items-center gap-2">
                            ${pipeline.kinds.length > 0 ? `<span class="badge text-[10px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/25 font-mono">Kind: ${Utils.escapeHtml(pipeline.kinds.join(', '))}</span>` : ''}
                            <span class="badge text-[10px] bg-zinc-800 text-zinc-300">${totalCount} Processed</span>
                        </div>
                    </div>

                    <!-- 4. Itemized Mutations Table -->
                    ${itemsSectionHtml}

                    <!-- 5. Collapsible Raw Audit Log Details -->
                    <details class="mt-3 rounded-lg border border-zinc-700/60" style="background:rgba(0,0,0,0.25)">
                        <summary class="p-2.5 text-[10px] font-bold uppercase text-[var(--muted)] tracking-wider cursor-pointer select-none">
                            <i class="fa-solid fa-terminal mr-1"></i> View Raw Audit Log Details
                        </summary>
                        <div class="p-3 text-xs leading-relaxed text-[var(--muted)] whitespace-pre-wrap border-t border-zinc-700/60" style="background:rgba(0,0,0,0.3)">${Utils.escapeHtml(log.details)}</div>
                    </details>
                </div>
            </td>
        `;

        // Wire up event listeners
        expTr.querySelectorAll('.btn-copy-log-id').forEach(btn => {
            (btn as HTMLElement).onclick = (e) => {
                e.stopPropagation();
                const id = (btn as HTMLElement).dataset.id || '';
                navigator.clipboard.writeText(id).then(() => {
                    Utils.toast('Copied Log ID to clipboard', 'ok');
                }).catch(() => {
                    Utils.toast('Could not copy to clipboard', 'err');
                });
            };
        });

        expTr.querySelectorAll('.btn-revert-from-expand').forEach(btn => {
            (btn as HTMLElement).onclick = (e) => {
                e.stopPropagation();
                const id = (btn as HTMLElement).dataset.id || '';
                if (id) AuditLog.revertLog(id);
            };
        });

        expTr.querySelectorAll('.audit-clickable-key').forEach(el => {
            (el as HTMLElement).onclick = (e) => {
                e.stopPropagation();
                const key = (el as HTMLElement).dataset.key || '';
                if (key) {
                    navigator.clipboard.writeText(key).then(() => {
                        Utils.toast(`Copied: ${key}`, 'ok');
                    });
                }
            };
        });

        expTr.querySelectorAll('.btn-view-entity-json').forEach(btn => {
            (btn as HTMLElement).onclick = (e) => {
                e.stopPropagation();
                const idx = (btn as HTMLElement).dataset.idx;
                const jsonRow = expTr.querySelector(`#entity-json-row-${log.id}-${idx}`) as HTMLElement | null;
                if (jsonRow) {
                    jsonRow.style.display = jsonRow.style.display === 'none' ? '' : 'none';
                }
            };
        });

        expTr.querySelectorAll('.btn-copy-entity-json').forEach(btn => {
            (btn as HTMLElement).onclick = (e) => {
                e.stopPropagation();
                const jsonStr = decodeURIComponent((btn as HTMLElement).dataset.json || '');
                navigator.clipboard.writeText(jsonStr).then(() => {
                    Utils.toast('Entity snapshot JSON copied', 'ok');
                });
            };
        });

        tr.after(expTr);
        const icon = tr.querySelector('.btn-toggle-log i') as HTMLElement | null;
        if (icon) icon.style.transform = 'rotate(90deg)';
    },
    parseItemizedFromDetails: (details: string): any[] => {
        if (!details || typeof details !== 'string') return [];
        const results: any[] = [];
        const lines = details.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            const m = /^[•\-\*]\s*([^:(]+?):([^(\s]+)(?:\s*\((.*?)\))?\s*\[(.*?)\]/.exec(trimmed);
            if (m) {
                const kind = m[1].trim();
                const keyId = m[2].trim();
                const displayName = m[3] ? m[3].trim() : '—';
                const action = m[4] ? m[4].trim().toUpperCase() : 'UPDATED';
                results.push({
                    kind,
                    keyStr: `${kind}:${keyId}`,
                    displayName,
                    action
                });
            }
        }
        return results;
    }
};

let cachedUserLogs: any[] = [];
let auditUiInitialized = false;
const auditFilterState = {
    search: '',
    op: 'ALL',
    dateRange: 'ALL',
    status: 'ALL',
    page: 1,
    pageSize: 25
};

