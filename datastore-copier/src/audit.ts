import { State } from './state';
import { Utils } from './utils';
import { Api } from './api';
import { CONFIG } from './config';

export const AuditLog = {
    parseFirestoreDoc: (doc: any): any => {
        if (!doc || !doc.fields) return null;
        const fields = doc.fields;
        const result: any = {};
        for (const key in fields) {
            const valObj = fields[key];
            if (valObj.stringValue !== undefined) result[key] = valObj.stringValue;
            else if (valObj.integerValue !== undefined) result[key] = parseInt(valObj.integerValue, 10);
            else if (valObj.booleanValue !== undefined) result[key] = valObj.booleanValue === true || valObj.booleanValue === "true";
            else if (valObj.doubleValue !== undefined) result[key] = parseFloat(valObj.doubleValue);
            else if (valObj.nullValue !== undefined) result[key] = null;
            else result[key] = valObj;
        }
        if (doc.name) {
            const parts = doc.name.split('/');
            result.id = parts[parts.length - 1];
        }
        if (result.prevState && typeof result.prevState === 'string') {
            try {
                result.prevState = JSON.parse(result.prevState);
            } catch(e) {}
        }
        return result;
    },
    fetchWithFallback: async (endpoint: 'runQuery' | 'documents', options: RequestInit): Promise<any> => {
        const proxyUrl = endpoint === 'runQuery' 
            ? `${CONFIG.FIRESTORE_AUDIT_LOG_URL}/runQuery`
            : CONFIG.FIRESTORE_AUDIT_LOG_URL;
        
        try {
            const res = await fetch(proxyUrl, options);
            if (res.ok) {
                return await res.json();
            }
            console.warn(`Proxy request to ${proxyUrl} returned status ${res.status}. Falling back to direct Firestore REST API.`);
        } catch (err) {
            console.warn(`Proxy request to ${proxyUrl} failed. Falling back to direct Firestore REST API:`, err);
        }

        const directUrl = endpoint === 'runQuery'
            ? `https://firestore.googleapis.com/v1/projects/${CONFIG.FIRESTORE_PROJECT_ID}/databases/${CONFIG.FIRESTORE_DATABASE_ID}/documents:runQuery`
            : `https://firestore.googleapis.com/v1/projects/${CONFIG.FIRESTORE_PROJECT_ID}/databases/${CONFIG.FIRESTORE_DATABASE_ID}/documents/${CONFIG.AUDIT_LOG_COLLECTION}`;
        
        const res = await fetch(directUrl, options);
        if (!res.ok) {
            throw new Error(`Firestore REST API Error: ${res.status} - ${await res.text()}`);
        }
        return await res.json();
    },
    readLogs: async (): Promise<any[]> => {
        try {
            if (!State.token) return [];
            const email = State.authEmail || 'anonymous';
            const data = await AuditLog.fetchWithFallback('runQuery', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${State.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    structuredQuery: {
                        from: [{ collectionId: CONFIG.AUDIT_LOG_COLLECTION }],
                        where: {
                            fieldFilter: {
                                field: { fieldPath: "user" },
                                op: "EQUAL",
                                value: { stringValue: email }
                            }
                        }
                    }
                })
            });
            const decryptedList: any[] = [];
            for (const item of data) {
                if (item.document) {
                    const parsed = AuditLog.parseFirestoreDoc(item.document);
                    if (parsed) {
                        decryptedList.push(parsed);
                    }
                }
            }
            return decryptedList.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        } catch(e) {
            console.error("Failed to read audit logs:", e);
            return [];
        }
    },
    addLog: async (operation: string, srcProject: string, tgtProject: string, details: string, status: string, prevState: any = null): Promise<void> => {
        try {
            if (!State.token) return;
            const email = State.authEmail || 'anonymous';
            const body: any = {
                fields: {
                    timestamp: { stringValue: new Date().toISOString() },
                    user: { stringValue: email },
                    operation: { stringValue: operation },
                    srcProject: { stringValue: srcProject || '—' },
                    tgtProject: { stringValue: tgtProject || '—' },
                    status: { stringValue: status || 'SUCCESS' },
                    details: { stringValue: details || '' }
                }
            };
            if (prevState) {
                body.fields.prevState = { stringValue: JSON.stringify(prevState) };
            }
            await AuditLog.fetchWithFallback('documents', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${State.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            await AuditLog.renderLogs();
        } catch(e) {
            console.error("Failed to add audit log:", e);
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
        
        const { UI } = await import('./ui');
        const { App } = await import('./app');

        const tmpl = Utils.$('template-ds-save-confirm') as HTMLTemplateElement; // We can repurpose or define standard template
        // Let's create a custom modal structure for Revert
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
                const state = log.prevState;
                if (state.type === 'BQ_SCHEMA_SYNC') {
                    let restored = 0, deleted = 0;
                    for (const item of state.backupData) {
                        const [dataset, table] = item.tablePath.split('.');
                        if (item.action === 'create') {
                            await Api.deleteTable(log.tgtProject, dataset, table);
                            deleted++;
                        } else if (item.action === 'patch' && item.prevSchema) {
                            await Api.patchTable(log.tgtProject, dataset, table, item.prevSchema);
                            restored++;
                        }
                    }
                    Utils.toast(`Reverted BQ schema sync. Restored: ${restored}, Deleted: ${deleted}`, "ok");
                    await AuditLog.addLog("BQ_SCHEMA_REVERT", "—", log.tgtProject, `Reverted sync of ${state.backupData.length} tables from log ${logId}.`, "SUCCESS");
                    if (State.mode === 'bq' && State.bq.src) await App.runBqCompare();
                } else if (state.type === 'QUERY_SYNC') {
                    let deleted = 0, restored = 0;
                    for (const item of state.backupData) {
                        if (item.action === 'create' || !item.action) {
                            await Api.deleteQuery(item.name);
                            deleted++;
                        } else if (item.action === 'update' && item.prevQuery) {
                            await Api.deleteQuery(item.name);
                            const parts = item.name.split('/');
                            const loc = parts[3] || 'us';
                            await Api.createQuery(log.tgtProject, loc, item.prevQuery);
                            restored++;
                        }
                    }
                    Utils.toast(`Reverted scheduled query sync. Restored: ${restored}, Deleted: ${deleted}`, "ok");
                    await AuditLog.addLog("QUERY_REVERT", "—", log.tgtProject, `Reverted sync of ${state.backupData.length} scheduled queries from log ${logId}.`, "SUCCESS");
                    if (State.mode === 'query' && State.query.src) await App.runQueryFetch();
                } else if (state.type === 'DATASTORE_COPY') {
                    const mutations: any[] = [];
                    let upsertCount = 0, deleteCount = 0;
                    for (const item of state.backupData) {
                        if (item.action === 'delete') {
                            const keyCopy = JSON.parse(JSON.stringify(item.prevEntity.key));
                            const db = (state.tgtDb === '(default)' || !state.tgtDb) ? '' : state.tgtDb;
                            const partitionId: any = { projectId: log.tgtProject };
                            if (db) partitionId.databaseId = db;
                            keyCopy.partitionId = partitionId;
                            mutations.push({ delete: keyCopy });
                            deleteCount++;
                        } else if (item.action === 'upsert' && item.prevEntity) {
                            const entityCopy = JSON.parse(JSON.stringify(item.prevEntity));
                            const db = (state.tgtDb === '(default)' || !state.tgtDb) ? '' : state.tgtDb;
                            const partitionId: any = { projectId: log.tgtProject };
                            if (db) partitionId.databaseId = db;
                            entityCopy.key.partitionId = partitionId;
                            mutations.push({ upsert: entityCopy });
                            upsertCount++;
                        }
                    }
                    if (mutations.length > 0) {
                        await Api.commitDatastore(log.tgtProject, mutations, state.tgtDb);
                    }
                    Utils.toast(`Reverted Datastore changes. Restored: ${upsertCount}, Deleted: ${deleteCount}`, "ok");
                    await AuditLog.addLog("DATASTORE_REVERT", "—", log.tgtProject, `Reverted changes for ${state.backupData.length} entities of kind ${state.kind} from log ${logId}.`, "SUCCESS");
                    if (State.mode === 'ds' && State.ds.src) await App.runDsAnalyze();
                } else if (state.type === 'DATASTORE_EDIT') {
                    const pid = log.tgtProject;
                    if (state.prevEntity) {
                        const entityCopy = JSON.parse(JSON.stringify(state.prevEntity));
                        const db = (state.dbId === '(default)' || !state.dbId) ? '' : state.dbId;
                        const partitionId: any = { projectId: pid };
                        if (db) partitionId.databaseId = db;
                        entityCopy.key.partitionId = partitionId;
                        await Api.commitDatastore(pid, [{ upsert: entityCopy }], state.dbId);
                        Utils.toast(`Reverted entity edit. Restored original properties.`, "ok");
                    } else {
                        const keyCopy = JSON.parse(JSON.stringify(state.rawKey));
                        const db = (state.dbId === '(default)' || !state.dbId) ? '' : state.dbId;
                        const partitionId: any = { projectId: pid };
                        if (db) partitionId.databaseId = db;
                        keyCopy.partitionId = partitionId;
                        await Api.commitDatastore(pid, [{ delete: keyCopy }], state.dbId);
                        Utils.toast(`Reverted entity edit. Deleted created entity.`, "ok");
                    }
                    await AuditLog.addLog("DATASTORE_EDIT_REVERT", "—", pid, `Reverted inline edit of entity ${state.keyStr}.`, "SUCCESS");
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
                        No local audit logs recorded yet.
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
            if (log.prevState) {
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
    toggleLogExpand: (tr: HTMLElement, logId: string, logs: any[]) => {
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
            if (typeof state === 'string') {
                try { state = JSON.parse(state); } catch(e) {}
            }

            if (state && typeof state === 'object') {
                stateDetailsHtml += `
                    <div style="margin-top: 20px; border-top: 1px solid var(--brd); padding-top: 18px;">
                        <div style="font-weight: 700; font-size: 11px; margin-bottom: 14px; color: var(--accent2); display: flex; align-items: center; gap: 6px;">
                            <i class="fa-solid fa-arrows-left-right"></i> Backup State Changes (Revert Data)
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
                    const rows = (state.backupData || []).map((item: any) => {
                        const prevStr = item.prevEntity ? JSON.stringify(item.prevEntity.properties || item.prevEntity, null, 2) : '—';
                        return `
                            <div style="margin-bottom: 18px; border-bottom: 1px solid var(--brd); padding-bottom: 14px;">
                                <div style="font-weight: 600; color: var(--fg); margin-bottom: 8px; font-size: 11px;">Entity Key: ${Utils.escapeHtml(item.keyStr)} (${item.action})</div>
                                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 15px;">
                                    <div>
                                        <div style="font-size: 9px; color: var(--muted); font-weight: 600; margin-bottom: 5px;">PREVIOUS STATE:</div>
                                        <pre style="padding: 10px; border-radius: 8px; font-family: var(--font-mono); font-size: 10px; max-height: 160px; overflow-y: auto; background: var(--bg); color: var(--ok); border: 1px solid var(--brd); white-space: pre-wrap; margin:0">${Utils.escapeHtml(prevStr)}</pre>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('');
                    stateDetailsHtml += `<div>${rows}</div>`;
                } else if (state.type === 'DATASTORE_EDIT') {
                    const prevStr = state.prevEntity ? JSON.stringify(state.prevEntity.properties || state.prevEntity, null, 2) : '—';
                    stateDetailsHtml += `
                        <div style="margin-bottom: 18px; padding-bottom: 14px;">
                            <div style="font-weight: 600; color: var(--fg); margin-bottom: 8px; font-size: 11px;">Entity Key: ${Utils.escapeHtml(state.keyStr)}</div>
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
