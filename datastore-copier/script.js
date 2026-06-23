const State = {
    token: null, authEmail: '', projects: [], mode: 'bq', cancelDs: false,
    bq: { src:'', tgt:'', ds:'', loc:'us', tables:[], filtered:[], page:1, perPage:50, search:'', selected:new Set(), datasetsSrc:[] },
    query: { src:'', tgt:'', srcLoc:'us', tgtLoc:'us', queries:[], selected:new Set() },
    ds: { src:'', tgt:'', kind:'', kinds:[], properties:[], results:[], filtered:[], page:1, perPage:50, selected:new Set(), filterStatus:'all', stats:{identical:0, different:0, missing:0, total:0} }
};

const Utils = {
    $: id => document.getElementById(id), 
    show: id => { const el = Utils.$(id); if(el) el.style.display = ''; }, 
    hide: id => { const el = Utils.$(id); if(el) el.style.display = 'none'; },
    toast: (msg, type='info') => { 
        const el = document.createElement('div'); 
        el.className = `toast toast-${type}`; 
        el.innerHTML = `<i class="fa-solid fa-${type==='ok'?'check-circle':type==='err'?'circle-xmark':'circle-info'}"></i> ${msg}`; 
        Utils.$('toast-wrap').appendChild(el); 
        requestAnimationFrame(() => el.classList.add('show')); 
        setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 4000); 
    },
    copyText: (text) => { 
        const ta = document.createElement("textarea"); 
        ta.value = text; 
        ta.style.position = "fixed"; 
        ta.style.left = "-9999px"; 
        document.body.appendChild(ta); 
        ta.select(); 
        try { document.execCommand('copy'); Utils.toast('Copied!', 'ok'); } catch(e) {} 
        document.body.removeChild(ta); 
    },
    escapeHtml: (str) => { 
        if(str === null || str === undefined) return '';
        if(typeof str !== 'string') str = JSON.stringify(str); 
        const div = document.createElement('div'); 
        div.appendChild(document.createTextNode(str)); 
        return div.innerHTML; 
    }
};

const Crypto = {
    getKey: async (passphrase) => {
        const enc = new TextEncoder();
        const keyMaterial = await window.crypto.subtle.importKey(
            "raw",
            enc.encode(passphrase),
            "PBKDF2",
            false,
            ["deriveBits", "deriveKey"]
        );
        return window.crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: enc.encode("brand-salt-12345"),
                iterations: 100000,
                hash: "SHA-256"
            },
            keyMaterial,
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"]
        );
    },
    encrypt: async (text, passphrase = 'audit-log-key') => {
        try {
            const key = await Crypto.getKey(passphrase);
            const enc = new TextEncoder();
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            const ciphertext = await window.crypto.subtle.encrypt(
                { name: "AES-GCM", iv: iv },
                key,
                enc.encode(text)
            );
            const combined = new Uint8Array(iv.length + ciphertext.byteLength);
            combined.set(iv, 0);
            combined.set(new Uint8Array(ciphertext), iv.length);
            let binary = "";
            for (let i = 0; i < combined.byteLength; i++) {
                binary += String.fromCharCode(combined[i]);
            }
            return btoa(binary);
        } catch(e) {
            console.error("Encryption failed:", e);
            return null;
        }
    },
    decrypt: async (encryptedBase64, passphrase = 'audit-log-key') => {
        try {
            const key = await Crypto.getKey(passphrase);
            const binaryString = atob(encryptedBase64);
            const combined = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                combined[i] = binaryString.charCodeAt(i);
            }
            const iv = combined.slice(0, 12);
            const ciphertext = combined.slice(12);
            const decrypted = await window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: iv },
                key,
                ciphertext
            );
            return new TextDecoder().decode(decrypted);
        } catch(e) {
            console.error("Decryption failed:", e);
            return null;
        }
    }
};

const AuditLog = {
    parseFirestoreDoc: (doc) => {
        if (!doc || !doc.fields) return null;
        const fields = doc.fields;
        const result = {};
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
    readLogs: async () => {
        try {
            if (!State.token) return [];
            const email = State.authEmail || 'anonymous';
            const res = await fetch(`https://firestore.googleapis.com/v1/projects/gcp-tools-portal/databases/(default)/documents:runQuery`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${State.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    structuredQuery: {
                        from: [{ collectionId: "audit_logs" }],
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
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            const decryptedList = [];
            for (const item of data) {
                if (item.document) {
                    const parsed = AuditLog.parseFirestoreDoc(item.document);
                    if (parsed) {
                        decryptedList.push(parsed);
                    }
                }
            }
            return decryptedList.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
        } catch(e) {
            console.error("Failed to read audit logs:", e);
            return [];
        }
    },
    addLog: async (operation, srcProject, tgtProject, details, status, prevState = null) => {
        try {
            if (!State.token) return;
            const email = State.authEmail || 'anonymous';
            const body = {
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
            const res = await fetch(`https://firestore.googleapis.com/v1/projects/gcp-tools-portal/databases/(default)/documents/audit_logs`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${State.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            if (!res.ok) throw new Error(await res.text());
            await AuditLog.renderLogs();
        } catch(e) {
            console.error("Failed to add audit log:", e);
        }
    },

    exportLogs: async () => {
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
    revertLog: async (logId) => {
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

        Utils.$('btn-revert-cancel').onclick = () => {
            UI.closeModal();
        };

        Utils.$('btn-revert-confirm').onclick = async () => {
            UI.closeModal();
            Utils.show('sec-loading');
            Utils.$('load-title').textContent = "Reverting Changes...";
            Utils.$('load-msg').textContent = "Restoring previous state...";
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
                    const mutations = [];
                    let upsertCount = 0, deleteCount = 0;
                    for (const item of state.backupData) {
                        if (item.action === 'delete') {
                            const keyCopy = JSON.parse(JSON.stringify(item.prevEntity.key));
                            keyCopy.partitionId = { projectId: log.tgtProject };
                            mutations.push({ delete: keyCopy });
                            deleteCount++;
                        } else if (item.action === 'upsert' && item.prevEntity) {
                            const entityCopy = JSON.parse(JSON.stringify(item.prevEntity));
                            entityCopy.key.partitionId = { projectId: log.tgtProject };
                            mutations.push({ upsert: entityCopy });
                            upsertCount++;
                        }
                    }
                    if (mutations.length > 0) {
                        await Api.commitDatastore(log.tgtProject, mutations);
                    }
                    Utils.toast(`Reverted Datastore changes. Restored: ${upsertCount}, Deleted: ${deleteCount}`, "ok");
                    await AuditLog.addLog("DATASTORE_REVERT", "—", log.tgtProject, `Reverted changes for ${state.backupData.length} entities of kind ${state.kind} from log ${logId}.`, "SUCCESS");
                    if (State.mode === 'ds' && State.ds.src) await App.runDsAnalyze();
                } else if (state.type === 'DATASTORE_EDIT') {
                    const pid = log.tgtProject;
                    if (state.prevEntity) {
                        const entityCopy = JSON.parse(JSON.stringify(state.prevEntity));
                        entityCopy.key.partitionId = { projectId: pid };
                        await Api.commitDatastore(pid, [{ upsert: entityCopy }]);
                        Utils.toast(`Reverted entity edit. Restored original properties.`, "ok");
                    } else {
                        const keyCopy = JSON.parse(JSON.stringify(state.rawKey));
                        keyCopy.partitionId = { projectId: pid };
                        await Api.commitDatastore(pid, [{ delete: keyCopy }]);
                        Utils.toast(`Reverted entity edit. Deleted created entity.`, "ok");
                    }
                    await AuditLog.addLog("DATASTORE_EDIT_REVERT", "—", pid, `Reverted inline edit of entity ${state.keyStr}.`, "SUCCESS");
                    if (State.mode === 'ds' && State.ds.src) await App.runDsAnalyze();
                }
            } catch(err) {
                console.error("Revert failed:", err);
                Utils.toast(`Revert failed: ${err.message}`, "err");
            } finally {
                Utils.hide('sec-loading');
                await AuditLog.renderLogs();
            }
        };
    },
    renderLogs: async () => {
        const container = Utils.$('audit-table-body');
        if (!container) return;
        const logs = await AuditLog.readLogs();
        if (logs.length === 0) {
            container.innerHTML = `
                <tr>
                    <td colspan="7" class="px-6 py-8 text-center text-xs" style="color:var(--muted)">
                        <i class="fa-solid fa-folder-open text-2xl mb-2 block"></i>
                        No local audit logs recorded yet.
                    </td>
                </tr>
            `;
            return;
        }
        container.innerHTML = logs.map(log => {
            const dateStr = new Date(log.timestamp).toLocaleString();
            const statusClass = log.status === 'SUCCESS' ? 'var(--ok)' : (log.status === 'PARTIAL' ? 'var(--warn)' : 'var(--danger)');
            const statusBg = log.status === 'SUCCESS' ? 'var(--ok-dim)' : (log.status === 'PARTIAL' ? 'var(--warn-dim)' : 'var(--danger-dim)');
            const revertBtn = log.prevState 
                ? `<button class="btn btn-s text-[10px]" style="padding: 2px 6px; font-weight: 600;" onclick="AuditLog.revertLog('${log.id}')"><i class="fa-solid fa-rotate-left"></i> Revert</button>`
                : `<span class="text-[10px]" style="color:var(--muted)">—</span>`;
            return `
                <tr class="border-b" style="border-color:var(--brd2)">
                    <td class="px-6 py-3 text-[11px] font-medium mono" style="color:var(--muted)">${dateStr}</td>
                    <td class="px-6 py-3 text-[11px] font-semibold" style="color:var(--fg)">${Utils.escapeHtml(log.user)}</td>
                    <td class="px-6 py-3 text-[11px]"><span class="badge" style="background:var(--brd2);color:var(--accent2);font-size:10px">${log.operation}</span></td>
                    <td class="px-6 py-3 text-[11px]">
                        <div class="flex flex-col">
                            <span class="mono" style="color:var(--fg)"><span class="text-[9px]" style="color:var(--muted)">Src:</span> ${log.srcProject}</span>
                            <span class="mono" style="color:var(--fg)"><span class="text-[9px]" style="color:var(--muted)">Tgt:</span> ${log.tgtProject}</span>
                        </div>
                    </td>
                    <td class="px-6 py-3 text-[11px]">
                        <span class="badge" style="background:${statusBg};color:${statusClass}">${log.status}</span>
                    </td>
                    <td class="px-6 py-3 text-[11px]" style="color:var(--muted)">${Utils.escapeHtml(log.details)}</td>
                    <td class="px-6 py-3 text-center">${revertBtn}</td>
                </tr>
            `;
        }).join('');
    }
};

const Api = {
    fetch: async (url, opts={}) => {
        const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${State.token}`, 'Content-Type': 'application/json', ...opts.headers } });
        if (res.status === 401) {
            try {
                const newToken = await UI.showTokenRenewalModal();
                State.token = newToken;
                localStorage.setItem('access_token', newToken);
                const tokenInp = Utils.$('inp-token');
                if (tokenInp) tokenInp.value = newToken;
                return Api.fetch(url, opts);
            } catch (err) {
                throw new Error("Auth Error");
            }
        }
        if (res.status === 429) { await new Promise(r => setTimeout(r, 2000)); return Api.fetch(url, opts); }
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `API Error ${res.status}`); } 
        const text = await res.text();
        return text ? JSON.parse(text) : {};
    },
    getProjects: async () => { const d = await Api.fetch('https://cloudresourcemanager.googleapis.com/v1/projects'); return (d.projects||[]).map(p => ({id:p.projectId, name:p.name||''})).sort((a,b) => a.id.localeCompare(b.id)); },
    getDatasets: async (pid) => { const d = await Api.fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${pid}/datasets`); return (d.datasets||[]).map(x=>x.datasetReference.datasetId); },
    getTables: async (pid, did) => { const d = await Api.fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${pid}/datasets/${did}/tables`); return (d.tables||[]).map(x=>({dataset:did,table:x.tableReference.tableId})); },
    getSchema: async (pid, did, tid) => { const d = await Api.fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${pid}/datasets/${did}/tables/${tid}`); return d.schema?.fields||[]; },
    getDataset: async (pid, did) => { return Api.fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${pid}/datasets/${did}`); },
    createDataset: async (pid, did, location) => { try { const body = {datasetReference:{projectId:pid,datasetId:did}}; if (location) body.location = location; await Api.fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${pid}/datasets`, { method:'POST', body: JSON.stringify(body) }); } catch(e) { if (!e.message.includes('Already Exists') && !e.message.includes('alreadyExists')) throw e; } },
    createTable: async (pid, did, tid, fields) => { return Api.fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${pid}/datasets/${did}/tables`, { method:'POST', body: JSON.stringify({tableReference:{projectId:pid,datasetId:did,tableId:tid},schema:{fields}}) }); },
    patchTable: async (pid, did, tid, fields) => { return Api.fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${pid}/datasets/${did}/tables/${tid}`, { method:'PATCH', body: JSON.stringify({tableReference:{projectId:pid,datasetId:did,tableId:tid},schema:{fields}}) }); },
    getQueries: async (pid, loc) => { const d = await Api.fetch(`https://bigquerydatatransfer.googleapis.com/v1/projects/${pid}/locations/${loc}/transferConfigs`); return (d.transferConfigs||[]).filter(x => x.dataSourceId === 'scheduled_query'); },
    createQuery: async (pid, loc, cfg) => { return Api.fetch(`https://bigquerydatatransfer.googleapis.com/v1/projects/${pid}/locations/${loc}/transferConfigs`, { method:'POST', body: JSON.stringify({displayName:cfg.displayName,dataSourceId:"scheduled_query",schedule:cfg.schedule,destinationDatasetId:cfg.destinationDatasetId,params:cfg.params}) }); },
    deleteTable: async (pid, did, tid) => { return Api.fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${pid}/datasets/${did}/tables/${tid}`, { method: 'DELETE' }); },
    deleteQuery: async (qName) => { return Api.fetch(`https://bigquerydatatransfer.googleapis.com/v1/${qName}`, { method: 'DELETE' }); },
    getKinds: async (pid) => { const d = await Api.fetch(`https://datastore.googleapis.com/v1/projects/${pid}:runQuery`, { method:'POST', body: JSON.stringify({partitionId:{projectId:pid},query:{kind:[{name:"__kind__"}]}}) }); return (d.batch?.entityResults||[]).map(e => e.entity.key.path[0].name); },
    getProperties: async (pid, kind) => { const d = await Api.fetch(`https://datastore.googleapis.com/v1/projects/${pid}:runQuery`, { method:'POST', body: JSON.stringify({partitionId:{projectId:pid},query:{kind:[{name:kind}],limit:1}}) }); return d.batch?.entityResults?.[0]?.entity.properties ? Object.keys(d.batch.entityResults[0].entity.properties) : []; },
    runDatastoreQuery: async (pid, body) => { return Api.fetch(`https://datastore.googleapis.com/v1/projects/${pid}:runQuery`, { method:'POST', body: JSON.stringify(body) }); },
    lookupEntities: async (pid, keys) => { return Api.fetch(`https://datastore.googleapis.com/v1/projects/${pid}:lookup`, { method:'POST', body: JSON.stringify({keys}) }); },
    commitDatastore: async (pid, mutations) => { return Api.fetch(`https://datastore.googleapis.com/v1/projects/${pid}:commit`, { method:'POST', body: JSON.stringify({mode:"NON_TRANSACTIONAL",mutations}) }); }
};

const UI = {
    initDropdowns: () => {
        const p = State.projects;
        const setupDD = (inpId, menuId, cb) => {
            const inp = Utils.$(inpId), menu = Utils.$(menuId);
            if(!inp || !menu) return;
            const render = (f='') => { 
                const ft = p.filter(x => x.id.includes(f.toLowerCase()) || x.name.toLowerCase().includes(f.toLowerCase())); 
                menu.innerHTML = ft.length ? ft.map(x => `<div class="dropdown-item" data-id="${x.id}"><span class="id">${x.id}</span><span class="name">${x.name}</span></div>`).join('') : `<div class="dropdown-item" style="color:var(--muted)">No results</div>`; 
                menu.querySelectorAll('[data-id]').forEach(el => el.onmousedown = e => { e.preventDefault(); inp.value = el.dataset.id; menu.classList.remove('open'); if(cb) cb(el.dataset.id); }); 
            };
            inp.onfocus = () => { render(inp.value); menu.classList.add('open'); }; 
            inp.oninput = () => { render(inp.value); menu.classList.add('open'); }; 
            inp.onblur = () => setTimeout(() => menu.classList.remove('open'), 150);
        };
        setupDD('bq-src', 'dd-bq-src', id => { State.bq.src = id; Api.getDatasets(id).then(ds => { State.bq.datasetsSrc = ds; UI.initDropdowns(); }).catch(()=>{}); });
        setupDD('bq-tgt', 'dd-bq-tgt', id => State.bq.tgt = id);
        setupDD('q-src', 'dd-q-src', id => State.query.src = id);
        setupDD('q-tgt', 'dd-q-tgt', id => State.query.tgt = id);
        setupDD('ds-src', 'dd-ds-src', id => { State.ds.src = id; UI.loadKinds(); });
        setupDD('ds-tgt', 'dd-ds-tgt', id => State.ds.tgt = id);

        const setupSimpleDD = (inpId, menuId, dataArr, stateKey, subObj, cb) => {
            const inp = Utils.$(inpId), menu = Utils.$(menuId);
            if(!inp || !menu) return;
            const render = (f='') => { 
                const ft = dataArr.filter(k => k.toLowerCase().includes(f.toLowerCase())); 
                menu.innerHTML = ft.length ? ft.map(k => `<div class="dropdown-item" data-id="${k}"><span class="id">${k}</span></div>`).join('') : `<div class="dropdown-item" style="color:var(--muted)">No results</div>`; 
                menu.querySelectorAll('[data-id]').forEach(el => el.onmousedown = e => { e.preventDefault(); inp.value = el.dataset.id; menu.classList.remove('open'); if(subObj) State[subObj][stateKey] = el.dataset.id; else State.ds[stateKey] = el.dataset.id; if(cb) cb(el.dataset.id); }); 
            };
            inp.onfocus = () => { render(inp.value); menu.classList.add('open'); }; 
            inp.oninput = () => { render(inp.value); menu.classList.add('open'); }; 
            inp.onblur = () => setTimeout(() => menu.classList.remove('open'), 150);
        };
        
        const kInp = Utils.$('ds-kind'); const kMenu = Utils.$('dd-ds-kind');
        if(kInp && kMenu) {
            kInp.onfocus = () => { 
                const f = kInp.value.toLowerCase(); 
                const ft = State.ds.kinds.filter(k => k.toLowerCase().includes(f)); 
                kMenu.innerHTML = ft.length ? ft.map(k => `<div class="dropdown-item" data-id="${k}"><span class="id">${k}</span></div>`).join('') : ''; 
                kMenu.classList.add('open'); 
                kMenu.querySelectorAll('[data-id]').forEach(el => el.onmousedown = e => { e.preventDefault(); kInp.value = el.dataset.id; kMenu.classList.remove('open'); State.ds.kind = el.dataset.id; UI.loadProperties(); }); 
            };
            kInp.onblur = () => setTimeout(() => kMenu.classList.remove('open'), 150); 
            kInp.oninput = () => kInp.onfocus();
        }

        setupSimpleDD('ds-mod-field', 'dd-ds-mod', State.ds.properties, 'modField', null);
        setupSimpleDD('bq-ds', 'dd-bq-ds', State.bq.datasetsSrc, 'ds', 'bq', async (datasetId) => {
            if (!State.bq.src || !datasetId) return;
            try {
                const meta = await Api.getDataset(State.bq.src, datasetId);
                if (meta.location) {
                    Utils.$('bq-loc').value = meta.location.toLowerCase();
                    State.bq.loc = meta.location.toLowerCase();
                }
            } catch(e) {
                console.error("Failed to auto-detect dataset location", e);
            }
        });
    },
    loadKinds: async () => { 
        if(!State.ds.src) return; 
        Utils.$('ds-kind').placeholder = "Loading..."; 
        try { 
            State.ds.kinds = await Api.getKinds(State.ds.src); 
            Utils.$('ds-kind').placeholder = "Select Kind..."; 
            UI.initDropdowns(); 
        } catch(e) { 
            Utils.$('ds-kind').placeholder = "Error loading kinds"; 
        } 
    },
    loadProperties: async () => { 
        if(!State.ds.src || !State.ds.kind) return; 
        try { 
            State.ds.properties = await Api.getProperties(State.ds.src, State.ds.kind); 
            UI.initDropdowns(); 
            Utils.toast("Properties loaded", "ok"); 
        } catch(e) { 
            State.ds.properties = []; 
        } 
    },
    addDsFilter: () => {
        const c = Utils.$('ds-filters-container'); 
        const row = document.createElement('div'); 
        row.className = 'filter-row';
        const propOptions = State.ds.properties.map(p => `<option value="${p}">${p}</option>`).join('');
        row.innerHTML = `
            <select class="inp">${propOptions}</select>
            <select class="inp">
                <option value="EQUAL">==</option>
                <option value="GREATER_THAN">&gt;</option>
                <option value="LESS_THAN">&lt;</option>
                <option value="GREATER_THAN_OR_EQUAL">&gt;=</option>
                <option value="LESS_THAN_OR_EQUAL">&lt;=</option>
                <option value="IN">IN</option>
                <option value="NOT_IN">NOT IN</option>
                <option value="HAS_ANCESTOR">HAS ANCESTOR</option>
            </select>
            <input class="inp" placeholder="Value">
            <button class="btn btn-d" style="padding:8px" onclick="this.parentElement.remove()"><i class="fa-solid fa-trash"></i></button>
        `;
        c.appendChild(row);
    },
    openModal: (html) => { 
        Utils.$('modal-root').style.display = ''; 
        Utils.$('modal-root').innerHTML = `<div class="modal-bg" onclick="if(event.target===this)UI.closeModal()"><div class="card modal" style="padding:0">${html}</div></div>`; 
    },
    closeModal: () => { 
        Utils.$('modal-root').style.display = 'none'; 
        Utils.$('modal-root').innerHTML = ''; 
    },
    showTokenRenewalModal: () => {
        return new Promise((resolve, reject) => {
            const html = `
                <div class="p-6 text-left">
                    <div class="flex items-center gap-3 mb-4" style="color:var(--warn)">
                        <i class="fa-solid fa-triangle-exclamation text-2xl"></i>
                        <h3 class="text-lg font-bold">Session Expired</h3>
                    </div>
                    <p class="text-sm mb-4" style="color:var(--muted)">
                        Your GCP access token has expired or is invalid. Please provide a new active access token to resume your operation.
                    </p>
                    <div class="mb-4">
                        <label class="block text-xs font-bold uppercase mb-1.5" style="color:var(--muted)">New Access Token</label>
                        <input id="renew-token-inp" type="password" class="inp w-full" placeholder="ya29.a0AfB_gO...">
                        <div id="renew-token-err" class="text-xs text-red-400 mt-1" style="display:none"></div>
                    </div>
                    <div class="flex justify-end gap-3">
                        <button id="btn-renew-cancel" class="btn btn-d">Cancel</button>
                        <button id="btn-renew-submit" class="btn btn-p" disabled>Verify & Resume</button>
                    </div>
                </div>
            `;
            UI.openModal(html);
            const inp = Utils.$('renew-token-inp');
            const submitBtn = Utils.$('btn-renew-submit');
            const cancelBtn = Utils.$('btn-renew-cancel');
            const errDiv = Utils.$('renew-token-err');

            inp.focus();

            inp.oninput = () => {
                submitBtn.disabled = !inp.value.trim();
                errDiv.style.display = 'none';
            };

            cancelBtn.onclick = () => {
                UI.closeModal();
                reject(new Error("Auth Error"));
            };

            submitBtn.onclick = async () => {
                const token = inp.value.trim();
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<span class="spinner"></span> Verifying...';
                try {
                    const checkRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`);
                    if (!checkRes.ok) throw new Error("Invalid token");
                    const data = await checkRes.json();
                    
                    if (data.email) {
                        State.authEmail = data.email;
                        Utils.$('header-right').innerHTML = `<span class="text-xs mono" style="color:var(--muted)">${Utils.escapeHtml(State.authEmail)}</span>`;
                    }
                    
                    UI.closeModal();
                    resolve(token);
                } catch(e) {
                    errDiv.textContent = e.message;
                    errDiv.style.display = 'block';
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = 'Verify & Resume';
                }
            };
        });
    },
    showWelcomeAnimation: (name) => {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.style.position = 'fixed';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.right = '0';
            overlay.style.bottom = '0';
            overlay.style.background = 'rgba(7, 10, 15, 0.96)';
            overlay.style.backdropFilter = 'blur(12px)';
            overlay.style.display = 'flex';
            overlay.style.flexDirection = 'column';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.zIndex = '9999';
            overlay.style.opacity = '0';
            overlay.style.transition = 'opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1)';
            
            overlay.innerHTML = `
                <div style="text-align:center; transform: scale(0.9); transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)" id="welcome-content">
                    <div class="mb-6 flex justify-center">
                        <div style="width: 80px; height: 80px; border-radius: 50%; background: radial-gradient(circle, var(--accent) 0%, transparent 70%); display: flex; align-items: center; justify-content: center; box-shadow: 0 0 30px rgba(0, 212, 170, 0.3); animation: pulseGlow 2s infinite alternate">
                            <i class="fa-solid fa-cloud text-3xl" style="color:var(--accent); line-height: 80px; text-align: center; width: 100%"></i>
                        </div>
                    </div>
                    <div class="text-[12px] uppercase tracking-[0.2em] font-bold mb-2" style="color:var(--muted); animation: fadeInUp 0.8s ease-out">
                        Welcome to GCP Infra Manager
                    </div>
                    <h1 class="text-4xl font-bold mb-4" style="color:#ffffff; font-family:'Space Grotesk', sans-serif; text-shadow: 0 0 20px rgba(255,255,255,0.1); animation: fadeInUp 1s ease-out">
                        ${Utils.escapeHtml(name)}
                    </h1>
                    <div style="width: 40px; height: 2px; background: var(--accent); margin: 0 auto; border-radius: 2px; animation: scaleWidth 1.2s ease-out"></div>
                </div>
            `;
            
            document.body.appendChild(overlay);
            
            // Trigger browser paint
            overlay.getBoundingClientRect();
            
            // Fade in
            overlay.style.opacity = '1';
            const content = overlay.querySelector('#welcome-content');
            if (content) content.style.transform = 'scale(1)';
            
            setTimeout(() => {
                // Fade out
                overlay.style.opacity = '0';
                if (content) content.style.transform = 'scale(1.05)';
                setTimeout(() => {
                    overlay.remove();
                    resolve();
                }, 600);
            }, 2400);
        });
    }
};

const App = {
    parseWelcomeName: (email) => {
        if (!email) return 'User';
        const username = email.split('@')[0] || '';
        if (username.includes('.')) {
            return username.split('.')
                .map(p => p.charAt(0).toUpperCase() + p.slice(1))
                .join(' ');
        } else if (username) {
            return username.charAt(0).toUpperCase() + username.slice(1);
        }
        return 'User';
    },
    init: () => {
        const toggleBtn = Utils.$('btn-toggle-token');
        const tokenInp = Utils.$('inp-token');
        if (toggleBtn && tokenInp) {
            toggleBtn.onclick = () => {
                const isPassword = tokenInp.type === 'password';
                tokenInp.type = isPassword ? 'text' : 'password';
                toggleBtn.innerHTML = isPassword 
                    ? '<i class="fa-solid fa-eye"></i>' 
                    : '<i class="fa-solid fa-eye-slash"></i>';
            };
        }
        Utils.$('inp-token').oninput = () => Utils.$('btn-verify').disabled = !Utils.$('inp-token').value.trim();
        Utils.$('btn-verify').onclick = App.verify;
        document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => App.selectMode(b.dataset.mode));
        Utils.$('btn-bq-compare').onclick = App.runBqCompare;
        Utils.$('btn-bq-copy-s2t').onclick = () => App.openBqCopyModal('s2t');
        Utils.$('btn-bq-copy-t2s').onclick = () => App.openBqCopyModal('t2s');
        Utils.$('btn-bq-csv').onclick = () => {
            const rows = [['Dataset', 'Table', 'Status']];
            State.bq.filtered.forEach(r => rows.push([r.dataset, r.table, r.status]));
            const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
            a.download = `bq_compare.csv`;
            a.click();
        };
        Utils.$('btn-q-fetch').onclick = App.runQueryFetch;
        Utils.$('btn-q-copy').onclick = App.openQueryCopyModal;
        Utils.$('btn-ds-add-filter').onclick = UI.addDsFilter;
        Utils.$('btn-ds-analyze').onclick = App.runDsAnalyze;
        Utils.$('btn-cancel-ds').onclick = () => { State.cancelDs = true; };
        Utils.$('btn-ds-csv').onclick = App.exportDsCsv;
        Utils.$('btn-ds-copy').onclick = App.openDsCopyModal;
        
        Utils.$('bq-search').oninput = (e) => {
            State.bq.search = e.target.value;
            State.bq.page = 1;
            App.renderBqResults();
        };


        if (Utils.$('btn-audit-export')) Utils.$('btn-audit-export').onclick = AuditLog.exportLogs;
        AuditLog.renderLogs();
    },
    verify: async () => {
        const token = Utils.$('inp-token').value.trim(); if(!token) return;
        Utils.$('btn-verify').disabled = true; Utils.$('btn-verify').innerHTML = '<span class="spinner"></span> Verifying...';
        try {
            const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`);
            if(!res.ok) throw new Error("Invalid token"); const data = await res.json();
            State.token = token; State.authEmail = data.email || 'User';
            localStorage.setItem('access_token', token);
            localStorage.setItem('auth_email', State.authEmail);
            try { State.projects = await Api.getProjects(); } catch(e) { Utils.toast("Could not fetch projects", "info"); }
            
            const welcomeName = App.parseWelcomeName(State.authEmail);
            await UI.showWelcomeAnimation(welcomeName);

            Utils.hide('sec-auth'); Utils.show('sec-modes'); Utils.show('sec-audit-logs'); UI.initDropdowns();
            Utils.$('header-right').innerHTML = `<span class="text-xs mono" style="color:var(--muted)">${Utils.escapeHtml(State.authEmail)}</span>`;
            await AuditLog.addLog("AUTHENTICATION", "—", "—", `User verified token successfully. Loaded ${State.projects.length} projects.`, "SUCCESS");
        } catch(e) { 
            Utils.toast(e.message, 'err'); Utils.$('btn-verify').disabled = false; Utils.$('btn-verify').innerHTML = '<i class="fa-solid fa-key"></i> Verify Token'; 
            await AuditLog.addLog("AUTHENTICATION", "—", "—", `Token verification failed: ${e.message}`, "FAILED");
        }
    },
    selectMode: (mode) => {
        State.mode = mode; document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
        Utils.show('sec-forms'); Utils.hide('sec-results');
        ['bq','query','ds'].forEach(m => { Utils.hide(`form-${m}`); Utils.hide(`res-${m}`); });
        Utils.show(`form-${mode}`);
    },
    
    // --- BQ logic ---
    runBqCompare: async () => {
        State.bq.src = Utils.$('bq-src').value; State.bq.tgt = Utils.$('bq-tgt').value; State.bq.ds = Utils.$('bq-ds').value; State.bq.loc = Utils.$('bq-loc').value || 'us';
        if(!State.bq.src || !State.bq.tgt) return Utils.toast("Select projects", "err");
        Utils.$('btn-bq-copy-s2t').setAttribute('data-tooltip', `Copy from ${State.bq.src} to ${State.bq.tgt}`);
        Utils.$('btn-bq-copy-t2s').setAttribute('data-tooltip', `Copy from ${State.bq.tgt} to ${State.bq.src}`);
        Utils.hide('sec-forms'); Utils.show('sec-loading'); Utils.$('load-title').textContent = "Comparing Schemas"; Utils.$('load-msg').textContent = "Fetching tables...";
        try {
            const srcDs = State.bq.ds ? [State.bq.ds] : await Api.getDatasets(State.bq.src); 
            const tgtDs = State.bq.ds ? [State.bq.ds] : await Api.getDatasets(State.bq.tgt);
            const srcTm=new Map(), tgtTm=new Map();
            for(const ds of srcDs){ const ts=await Api.getTables(State.bq.src,ds); ts.forEach(t=>srcTm.set(`${ds}.${t.table}`,t)); }
            for(const ds of tgtDs){ const ts=await Api.getTables(State.bq.tgt,ds); ts.forEach(t=>tgtTm.set(`${ds}.${t.table}`,t)); }
            State.bq.tables = [];
            for(const key of new Set([...srcTm.keys(),...tgtTm.keys()])) {
                const [ds,tbl]=key.split('.'); const inSrc=srcTm.has(key), inTgt=tgtTm.has(key);
                let status = inSrc && inTgt ? 'different' : (inSrc ? 'source_only' : 'target_only');
                State.bq.tables.push({dataset:ds,table:tbl,srcSchema:null,tgtSchema:null,status});
            }
            State.bq.tables.sort((a,b)=>a.dataset.localeCompare(b.dataset) || a.table.localeCompare(b.table));
            State.bq.page = 1; State.bq.selected.clear(); Utils.hide('sec-loading'); Utils.show('sec-results'); Utils.show('res-bq'); App.renderBqResults();
        } catch(e) { Utils.hide('sec-loading'); Utils.show('sec-forms'); Utils.toast(e.message, 'err'); }
    },
    
    compareFields: (srcFields, tgtFields) => {
        const diffs = [];
        const srcMap = new Map(srcFields.map(f => [f.name, f]));
        const tgtMap = new Map(tgtFields.map(f => [f.name, f]));
        
        for (const [name, sf] of srcMap) {
            if (!tgtMap.has(name)) {
                diffs.push({ field: name, type: 'added', src: `${sf.type} (${sf.mode})`, tgt: '—' });
            } else {
                const tf = tgtMap.get(name);
                if (sf.type !== tf.type || sf.mode !== tf.mode) {
                    diffs.push({ field: name, type: 'modified', src: `${sf.type} (${sf.mode})`, tgt: `${tf.type} (${tf.mode})` });
                } else if (sf.type === 'RECORD' && sf.fields && tf.fields) {
                    const nestedDiffs = App.compareFields(sf.fields, tf.fields);
                    nestedDiffs.forEach(nd => {
                        diffs.push({ field: `${name}.${nd.field}`, type: nd.type, src: nd.src, tgt: nd.tgt });
                    });
                }
            }
        }
        for (const [name, tf] of tgtMap) {
            if (!srcMap.has(name)) {
                diffs.push({ field: name, type: 'removed', src: '—', tgt: `${tf.type} (${tf.mode})` });
            }
        }
        return diffs;
    },

    compareBqTableSchema: async (r, tr) => {
        try {
            const [srcSchema, tgtSchema] = await Promise.all([
                Api.getSchema(State.bq.src, r.dataset, r.table),
                Api.getSchema(State.bq.tgt, r.dataset, r.table)
            ]);
            
            r.srcSchema = srcSchema;
            r.tgtSchema = tgtSchema;
            
            const diffs = App.compareFields(srcSchema, tgtSchema);
            if (diffs.length === 0) {
                r.status = 'identical';
            } else {
                r.status = 'different';
                r.diffs = diffs;
            }
            
            const badge = tr.querySelector('.status-badge');
            const summaryTd = tr.querySelectorAll('td')[3];
            
            if (r.status === 'identical') {
                badge.textContent = 'IDENTICAL';
                badge.style.color = 'var(--ok)';
                badge.style.background = 'var(--ok-dim)';
                summaryTd.textContent = 'Schemas match';
            } else {
                badge.textContent = 'DIFFERENT';
                badge.style.color = 'var(--warn)';
                badge.style.background = 'var(--warn-dim)';
                summaryTd.textContent = `${diffs.length} difference(s)`;
            }
        } catch (e) {
            const badge = tr.querySelector('.status-badge');
            badge.textContent = 'ERROR';
            badge.style.color = 'var(--danger)';
            badge.style.background = 'var(--danger-dim)';
            tr.querySelectorAll('td')[3].textContent = e.message;
        }
    },

    renderBqResults: () => {
        const tbody = Utils.$('bq-table-list');
        tbody.innerHTML = '';
        
        const query = State.bq.search.toLowerCase();
        State.bq.filtered = State.bq.tables.filter(t => 
            t.dataset.toLowerCase().includes(query) || 
            t.table.toLowerCase().includes(query)
        );
        
        // Render stats
        const total = State.bq.filtered.length;
        const srcOnly = State.bq.filtered.filter(t => t.status === 'source_only').length;
        const tgtOnly = State.bq.filtered.filter(t => t.status === 'target_only').length;
        const diff = State.bq.filtered.filter(t => t.status === 'different').length;
        const eq = State.bq.filtered.filter(t => t.status === 'identical').length;

        Utils.$('bq-summary').innerHTML = `
            <div class="p-3 rounded-lg text-center" style="background:var(--bg)"><div class="text-lg font-bold mono">${total}</div><div class="text-[10px]" style="color:var(--muted)">Total</div></div>
            <div class="p-3 rounded-lg text-center" style="background:var(--bg)"><div class="text-lg font-bold mono" style="color:var(--info)">${srcOnly}</div><div class="text-[10px]" style="color:var(--muted)">Src Only</div></div>
            <div class="p-3 rounded-lg text-center" style="background:var(--bg)"><div class="text-lg font-bold mono" style="color:var(--warn)">${diff}</div><div class="text-[10px]" style="color:var(--muted)">Different</div></div>
            <div class="p-3 rounded-lg text-center" style="background:var(--bg)"><div class="text-lg font-bold mono" style="color:var(--ok)">${eq}</div><div class="text-[10px]" style="color:var(--muted)">Identical</div></div>
            <div class="p-3 rounded-lg text-center" style="background:var(--bg)"><div class="text-lg font-bold mono" style="color:var(--muted)">${tgtOnly}</div><div class="text-[10px]" style="color:var(--muted)">Tgt Only</div></div>
        `;

        const start = (State.bq.page - 1) * State.bq.perPage;
        const pageData = State.bq.filtered.slice(start, start + State.bq.perPage);
        
        if (pageData.length === 0) {
            tbody.innerHTML = `<div class="card p-6 text-center text-sm" style="color:var(--muted)">No tables found</div>`;
            Utils.$('bq-pagination').innerHTML = '';
            return;
        }
        
        const tableHtml = `
            <div class="card" style="padding:0;overflow:hidden">
                <table class="w-full text-xs mono" style="border-collapse:collapse">
                    <thead>
                        <tr style="background:var(--bg2)">
                            <th class="text-left px-4 py-3 w-10"><div class="chk" id="chk-all-bq" onclick="App.toggleAllBq()"></div></th>
                            <th class="text-left px-4 py-3" style="color:var(--muted)">Table Path</th>
                            <th class="text-left px-4 py-3 w-32" style="color:var(--muted)">Status</th>
                            <th class="text-left px-4 py-3 w-64" style="color:var(--muted)">Diff Summary</th>
                        </tr>
                    </thead>
                    <tbody id="bq-table-body-rows"></tbody>
                </table>
            </div>
        `;
        tbody.innerHTML = tableHtml;
        const rowsContainer = Utils.$('bq-table-body-rows');
        
        pageData.forEach(r => {
            const tablePath = `${r.dataset}.${r.table}`;
            const sel = State.bq.selected.has(tablePath);
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid var(--brd)';
            
            let badgeText = 'Checking...';
            let badgeColor = 'var(--muted)';
            let badgeBg = 'var(--hover)';
            let diffSum = '—';
            
            if (r.status === 'source_only') {
                badgeText = 'SRC ONLY';
                badgeColor = 'var(--info)';
                badgeBg = 'var(--info-dim)';
                diffSum = 'Does not exist in target';
            } else if (r.status === 'target_only') {
                badgeText = 'TGT ONLY';
                badgeColor = 'var(--muted)';
                badgeBg = 'var(--hover)';
                diffSum = 'Exists only in target';
            } else if (r.status === 'identical') {
                badgeText = 'IDENTICAL';
                badgeColor = 'var(--ok)';
                badgeBg = 'var(--ok-dim)';
                diffSum = 'Schemas match';
            } else if (r.status === 'different') {
                badgeText = 'COMPARING';
                badgeColor = 'var(--warn)';
                badgeBg = 'var(--warn-dim)';
                diffSum = 'Comparing schemas...';
            }
            
            tr.innerHTML = `
                <td class="px-4 py-3"><div class="chk ${sel?'on':''}"></div></td>
                <td class="px-4 py-3 cursor-pointer font-semibold" style="color:var(--fg)">${tablePath} <i class="fa-solid fa-chevron-down" style="font-size:9px;color:var(--muted);margin-left:4px"></i></td>
                <td class="px-4 py-3"><span class="badge status-badge" style="background:${badgeBg};color:${badgeColor}">${badgeText}</span></td>
                <td class="px-4 py-3" style="color:var(--muted)">${diffSum}</td>
            `;
            
            const keyTd = tr.querySelectorAll('td')[1];
            keyTd.onclick = () => App.toggleBqRowExpand(tr, r);
            
            const chk = tr.querySelector('.chk');
            chk.onclick = () => App.toggleBqSelect(tablePath, chk);
            
            rowsContainer.appendChild(tr);
            
            if (r.status === 'different' && !r.srcSchema) {
                App.compareBqTableSchema(r, tr);
            }
        });
        
        const totalPages = Math.ceil(State.bq.filtered.length / State.bq.perPage);
        Utils.$('bq-pagination').innerHTML = totalPages > 1 
            ? `<button class="btn btn-s" ${State.bq.page===1?'disabled':''} onclick="App.bqPage(${State.bq.page-1})">Prev</button><span class="mono text-xs" style="color:var(--muted);padding:0 12px">Page ${State.bq.page} of ${totalPages}</span><button class="btn btn-s" ${State.bq.page===totalPages?'disabled':''} onclick="App.bqPage(${State.bq.page+1})">Next</button>` 
            : '';
            
        App.updateSelectAllBqState();
    },

    bqPage: (p) => { State.bq.page = p; App.renderBqResults(); },
    toggleBqSelect: (tablePath, el) => {
        if (State.bq.selected.has(tablePath)) State.bq.selected.delete(tablePath);
        else State.bq.selected.add(tablePath);
        el.classList.toggle('on');
        const disableBtn = State.bq.selected.size === 0;
        Utils.$('btn-bq-copy-s2t').disabled = disableBtn;
        Utils.$('btn-bq-copy-t2s').disabled = disableBtn;
        App.updateSelectAllBqState();
    },
    toggleAllBq: () => {
        const allSel = State.bq.selected.size === State.bq.filtered.length && State.bq.filtered.length > 0;
        if (allSel) State.bq.selected.clear();
        else State.bq.filtered.forEach(r => State.bq.selected.add(`${r.dataset}.${r.table}`));
        App.renderBqResults();
        const disableBtn = State.bq.selected.size === 0;
        Utils.$('btn-bq-copy-s2t').disabled = disableBtn;
        Utils.$('btn-bq-copy-t2s').disabled = disableBtn;
    },
    updateSelectAllBqState: () => {
        const chkAll = Utils.$('chk-all-bq'); if(!chkAll) return;
        const isAll = State.bq.filtered.length > 0 && State.bq.selected.size === State.bq.filtered.length;
        chkAll.classList.toggle('on', isAll);
    },

    toggleBqRowExpand: async (tr, r) => {
        const existingNext = tr.nextElementSibling;
        if (existingNext?.classList.contains('expand-row')) { existingNext.remove(); return; }
        
        const expTr = document.createElement('tr');
        expTr.className = 'expand-row';
        expTr.style.borderBottom = '1px solid var(--brd)';
        
        let content = `<div class="px-6 py-3 text-xs"><span class="spinner"></span> Loading schema details...</div>`;
        expTr.innerHTML = `<td colspan="4" class="px-6 py-3" style="background:var(--bg)">${content}</td>`;
        tr.after(expTr);
        
        try {
            if (!r.srcSchema && r.status !== 'target_only') r.srcSchema = await Api.getSchema(State.bq.src, r.dataset, r.table);
            if (!r.tgtSchema && r.status !== 'source_only') r.tgtSchema = await Api.getSchema(State.bq.tgt, r.dataset, r.table);
            
            let html = '';
            if (r.status === 'identical') {
                html = `<div class="text-xs font-semibold text-emerald-400"><i class="fa-solid fa-circle-check mr-1"></i> Schemas are fully identical.</div>`;
            } else if (r.status === 'source_only') {
                let rows = r.srcSchema.map(f => `<tr><td class="px-3 py-1.5 font-semibold">${Utils.escapeHtml(f.name)}</td><td class="px-3 py-1.5">${Utils.escapeHtml(f.type)}</td><td class="px-3 py-1.5">${Utils.escapeHtml(f.mode)}</td></tr>`).join('');
                html = `
                    <div class="mb-2 text-xs font-semibold text-blue-400">Table exists only in source. Schema:</div>
                    <table class="w-full text-xs mono" style="border-collapse:collapse">
                        <thead><tr style="background:var(--bg2)"><th class="text-left px-3 py-1">Field</th><th class="text-left px-3 py-1">Type</th><th class="text-left px-3 py-1">Mode</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                `;
            } else if (r.status === 'target_only') {
                let rows = r.tgtSchema.map(f => `<tr><td class="px-3 py-1.5 font-semibold">${Utils.escapeHtml(f.name)}</td><td class="px-3 py-1.5">${Utils.escapeHtml(f.type)}</td><td class="px-3 py-1.5">${Utils.escapeHtml(f.mode)}</td></tr>`).join('');
                html = `
                    <div class="mb-2 text-xs font-semibold" style="color:var(--muted)">Table exists only in target. Schema:</div>
                    <table class="w-full text-xs mono" style="border-collapse:collapse">
                        <thead><tr style="background:var(--bg2)"><th class="text-left px-3 py-1">Field</th><th class="text-left px-3 py-1">Type</th><th class="text-left px-3 py-1">Mode</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                `;
            } else {
                const diffs = r.diffs || App.compareFields(r.srcSchema, r.tgtSchema);
                let rows = diffs.map(d => {
                    const cls = d.type === 'added' ? 'diff-add' : d.type === 'removed' ? 'diff-rem' : 'diff-mod';
                    return `
                        <tr class="${cls}">
                            <td class="px-3 py-1.5 font-semibold">${Utils.escapeHtml(d.field)}</td>
                            <td class="px-3 py-1.5"><span class="badge" style="background:var(--bg2);color:${d.type==='added'?'var(--ok)':d.type==='removed'?'var(--danger)':'var(--warn)'}">${d.type}</span></td>
                            <td class="px-3 py-1.5">${Utils.escapeHtml(d.src)}</td>
                            <td class="px-3 py-1.5">${Utils.escapeHtml(d.tgt)}</td>
                        </tr>
                    `;
                }).join('');
                html = `
                    <table class="w-full text-xs mono" style="border-collapse:collapse">
                        <thead>
                            <tr style="background:var(--bg2)">
                                <th class="text-left px-3 py-1">Field Path</th>
                                <th class="text-left px-3 py-1">Diff Type</th>
                                <th class="text-left px-3 py-1">Source</th>
                                <th class="text-left px-3 py-1">Target</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                `;
            }
            expTr.querySelector('td').innerHTML = html;
        } catch (e) {
            expTr.querySelector('td').innerHTML = `<div class="text-xs text-red-400">Error: ${e.message}</div>`;
        }
    },

    openBqCopyModal: (direction) => {
        const selected = [...State.bq.selected]; if(selected.length === 0) return;
        const fromPid = direction === 't2s' ? State.bq.tgt : State.bq.src;
        const toPid = direction === 't2s' ? State.bq.src : State.bq.tgt;
        UI.openModal(`
            <div class="p-5 text-left">
                <h3 class="font-semibold mb-4 text-base">Copy BigQuery Schemas</h3>
                <div class="warning-box"><i class="fa-solid fa-triangle-exclamation"></i><div><strong>Backup!</strong> Syncing schemas will patch or recreate tables in the destination project. <a href="https://cloud.google.com/bigquery/docs/table-snapshots-intro" target="_blank">Create Snapshots</a>.</div></div>
                <div class="text-xs mb-3" style="color:var(--muted)">
                    <p class="mb-1"><strong>Source (From):</strong> ${Utils.escapeHtml(fromPid)}</p>
                    <p class="mb-1"><strong>Destination (To):</strong> ${Utils.escapeHtml(toPid)}</p>
                </div>
                <p class="text-sm mb-4 font-semibold">${selected.length} tables selected.</p>
                <div class="flex justify-end gap-2">
                    <button class="btn btn-s" onclick="UI.closeModal()">Cancel</button>
                    <button class="btn btn-p" id="btn-bq-confirm-copy">Confirm Copy</button>
                </div>
            </div>
        `);
        Utils.$('btn-bq-confirm-copy').onclick = () => {
            UI.closeModal();
            App.executeBqCopy(direction);
        };
    },

    executeBqCopy: async (direction = 's2t') => {
        const selected = [...State.bq.selected]; if(selected.length === 0) return;
        const fromPid = direction === 't2s' ? State.bq.tgt : State.bq.src;
        const toPid = direction === 't2s' ? State.bq.src : State.bq.tgt;
        Utils.show('sec-loading'); Utils.hide('load-ds-stats'); Utils.hide('btn-cancel-ds');
        Utils.$('load-title').textContent = "Syncing BQ Schemas...";
        let ok = 0, fail = 0;
        const backupData = [];
        for (let i = 0; i < selected.length; i++) {
            const path = selected[i]; const [dataset, table] = path.split('.');
            const r = State.bq.tables.find(x => x.dataset === dataset && x.table === table);
            if (!r) continue;
            Utils.$('load-msg').textContent = `Syncing ${i+1}/${selected.length}: ${path}`;
            try {
                const fromSchema = await Api.getSchema(fromPid, dataset, table);
                
                let location = null;
                try {
                    const srcDsMeta = await Api.getDataset(fromPid, dataset);
                    location = srcDsMeta.location;
                } catch(err) {
                    console.error("Failed to fetch source dataset location, falling back", err);
                }
                
                let prevSchema = null;
                let existsInDest = false;
                try {
                    prevSchema = await Api.getSchema(toPid, dataset, table);
                    existsInDest = true;
                } catch(err) {
                    console.log("Table does not exist in destination, or schema fetch failed", err);
                }
                
                await Api.createDataset(toPid, dataset, location);
                let actionApplied = !existsInDest ? 'create' : 'patch';
                if (!existsInDest) {
                    await Api.createTable(toPid, dataset, table, fromSchema);
                } else {
                    try {
                        await Api.patchTable(toPid, dataset, table, fromSchema);
                    } catch (patchErr) {
                        // Prevent silent table deletion and data loss. Reject incompatible schema changes.
                        throw new Error(`Incompatible schema change on destination table (change of field type, mode, or deleted column). Sync failed to prevent data loss. Error: ${patchErr.message}`);
                    }
                }
                
                backupData.push({
                    tablePath: path,
                    action: actionApplied,
                    prevSchema: prevSchema
                });
                ok++;
            } catch (e) { fail++; Utils.toast(`Failed ${path}: ${e.message}`, 'err'); }
        }
        Utils.hide('sec-loading'); Utils.toast(`Sync completed. Success: ${ok}, Failed: ${fail}`, ok > 0 ? 'ok' : 'err');
        const status = fail === 0 && ok > 0 ? "SUCCESS" : (ok > 0 ? "PARTIAL" : "FAILED");
        const details = `Synced ${ok} tables from ${fromPid} to ${toPid}, failed ${fail} tables. Tables: ${selected.join(', ')}`;
        await AuditLog.addLog("BQ_SCHEMA_SYNC", fromPid, toPid, details, status, {
            type: "BQ_SCHEMA_SYNC",
            backupData: backupData
        });
        await App.runBqCompare();
    },

    // --- QUERY logic ---
    runQueryFetch: async () => {
        State.query.src = Utils.$('q-src').value; 
        State.query.tgt = Utils.$('q-tgt').value;
        State.query.srcLoc = Utils.$('q-src-loc').value || 'us';
        State.query.tgtLoc = Utils.$('q-tgt-loc').value || 'us';
        if(!State.query.src || !State.query.tgt) return Utils.toast("Select projects", "err");
        Utils.hide('sec-forms'); Utils.show('sec-loading'); Utils.$('load-title').textContent = "Fetching Scheduled Queries";
        try { 
            const [srcQueries, tgtQueries] = await Promise.all([
                Api.getQueries(State.query.src, State.query.srcLoc),
                Api.getQueries(State.query.tgt, State.query.tgtLoc)
            ]);

            const tgtMap = new Map();
            tgtQueries.forEach(q => {
                if (q.displayName) {
                    tgtMap.set(q.displayName, q);
                }
            });

            const srcMap = new Map();
            srcQueries.forEach(q => {
                if (q.displayName) {
                    srcMap.set(q.displayName, q);
                }
            });

            const allNames = new Set([...srcMap.keys(), ...tgtMap.keys()]);
            State.query.queries = [];

            allNames.forEach(name => {
                const srcQ = srcMap.get(name);
                const tgtQ = tgtMap.get(name);

                let status = 'identical';
                let diffFields = [];

                if (srcQ && tgtQ) {
                    const srcSched = srcQ.schedule || '';
                    const tgtSched = tgtQ.schedule || '';
                    const srcDs = srcQ.destinationDatasetId || '';
                    const tgtDs = tgtQ.destinationDatasetId || '';
                    const srcSql = srcQ.params?.query || '';
                    const tgtSql = tgtQ.params?.query || '';

                    if (srcSched !== tgtSched || srcDs !== tgtDs || srcSql !== tgtSql) {
                        status = 'different';
                        if (srcSched !== tgtSched) diffFields.push('schedule');
                        if (srcDs !== tgtDs) diffFields.push('destinationDatasetId');
                        if (srcSql !== tgtSql) diffFields.push('query');
                    }
                } else if (srcQ) {
                    status = 'source_only';
                } else {
                    status = 'target_only';
                }

                State.query.queries.push({
                    name: srcQ ? srcQ.name : tgtQ.name,
                    displayName: name,
                    status,
                    srcQuery: srcQ || null,
                    tgtQuery: tgtQ || null,
                    diffFields
                });
            });

            State.query.queries.sort((a, b) => a.displayName.localeCompare(b.displayName));

            Utils.hide('sec-loading'); Utils.show('sec-results'); Utils.show('res-query'); 
            App.renderQueryResults();
        } catch(e) { Utils.hide('sec-loading'); Utils.show('sec-forms'); Utils.toast(e.message, 'err'); }
    },
    renderQueryResults: () => {
        const container = Utils.$('q-list'); container.innerHTML = '';
        if (State.query.queries.length === 0) {
            container.innerHTML = `<div class="card p-6 text-center text-sm" style="color:var(--muted)">No scheduled queries found.</div>`;
            return;
        }

        const total = State.query.queries.length;
        const srcOnly = State.query.queries.filter(q => q.status === 'source_only').length;
        const tgtOnly = State.query.queries.filter(q => q.status === 'target_only').length;
        const diff = State.query.queries.filter(q => q.status === 'different').length;
        const eq = State.query.queries.filter(q => q.status === 'identical').length;

        const summaryEl = Utils.$('q-summary');
        if (summaryEl) {
            summaryEl.innerHTML = `
                <div class="p-3 rounded-lg text-center" style="background:var(--bg)"><div class="text-lg font-bold mono">${total}</div><div class="text-[10px]" style="color:var(--muted)">Total</div></div>
                <div class="p-3 rounded-lg text-center" style="background:var(--bg)"><div class="text-lg font-bold mono" style="color:var(--info)">${srcOnly}</div><div class="text-[10px]" style="color:var(--muted)">Src Only</div></div>
                <div class="p-3 rounded-lg text-center" style="background:var(--bg)"><div class="text-lg font-bold mono" style="color:var(--warn)">${diff}</div><div class="text-[10px]" style="color:var(--muted)">Different</div></div>
                <div class="p-3 rounded-lg text-center" style="background:var(--bg)"><div class="text-lg font-bold mono" style="color:var(--ok)">${eq}</div><div class="text-[10px]" style="color:var(--muted)">Identical</div></div>
                <div class="p-3 rounded-lg text-center" style="background:var(--bg)"><div class="text-lg font-bold mono" style="color:var(--muted)">${tgtOnly}</div><div class="text-[10px]" style="color:var(--muted)">Tgt Only</div></div>
            `;
        }

        const tableHtml = `
            <div class="card" style="padding:0;overflow:hidden">
                <table class="w-full text-xs mono" style="border-collapse:collapse">
                    <thead>
                        <tr style="background:var(--bg2)">
                            <th class="text-left px-4 py-3 w-10"><div class="chk" id="chk-all-q" onclick="App.toggleAllQ()"></div></th>
                            <th class="text-left px-4 py-3" style="color:var(--muted)">Display Name</th>
                            <th class="text-left px-4 py-3 w-32" style="color:var(--muted)">Status</th>
                            <th class="text-left px-4 py-3" style="color:var(--muted)">Schedule</th>
                            <th class="text-left px-4 py-3" style="color:var(--muted)">Dataset ID</th>
                        </tr>
                    </thead>
                    <tbody id="q-table-body-rows"></tbody>
                </table>
            </div>
        `;
        container.innerHTML = tableHtml;
        const rowsContainer = Utils.$('q-table-body-rows');
        State.query.queries.forEach(q => {
            const qId = q.name; const sel = State.query.selected.has(qId);
            const tr = document.createElement('tr'); tr.style.borderBottom = '1px solid var(--brd)';
            
            let badgeText = '';
            let badgeColor = '';
            let badgeBg = '';
            if (q.status === 'source_only') {
                badgeText = 'SRC ONLY';
                badgeColor = 'var(--info)';
                badgeBg = 'var(--info-dim)';
            } else if (q.status === 'target_only') {
                badgeText = 'TGT ONLY';
                badgeColor = 'var(--muted)';
                badgeBg = 'var(--hover)';
            } else if (q.status === 'identical') {
                badgeText = 'IDENTICAL';
                badgeColor = 'var(--ok)';
                badgeBg = 'var(--ok-dim)';
            } else if (q.status === 'different') {
                badgeText = 'DIFFERENT';
                badgeColor = 'var(--warn)';
                badgeBg = 'var(--warn-dim)';
            }

            const isCopyable = q.srcQuery !== null;
            const chkHtml = isCopyable 
                ? `<div class="chk ${sel?'on':''}"></div>` 
                : `<div class="chk disabled" style="opacity:0.3;cursor:not-allowed"></div>`;

            tr.innerHTML = `
                <td class="px-4 py-3">${chkHtml}</td>
                <td class="px-4 py-3 cursor-pointer font-semibold" style="color:var(--fg)">${Utils.escapeHtml(q.displayName)} <i class="fa-solid fa-chevron-down" style="font-size:9px;color:var(--muted);margin-left:4px"></i></td>
                <td class="px-4 py-3"><span class="badge status-badge" style="background:${badgeBg};color:${badgeColor}">${badgeText}</span></td>
                <td class="px-4 py-3" style="color:var(--muted)">${Utils.escapeHtml(q.srcQuery?.schedule || q.tgtQuery?.schedule || 'Manual')}</td>
                <td class="px-4 py-3" style="color:var(--accent)">${Utils.escapeHtml(q.srcQuery?.destinationDatasetId || q.tgtQuery?.destinationDatasetId || '—')}</td>
            `;
            const keyTd = tr.querySelectorAll('td')[1];
            keyTd.onclick = () => App.toggleQueryDetails(tr, q);
            if (isCopyable) {
                const chk = tr.querySelector('.chk');
                chk.onclick = () => App.toggleQSelect(qId, chk);
            }
            rowsContainer.appendChild(tr);
        });
        App.updateSelectAllQState();
    },
    toggleQSelect: (qId, el) => {
        if (State.query.selected.has(qId)) State.query.selected.delete(qId);
        else State.query.selected.add(qId);
        el.classList.toggle('on');
        Utils.$('btn-q-copy').disabled = State.query.selected.size === 0;
        App.updateSelectAllQState();
    },
    toggleAllQ: () => {
        const copyableQueries = State.query.queries.filter(q => q.srcQuery !== null);
        const allSel = State.query.selected.size === copyableQueries.length && copyableQueries.length > 0;
        if (allSel) State.query.selected.clear();
        else copyableQueries.forEach(q => State.query.selected.add(q.name));
        App.renderQueryResults();
        Utils.$('btn-q-copy').disabled = State.query.selected.size === 0;
    },
    updateSelectAllQState: () => {
        const chkAll = Utils.$('chk-all-q'); if(!chkAll) return;
        const copyableQueries = State.query.queries.filter(q => q.srcQuery !== null);
        const isAll = copyableQueries.length > 0 && State.query.selected.size === copyableQueries.length;
        chkAll.classList.toggle('on', isAll);
    },
    toggleQueryDetails: (tr, q) => {
        const existingNext = tr.nextElementSibling;
        if (existingNext?.classList.contains('expand-row')) { existingNext.remove(); return; }
        const expTr = document.createElement('tr'); expTr.className = 'expand-row'; expTr.style.borderBottom = '1px solid var(--brd)';
        
        let html = '';
        if (q.status === 'different') {
            const srcSched = q.srcQuery?.schedule || 'Manual';
            const tgtSched = q.tgtQuery?.schedule || 'Manual';
            const srcDs = q.srcQuery?.destinationDatasetId || '—';
            const tgtDs = q.tgtQuery?.destinationDatasetId || '—';
            const srcSql = q.srcQuery?.params?.query || '';
            const tgtSql = q.tgtQuery?.params?.query || '';
            const diffFieldsList = q.diffFields.join(', ');

            html = `
                <div class="mb-3 text-[11px]" style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
                    <div>
                        <div class="font-bold text-[10px] text-zinc-500 mb-1">SOURCE CONFIG:</div>
                        <div style="background:var(--bg2); border:1px solid var(--brd); padding: 8px; border-radius: 6px;">
                            <div><strong>Schedule:</strong> ${Utils.escapeHtml(srcSched)}</div>
                            <div><strong>Dataset ID:</strong> ${Utils.escapeHtml(srcDs)}</div>
                        </div>
                    </div>
                    <div>
                        <div class="font-bold text-[10px] text-zinc-500 mb-1">TARGET CONFIG:</div>
                        <div style="background:var(--bg2); border:1px solid var(--brd); padding: 8px; border-radius: 6px;">
                            <div><strong>Schedule:</strong> ${Utils.escapeHtml(tgtSched)}</div>
                            <div><strong>Dataset ID:</strong> ${Utils.escapeHtml(tgtDs)}</div>
                        </div>
                    </div>
                </div>
                <div class="p-3 rounded mb-3" style="background:var(--bg); border: 1px solid var(--warn-dim)">
                    <span style="color:var(--warn); font-weight:bold; font-size:11px">DIFFERENCES DETECTED IN: ${diffFieldsList.toUpperCase()}</span>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <div class="mb-1 font-bold text-[10px] tracking-wider" style="color:var(--info)">SOURCE SQL:</div>
                        <pre class="p-3 rounded text-[11px] overflow-x-auto" style="background:#090d12;border:1px solid var(--brd2);color:var(--accent2)">${Utils.escapeHtml(srcSql)}</pre>
                    </div>
                    <div>
                        <div class="mb-1 font-bold text-[10px] tracking-wider" style="color:var(--muted)">TARGET SQL:</div>
                        <pre class="p-3 rounded text-[11px] overflow-x-auto" style="background:#090d12;border:1px solid var(--brd2);color:var(--accent2)">${Utils.escapeHtml(tgtSql)}</pre>
                    </div>
                </div>
            `;
        } else if (q.status === 'identical') {
            const sql = q.srcQuery?.params?.query || '';
            html = `
                <div class="p-3 rounded" style="background:var(--bg)">
                    <div class="mb-2 font-bold text-[10px] tracking-wider" style="color:var(--ok)">SQL QUERY (IDENTICAL):</div>
                    <pre class="p-3 rounded text-[11px] overflow-x-auto" style="background:#090d12;border:1px solid var(--brd2);color:var(--accent2)">${Utils.escapeHtml(sql)}</pre>
                </div>
            `;
        } else if (q.status === 'source_only') {
            const sql = q.srcQuery?.params?.query || '';
            html = `
                <div class="p-3 rounded" style="background:var(--bg)">
                    <div class="mb-2 font-bold text-[10px] tracking-wider" style="color:var(--info)">SOURCE SQL (ONLY IN SOURCE):</div>
                    <pre class="p-3 rounded text-[11px] overflow-x-auto" style="background:#090d12;border:1px solid var(--brd2);color:var(--accent2)">${Utils.escapeHtml(sql)}</pre>
                </div>
            `;
        } else if (q.status === 'target_only') {
            const sql = q.tgtQuery?.params?.query || '';
            html = `
                <div class="p-3 rounded" style="background:var(--bg)">
                    <div class="mb-2 font-bold text-[10px] tracking-wider" style="color:var(--muted)">TARGET SQL (ONLY IN TARGET):</div>
                    <pre class="p-3 rounded text-[11px] overflow-x-auto" style="background:#090d12;border:1px solid var(--brd2);color:var(--accent2)">${Utils.escapeHtml(sql)}</pre>
                </div>
            `;
        }
        expTr.innerHTML = `<td colspan="5" class="px-6 py-3" style="background:var(--bg)">${html}</td>`;
        tr.after(expTr);
    },
    openQueryCopyModal: () => {
        const selected = [...State.query.selected]; if(selected.length === 0) return;
        UI.openModal(`
            <div class="p-5 text-left">
                <h3 class="font-semibold mb-4 text-base">Copy Scheduled Queries</h3>
                <div class="warning-box"><i class="fa-solid fa-triangle-exclamation"></i><div><strong>Verify SQL project references!</strong> Ensure that query parameters and SQL project IDs inside the query body are updated for the destination project.</div></div>
                <div class="text-xs mb-3" style="color:var(--muted)">
                    <p class="mb-1"><strong>Source (From):</strong> ${Utils.escapeHtml(State.query.src)}</p>
                    <p class="mb-1"><strong>Destination (To):</strong> ${Utils.escapeHtml(State.query.tgt)}</p>
                </div>
                <p class="text-sm mb-4 font-semibold">${selected.length} scheduled queries selected.</p>
                <div class="flex justify-end gap-2">
                    <button class="btn btn-s" onclick="UI.closeModal()">Cancel</button>
                    <button class="btn btn-p" id="btn-q-confirm-copy">Confirm Copy</button>
                </div>
            </div>
        `);
        Utils.$('btn-q-confirm-copy').onclick = () => {
            UI.closeModal();
            App.executeQueryCopy();
        };
    },

    executeQueryCopy: async () => {
        const selected = [...State.query.selected]; if (selected.length === 0) return;
        Utils.show('sec-loading'); Utils.hide('load-ds-stats'); Utils.hide('btn-cancel-ds');
        Utils.$('load-title').textContent = "Copying Scheduled Queries...";
        let ok = 0, fail = 0;
        const backupData = [];
        for (let i = 0; i < selected.length; i++) {
            const qId = selected[i];
            const cmpObj = State.query.queries.find(x => x.name === qId);
            if (!cmpObj || !cmpObj.srcQuery) continue;
            const q = cmpObj.srcQuery;
            Utils.$('load-msg').textContent = `Copying ${i+1}/${selected.length}: ${q.displayName}`;
            try {
                let actionApplied = 'create';
                if (cmpObj.tgtQuery) {
                    await Api.deleteQuery(cmpObj.tgtQuery.name);
                    actionApplied = 'update';
                }
                const created = await Api.createQuery(State.query.tgt, State.query.tgtLoc, q);
                if (created && created.name) {
                    backupData.push({
                        action: actionApplied,
                        name: created.name,
                        displayName: q.displayName,
                        prevQuery: cmpObj.tgtQuery ? {
                            displayName: cmpObj.tgtQuery.displayName,
                            schedule: cmpObj.tgtQuery.schedule,
                            destinationDatasetId: cmpObj.tgtQuery.destinationDatasetId,
                            params: cmpObj.tgtQuery.params
                        } : null
                    });
                }
                ok++;
            } catch (e) { 
                fail++; 
                console.error(`Query copy error for ${q.displayName}:`, e);
                Utils.toast(`Failed: ${q.displayName} - ${e.message}`, 'err'); 
            }
        }
        Utils.hide('sec-loading'); Utils.toast(`Queries copied. Success: ${ok}, Failed: ${fail}`, ok > 0 ? 'ok' : 'err');
        const status = fail === 0 && ok > 0 ? "SUCCESS" : (ok > 0 ? "PARTIAL" : "FAILED");
        const details = `Copied ${ok} scheduled queries, failed ${fail} queries.`;
        await AuditLog.addLog("QUERY_SYNC", State.query.src, State.query.tgt, details, status, {
            type: "QUERY_SYNC",
            backupData: backupData
        });
        State.query.selected.clear(); Utils.$('btn-q-copy').disabled = true;
        await App.runQueryFetch();
    },

    // --- DATASTORE logic ---
    runDsAnalyze: async () => {
        State.ds.src = Utils.$('ds-src').value; State.ds.tgt = Utils.$('ds-tgt').value; State.ds.kind = Utils.$('ds-kind').value;
        if(!State.ds.src || !State.ds.tgt || !State.ds.kind) return Utils.toast("Fill required fields", "err");

        State.ds.results = []; State.ds.stats = {identical:0, different:0, missing:0, total:0}; State.cancelDs = false;
        Utils.hide('sec-forms'); Utils.show('sec-loading'); Utils.show('load-ds-stats'); Utils.show('btn-cancel-ds');
        Utils.$('load-title').textContent = "Analyzing Entities..."; 

        const parseVal = (v) => {
            if (v === 'true') return { booleanValue: true };
            if (v === 'false') return { booleanValue: false };
            if (!isNaN(v) && v.trim() !== '') {
                if (v.includes('.')) return { doubleValue: parseFloat(v) };
                return { integerValue: String(parseInt(v, 10)) };
            }
            return { stringValue: v };
        };

        const parseAncestorKey = (str) => {
            const parts = str.split('|').map(x => x.trim()).filter(Boolean);
            if (parts.length === 0) throw new Error("Key path cannot be empty.");
            const path = parts.map(part => {
                const sepIndex = part.indexOf(':');
                if (sepIndex === -1) throw new Error(`Invalid element "${part}". Use Kind:Name or Kind:ID.`);
                const kind = part.substring(0, sepIndex).trim();
                const val = part.substring(sepIndex + 1).trim();
                if (!kind || !val) throw new Error(`Invalid element "${part}". Use Kind:Name or Kind:ID.`);
                const isNum = !isNaN(val) && val !== '';
                return isNum ? { kind, id: val } : { kind, name: val };
            });
            return { keyValue: { path, partitionId: { projectId: State.ds.src } } };
        };

        const body = { partitionId: { projectId: State.ds.src }, query: { kind: [{ name: State.ds.kind }] } };
        const filters = Utils.$('ds-filters-container').querySelectorAll('.filter-row');
        if(filters.length > 0) {
            const props = [];
            try {
                filters.forEach(r => { 
                    const prop = r.querySelector('select:first-child').value; 
                    const op = r.querySelectorAll('select')[1].value; 
                    const val = r.querySelector('input').value; 
                    if(prop && val) {
                        if (op === 'HAS_ANCESTOR') {
                            const keyValue = parseAncestorKey(val);
                            props.push({ propertyFilter: { property: { name: '__key__' }, op: 'HAS_ANCESTOR', value: keyValue } });
                        } else if (op === 'IN' || op === 'NOT_IN') {
                            const vals = val.split(',').map(x => x.trim()).filter(x => x !== '');
                            const arrayVal = { arrayValue: { values: vals.map(v => parseVal(v)) } };
                            props.push({ propertyFilter: { property: { name: prop }, op: op, value: arrayVal } });
                        } else {
                            props.push({ propertyFilter: { property: { name: prop }, op: op, value: parseVal(val) } }); 
                        }
                    }
                });
            } catch (err) {
                Utils.toast(err.message, 'err');
                return;
            }
            if(props.length > 0) body.query.filter = { compositeFilter: { op: 'AND', filters: props } };
        }

        try {
            let cursor = null; let totalScanned = 0;
            do {
                if(cursor) body.query.startCursor = cursor;
                Utils.$('load-msg').textContent = `Scanned ${totalScanned} entities... (Fetching batch)`;
                const res = await Api.runDatastoreQuery(State.ds.src, body);
                const srcEntities = res.batch?.entityResults || [];
                cursor = res.batch?.endCursor; 
                if(srcEntities.length === 0) break;

                for (let i = 0; i < srcEntities.length; i += 100) {
                    if(State.cancelDs) throw new Error("Process Cancelled");
                    const chunk = srcEntities.slice(i, i + 100);
                    const keysToLookup = chunk.map(e => {
                        const keyCopy = JSON.parse(JSON.stringify(e.entity.key));
                        keyCopy.partitionId = { projectId: State.ds.tgt };
                        return keyCopy;
                    });
                    
                    Utils.$('load-msg').textContent = `Scanned ${totalScanned} entities... (Comparing batch)`;
                    const tgtRes = await Api.lookupEntities(State.ds.tgt, keysToLookup);
                    
                    const tgtMap = new Map((tgtRes.found||[]).map(e => [App.formatKey(e.entity.key), e.entity]));
                    const missingSet = new Set((tgtRes.missing||[]).map(e => App.formatKey(e.entity.key)));

                    for (const srcE of chunk) {
                        const kStr = App.formatKey(srcE.entity.key);
                        State.ds.stats.total++;
                        if(missingSet.has(kStr)) {
                            State.ds.stats.missing++;
                            State.ds.results.push({ keyStr: kStr, rawKey: srcE.entity.key, status: 'missing', diffSum: 'Missing in Target', srcEntity: srcE.entity, tgtEntity: null });
                        } else {
                            const tgtEnt = tgtMap.get(kStr);
                            const diff = App.compareEntities(srcE.entity, tgtEnt);
                            if(diff.length > 0) {
                                State.ds.stats.different++;
                                const diffSum = diff.map(d=>d.prop).join(', ');
                                State.ds.results.push({ keyStr: kStr, rawKey: srcE.entity.key, status: 'different', diff, diffSum, srcEntity: srcE.entity, tgtEntity: tgtEnt });
                            } else {
                                State.ds.stats.identical++;
                                if(State.ds.results.length < 20000) State.ds.results.push({ keyStr: kStr, rawKey: srcE.entity.key, status: 'identical', diff:[], diffSum: '—', srcEntity: srcE.entity, tgtEntity: tgtEnt });
                            }
                        }
                        totalScanned++;
                    }
                }
                
                Utils.$('ld-identical').textContent = State.ds.stats.identical; 
                Utils.$('ld-different').textContent = State.ds.stats.different; 
                Utils.$('ld-missing').textContent = State.ds.stats.missing;
                await new Promise(resolve => setTimeout(resolve, 0));
            } while(cursor);

            Utils.hide('sec-loading'); Utils.show('sec-results'); Utils.show('res-ds'); App.filterDsResults('all');
        } catch(e) { 
            Utils.hide('sec-loading'); Utils.show('sec-forms'); 
            if(e.message !== "Process Cancelled") Utils.toast(e.message, 'err'); else Utils.toast("Analysis cancelled.", "info");
        }
    },
    formatKey: (key) => { return key.path.map(p => `${p.kind}:${p.name||p.id}`).join(' | '); },
    compareEntities: (src, tgt) => {
        const diffs = []; const allKeys = new Set([...Object.keys(src?.properties||{}), ...Object.keys(tgt?.properties||{})]);
        for(const k of allKeys) {
            const sVal = src?.properties?.[k]; const tVal = tgt?.properties?.[k];
            if(!App.valsEqual(sVal, tVal)) {
                diffs.push({ prop: k, type: (!sVal && tVal) ? 'added' : (sVal && !tVal) ? 'removed' : 'modified', src: App.formatVal(sVal), tgt: App.formatVal(tVal) });
            }
        } return diffs;
    },
    valsEqual: (a, b) => { return JSON.stringify(a) === JSON.stringify(b); },
    formatVal: (v) => {
        if(!v) return '—'; const k = Object.keys(v).find(k => v[k] !== null && v[k] !== undefined && !(Array.isArray(v[k]?.values) && v[k].values.length === 0));
        if(!k) return '—'; if(k === 'arrayValue') return `[Array:${(v[k].values||[]).length}]`; if(k === 'mapValue') return `{Map}`; if(k === 'entityValue') return `{Entity}`;
        return String(v[k]).substring(0, 50);
    },
    
    filterDsResults: (status) => {
        State.ds.filterStatus = status;
        State.ds.filtered = status === 'all' ? State.ds.results : State.ds.results.filter(r => r.status === status);
        Utils.$('ds-cnt-all').textContent = State.ds.stats.total; Utils.$('ds-cnt-diff').textContent = State.ds.stats.different; Utils.$('ds-cnt-miss').textContent = State.ds.stats.missing; Utils.$('ds-cnt-eq').textContent = State.ds.stats.identical;
        State.ds.page = 1; App.renderDsTable();
    },
    renderDsTable: () => {
        const start = (State.ds.page - 1) * State.ds.perPage;
        const pageData = State.ds.filtered.slice(start, start + State.ds.perPage);
        const tbody = Utils.$('ds-table-body');
        tbody.innerHTML = '';
        
        pageData.forEach(r => {
            const stCfg = {different:{l:'DIFFERENT',c:'var(--warn)',b:'var(--warn-dim)'},missing:{l:'MISSING IN TGT',c:'var(--danger)',b:'var(--danger-dim)'},identical:{l:'IDENTICAL',c:'var(--ok)',b:'var(--ok-dim)'}}[r.status];
            const sel = State.ds.selected.has(r.keyStr);
            const tr = document.createElement('tr'); tr.style.borderBottom = '1px solid var(--brd)';
            tr.innerHTML = `
                <td class="px-4 py-3"><div class="chk ${sel?'on':''}"></div></td>
                <td class="px-4 py-3 cursor-pointer" style="color:var(--fg)">${Utils.escapeHtml(r.keyStr)} <i class="fa-solid fa-chevron-down" style="font-size:9px;color:var(--muted);margin-left:4px"></i></td>
                <td class="px-4 py-3"><span class="badge" style="background:${stCfg.b};color:${stCfg.c}">${stCfg.l}</span></td>
                <td class="px-4 py-3" style="color:var(--muted)">${Utils.escapeHtml(r.diffSum)}</td>`;
            
            const chk = tr.querySelector('.chk'); chk.onclick = () => App.toggleDsSelect(r.keyStr, chk);
            const keyTd = tr.querySelectorAll('td')[1]; keyTd.onclick = () => App.toggleDsRowExpand(tr, r.keyStr);
            tbody.appendChild(tr);
        });

        const totalPages = Math.ceil(State.ds.filtered.length / State.ds.perPage);
        Utils.$('ds-pagination').innerHTML = totalPages > 1 ? `<button class="btn btn-s" ${State.ds.page===1?'disabled':''} onclick="App.dsPage(${State.ds.page-1})">Prev</button><span class="mono text-xs" style="color:var(--muted);padding:0 12px">Page ${State.ds.page} of ${totalPages}</span><button class="btn btn-s" ${State.ds.page===totalPages?'disabled':''} onclick="App.dsPage(${State.ds.page+1})">Next</button>` : '';
        
        App.updateSelectAllDsState();
    },
    dsPage: (p) => { State.ds.page = p; App.renderDsTable(); },
    toggleDsSelect: (keyStr, el) => { 
        if(State.ds.selected.has(keyStr)) State.ds.selected.delete(keyStr); else State.ds.selected.add(keyStr); 
        el.classList.toggle('on');
        Utils.$('btn-ds-copy').disabled = State.ds.selected.size === 0;
        App.updateSelectAllDsState();
    },
    toggleAllDs: () => { 
        const allSel = State.ds.selected.size === State.ds.filtered.length && State.ds.filtered.length > 0; 
        if(allSel) State.ds.selected.clear(); else State.ds.filtered.forEach(r => State.ds.selected.add(r.keyStr)); 
        App.renderDsTable();
        Utils.$('btn-ds-copy').disabled = State.ds.selected.size === 0;
    },
    updateSelectAllDsState: () => {
        const chkAll = Utils.$('chk-all-ds'); if(!chkAll) return;
        const isAll = State.ds.filtered.length > 0 && State.ds.selected.size === State.ds.filtered.length;
        chkAll.classList.toggle('on', isAll);
    },
    toggleDsRowExpand: (tr, keyStr) => {
        const existingNext = tr.nextElementSibling; if(existingNext?.classList.contains('expand-row')) { existingNext.remove(); return; }
        const expTr = document.createElement('tr'); expTr.className = 'expand-row'; expTr.style.borderBottom = '1px solid var(--brd)';
        const r = State.ds.results.find(x => x.keyStr === keyStr);
        
        const srcProps = r.srcEntity?.properties || {};
        const tgtProps = r.tgtEntity?.properties || {};
        const allKeys = Array.from(new Set([...Object.keys(srcProps), ...Object.keys(tgtProps)])).sort();
        
        const renderRowHtml = (key, type, sVal, tVal) => {
            const isBool = type === 'Boolean';
            return `
                <tr class="prop-edit-row" data-key="${Utils.escapeHtml(key)}">
                    <td class="px-3 py-1.5 font-semibold text-xs text-left" style="color:var(--fg)">${Utils.escapeHtml(key)}</td>
                    <td class="px-3 py-1.5 text-left">
                        <select class="inp select-type font-semibold" style="padding: 2px 6px; font-size: 11px; width: 100px;">
                            <option value="String" ${type==='String'?'selected':''}>String</option>
                            <option value="Integer" ${type==='Integer'?'selected':''}>Integer</option>
                            <option value="Double" ${type==='Double'?'selected':''}>Double</option>
                            <option value="Boolean" ${type==='Boolean'?'selected':''}>Boolean</option>
                        </select>
                    </td>
                    <td class="px-3 py-1.5 text-left">
                        ${isBool ? `
                            <select class="inp val-src" style="padding: 2px 6px; font-size: 11px; width: 100%;">
                                <option value="true" ${sVal==='true'?'selected':''}>true</option>
                                <option value="false" ${sVal==='false'?'selected':''}>false</option>
                                <option value="" ${sVal===''?'selected':''}>— (Empty)</option>
                            </select>
                        ` : `
                            <input class="inp val-src" style="padding: 2px 6px; font-size: 11px; width: 100%;" value="${Utils.escapeHtml(sVal)}" placeholder="— (Empty)">
                        `}
                    </td>
                    <td class="px-3 py-1.5 text-left">
                        ${isBool ? `
                            <select class="inp val-tgt" style="padding: 2px 6px; font-size: 11px; width: 100%;">
                                <option value="true" ${tVal==='true'?'selected':''}>true</option>
                                <option value="false" ${tVal==='false'?'selected':''}>false</option>
                                <option value="" ${tVal===''?'selected':''}>— (Empty)</option>
                            </select>
                        ` : `
                            <input class="inp val-tgt" style="padding: 2px 6px; font-size: 11px; width: 100%;" value="${Utils.escapeHtml(tVal)}" placeholder="— (Empty)">
                        `}
                    </td>
                    <td class="px-3 py-1.5 text-center">
                        <button class="btn btn-d btn-delete-prop" style="padding: 2px 6px; font-size: 10px;"><i class="fa-solid fa-trash-can"></i></button>
                    </td>
                </tr>
            `;
        };

        let rowsHtml = '';
        allKeys.forEach(key => {
            const sProp = srcProps[key];
            const tProp = tgtProps[key];
            let type = 'String';
            let sVal = '', tVal = '';
            
            if (sProp) {
                const k = Object.keys(sProp)[0];
                type = k === 'integerValue' ? 'Integer' : k === 'doubleValue' ? 'Double' : k === 'booleanValue' ? 'Boolean' : 'String';
                sVal = sProp[k] !== undefined && sProp[k] !== null ? String(sProp[k]) : '';
            }
            if (tProp) {
                const k = Object.keys(tProp)[0];
                if (!sProp) {
                    type = k === 'integerValue' ? 'Integer' : k === 'doubleValue' ? 'Double' : k === 'booleanValue' ? 'Boolean' : 'String';
                }
                tVal = tProp[k] !== undefined && tProp[k] !== null ? String(tProp[k]) : '';
            }
            
            rowsHtml += renderRowHtml(key, type, sVal, tVal);
        });

        const content = `
            <div class="p-4 rounded border text-xs" style="background:var(--bg2); border-color:var(--brd2); line-height: 1.5;">
                <div class="flex items-center justify-between mb-3">
                    <span class="font-bold text-xs" style="color:var(--accent2)"><i class="fa-solid fa-pen-to-square"></i> Inline Entity Property Editor</span>
                    <button class="btn btn-s text-xs btn-add-prop" style="padding: 4px 8px;"><i class="fa-solid fa-plus"></i> Add Property</button>
                </div>
                <div style="overflow-x:auto;">
                    <table class="w-full text-xs mono mb-4" style="border-collapse:collapse; min-width: 500px">
                        <thead>
                            <tr style="background:var(--bg); border-bottom: 1px solid var(--brd)">
                                <th class="text-left px-3 py-2" style="width: 22%; color:var(--muted)">Property Key</th>
                                <th class="text-left px-3 py-2" style="width: 110px; color:var(--muted)">Type</th>
                                <th class="text-left px-3 py-2" style="width: 32%; color:var(--muted)">Source Project Value</th>
                                <th class="text-left px-3 py-2" style="width: 32%; color:var(--muted)">Target Project Value</th>
                                <th class="text-center px-3 py-2" style="width: 48px; color:var(--muted)">Delete</th>
                            </tr>
                        </thead>
                        <tbody class="tbody-props">
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
                <div class="flex justify-center gap-4 border-t pt-3" style="border-color:var(--brd)">
                    <button class="btn btn-s btn-save-src text-xs has-tooltip" style="padding: 6px 12px;" data-tooltip="Save changes to source project: ${Utils.escapeHtml(State.ds.src)}"><i class="fa-solid fa-cloud-arrow-up"></i> Save to Source</button>
                    <button class="btn btn-p btn-save-tgt text-xs has-tooltip" style="padding: 6px 12px;" data-tooltip="Save changes to target project: ${Utils.escapeHtml(State.ds.tgt)}"><i class="fa-solid fa-cloud-arrow-up"></i> Save to Target</button>
                </div>
            </div>
        `;
        
        expTr.innerHTML = `<td colspan="4" class="px-6 py-3" style="background:var(--bg)">${content}</td>`;
        tr.after(expTr);

        const tbody = expTr.querySelector('.tbody-props');
        expTr.querySelector('.btn-add-prop').onclick = () => {
            const key = prompt("Enter new property key:");
            if (!key) return;
            const cleanKey = key.trim();
            if (!cleanKey) return;
            if (tbody.querySelector(`tr[data-key="${cleanKey}"]`)) {
                alert("Property key already exists!");
                return;
            }
            const newRow = document.createElement('tr');
            newRow.className = 'prop-edit-row';
            newRow.setAttribute('data-key', cleanKey);
            newRow.innerHTML = renderRowHtml(cleanKey, 'String', '', '');
            newRow.querySelector('.btn-delete-prop').onclick = () => newRow.remove();
            newRow.querySelector('.select-type').onchange = (e) => handleTypeChange(newRow, cleanKey, e.target.value);
            tbody.appendChild(newRow);
        };

        tbody.querySelectorAll('.btn-delete-prop').forEach(btn => {
            btn.onclick = () => btn.closest('tr').remove();
        });

        const handleTypeChange = (row, key, newType) => {
            const srcTd = row.querySelectorAll('td')[2];
            const tgtTd = row.querySelectorAll('td')[3];
            const isBool = newType === 'Boolean';
            
            if (isBool) {
                srcTd.innerHTML = `
                    <select class="inp val-src" style="padding: 2px 6px; font-size: 11px; width: 100%;">
                        <option value="true">true</option>
                        <option value="false">false</option>
                        <option value="" selected>— (Empty)</option>
                    </select>
                `;
                tgtTd.innerHTML = `
                    <select class="inp val-tgt" style="padding: 2px 6px; font-size: 11px; width: 100%;">
                        <option value="true">true</option>
                        <option value="false">false</option>
                        <option value="" selected>— (Empty)</option>
                    </select>
                `;
            } else {
                srcTd.innerHTML = `<input class="inp val-src" style="padding: 2px 6px; font-size: 11px; width: 100%;" value="" placeholder="— (Empty)">`;
                tgtTd.innerHTML = `<input class="inp val-tgt" style="padding: 2px 6px; font-size: 11px; width: 100%;" value="" placeholder="— (Empty)">`;
            }
        };

        tbody.querySelectorAll('.prop-edit-row').forEach(row => {
            const key = row.getAttribute('data-key');
            row.querySelector('.select-type').onchange = (e) => handleTypeChange(row, key, e.target.value);
        });

        const getPropertiesFromUI = (side) => {
            const props = {};
            tbody.querySelectorAll('.prop-edit-row').forEach(row => {
                const key = row.getAttribute('data-key');
                const type = row.querySelector('.select-type').value;
                const input = row.querySelector(`.val-${side}`);
                const val = input ? input.value : '';
                
                if (val !== '') {
                    if (type === 'Boolean') {
                        props[key] = { booleanValue: val === 'true' };
                    } else if (type === 'Integer') {
                        props[key] = { integerValue: String(parseInt(val, 10)) };
                    } else if (type === 'Double') {
                        props[key] = { doubleValue: parseFloat(val) };
                    } else {
                        props[key] = { stringValue: val };
                    }
                }
            });
            return props;
        };

        const handleSave = async (side) => {
            const pid = side === 'src' ? State.ds.src : State.ds.tgt;
            const props = getPropertiesFromUI(side);
            
            UI.openModal(`
                <div class="p-5 text-left">
                    <h3 class="font-semibold mb-4 text-base">Save Datastore Entity</h3>
                    <div class="warning-box"><i class="fa-solid fa-triangle-exclamation"></i><div><strong>Overwrite Warning!</strong> This will immediately update or overwrite the properties of entity <strong>${Utils.escapeHtml(keyStr)}</strong> in the project <strong>${Utils.escapeHtml(pid)}</strong>.</div></div>
                    
                    <div class="warning-box flex-col" style="background:rgba(247,148,29,0.06); border-color:rgba(247,148,29,0.25); display: flex;">
                        <div class="flex items-start gap-2.5 w-full">
                            <i class="fa-solid fa-shield-halved" style="color:var(--brand-orange); margin-top: 2px;"></i>
                            <div><strong>GCP Audit Logging Recommendation</strong></div>
                        </div>
                        <div class="text-xs mt-2 pl-7" style="line-height:1.4">
                            Ensure you have enabled <strong>Data Write</strong> audit logs for the <strong>Cloud Datastore API</strong> under <strong>IAM & Admin > Audit Logs</strong> in your GCP console.
                        </div>
                    </div>
                    
                    <p class="text-sm mt-4 mb-4">Are you sure you want to write these changes to the ${side === 'src' ? 'source' : 'target'} project?</p>
                    
                    <div class="flex justify-end gap-2">
                        <button class="btn btn-s" id="btn-ds-save-cancel">Cancel</button>
                        <button class="btn btn-p" id="btn-ds-save-confirm">Confirm & Save</button>
                    </div>
                </div>
            `);

            Utils.$('btn-ds-save-cancel').onclick = () => {
                UI.closeModal();
            };

            Utils.$('btn-ds-save-confirm').onclick = async () => {
                UI.closeModal();
                Utils.show('sec-loading');
                Utils.$('load-title').textContent = "Saving Entity...";
                Utils.$('load-msg').textContent = `Committing changes to ${pid}...`;
                
                try {
                    const entity = {
                        key: JSON.parse(JSON.stringify(r.rawKey)),
                        properties: props
                    };
                    entity.key.partitionId = { projectId: pid };
                    
                    await Api.commitDatastore(pid, [{ upsert: entity }]);
                    Utils.toast(`Successfully saved entity to ${side === 'src' ? 'source' : 'target'} project.`, "ok");
                    
                    const prevEntity = side === 'src' ? r.srcEntity : r.tgtEntity;
                    const prevState = {
                        type: 'DATASTORE_EDIT',
                        prevEntity: prevEntity ? JSON.parse(JSON.stringify(prevEntity)) : null,
                        rawKey: r.rawKey,
                        keyStr: keyStr
                    };
                    await AuditLog.addLog("DATASTORE_EDIT", "—", pid, `Inline edited entity properties for ${keyStr}.`, "SUCCESS", prevState);
                    
                    const expandedKey = keyStr;
                    await App.runDsAnalyze();
                    
                    setTimeout(() => {
                        const newTr = Array.from(document.querySelectorAll('#ds-table-body tr')).find(tr => tr.innerText.includes(expandedKey));
                        if (newTr) {
                            App.toggleDsRowExpand(newTr, expandedKey);
                        }
                    }, 800);
                } catch(err) {
                    console.error("Save failed:", err);
                    Utils.toast(`Save failed: ${err.message}`, "err");
                    Utils.hide('sec-loading');
                }
            };
        };

        expTr.querySelector('.btn-save-src').onclick = () => handleSave('src');
        expTr.querySelector('.btn-save-tgt').onclick = () => handleSave('tgt');
    },
    exportDsCsv: () => {
        const rows = [['Key','Status','Diff Summary']]; State.ds.results.forEach(r => rows.push([r.keyStr, r.status, r.diffSum]));
        const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
        const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download=`ds_compare_${State.ds.kind}.csv`; a.click();
    },
    openDsCopyModal: () => {
        UI.openModal(`
            <div class="p-5">
                <h3 class="font-semibold mb-4 text-base">Copy Datastore Entities</h3>
                <div class="warning-box"><i class="fa-solid fa-triangle-exclamation"></i><div><strong>Backup!</strong> This will upsert entities. <a href="https://cloud.google.com/firestore/docs/backups" target="_blank">Create Backup</a></div></div>
                <div class="warning-box flex-col" style="background:rgba(247,148,29,0.06); border-color:rgba(247,148,29,0.25); display: flex;">
                    <div class="flex items-start gap-2.5 w-full">
                        <i class="fa-solid fa-shield-halved" style="color:var(--brand-orange); margin-top: 2px;"></i>
                        <div><strong>2. Operations that need to be enabled (Data Access Logs)</strong></div>
                    </div>
                    <div class="text-xs mt-2 pl-7" style="line-height:1.4">
                        <p class="mb-2">Writing or overwriting entities in Datastore uses the Commit API (under <code>google.datastore.v1.Datastore.Commit</code>). To log these actions:</p>
                        <ol class="list-decimal list-inside space-y-1">
                            <li>Go to the <strong>GCP Console</strong>.</li>
                            <li>Navigate to <strong>IAM &amp; Admin &gt; Audit Logs</strong>.</li>
                            <li>Select the <strong>Cloud Datastore API</strong> from the list of services.</li>
                            <li>Check the <strong>Data Write</strong> (for creations, updates, overwrites, and deletes) and/or <strong>Data Read</strong> (for lookups and queries) audit log types and save.</li>
                        </ol>
                    </div>
                </div>
                <p class="text-xs mb-2 mt-4" style="color:var(--muted)">From <strong>${Utils.escapeHtml(State.ds.src)}</strong> to <strong>${Utils.escapeHtml(State.ds.tgt)}</strong></p>
                <p class="text-sm mb-4 font-semibold">${State.ds.selected.size} entities selected.</p>
                <div class="mb-4 flex items-center gap-2"><div class="chk on" id="chk-ds-replace" onclick="this.classList.toggle('on')"></div><span class="text-xs">Apply Find & Replace modifications</span></div>
                <div class="flex justify-end gap-2"><button class="btn btn-s" onclick="UI.closeModal()">Cancel</button><button class="btn btn-p" onclick="App.executeDsCopy()">Confirm Copy</button></div>
            </div>
        `);
    },
    executeDsCopy: async () => {
        const applyMod = Utils.$('chk-ds-replace')?.classList.contains('on');
        const modField = Utils.$('ds-mod-field').value.trim();
        const modTarget = Utils.$('ds-mod-target').value;
        const modReplace = Utils.$('ds-mod-replace').value;
        
        UI.closeModal(); 
        
        Utils.show('sec-loading');
        Utils.hide('load-ds-stats');
        Utils.show('btn-cancel-ds');
        Utils.$('load-title').textContent = "Copying Entities...";
        State.cancelDs = false;
        
        const keysToCopy = [...State.ds.selected];
        let ok = 0;

        const recursiveReplaceValue = (val, target, replace) => {
            if (!val || typeof val !== 'object') return;
            if (val.stringValue !== undefined && val.stringValue !== null) {
                val.stringValue = val.stringValue.split(target).join(replace);
            } else if (val.arrayValue && Array.isArray(val.arrayValue.values)) {
                val.arrayValue.values.forEach(subVal => recursiveReplaceValue(subVal, target, replace));
            } else if (val.entityValue && val.entityValue.properties) {
                for (const k in val.entityValue.properties) {
                    recursiveReplaceValue(val.entityValue.properties[k], target, replace);
                }
            }
        };
        let fail = 0;
        const backupData = [];
        
        try {
            const rawKeys = keysToCopy.map(kStr => {
                const r = State.ds.results.find(x => x.keyStr === kStr);
                return r ? r.rawKey : null;
            }).filter(Boolean);
            if (rawKeys.length > 0) {
                const tgtBackupRes = await Api.lookupEntities(State.ds.tgt, rawKeys);
                const foundMap = new Map((tgtBackupRes.found||[]).map(e => [App.formatKey(e.entity.key), e.entity]));
                
                keysToCopy.forEach(kStr => {
                    const existingTgt = foundMap.get(kStr);
                    const r = State.ds.results.find(x => x.keyStr === kStr);
                    backupData.push({
                        keyStr: kStr,
                        action: existingTgt ? 'upsert' : 'delete',
                        prevEntity: existingTgt || { key: r ? r.rawKey : null }
                    });
                });
            }
        } catch(err) {
            console.error("Failed to perform target backup for revert", err);
        }
        
        for (let i = 0; i < keysToCopy.length; i += 100) {
            if (State.cancelDs) {
                Utils.toast("Copy process cancelled", "info");
                break;
            }
            const chunkStrs = keysToCopy.slice(i, i + 100);
            Utils.$('load-msg').textContent = `Copying ${ok} of ${keysToCopy.length}... (Fetching source entities)`;
            
            try {
                const rawKeys = chunkStrs.map(kStr => {
                    const r = State.ds.results.find(x => x.keyStr === kStr);
                    return r ? r.rawKey : null;
                }).filter(Boolean);
                
                if (rawKeys.length === 0) continue;
                
                const srcRes = await Api.lookupEntities(State.ds.src, rawKeys);
                const mutations = [];
                
                for (const e of srcRes.found || []) {
                    const entity = JSON.parse(JSON.stringify(e.entity));
                    entity.key.partitionId = { projectId: State.ds.tgt };
                    
                    if (applyMod && modTarget) {
                        if (modField && modField.trim() !== "" && modField !== "*") {
                            if (entity.properties?.[modField]) {
                                recursiveReplaceValue(entity.properties[modField], modTarget, modReplace);
                            }
                        } else {
                            if (entity.properties) {
                                for (const k in entity.properties) {
                                    recursiveReplaceValue(entity.properties[k], modTarget, modReplace);
                                }
                            }
                        }
                    }
                    
                    mutations.push({ upsert: entity });
                }
                
                if (mutations.length > 0) {
                    Utils.$('load-msg').textContent = `Copying ${ok} of ${keysToCopy.length}... (Writing to target)`;
                    await Api.commitDatastore(State.ds.tgt, mutations);
                    ok += mutations.length;
                }
            } catch (e) {
                fail += chunkStrs.length;
                Utils.toast(`Failed to copy batch: ${e.message}`, "err");
            }
        }
        
        Utils.hide('sec-loading');
        Utils.toast(`Copy complete. Success: ${ok}, Failed: ${fail}`, ok > 0 ? 'ok' : 'err');
        const status = fail === 0 && ok > 0 ? "SUCCESS" : (ok > 0 ? "PARTIAL" : "FAILED");
        let details = `Copied ${ok} entities of kind ${State.ds.kind}.`;
        if (applyMod) {
            const fieldText = (modField && modField.trim() !== "") ? `field '${modField}'` : "all fields (recursively)";
            details += ` Applied Find & Replace on ${fieldText}: "${modTarget}" -> "${modReplace}".`;
        }
        if (State.cancelDs) {
            details += " Copy process was cancelled by the user.";
        }
        await AuditLog.addLog("DATASTORE_COPY", State.ds.src, State.ds.tgt, details, status, {
            type: "DATASTORE_COPY",
            kind: State.ds.kind,
            backupData: backupData
        });
        await App.runDsAnalyze();
    }
};

window.onload = () => {
    App.init();
};
