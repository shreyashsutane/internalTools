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
    readLogs: async (): Promise<any[]> => {
        try {
            if (!State.token) return [];
            const data = await AuditLog.request(
                `${CONFIG.FIRESTORE_AUDIT_LOG_URL}/runQuery`,
                { limit: 500 }
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
            if (prepared.chunks) {
                const completeManifest = await AuditLog.persistChunks(result.id, prepared);
                await AuditLog.request(`${CONFIG.FIRESTORE_AUDIT_LOG_URL}/update`, {
                    id: result.id,
                    status: status || 'SUCCESS',
                    details: details || '',
                    prevState: completeManifest
                });
            }
            if (!skipRender) {
                await AuditLog.renderLogs();
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
            if (prevState !== undefined) {
                const prepared = prevState ? await preparePrevState(prevState) : { inline: null };
                body.prevState = await AuditLog.persistChunks(id, prepared);
            }
            await AuditLog.request(`${CONFIG.FIRESTORE_AUDIT_LOG_URL}/update`, body);
            if (!skipRender) {
                await AuditLog.renderLogs();
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
        const logs = await AuditLog.readLogs();
        const log = logs.find(x => x.id === logId);
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
    renderLogs: async (forceFetch = true): Promise<void> => {
        const container = Utils.$('audit-table-body');
        if (!container) return;

        if (forceFetch || cachedUserLogs.length === 0) {
            container.innerHTML = `
                <tr>
                    <td colspan="8" class="px-6 py-8 text-center text-xs" style="color:var(--muted)">
                        <i class="fa-solid fa-spinner fa-spin text-xl mb-2 block text-cyan-400"></i>
                        Loading operations audit trail from Firestore...
                    </td>
                </tr>
            `;
            cachedUserLogs = await AuditLog.readLogs();
            AuditLog.updateStats(cachedUserLogs);
        }

        AuditLog.initControls();
        AuditLog.renderCurrentPage();
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

        const expTr = document.createElement('tr');
        expTr.className = 'expand-row';
        expTr.style.background = 'rgba(10, 15, 26, 0.7)';

        let stateDetailsHtml = '';
        if (log.prevState) {
            let state = log.prevState;
            try {
                state = await AuditLog.resolvePrevState(log.id, state);
            } catch (e) {
                console.error("Failed to load backup data", e);
            }

            if (state && typeof state === 'object') {
                if (state.type === 'DATASTORE_COPY') {
                    const items = state.backupData || [];
                    const kindsLabel = Array.isArray(state.kinds) && state.kinds.length > 0
                        ? state.kinds.join(', ')
                        : (state.kind || 'all');

                    const rows = items.map((item: any, idx: number) => {
                        const isNew = item.action === 'delete' || item.action === 'CREATE' || item.action === 'CREATED';
                        const actionBadge = isNew
                            ? `<span class="badge text-[10px] font-semibold bg-green-500/15 text-green-400 border border-green-500/30">🟢 CREATED</span>`
                            : `<span class="badge text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">🟡 UPDATED</span>`;

                        const refInfo = state.entityDisplayNames?.[item.keyStr];
                        const displayName = refInfo ? `${refInfo.value} (${refInfo.fieldName})` : '—';
                        const prevStr = item.prevEntity ? JSON.stringify(item.prevEntity.properties || item.prevEntity, null, 2) : '—';
                        const entityKind = item.prevEntity?.key?.path?.[item.prevEntity.key.path.length - 1]?.kind || state.kind || 'Entity';

                        return `
                            <tr>
                                <td class="mono font-semibold" style="width: 35px; color:var(--muted)">#${idx + 1}</td>
                                <td style="width: 130px;"><span class="badge font-mono text-[10px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/25">${Utils.escapeHtml(entityKind)}</span></td>
                                <td class="mono font-semibold" style="color:var(--fg);">${Utils.escapeHtml(item.keyStr)}</td>
                                <td style="color:#67e8f9;">${Utils.escapeHtml(displayName)}</td>
                                <td style="width: 120px;">${actionBadge}</td>
                                <td style="width: 110px; text-align:right;">
                                    <button class="btn btn-s text-[10px] py-1 px-2 btn-view-entity-json" data-idx="${idx}">
                                        <i class="fa-solid fa-code"></i> Snapshot
                                    </button>
                                </td>
                            </tr>
                            <tr id="entity-json-row-${log.id}-${idx}" style="display:none; background:rgba(0,0,0,0.3)">
                                <td colspan="6" class="p-3">
                                    <div class="flex items-center justify-between mb-1 text-[10px] text-[var(--muted)]">
                                        <span>PRE-MUTATION STATE (TARGET ENTITY SNAPSHOT):</span>
                                        <button class="btn btn-s text-[9px] py-0.5 px-1.5 btn-copy-entity-json" data-json="${encodeURIComponent(prevStr)}">
                                            <i class="fa-regular fa-copy"></i> Copy JSON
                                        </button>
                                    </div>
                                    <pre style="padding: 8px 12px; border-radius: 6px; font-family: var(--font-mono); font-size: 10px; max-height: 140px; overflow-y: auto; background: var(--bg); color: #34d399; border: 1px solid var(--brd); white-space: pre-wrap; margin:0">${Utils.escapeHtml(prevStr)}</pre>
                                </td>
                            </tr>
                        `;
                    }).join('');

                    stateDetailsHtml = `
                        <div class="mt-4 pt-3 border-t border-zinc-700/60">
                            <div class="flex items-center justify-between mb-3">
                                <div class="flex items-center gap-2">
                                    <span class="font-bold text-xs text-[var(--fg)]"><i class="fa-solid fa-layer-group text-cyan-400 mr-1"></i> Itemized Entity Mutations</span>
                                    <span class="badge text-[10px] bg-zinc-800 text-zinc-300">Kind: ${Utils.escapeHtml(kindsLabel)}</span>
                                    <span class="badge text-[10px] bg-zinc-800 text-zinc-300">${items.length} records</span>
                                </div>
                            </div>
                            <div class="overflow-x-auto rounded-lg border border-zinc-700/60">
                                <table class="audit-entity-table">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>KIND</th>
                                            <th>ENTITY KEY ID</th>
                                            <th>DISPLAY / REFERENCE NAME</th>
                                            <th>ACTION</th>
                                            <th style="text-align:right;">PAYLOAD</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${items.length > 0 ? rows : '<tr><td colspan="6" class="p-4 text-center text-muted">No entity records in this batch.</td></tr>'}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    `;
                } else if (state.type === 'QUERY_SYNC') {
                    const rows = (state.backupData || []).map((item: any) => {
                        const prevStr = item.prevQuery ? JSON.stringify(item.prevQuery, null, 2) : '—';
                        const newStr = item.newQuery ? JSON.stringify(item.newQuery, null, 2) : '—';
                        return `
                            <div class="p-3 mb-2 rounded-lg border border-zinc-700/60" style="background:rgba(0,0,0,0.2)">
                                <div class="font-semibold text-xs text-fg mb-2">Query: ${Utils.escapeHtml(item.displayName || item.name)} (${item.action})</div>
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div>
                                        <div class="text-[10px] font-bold text-muted mb-1">PREVIOUS CONFIGURATION:</div>
                                        <pre style="padding: 8px 10px; border-radius: 6px; font-family: var(--font-mono); font-size: 10px; max-height: 140px; overflow-y: auto; background: var(--bg); color: var(--ok); border: 1px solid var(--brd); white-space: pre-wrap; margin:0">${Utils.escapeHtml(prevStr)}</pre>
                                    </div>
                                    <div>
                                        <div class="text-[10px] font-bold text-muted mb-1">NEW CONFIGURATION:</div>
                                        <pre style="padding: 8px 10px; border-radius: 6px; font-family: var(--font-mono); font-size: 10px; max-height: 140px; overflow-y: auto; background: var(--bg); color: var(--ok); border: 1px solid var(--brd); white-space: pre-wrap; margin:0">${Utils.escapeHtml(newStr)}</pre>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('');
                    stateDetailsHtml = `<div class="mt-4 pt-3 border-t border-zinc-700/60">${rows}</div>`;
                } else if (state.type === 'BQ_SCHEMA_SYNC') {
                    const rows = (state.backupData || []).map((item: any) => {
                        const prevStr = item.prevSchema ? JSON.stringify(item.prevSchema, null, 2) : '—';
                        return `
                            <div class="p-3 mb-2 rounded-lg border border-zinc-700/60" style="background:rgba(0,0,0,0.2)">
                                <div class="font-semibold text-xs text-fg mb-2">Table: ${Utils.escapeHtml(item.tablePath)} (${item.action})</div>
                                <div>
                                    <div class="text-[10px] font-bold text-muted mb-1">PREVIOUS SCHEMA:</div>
                                    <pre style="padding: 8px 10px; border-radius: 6px; font-family: var(--font-mono); font-size: 10px; max-height: 140px; overflow-y: auto; background: var(--bg); color: var(--ok); border: 1px solid var(--brd); white-space: pre-wrap; margin:0">${Utils.escapeHtml(prevStr)}</pre>
                                </div>
                            </div>
                        `;
                    }).join('');
                    stateDetailsHtml = `<div class="mt-4 pt-3 border-t border-zinc-700/60">${rows}</div>`;
                }
            }
        }

        // Full expanded details block
        expTr.innerHTML = `
            <td colspan="8" class="px-6 py-4" style="background:var(--bg2)">
                <div class="flex flex-col gap-3 text-left">
                    <!-- Top Telemetry Row -->
                    <div class="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border border-zinc-700/60" style="background:rgba(0,0,0,0.2)">
                        <div class="flex flex-wrap items-center gap-4">
                            <div>
                                <span class="text-[10px] font-bold uppercase text-[var(--muted)] block">LOG DOCUMENT ID</span>
                                <span class="mono text-xs font-semibold text-cyan-400">${log.id}</span>
                            </div>
                            <div>
                                <span class="text-[10px] font-bold uppercase text-[var(--muted)] block">TIMESTAMP</span>
                                <span class="mono text-xs text-[var(--fg)]">${new Date(log.timestamp).toISOString()}</span>
                            </div>
                            <div>
                                <span class="text-[10px] font-bold uppercase text-[var(--muted)] block">AUTHENTICATED OPERATOR</span>
                                <span class="text-xs font-semibold text-[var(--fg)]">${Utils.escapeHtml(log.user)}</span>
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            <button class="btn btn-s text-xs btn-copy-log-id" data-id="${log.id}">
                                <i class="fa-regular fa-copy mr-1"></i> Copy Log ID
                            </button>
                        </div>
                    </div>

                    <!-- Details description card -->
                    <div class="p-3 rounded-lg border border-zinc-700/60" style="background:rgba(0,0,0,0.2)">
                        <span class="text-[10px] font-bold uppercase text-[var(--muted)] block mb-1">EXECUTIVE SUMMARY</span>
                        <div class="text-xs leading-relaxed text-[var(--fg)] whitespace-pre-wrap">${Utils.escapeHtml(log.details)}</div>
                    </div>

                    <!-- Itemized state mutations -->
                    ${stateDetailsHtml}
                </div>
            </td>
        `;

        // Wire up copy log id and snapshot buttons inside the expanded row
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

