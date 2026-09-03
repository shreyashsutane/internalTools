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
    renderLogs: async (): Promise<void> => {
        const container = Utils.$('audit-table-body');
        if (!container) return;
        const logs = await AuditLog.readLogs();
        if (logs.length === 0) {
            container.innerHTML = `
                <tr>
                    <td colspan="8" class="px-6 py-8 text-center text-xs" style="color:var(--muted)">
                        <i class="fa-solid fa-folder-open text-2xl mb-2 block"></i>
                        No audit logs recorded for this user yet.
                    </td>
                </tr>
            `;
            return;
        }

        const tmpl = Utils.$('template-log-row') as HTMLTemplateElement;
        if (!tmpl) return;

        container.innerHTML = '';
        logs.forEach(log => {
            const fragment = tmpl.content.cloneNode(true) as DocumentFragment;
            const tr = fragment.querySelector('.log-row') as HTMLElement;
            tr.setAttribute('data-log-id', log.id);

            const dateStr = new Date(log.timestamp).toLocaleString();
            fragment.querySelector('.log-date')!.textContent = dateStr;
            fragment.querySelector('.log-user')!.textContent = log.user;
            fragment.querySelector('.log-op')!.textContent = log.operation;
            fragment.querySelector('.log-src')!.textContent = log.srcProject;
            fragment.querySelector('.log-tgt')!.textContent = log.tgtProject;

            const statusClass = log.status === 'SUCCESS' ? 'var(--ok)' : (log.status === 'PARTIAL' ? 'var(--warn)' : 'var(--danger)');
            const statusBg = log.status === 'SUCCESS' ? 'var(--ok-dim)' : (log.status === 'PARTIAL' ? 'var(--warn-dim)' : 'var(--danger-dim)');
            const statusBadge = fragment.querySelector('.log-status') as HTMLElement;
            statusBadge.textContent = log.status;
            statusBadge.style.color = statusClass;
            statusBadge.style.background = statusBg;

            fragment.querySelector('.log-details')!.textContent = log.details;

            const revertTd = fragment.querySelector('.log-revert-td') as HTMLElement;
            let previousState = log.prevState;
            if (typeof previousState === 'string') {
                try { previousState = JSON.parse(previousState); } catch { previousState = null; }
            }
            if (previousState && previousState.type !== 'BQ_SCHEMA_SYNC') {
                const btn = document.createElement('button');
                btn.className = 'btn btn-s btn-revert-log text-[10px]';
                btn.style.padding = '2px 6px';
                btn.style.fontWeight = '600';
                btn.setAttribute('data-log-id', log.id);
                btn.innerHTML = `<i class="fa-solid fa-rotate-left"></i> Revert`;

                // Dynamic event handler mapping instead of inline onclick
                btn.onclick = (e) => {
                    e.stopPropagation();
                    AuditLog.revertLog(log.id);
                };
                revertTd.appendChild(btn);
            } else {
                revertTd.textContent = '—';
            }

            // Row toggle details view listener
            tr.onclick = (e) => {
                const target = e.target as HTMLElement;
                if (target.closest('.btn-revert-log')) return;
                AuditLog.toggleLogExpand(tr, log.id, logs);
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
        expTr.style.background = 'rgba(13, 20, 30, 0.4)';

        const statusClass = log.status === 'SUCCESS' ? 'var(--ok)' : (log.status === 'PARTIAL' ? 'var(--warn)' : 'var(--danger)');
        const statusBg = log.status === 'SUCCESS' ? 'var(--ok-dim)' : (log.status === 'PARTIAL' ? 'var(--warn-dim)' : 'var(--danger-dim)');

        let stateDetailsHtml = '';
        if (log.prevState) {
            let state = log.prevState;
            try {
                state = await AuditLog.resolvePrevState(log.id, state);
            } catch (e) {
                console.error("Failed to load backup data", e);
            }

            if (state && typeof state === 'object') {
                stateDetailsHtml += `
                    <div style="margin-top: 20px; border-top: 1px solid var(--brd); padding-top: 18px;">
                        <div style="font-weight: 700; font-size: 11px; margin-bottom: 14px; color: var(--accent2); display: flex; align-items: center; justify-content: space-between;">
                            <span style="display: flex; align-items: center; gap: 6px;"><i class="fa-solid fa-arrows-left-right"></i> Backup State Changes & Copied Entities</span>
                            ${state.kind ? `<span class="badge" style="background:var(--brd2); color:var(--accent2); font-size:10px;">Kind: ${Utils.escapeHtml(state.kind)} (${(state.backupData || []).length} entities)</span>` : ''}
                        </div>
                `;

                if (state.type === 'BQ_SCHEMA_SYNC') {
                    const rows = (state.backupData || []).map((item: any) => {
                        const prevStr = item.prevSchema ? JSON.stringify(item.prevSchema, null, 2) : '—';
                        return `
                            <div style="margin-bottom: 18px; border-bottom: 1px solid var(--brd); padding-bottom: 14px;">
                                <div style="font-weight: 600; color: var(--fg); margin-bottom: 8px; font-size: 11px;">Table: ${Utils.escapeHtml(item.tablePath)} (${item.action})</div>
                                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 15px;">
                                    <div>
                                        <div style="font-size: 9px; color: var(--muted); font-weight: 600; margin-bottom: 5px;">PREVIOUS SCHEMA:</div>
                                        <pre style="padding: 10px; border-radius: 8px; font-family: var(--font-mono); font-size: 10px; max-height: 160px; overflow-y: auto; background: var(--bg); color: var(--ok); border: 1px solid var(--brd); white-space: pre-wrap; margin:0">${Utils.escapeHtml(prevStr)}</pre>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('');
                    stateDetailsHtml += `<div>${rows}</div>`;
                } else if (state.type === 'QUERY_SYNC') {
                    const rows = (state.backupData || []).map((item: any) => {
                        const prevStr = item.prevQuery ? JSON.stringify(item.prevQuery, null, 2) : '—';
                        const newStr = item.newQuery ? JSON.stringify(item.newQuery, null, 2) : '—';
                        return `
                            <div style="margin-bottom: 18px; border-bottom: 1px solid var(--brd); padding-bottom: 14px;">
                                <div style="font-weight: 600; color: var(--fg); margin-bottom: 8px; font-size: 11px;">Query: ${Utils.escapeHtml(item.displayName || item.name)} (${item.action})</div>
                                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 15px;">
                                    <div>
                                        <div style="font-size: 9px; color: var(--muted); font-weight: 600; margin-bottom: 5px;">PREVIOUS CONFIG:</div>
                                        <pre style="padding: 10px; border-radius: 8px; font-family: var(--font-mono); font-size: 10px; max-height: 160px; overflow-y: auto; background: var(--bg); color: var(--ok); border: 1px solid var(--brd); white-space: pre-wrap; margin:0">${Utils.escapeHtml(prevStr)}</pre>
                                    </div>
                                    <div>
                                        <div style="font-size: 9px; color: var(--muted); font-weight: 600; margin-bottom: 5px;">NEW CONFIG:</div>
                                        <pre style="padding: 10px; border-radius: 8px; font-family: var(--font-mono); font-size: 10px; max-height: 160px; overflow-y: auto; background: var(--bg); color: var(--ok); border: 1px solid var(--brd); white-space: pre-wrap; margin:0">${Utils.escapeHtml(newStr)}</pre>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('');
                    stateDetailsHtml += `<div>${rows}</div>`;
                } else if (state.type === 'DATASTORE_COPY') {
                    const items = state.backupData || [];
                    const rows = items.map((item: any, idx: number) => {
                        const prevStr = item.prevEntity ? JSON.stringify(item.prevEntity.properties || item.prevEntity, null, 2) : '—';
                        const actionColor = item.action === 'upsert' ? 'var(--warn)' : 'var(--ok)';
                        const actionLabel = item.action === 'upsert' ? 'OVERWRITTEN (Restorable)' : 'NEW ENTITY (Deletable on Revert)';
                        const refInfo = state.entityDisplayNames?.[item.keyStr];
                        const refBadge = refInfo ? `<span class="badge" style="background:rgba(0,212,255,0.15); color:var(--accent2); font-size:9px; border:1px solid rgba(0,212,255,0.3); margin-left:6px;"><span style="color:var(--muted); margin-right:3px;">${Utils.escapeHtml(refInfo.fieldName)}:</span>"${Utils.escapeHtml(refInfo.value)}"</span>` : '';
                        
                        // Extract kind from entity key path if present
                        const entityKind = item.prevEntity?.key?.path?.[item.prevEntity.key.path.length - 1]?.kind || '';
                        const kindBadge = entityKind ? `<span class="badge" style="background:var(--accent-dim); color:var(--accent); font-size:9px; border:1px solid var(--accent); margin-right:6px;"><i class="fa-solid fa-folder-tree" style="margin-right:2px;"></i>${Utils.escapeHtml(entityKind)}</span>` : '';

                        return `
                            <div style="margin-bottom: 12px; border-bottom: 1px solid var(--brd); padding-bottom: 10px;">
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                                    <div style="font-weight: 600; color: var(--fg); font-size: 11px; font-family: var(--font-mono); display:flex; align-items:center;">
                                        ${kindBadge}#${idx + 1}. Entity Key: <span style="color: var(--accent2); margin-left:4px;">${Utils.escapeHtml(item.keyStr)}</span>
                                        ${refBadge}
                                    </div>
                                    <span style="font-size: 9px; padding: 2px 6px; border-radius: 4px; background: var(--bg); color: ${actionColor}; font-weight: 600; border: 1px solid var(--brd);">
                                        ${actionLabel}
                                    </span>
                                </div>
                                <div style="display: grid; grid-template-columns: 1fr; gap: 8px;">
                                    <div>
                                        <div style="font-size: 9px; color: var(--muted); margin-bottom: 2px;">ENTITY SNAPSHOT & PROPERTIES:</div>
                                        <pre style="padding: 8px 10px; border-radius: 6px; font-family: var(--font-mono); font-size: 10px; max-height: 140px; overflow-y: auto; background: var(--bg); color: var(--ok); border: 1px solid var(--brd); white-space: pre-wrap; margin:0">${Utils.escapeHtml(prevStr)}</pre>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('');
                    stateDetailsHtml += `
                        <div style="max-height: 400px; overflow-y: auto; padding-right: 4px;">
                            ${items.length > 0 ? rows : '<div style="color:var(--muted); font-size:11px; padding:8px 0;">No entity changes recorded in this batch.</div>'}
                        </div>
                    `;
                } else if (state.type === 'DATASTORE_EDIT') {
                    const prevStr = state.prevEntity ? JSON.stringify(state.prevEntity.properties || state.prevEntity, null, 2) : '—';
                    const refBadge = state.referenceName ? `<span class="badge" style="background:rgba(0,212,255,0.15); color:var(--accent2); font-size:10px; border:1px solid rgba(0,212,255,0.3); margin-left:8px;"><span style="color:var(--muted); margin-right:3px;">${Utils.escapeHtml(state.referenceField || 'Name')}:</span>"${Utils.escapeHtml(state.referenceName)}"</span>` : '';
                    stateDetailsHtml += `
                        <div style="margin-bottom: 18px; padding-bottom: 14px;">
                            <div style="font-weight: 600; color: var(--fg); margin-bottom: 8px; font-size: 11px; display:flex; align-items:center;">
                                Entity Key: <span style="font-family:var(--font-mono); color:var(--accent2); margin-left:4px;">${Utils.escapeHtml(state.keyStr)}</span>
                                ${refBadge}
                            </div>
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 15px;">
                                <div>
                                    <div style="font-size: 9px; color: var(--muted); font-weight: 600; margin-bottom: 5px;">PREVIOUS STATE:</div>
                                    <pre style="padding: 10px; border-radius: 8px; font-family: var(--font-mono); font-size: 10px; max-height: 160px; overflow-y: auto; background: var(--bg); color: var(--ok); border: 1px solid var(--brd); white-space: pre-wrap; margin:0">${Utils.escapeHtml(prevStr)}</pre>
                                </div>
                            </div>
                        </div>
                    `;
                }
                stateDetailsHtml += `</div>`;
            }
        }

        expTr.innerHTML = `
            <td colspan="8" class="px-6 py-4" style="background:var(--bg2)">
                <div style="display: flex; flex-direction: column; gap: 14px; text-align: left; line-height: 1.6;">
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
                        <div><span style="font-weight:700; font-size:10px; color:var(--muted); text-transform:uppercase; display:block; margin-bottom:4px">LOG ID</span><span class="mono text-xs" style="color:var(--fg)">${log.id}</span></div>
                        <div><span style="font-weight:700; font-size:10px; color:var(--muted); text-transform:uppercase; display:block; margin-bottom:4px">OPERATION TYPE</span><span class="badge" style="background:var(--brd2);color:var(--accent2)">${log.operation}</span></div>
                        <div><span style="font-weight:700; font-size:10px; color:var(--muted); text-transform:uppercase; display:block; margin-bottom:4px">STATUS</span><span class="badge" style="background:${statusBg};color:${statusClass}">${log.status}</span></div>
                    </div>
                    <div style="margin-top: 10px;"><span style="font-weight:700; font-size:10px; color:var(--muted); text-transform:uppercase; display:block; margin-bottom:4px">OPERATION DETAILS</span><span style="color:var(--fg); font-size:12px">${Utils.escapeHtml(log.details)}</span></div>
                    ${stateDetailsHtml}
                </div>
            </td>
        `;

        tr.after(expTr);
        const icon = tr.querySelector('.btn-toggle-log i') as HTMLElement | null;
        if (icon) icon.style.transform = 'rotate(90deg)';
    }
};
