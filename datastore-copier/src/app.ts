import { State, BqTable, QueryComparison, DsResult } from './state';
import { Utils } from './utils';
import { Api } from './api';
import { UI } from './ui';
import { Diff } from './diff';
import { AuditLog } from './audit';
import {
    cloneDatastoreValue,
    datastoreValueToEditorText,
    editorTextToDatastoreValue,
    getDatastoreEditorType,
    replaceDatastoreField,
    type DatastoreEditorType
} from './datastore-utils';

let dsAbortController: AbortController | null = null;

const beginDsOperation = (): AbortController => {
    dsAbortController?.abort();
    dsAbortController = new AbortController();
    return dsAbortController;
};

const isCancellationError = (error: any): boolean =>
    error?.name === 'AbortError' || error?.message === 'Process Cancelled';

export const App = {
    cancelDsOperation: (): void => {
        State.cancelDs = true;
        dsAbortController?.abort();
        void AuditLog.addLog(
            'DATASTORE_CANCEL',
            State.ds.src || '—',
            State.ds.tgt || '—',
            `User requested cancellation for Datastore kind ${State.ds.kind || 'not selected'}.`,
            'CANCELLED'
        );
    },
    parseWelcomeName: (email: string): string => {
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
    init: (): void => {
        const toggleBtn = Utils.$('btn-toggle-token');
        const tokenInp = Utils.$('inp-token') as HTMLInputElement | null;
        if (toggleBtn && tokenInp) {
            toggleBtn.onclick = () => {
                const isPassword = tokenInp.type === 'password';
                tokenInp.type = isPassword ? 'text' : 'password';
                toggleBtn.innerHTML = isPassword
                    ? '<i class="fa-solid fa-eye"></i>'
                    : '<i class="fa-solid fa-eye-slash"></i>';
            };
        }
        const verifyInp = Utils.$('inp-token') as HTMLInputElement | null;
        if (verifyInp) {
            verifyInp.oninput = () => {
                const btn = Utils.$('btn-verify') as HTMLButtonElement | null;
                if (btn) btn.disabled = !verifyInp.value.trim();
            };
        }
        const verifyBtn = Utils.$('btn-verify');
        if (verifyBtn) verifyBtn.onclick = App.verify;

        document.querySelectorAll('[data-mode]').forEach(b => {
            const btn = b as HTMLElement;
            btn.onclick = () => App.selectMode(btn.dataset.mode || 'bq');
        });

        const bqCompareBtn = Utils.$('btn-bq-compare');
        if (bqCompareBtn) bqCompareBtn.onclick = App.runBqCompare;

        const bqCsvBtn = Utils.$('btn-bq-csv');
        if (bqCsvBtn) {
            bqCsvBtn.onclick = () => {
                const rows = [['Dataset', 'Table', 'Status']];
                State.bq.filtered.forEach(r => rows.push([r.dataset, r.table, r.status]));
                const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
                a.download = `bq_compare.csv`;
                a.click();
                void AuditLog.addLog(
                    'BQ_CSV_EXPORT',
                    State.bq.src || '—',
                    State.bq.tgt || '—',
                    `Exported ${State.bq.filtered.length} BigQuery schema comparison rows.`,
                    'SUCCESS'
                ).then(logged => {
                    if (!logged) Utils.toast('CSV exported, but the export action could not be logged.', 'warn');
                });
            };
        }

        const qFetchBtn = Utils.$('btn-q-fetch');
        if (qFetchBtn) qFetchBtn.onclick = App.runQueryFetch;

        const qCopyBtn = Utils.$('btn-q-copy');
        if (qCopyBtn) qCopyBtn.onclick = App.openQueryCopyModal;

        const dsAddFilterBtn = Utils.$('btn-ds-add-filter');
        if (dsAddFilterBtn) dsAddFilterBtn.onclick = UI.addDsFilter;

        const dsModField = Utils.$('ds-mod-field') as HTMLInputElement | null;
        if (dsModField) dsModField.oninput = (e: any) => { State.ds.modField = e.target.value; };

        const dsModTarget = Utils.$('ds-mod-target') as HTMLInputElement | null;
        if (dsModTarget) dsModTarget.oninput = (e: any) => { State.ds.modTarget = e.target.value; };

        const dsModReplace = Utils.$('ds-mod-replace') as HTMLInputElement | null;
        if (dsModReplace) dsModReplace.oninput = (e: any) => { State.ds.modReplace = e.target.value; };

        const dsAnalyzeBtn = Utils.$('btn-ds-analyze');
        if (dsAnalyzeBtn) dsAnalyzeBtn.onclick = App.runDsAnalyze;

        const cancelDsBtn = Utils.$('btn-cancel-ds');
        if (cancelDsBtn) cancelDsBtn.onclick = App.cancelDsOperation;

        const dsCsvBtn = Utils.$('btn-ds-csv');
        if (dsCsvBtn) dsCsvBtn.onclick = App.exportDsCsv;

        const dsCopyBtn = Utils.$('btn-ds-copy');
        if (dsCopyBtn) dsCopyBtn.onclick = App.openDsCopyModal;

        const bqSearchInp = Utils.$('bq-search') as HTMLInputElement | null;
        if (bqSearchInp) {
            bqSearchInp.oninput = (e: any) => {
                State.bq.search = e.target.value;
                State.bq.page = 1;
                App.renderBqResults();
            };
        }

        const auditExportBtn = Utils.$('btn-audit-export');
        if (auditExportBtn) auditExportBtn.onclick = AuditLog.exportLogs;

        // themeToggle listener mapping
        const themeToggle = Utils.$('themeToggle');
        if (themeToggle) {
            themeToggle.onclick = () => {
                if (typeof (window as any).toggleTheme === 'function') {
                    (window as any).toggleTheme();
                }
            };
        }

        // Copy CLI token command button listener mapping
        const copyTokenCmdBtn = document.querySelector('.btn-copy-token-cmd') as HTMLButtonElement | null;
        if (copyTokenCmdBtn) {
            copyTokenCmdBtn.onclick = () => {
                Utils.copyText('gcloud auth print-access-token');
            };
        }

        // Datastore filters listener mapping
        document.querySelectorAll('button[data-filter]').forEach(btn => {
            const b = btn as HTMLButtonElement;
            b.onclick = () => App.filterDsResults(b.dataset.filter!);
        });

        // Datastore toggle all listener mapping
        const chkAllDs = Utils.$('chk-all-ds');
        if (chkAllDs) {
            chkAllDs.onclick = () => App.toggleAllDs();
        }

        AuditLog.renderLogs();
    },
    verify: async (): Promise<void> => {
        const tokenInp = Utils.$('inp-token') as HTMLInputElement | null;
        const token = tokenInp ? tokenInp.value.trim() : '';
        if (!token) return;

        const verifyBtn = Utils.$('btn-verify') as HTMLButtonElement | null;
        if (verifyBtn) {
            verifyBtn.disabled = true;
            verifyBtn.innerHTML = '<span class="spinner"></span> Verifying...';
        }

        try {
            const identity = await Api.validateToken(token);
            State.token = token;
            Api.setToken(token);
            State.authEmail = identity.email;
            State.projects = identity.projects;

            const welcomeName = App.parseWelcomeName(State.authEmail);
            try { App.playNetflixTudum(); } catch(audioErr) { console.warn("Audio feedback error:", audioErr); }
            await UI.showWelcomeAnimation(welcomeName);

            Utils.hide('sec-auth'); Utils.show('sec-modes'); Utils.show('sec-audit-logs'); UI.initDropdowns();
            Utils.$('header-right')!.innerHTML = `<span class="text-xs mono" style="color:var(--muted)">${Utils.escapeHtml(State.authEmail)}</span>`;
            const logged = await AuditLog.addLog(
                "AUTHENTICATION",
                "—",
                "—",
                `User verified token successfully. Loaded ${State.projects.length} projects.`,
                "SUCCESS"
            );
            if (!logged) {
                Utils.toast(
                    'Signed in, but centralized audit logging is unavailable. Mutating operations may not be safely reversible.',
                    'warn'
                );
            }
        } catch(e: any) {
            if (verifyBtn) {
                verifyBtn.disabled = false;
                verifyBtn.innerHTML = '<i class="fa-solid fa-key"></i> Verify Token';
            }
            const { ErrorBoundary } = await import('./utils');
            await ErrorBoundary.handle(e, 'App.verify');
        }
    },
    playNetflixTudum: (): void => {
        try {
            const isSubfolder = window.location.pathname.includes('/datastore-copier');
            const audioPath = isSubfolder ? '../sounds/netflix-tudum.mp3' : 'sounds/netflix-tudum.mp3';
            const audio = new Audio(audioPath);
            audio.play();
        } catch (e) {
            console.warn("Audio playback failed:", e);
        }
    },
    selectMode: (mode: string): void => {
        State.mode = mode;
        document.querySelectorAll('[data-mode]').forEach(b => {
            const btn = b as HTMLElement;
            btn.classList.toggle('on', btn.dataset.mode === mode);
        });
        Utils.show('sec-forms'); Utils.hide('sec-results');
        ['bq','query','ds'].forEach(m => { Utils.hide(`form-${m}`); Utils.hide(`res-${m}`); });
        Utils.show(`form-${mode}`);
        void AuditLog.addLog(
            'MODE_SELECT',
            '—',
            '—',
            `Selected Infrastructure Manager mode: ${mode}.`,
            'SUCCESS'
        );
    },

    // --- BQ logic ---
    runBqCompare: async (): Promise<void> => {
        State.bq.src = (Utils.$('bq-src') as HTMLInputElement).value;
        State.bq.tgt = (Utils.$('bq-tgt') as HTMLInputElement).value;
        State.bq.srcDs = (Utils.$('bq-src-ds') as HTMLInputElement).value;
        State.bq.tgtDs = (Utils.$('bq-tgt-ds') as HTMLInputElement).value;
        if (!State.bq.src || !State.bq.tgt) return Utils.toast("Select projects", "err");

        Utils.hide('sec-forms'); Utils.show('sec-loading');
        Utils.$('load-title')!.textContent = "Comparing Schemas";
        Utils.$('load-msg')!.textContent = "Fetching tables...";
        try {
            const srcDs = State.bq.srcDs ? [State.bq.srcDs] : await Api.getDatasets(State.bq.src);
            const tgtDs = State.bq.tgtDs ? [State.bq.tgtDs] : await Api.getDatasets(State.bq.tgt);
            const srcTm = new Map<string, any>(), tgtTm = new Map<string, any>();
            for (const ds of srcDs) {
                const ts = await Api.getTables(State.bq.src, ds);
                ts.forEach(t => srcTm.set(`${ds}.${t.table}`, t));
            }
            for (const ds of tgtDs) {
                const ts = await Api.getTables(State.bq.tgt, ds);
                ts.forEach(t => tgtTm.set(`${ds}.${t.table}`, t));
            }
            State.bq.tables = [];
            for (const key of new Set([...srcTm.keys(), ...tgtTm.keys()])) {
                const [ds, tbl] = key.split('.');
                const inSrc = srcTm.has(key), inTgt = tgtTm.has(key);
                let status: 'different' | 'source_only' | 'target_only' | 'identical' | 'checking' = inSrc && inTgt ? 'checking' : (inSrc ? 'source_only' : 'target_only');
                State.bq.tables.push({ dataset: ds, table: tbl, srcSchema: null, tgtSchema: null, status });
            }
            State.bq.tables.sort((a, b) => a.dataset.localeCompare(b.dataset) || a.table.localeCompare(b.table));
            State.bq.page = 1;
            Utils.hide('sec-loading'); Utils.show('sec-results'); Utils.show('res-bq');
            App.renderBqResults();
            const logged = await AuditLog.addLog(
                'BQ_SCHEMA_COMPARE',
                State.bq.src,
                State.bq.tgt,
                `Compared ${State.bq.tables.length} table paths. Source dataset filter: ${State.bq.srcDs || 'all'}; target dataset filter: ${State.bq.tgtDs || 'all'}.`,
                'SUCCESS'
            );
            if (!logged) Utils.toast('Comparison completed, but the action could not be logged.', 'warn');
        } catch(e: any) {
            Utils.hide('sec-loading'); Utils.show('sec-forms');
            const { ErrorBoundary } = await import('./utils');
            await ErrorBoundary.handle(e, 'App.runBqCompare');
        }
    },

    compareFields: (srcFields: any[], tgtFields: any[]): any[] => {
        const diffs: any[] = [];
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

    compareBqTableSchema: async (r: BqTable, tr: HTMLElement): Promise<void> => {
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

            const badge = tr.querySelector('.status-badge') as HTMLElement;
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
        } catch (e: any) {
            const badge = tr.querySelector('.status-badge') as HTMLElement;
            badge.textContent = 'ERROR';
            badge.style.color = 'var(--danger)';
            badge.style.background = 'var(--danger-dim)';
            tr.querySelectorAll('td')[3].textContent = e.message;
        }
    },

    renderBqResults: (): void => {
        const tbody = Utils.$('bq-table-list');
        if (!tbody) return;
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
        const diff = State.bq.filtered.filter(t => t.status === 'different' || t.status === 'checking').length;
        const eq = State.bq.filtered.filter(t => t.status === 'identical').length;

        Utils.$('bq-summary')!.innerHTML = `
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
            Utils.$('bq-pagination')!.innerHTML = '';
            return;
        }

        const tableHtml = `
            <div class="card" style="padding:0;overflow:hidden">
                <table class="w-full text-xs mono" style="border-collapse:collapse">
                    <thead>
                        <tr style="background:var(--bg2)">
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
        const rowsContainer = Utils.$('bq-table-body-rows') as HTMLElement;

        pageData.forEach(r => {
            const tablePath = `${r.dataset}.${r.table}`;
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
            } else if (r.status === 'different' || r.status === 'checking') {
                badgeText = 'COMPARING';
                badgeColor = 'var(--warn)';
                badgeBg = 'var(--warn-dim)';
                diffSum = 'Comparing schemas...';
            }

            tr.innerHTML = `
                <td class="px-4 py-3 cursor-pointer font-semibold" style="color:var(--fg)">${Utils.escapeHtml(tablePath)} <i class="fa-solid fa-chevron-down" style="font-size:9px;color:var(--muted);margin-left:4px"></i></td>
                <td class="px-4 py-3"><span class="badge status-badge" style="background:${badgeBg};color:${badgeColor}">${badgeText}</span></td>
                <td class="px-4 py-3" style="color:var(--muted)">${diffSum}</td>
            `;

            const keyTd = tr.querySelectorAll('td')[0] as HTMLElement;
            keyTd.onclick = () => App.toggleBqRowExpand(tr, r);

            rowsContainer.appendChild(tr);

            if (r.status === 'checking' && !r.srcSchema) {
                App.compareBqTableSchema(r, tr);
            }
        });

        const totalPages = Math.ceil(State.bq.filtered.length / State.bq.perPage);
        Utils.$('bq-pagination')!.innerHTML = totalPages > 1
            ? `<button class="btn btn-s btn-bq-prev">Prev</button><span class="mono text-xs" style="color:var(--muted);padding:0 12px">Page ${State.bq.page} of ${totalPages}</span><button class="btn btn-s btn-bq-next">Next</button>`
            : '';

        if (totalPages > 1) {
            const prevBtn = tbody.querySelector('.btn-bq-prev') as HTMLButtonElement | null;
            if (prevBtn) {
                prevBtn.disabled = State.bq.page === 1;
                prevBtn.onclick = () => App.bqPage(State.bq.page - 1);
            }
            const nextBtn = tbody.querySelector('.btn-bq-next') as HTMLButtonElement | null;
            if (nextBtn) {
                nextBtn.disabled = State.bq.page === totalPages;
                nextBtn.onclick = () => App.bqPage(State.bq.page + 1);
            }
        }

    },

    bqPage: (p: number): void => { State.bq.page = p; App.renderBqResults(); },

    toggleBqRowExpand: async (tr: HTMLElement, r: BqTable): Promise<void> => {
        const existingNext = tr.nextElementSibling;
        if (existingNext?.classList.contains('expand-row')) { existingNext.remove(); return; }

        const expTr = document.createElement('tr');
        expTr.className = 'expand-row';
        expTr.style.borderBottom = '1px solid var(--brd)';

        let content = `<div class="px-6 py-3 text-xs"><span class="spinner"></span> Loading schema details...</div>`;
        expTr.innerHTML = `<td colspan="3" class="px-6 py-3" style="background:var(--bg)">${content}</td>`;
        tr.after(expTr);

        try {
            if (!r.srcSchema && r.status !== 'target_only') r.srcSchema = await Api.getSchema(State.bq.src, r.dataset, r.table);
            if (!r.tgtSchema && r.status !== 'source_only') r.tgtSchema = await Api.getSchema(State.bq.tgt, r.dataset, r.table);

            let html = '';
            if (r.status === 'identical') {
                html = `<div class="text-xs font-semibold text-emerald-400"><i class="fa-solid fa-circle-check mr-1"></i> Schemas are fully identical.</div>`;
            } else if (r.status === 'source_only') {
                let rows = r.srcSchema!.map(f => `<tr><td class="px-3 py-1.5 font-semibold">${Utils.escapeHtml(f.name)}</td><td class="px-3 py-1.5">${Utils.escapeHtml(f.type)}</td><td class="px-3 py-1.5">${Utils.escapeHtml(f.mode)}</td></tr>`).join('');
                html = `
                    <div class="mb-2 text-xs font-semibold text-blue-400">Table exists only in source. Schema:</div>
                    <table class="w-full text-xs mono" style="border-collapse:collapse">
                        <thead><tr style="background:var(--bg2)"><th class="text-left px-3 py-1">Field</th><th class="text-left px-3 py-1">Type</th><th class="text-left px-3 py-1">Mode</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                `;
            } else if (r.status === 'target_only') {
                let rows = r.tgtSchema!.map(f => `<tr><td class="px-3 py-1.5 font-semibold">${Utils.escapeHtml(f.name)}</td><td class="px-3 py-1.5">${Utils.escapeHtml(f.type)}</td><td class="px-3 py-1.5">${Utils.escapeHtml(f.mode)}</td></tr>`).join('');
                html = `
                    <div class="mb-2 text-xs font-semibold" style="color:var(--muted)">Table exists only in target. Schema:</div>
                    <table class="w-full text-xs mono" style="border-collapse:collapse">
                        <thead><tr style="background:var(--bg2)"><th class="text-left px-3 py-1">Field</th><th class="text-left px-3 py-1">Type</th><th class="text-left px-3 py-1">Mode</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                `;
            } else {
                const diffs = r.diffs || App.compareFields(r.srcSchema!, r.tgtSchema!);
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
            expTr.querySelector('td')!.innerHTML = html;
        } catch (e: any) {
            expTr.querySelector('td')!.innerHTML = `<div class="text-xs text-red-400">Error: ${Utils.escapeHtml(e.message)}</div>`;
        }
    },

    // --- QUERY logic ---
    runQueryFetch: async (): Promise<void> => {
        State.query.src = (Utils.$('q-src') as HTMLInputElement).value;
        State.query.tgt = (Utils.$('q-tgt') as HTMLInputElement).value;
        State.query.srcLoc = (Utils.$('q-src-loc') as HTMLSelectElement).value || 'us';
        State.query.tgtLoc = (Utils.$('q-tgt-loc') as HTMLSelectElement).value || 'us';
        if(!State.query.src || !State.query.tgt) return Utils.toast("Select projects", "err");
        Utils.hide('sec-forms'); Utils.show('sec-loading'); Utils.$('load-title')!.textContent = "Scheduled Queries";
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

                let status: 'identical' | 'different' | 'source_only' | 'target_only' = 'identical';
                let diffFields: string[] = [];

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
            const logged = await AuditLog.addLog(
                'QUERY_COMPARE',
                State.query.src,
                State.query.tgt,
                `Compared ${State.query.queries.length} scheduled query configurations in ${State.query.srcLoc} and ${State.query.tgtLoc}.`,
                'SUCCESS'
            );
            if (!logged) Utils.toast('Scheduled-query comparison completed, but the action could not be logged.', 'warn');
        } catch(e: any) {
            Utils.hide('sec-loading'); Utils.show('sec-forms');
            const { ErrorBoundary } = await import('./utils');
            await ErrorBoundary.handle(e, 'App.runQueryFetch');
        }
    },
    renderQueryResults: (): void => {
        const container = Utils.$('q-list'); if (!container) return;
        container.innerHTML = '';
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
                            <th class="text-left px-4 py-3 w-10"><div class="chk" id="chk-all-q"></div></th>
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
        const rowsContainer = Utils.$('q-table-body-rows') as HTMLElement;
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
            const keyTd = tr.querySelectorAll('td')[1] as HTMLElement;
            keyTd.onclick = () => App.toggleQueryDetails(tr, q);
            if (isCopyable) {
                const chk = tr.querySelector('.chk') as HTMLElement;
                chk.onclick = () => App.toggleQSelect(qId, chk);
            }
            rowsContainer.appendChild(tr);
        });

        // Bind dynamic select all listener instead of inline onclick
        const chkAllQ = container.querySelector('#chk-all-q') as HTMLElement | null;
        if (chkAllQ) {
            chkAllQ.onclick = () => App.toggleAllQ();
        }

        App.updateSelectAllQState();
    },
    toggleQSelect: (qId: string, el: HTMLElement): void => {
        if (State.query.selected.has(qId)) State.query.selected.delete(qId);
        else State.query.selected.add(qId);
        el.classList.toggle('on');
        (Utils.$('btn-q-copy') as HTMLButtonElement).disabled = State.query.selected.size === 0;
        App.updateSelectAllQState();
    },
    toggleAllQ: (): void => {
        const copyableQueries = State.query.queries.filter(q => q.srcQuery !== null);
        const allSel = State.query.selected.size === copyableQueries.length && copyableQueries.length > 0;
        if (allSel) State.query.selected.clear();
        else copyableQueries.forEach(q => State.query.selected.add(q.name));
        App.renderQueryResults();
        (Utils.$('btn-q-copy') as HTMLButtonElement).disabled = State.query.selected.size === 0;
    },
    updateSelectAllQState: (): void => {
        const chkAll = Utils.$('chk-all-q'); if(!chkAll) return;
        const copyableQueries = State.query.queries.filter(q => q.srcQuery !== null);
        const isAll = copyableQueries.length > 0 && State.query.selected.size === copyableQueries.length;
        chkAll.classList.toggle('on', isAll);
    },
    toggleQueryDetails: (tr: HTMLElement, q: QueryComparison): void => {
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
    openQueryCopyModal: (): void => {
        const selected = [...State.query.selected]; if(selected.length === 0) return;

        const tmpl = Utils.$('template-query-copy-modal') as HTMLTemplateElement;
        if (!tmpl) return;
        const fragment = tmpl.content.cloneNode(true) as DocumentFragment;

        fragment.querySelector('.from-pid-span')!.textContent = State.query.src;
        fragment.querySelector('.to-pid-span')!.textContent = State.query.tgt;
        fragment.querySelector('.selected-cnt-span')!.textContent = String(selected.length);

        UI.openModal(fragment);

        (Utils.$('modal-root')!.querySelector('.btn-cancel') as HTMLButtonElement).onclick = () => UI.closeModal();
        (Utils.$('modal-root')!.querySelector('.btn-confirm') as HTMLButtonElement).onclick = () => {
            UI.closeModal();
            App.executeQueryCopy();
        };
    },

    executeQueryCopy: async (): Promise<void> => {
        const selected = [...State.query.selected]; if (selected.length === 0) return;
        Utils.show('sec-loading'); Utils.hide('load-ds-stats'); Utils.hide('btn-cancel-ds');
        Utils.$('load-title')!.textContent = "Copying Scheduled Queries...";
        let ok = 0, fail = 0;
        const backupData: any[] = [];
        const queryAuditLogId = await AuditLog.addLog(
            'QUERY_SYNC',
            State.query.src,
            State.query.tgt,
            `Started copying ${selected.length} scheduled query configurations.`,
            'IN_PROGRESS',
            { type: 'QUERY_SYNC', backupData: [] }
        );
        if (!queryAuditLogId) {
            Utils.hide('sec-loading');
            Utils.toast(
                'Scheduled-query copy stopped before mutation because the centralized audit record could not be created.',
                'err'
            );
            return;
        }
        for (let i = 0; i < selected.length; i++) {
            const qId = selected[i];
            const cmpObj = State.query.queries.find(x => x.name === qId);
            if (!cmpObj || !cmpObj.srcQuery) continue;
            const q = cmpObj.srcQuery;
            Utils.$('load-msg')!.textContent = `Copying ${i+1}/${selected.length}: ${q.displayName}`;
            const prevQuery = cmpObj.tgtQuery ? {
                displayName: cmpObj.tgtQuery.displayName,
                schedule: cmpObj.tgtQuery.schedule,
                destinationDatasetId: cmpObj.tgtQuery.destinationDatasetId,
                params: cmpObj.tgtQuery.params
            } : null;
            const newQuery = {
                displayName: q.displayName,
                schedule: q.schedule,
                destinationDatasetId: q.destinationDatasetId,
                params: q.params
            };
            const actionApplied = cmpObj.tgtQuery ? 'update' : 'create';
            const backupCandidate = {
                action: actionApplied,
                name: cmpObj.tgtQuery?.name || `pending/${'x'.repeat(1024)}`,
                displayName: q.displayName,
                prevQuery,
                newQuery
            };
            let removedPreviousTarget = false;
            try {
                if (!AuditLog.canPersistPrevState({
                    type: 'QUERY_SYNC',
                    backupData: [...backupData, backupCandidate]
                })) {
                    throw new Error('Scheduled-query backup is too large for a safe audit entry.');
                }
                if (cmpObj.tgtQuery) {
                    await Api.deleteQuery(cmpObj.tgtQuery.name);
                    removedPreviousTarget = true;
                }
                const created = await Api.createQuery(State.query.tgt, State.query.tgtLoc, q);
                if (!created?.name) throw new Error('Scheduled-query create response did not include a resource name.');
                backupData.push({ ...backupCandidate, name: created.name });
                const backupPersisted = await AuditLog.updateLog(
                    queryAuditLogId,
                    'IN_PROGRESS',
                    `Copied ${backupData.length} of ${selected.length} scheduled query configurations.`,
                    { type: 'QUERY_SYNC', backupData }
                );
                if (!backupPersisted) {
                    backupData.pop();
                    try {
                        await Api.deleteQuery(created.name);
                        if (prevQuery) {
                            await Api.createQuery(State.query.tgt, State.query.tgtLoc, prevQuery);
                            removedPreviousTarget = false;
                        }
                    } catch (rollbackError: any) {
                        throw new Error(
                            `Audit backup update failed and immediate rollback also failed: ${rollbackError.message}`
                        );
                    }
                    throw new Error('Audit backup update failed; the copied configuration was immediately rolled back.');
                }
                ok++;
            } catch (e: any) {
                let failure = e;
                if (removedPreviousTarget && prevQuery) {
                    try {
                        await Api.createQuery(State.query.tgt, State.query.tgtLoc, prevQuery);
                    } catch (rollbackError: any) {
                        failure = new Error(
                            `${e.message}; restoring the previous target query also failed: ${rollbackError.message}`
                        );
                    }
                }
                fail++;
                console.error(`Query copy error for ${q.displayName}:`, failure);
                Utils.toast(`Failed: ${q.displayName} - ${failure.message}`, 'err');
            }
        }
        Utils.hide('sec-loading'); Utils.toast(`Queries copied. Success: ${ok}, Failed: ${fail}`, ok > 0 ? 'ok' : 'err');
        const status = fail === 0 && ok > 0 ? "SUCCESS" : (ok > 0 ? "PARTIAL" : "FAILED");
        const details = `Copied ${ok} scheduled queries, failed ${fail} queries.`;
        const logged = await AuditLog.updateLog(
            queryAuditLogId,
            status,
            details,
            { type: 'QUERY_SYNC', backupData }
        );
        if (!logged) {
            Utils.toast(
                'Scheduled queries finished, but the final audit status could not be saved. The last persisted revert backup remains available.',
                'warn'
            );
        }
        State.query.selected.clear(); (Utils.$('btn-q-copy') as HTMLButtonElement).disabled = true;
        await App.runQueryFetch();
    },

    // --- DATASTORE logic ---
    runDsAnalyze: async (): Promise<void> => {
        State.ds.src = (Utils.$('ds-src') as HTMLInputElement).value;
        State.ds.tgt = (Utils.$('ds-tgt') as HTMLInputElement).value;
        State.ds.kind = (Utils.$('ds-kind') as HTMLInputElement).value;
        State.ds.srcDb = (Utils.$('ds-src-db') as HTMLInputElement).value;
        State.ds.tgtDb = (Utils.$('ds-tgt-db') as HTMLInputElement).value;
        if (!State.ds.src || !State.ds.tgt || !State.ds.kind) return Utils.toast("Fill required fields", "err");

        State.ds.results = [];
        State.ds.filtered = [];
        State.ds.selected.clear();
        State.ds.stats = {identical:0, different:0, missing:0, total:0};
        State.cancelDs = false;
        const copyButton = Utils.$('btn-ds-copy') as HTMLButtonElement | null;
        if (copyButton) copyButton.disabled = true;
        Utils.hide('sec-forms'); Utils.show('sec-loading'); Utils.show('load-ds-stats'); Utils.show('btn-cancel-ds');
        Utils.$('load-title')!.textContent = "Analyzing Entities...";

        const parseVal = (v: string) => {
            if (v === 'true') return { booleanValue: true };
            if (v === 'false') return { booleanValue: false };
            if (!isNaN(Number(v)) && v.trim() !== '') {
                if (v.includes('.')) return { doubleValue: parseFloat(v) };
                return { integerValue: String(parseInt(v, 10)) };
            }
            return { stringValue: v };
        };

        const parseAncestorKey = (str: string) => {
            const parts = str.split('|').map(x => x.trim()).filter(Boolean);
            if (parts.length === 0) throw new Error("Key path cannot be empty.");
            const path = parts.map(part => {
                const sepIndex = part.indexOf(':');
                if (sepIndex === -1) throw new Error(`Invalid element "${part}". Use Kind:Name or Kind:ID.`);
                const kind = part.substring(0, sepIndex).trim();
                const val = part.substring(sepIndex + 1).trim();
                if (!kind || !val) throw new Error(`Invalid element "${part}". Use Kind:Name or Kind:ID.`);
                const isNum = !isNaN(Number(val)) && val !== '';
                return isNum ? { kind, id: val } : { kind, name: val };
            });
            const db = (State.ds.srcDb === '(default)' || !State.ds.srcDb) ? '' : State.ds.srcDb;
            const partitionId: any = { projectId: State.ds.src };
            if (db) partitionId.databaseId = db;
            return { keyValue: { path, partitionId } };
        };

        const parseKeyFilterVal = (str: string) => {
            if (str.includes(':')) {
                return parseAncestorKey(str);
            }
            const path = [];
            const isNum = !isNaN(Number(str)) && str.trim() !== '';
            if (isNum) {
                path.push({ kind: State.ds.kind, id: str.trim() });
            } else {
                path.push({ kind: State.ds.kind, name: str.trim() });
            }
            const db = (State.ds.srcDb === '(default)' || !State.ds.srcDb) ? '' : State.ds.srcDb;
            const partitionId: any = { projectId: State.ds.src };
            if (db) partitionId.databaseId = db;
            return { keyValue: { path, partitionId } };
        };

        const srcDbClean = (State.ds.srcDb === '(default)' || !State.ds.srcDb) ? '' : State.ds.srcDb;
        const srcPartitionId: any = { projectId: State.ds.src };
        if (srcDbClean) srcPartitionId.databaseId = srcDbClean;
        const body: any = { partitionId: srcPartitionId, query: { kind: [{ name: State.ds.kind }] } };
        const filters = Utils.$('ds-filters-container')!.querySelectorAll('.filter-row');
        if (filters.length > 0) {
            const props: any[] = [];
            try {
                filters.forEach(r => {
                    const prop = (r.querySelector('select:first-child') as HTMLSelectElement).value;
                    const op = (r.querySelectorAll('select')[1] as HTMLSelectElement).value;
                    const val = (r.querySelector('input') as HTMLInputElement).value;
                    if(prop && val) {
                        if (prop === '__key__') {
                            if (op === 'IN' || op === 'NOT_IN') {
                                const parts = val.split(',').map(x => x.trim()).filter(Boolean);
                                const keyValues = parts.map(part => parseKeyFilterVal(part).keyValue);
                                const arrayVal = { arrayValue: { values: keyValues.map(kv => ({ keyValue: kv })) } };
                                props.push({ propertyFilter: { property: { name: '__key__' }, op: op, value: arrayVal } });
                            } else {
                                const keyValueObj = parseKeyFilterVal(val);
                                props.push({ propertyFilter: { property: { name: '__key__' }, op: op, value: keyValueObj } });
                            }
                        } else if (op === 'HAS_ANCESTOR') {
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
            } catch (err: any) {
                Utils.toast(err.message, 'err');
                Utils.hide('sec-loading');
                Utils.show('sec-forms');
                return;
            }
            if (props.length > 0) body.query.filter = { compositeFilter: { op: 'AND', filters: props } };
        }

        const controller = beginDsOperation();
        const discoveredProperties = new Set(State.ds.properties);
        try {
            let cursor = null; let totalScanned = 0;
            do {
                if (cursor) body.query.startCursor = cursor;
                Utils.$('load-msg')!.textContent = `Scanned ${totalScanned} entities... (Fetching batch)`;
                const res = await Api.runDatastoreQuery(State.ds.src, body, State.ds.srcDb, controller.signal);
                const srcEntities = res.batch?.entityResults || [];
                cursor = res.batch?.moreResults === 'NO_MORE_RESULTS' ? null : (res.batch?.endCursor || null);
                if (srcEntities.length === 0) break;

                for (let i = 0; i < srcEntities.length; i += 100) {
                    if (State.cancelDs) throw new DOMException("Process Cancelled", 'AbortError');
                    const chunk = srcEntities.slice(i, i + 100);
                    chunk.forEach((result: any) => {
                        Object.keys(result.entity?.properties || {}).forEach(name => discoveredProperties.add(name));
                    });
                    const keysToLookup = chunk.map((e: any) => {
                        const keyCopy = cloneDatastoreValue(e.entity.key);
                        const tgtDbClean = (State.ds.tgtDb === '(default)' || !State.ds.tgtDb) ? '' : State.ds.tgtDb;
                        const tgtPartitionId: any = { projectId: State.ds.tgt };
                        if (tgtDbClean) tgtPartitionId.databaseId = tgtDbClean;
                        keyCopy.partitionId = tgtPartitionId;
                        return keyCopy;
                    });

                    Utils.$('load-msg')!.textContent = `Scanned ${totalScanned} entities... (Comparing batch)`;
                    const tgtRes = await Api.lookupEntities(State.ds.tgt, keysToLookup, State.ds.tgtDb, controller.signal);

                    const tgtMap = new Map((tgtRes.found||[]).map((e: any) => [App.formatKey(e.entity.key), e.entity]));
                    const missingSet = new Set((tgtRes.missing||[]).map((e: any) => App.formatKey(e.entity.key)));

                    for (const srcE of chunk) {
                        const kStr = App.formatKey(srcE.entity.key);
                        State.ds.stats.total++;
                        const tgtEnt = tgtMap.get(kStr);
                        if (missingSet.has(kStr) || !tgtEnt) {
                            State.ds.stats.missing++;
                            State.ds.results.push({ keyStr: kStr, rawKey: srcE.entity.key, status: 'missing', diffSum: 'Missing in Target', srcEntity: srcE.entity, tgtEntity: null });
                        } else {
                            const diff = App.compareEntities(srcE.entity, tgtEnt);
                            if (diff.length > 0) {
                                State.ds.stats.different++;
                                const diffSum = diff.map(d=>d.prop).join(', ');
                                State.ds.results.push({ keyStr: kStr, rawKey: srcE.entity.key, status: 'different', diff, diffSum, srcEntity: srcE.entity, tgtEntity: tgtEnt });
                            } else {
                                State.ds.stats.identical++;
                                State.ds.results.push({ keyStr: kStr, rawKey: srcE.entity.key, status: 'identical', diff:[], diffSum: '—', srcEntity: srcE.entity, tgtEntity: tgtEnt });
                            }
                        }
                        totalScanned++;
                    }
                }

                Utils.$('ld-identical')!.textContent = String(State.ds.stats.identical);
                Utils.$('ld-different')!.textContent = String(State.ds.stats.different);
                Utils.$('ld-missing')!.textContent = String(State.ds.stats.missing);
                await new Promise(resolve => setTimeout(resolve, 0));
            } while(cursor);

            State.ds.properties = [...discoveredProperties].sort();
            UI.initDropdowns();
            Utils.hide('sec-loading'); Utils.show('sec-results'); Utils.show('res-ds'); App.filterDsResults('all');
            const logged = await AuditLog.addLog(
                'DATASTORE_ANALYZE',
                State.ds.src,
                State.ds.tgt,
                `Analyzed kind ${State.ds.kind}. Total: ${State.ds.stats.total}; identical: ${State.ds.stats.identical}; different: ${State.ds.stats.different}; missing: ${State.ds.stats.missing}.`,
                'SUCCESS'
            );
            if (!logged) Utils.toast('Datastore analysis completed, but the action could not be logged.', 'warn');
        } catch(e: any) {
            Utils.hide('sec-loading'); Utils.show('sec-forms');
            if(isCancellationError(e)) {
                Utils.toast("Analysis cancelled.", "info");
                await AuditLog.addLog(
                    'DATASTORE_ANALYZE',
                    State.ds.src || '—',
                    State.ds.tgt || '—',
                    `Cancelled analysis for kind ${State.ds.kind || 'not selected'}.`,
                    'CANCELLED'
                );
            } else {
                const { ErrorBoundary } = await import('./utils');
                await ErrorBoundary.handle(e, 'App.runDsAnalyze');
            }
        } finally {
            Utils.hide('btn-cancel-ds');
            if (dsAbortController === controller) dsAbortController = null;
        }
    },
    formatKey: (key: any): string => { return key.path.map((p: any) => `${p.kind}:${p.name||p.id}`).join(' | '); },
    compareEntities: (src: any, tgt: any): any[] => {
        const diffs: any[] = []; const allKeys = new Set([...Object.keys(src?.properties||{}), ...Object.keys(tgt?.properties||{})]);
        for(const k of allKeys) {
            const sVal = src?.properties?.[k]; const tVal = tgt?.properties?.[k];
            if (!App.valsEqual(sVal, tVal)) {
                diffs.push({ prop: k, type: (!sVal && tVal) ? 'added' : (sVal && !tVal) ? 'removed' : 'modified', src: App.formatVal(sVal), tgt: App.formatVal(tVal) });
            }
        } return diffs;
    },
    valsEqual: (a: any, b: any): boolean => Diff.areValuesEqual(a, b),
    formatVal: (v: any): string => {
        if (!v) return '—'; const k = Object.keys(v).find(k => v[k] !== null && v[k] !== undefined && !(Array.isArray(v[k]?.values) && v[k].values.length === 0));
        if (!k) return '—'; if(k === 'arrayValue') return `[Array:${(v[k].values||[]).length}]`; if(k === 'mapValue') return `{Map}`; if(k === 'entityValue') return `{Entity}`;
        return String(v[k]).substring(0, 50);
    },

    exportDsCsv: (): void => {
        const rows = [['Key','Status','Diff Summary']]; State.ds.results.forEach(r => rows.push([r.keyStr, r.status, r.diffSum]));
        const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
        const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download=`ds_compare_${State.ds.kind}.csv`; a.click();
        void AuditLog.addLog(
            'DATASTORE_CSV_EXPORT',
            State.ds.src || '—',
            State.ds.tgt || '—',
            `Exported ${State.ds.results.length} Datastore comparison rows for kind ${State.ds.kind || 'not selected'}.`,
            'SUCCESS'
        ).then(logged => {
            if (!logged) Utils.toast('CSV exported, but the export action could not be logged.', 'warn');
        });
    },
    filterDsResults: (status: string): void => {
        State.ds.filterStatus = status;
        State.ds.filtered = status === 'all' ? State.ds.results : State.ds.results.filter(r => r.status === status);
        Utils.$('ds-cnt-all')!.textContent = String(State.ds.stats.total); Utils.$('ds-cnt-diff')!.textContent = String(State.ds.stats.different); Utils.$('ds-cnt-miss')!.textContent = String(State.ds.stats.missing); Utils.$('ds-cnt-eq')!.textContent = String(State.ds.stats.identical);
        State.ds.page = 1; App.renderDsTable();
    },
    renderDsTable: (): void => {
        const start = (State.ds.page - 1) * State.ds.perPage;
        const pageData = State.ds.filtered.slice(start, start + State.ds.perPage);
        const tbody = Utils.$('ds-table-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        pageData.forEach(r => {
            const stCfg = {
                different: { l: 'DIFFERENT', c: 'var(--warn)', b: 'var(--warn-dim)' },
                missing: { l: 'MISSING IN TGT', c: 'var(--danger)', b: 'var(--danger-dim)' },
                identical: { l: 'IDENTICAL', c: 'var(--ok)', b: 'var(--ok-dim)' }
            }[r.status];

            const sel = State.ds.selected.has(r.keyStr);
            const tr = document.createElement('tr'); tr.style.borderBottom = '1px solid var(--brd)';
            tr.innerHTML = `
                <td class="px-4 py-3"><div class="chk ${sel?'on':''}"></div></td>
                <td class="px-4 py-3 cursor-pointer" style="color:var(--fg)">${Utils.escapeHtml(r.keyStr)} <i class="fa-solid fa-chevron-down" style="font-size:9px;color:var(--muted);margin-left:4px"></i></td>
                <td class="px-4 py-3"><span class="badge" style="background:${stCfg.b};color:${stCfg.c}">${stCfg.l}</span></td>
                <td class="px-4 py-3" style="color:var(--muted)">${Utils.escapeHtml(r.diffSum)}</td>`;

            const chk = tr.querySelector('.chk') as HTMLElement;
            chk.onclick = () => App.toggleDsSelect(r.keyStr, chk);

            const keyTd = tr.querySelectorAll('td')[1] as HTMLElement;
            keyTd.onclick = () => App.toggleDsRowExpand(tr, r.keyStr);

            tbody.appendChild(tr);
        });

        const totalPages = Math.ceil(State.ds.filtered.length / State.ds.perPage);
        Utils.$('ds-pagination')!.innerHTML = totalPages > 1 ? `<button class="btn btn-s btn-ds-prev">Prev</button><span class="mono text-xs" style="color:var(--muted);padding:0 12px">Page ${State.ds.page} of ${totalPages}</span><button class="btn btn-s btn-ds-next">Next</button>` : '';

        if (totalPages > 1) {
            const prevBtn = Utils.$('ds-pagination')!.querySelector('.btn-ds-prev') as HTMLButtonElement | null;
            if (prevBtn) {
                prevBtn.disabled = State.ds.page === 1;
                prevBtn.onclick = () => App.dsPage(State.ds.page - 1);
            }
            const nextBtn = Utils.$('ds-pagination')!.querySelector('.btn-ds-next') as HTMLButtonElement | null;
            if (nextBtn) {
                nextBtn.disabled = State.ds.page === totalPages;
                nextBtn.onclick = () => App.dsPage(State.ds.page + 1);
            }
        }

        App.updateSelectAllDsState();
    },
    dsPage: (p: number): void => { State.ds.page = p; App.renderDsTable(); },
    toggleDsSelect: (keyStr: string, el: HTMLElement): void => {
        if (State.ds.selected.has(keyStr)) State.ds.selected.delete(keyStr); else State.ds.selected.add(keyStr);
        el.classList.toggle('on');
        (Utils.$('btn-ds-copy') as HTMLButtonElement).disabled = State.ds.selected.size === 0;
        App.updateSelectAllDsState();
    },
    toggleAllDs: (): void => {
        const allSel = State.ds.selected.size === State.ds.filtered.length && State.ds.filtered.length > 0;
        if(allSel) State.ds.selected.clear(); else State.ds.filtered.forEach(r => State.ds.selected.add(r.keyStr));
        App.renderDsTable();
        (Utils.$('btn-ds-copy') as HTMLButtonElement).disabled = State.ds.selected.size === 0;
    },
    updateSelectAllDsState: (): void => {
        const chkAll = Utils.$('chk-all-ds'); if(!chkAll) return;
        const isAll = State.ds.filtered.length > 0 && State.ds.selected.size === State.ds.filtered.length;
        chkAll.classList.toggle('on', isAll);
    },
    toggleDsRowExpand: (tr: HTMLElement, keyStr: string): void => {
        const existingNext = tr.nextElementSibling; if(existingNext?.classList.contains('expand-row')) { existingNext.remove(); return; }
        const expTr = document.createElement('tr'); expTr.className = 'expand-row'; expTr.style.borderBottom = '1px solid var(--brd)';
        const r = State.ds.results.find(x => x.keyStr === keyStr);
        if (!r) return;

        const srcProps = r.srcEntity?.properties || {};
        const tgtProps = r.tgtEntity?.properties || {};
        const allKeys = Array.from(new Set([...Object.keys(srcProps), ...Object.keys(tgtProps)])).sort();

        const renderRowHtml = (key: string, type: string, sVal: string, tVal: string, diffClass = '') => {
            const isBool = type === 'Boolean';
            const isSrcJson = Diff.isJsonString(sVal);
            const isTgtJson = Diff.isJsonString(tVal);
            const jsonEditableTypes = ['String', 'Array', 'Map', 'Entity', 'Key', 'GeoPoint'];
            const showJsonBtn = jsonEditableTypes.includes(type) && (isSrcJson || isTgtJson || type !== 'String');

            const sDisplayVal = sVal.includes('\n') ? sVal.split('\n')[0] + '...' : sVal;
            const tDisplayVal = tVal.includes('\n') ? tVal.split('\n')[0] + '...' : tVal;

            return `
                <tr class="prop-edit-row ${diffClass}" data-key="${Utils.escapeHtml(key)}" data-initial-type="${type}">
                    <td class="px-3 py-1.5 font-semibold text-xs text-left" style="color:var(--fg)">${Utils.escapeHtml(key)}</td>
                    <td class="px-3 py-1.5 text-left">
                        <select class="inp select-type font-semibold" style="padding: 2px 6px; font-size: 11px; width: 100px;">
                            <option value="String" ${type==='String'?'selected':''}>String</option>
                            <option value="Integer" ${type==='Integer'?'selected':''}>Integer</option>
                            <option value="Double" ${type==='Double'?'selected':''}>Double</option>
                            <option value="Boolean" ${type==='Boolean'?'selected':''}>Boolean</option>
                            <option value="Null" ${type==='Null'?'selected':''}>Null</option>
                            <option value="Timestamp" ${type==='Timestamp'?'selected':''}>Timestamp</option>
                            <option value="Blob" ${type==='Blob'?'selected':''}>Blob</option>
                            <option value="Key" ${type==='Key'?'selected':''}>Key</option>
                            <option value="GeoPoint" ${type==='GeoPoint'?'selected':''}>GeoPoint</option>
                            <option value="Array" ${type==='Array'?'selected':''}>Array</option>
                            <option value="Map" ${type==='Map'?'selected':''}>Map</option>
                            <option value="Entity" ${type==='Entity'?'selected':''}>Entity</option>
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
                            <div class="flex gap-1.5 items-center w-full">
                                <input class="inp val-src" style="padding: 2px 6px; font-size: 11px; width: 100%;" value="${Utils.escapeHtml(sDisplayVal)}" placeholder="— (Empty)">
                                <textarea class="raw-val-src" style="display:none;">${Utils.escapeHtml(sVal)}</textarea>
                                ${showJsonBtn ? `<button type="button" class="btn btn-s btn-json-edit-trigger" style="padding: 3px 6px; font-size: 10px;" title="Edit JSON"><i class="fa-solid fa-code"></i></button>` : ''}
                            </div>
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
                            <div class="flex gap-1.5 items-center w-full">
                                <input class="inp val-tgt" style="padding: 2px 6px; font-size: 11px; width: 100%;" value="${Utils.escapeHtml(tDisplayVal)}" placeholder="— (Empty)">
                                <textarea class="raw-val-tgt" style="display:none;">${Utils.escapeHtml(tVal)}</textarea>
                                ${showJsonBtn ? `<button type="button" class="btn btn-s btn-json-edit-trigger" style="padding: 3px 6px; font-size: 10px;" title="Edit JSON"><i class="fa-solid fa-code"></i></button>` : ''}
                            </div>
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
                type = getDatastoreEditorType(sProp);
                sVal = datastoreValueToEditorText(sProp);
            }
            if (tProp) {
                if (!sProp) type = getDatastoreEditorType(tProp);
                tVal = datastoreValueToEditorText(tProp);
            }

            let diffClass = '';
            if (sProp && !tProp) {
                diffClass = 'diff-rem';
            } else if (!sProp && tProp) {
                diffClass = 'diff-add';
            } else if (!Diff.areValuesEqual(sProp, tProp)) {
                diffClass = 'diff-mod';
            }

            rowsHtml += renderRowHtml(key, type, sVal, tVal, diffClass);
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

        const tbody = expTr.querySelector('.tbody-props') as HTMLElement;
        (expTr.querySelector('.btn-add-prop') as HTMLButtonElement).onclick = () => {
            const key = prompt("Enter new property key:");
            if (!key) return;
            const cleanKey = key.trim();
            if (!cleanKey) return;
            const keyExists = Array.from(tbody.querySelectorAll('.prop-edit-row'))
                .some(row => row.getAttribute('data-key') === cleanKey);
            if (keyExists) {
                alert("Property key already exists!");
                return;
            }
            const rowContainer = document.createElement('tbody');
            rowContainer.innerHTML = renderRowHtml(cleanKey, 'String', '', '');
            const newRow = rowContainer.firstElementChild as HTMLElement | null;
            if (!newRow) return;
            (newRow.querySelector('.btn-delete-prop') as HTMLButtonElement).onclick = () => newRow.remove();
            (newRow.querySelector('.select-type') as HTMLSelectElement).onchange = (e: any) => handleTypeChange(newRow, cleanKey, e.target.value);
            tbody.appendChild(newRow);
        };

        tbody.querySelectorAll('.btn-delete-prop').forEach(btn => {
            (btn as HTMLButtonElement).onclick = () => btn.closest('tr')!.remove();
        });

        const checkShowJsonBtn = (inputEl: HTMLInputElement | HTMLTextAreaElement | null) => {
            if (!inputEl) return;
            const val = inputEl.value;
            const container = inputEl.parentElement;
            if (!container) return;
            const hasBtn = container.querySelector('.btn-json-edit-trigger');
            if (Diff.isJsonString(val)) {
                if (!hasBtn) {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'btn btn-s btn-json-edit-trigger';
                    btn.style.padding = '3px 6px';
                    btn.style.fontSize = '10px';
                    btn.title = 'Edit JSON';
                    btn.innerHTML = '<i class="fa-solid fa-code"></i>';
                    inputEl.after(btn);

                    btn.onclick = () => {
                        const row = inputEl.closest('tr') as HTMLElement;
                        const key = row.getAttribute('data-key') || '';
                        const srcInput = row.querySelector('.raw-val-src') || row.querySelector('.val-src');
                        const tgtInput = row.querySelector('.raw-val-tgt') || row.querySelector('.val-tgt');
                        App.openJsonEditorModal(row, key, srcInput as any, tgtInput as any);
                    };
                }
            } else {
                if (hasBtn) hasBtn.remove();
            }
        };

        const handleTypeChange = (row: HTMLElement, key: string, newType: string) => {
            const srcTd = row.querySelectorAll('td')[2];
            const tgtTd = row.querySelectorAll('td')[3];
            const isBool = newType === 'Boolean';

            const oldSrcEl = (srcTd.querySelector('.raw-val-src') || srcTd.querySelector('.val-src')) as HTMLInputElement | null;
            const oldTgtEl = (tgtTd.querySelector('.raw-val-tgt') || tgtTd.querySelector('.val-tgt')) as HTMLInputElement | null;
            const oldSrcVal = oldSrcEl ? oldSrcEl.value : '';
            const oldTgtVal = oldTgtEl ? oldTgtEl.value : '';

            if (isBool) {
                srcTd.innerHTML = `
                    <select class="inp val-src" style="padding: 2px 6px; font-size: 11px; width: 100%;">
                        <option value="true" ${oldSrcVal==='true'?'selected':''}>true</option>
                        <option value="false" ${oldSrcVal==='false'?'selected':''}>false</option>
                        <option value="" ${!oldSrcVal?'selected':''}>— (Empty)</option>
                    </select>
                `;
                tgtTd.innerHTML = `
                    <select class="inp val-tgt" style="padding: 2px 6px; font-size: 11px; width: 100%;">
                        <option value="true" ${oldTgtVal==='true'?'selected':''}>true</option>
                        <option value="false" ${oldTgtVal==='false'?'selected':''}>false</option>
                        <option value="" ${!oldTgtVal?'selected':''}>— (Empty)</option>
                    </select>
                `;
            } else {
                const isSrcJson = Diff.isJsonString(oldSrcVal);
                const isTgtJson = Diff.isJsonString(oldTgtVal);
                const jsonEditableTypes = ['String', 'Array', 'Map', 'Entity', 'Key', 'GeoPoint'];
                const showJsonBtn = jsonEditableTypes.includes(newType) &&
                    (isSrcJson || isTgtJson || newType !== 'String');

                const sDisplayVal = oldSrcVal.includes('\n') ? oldSrcVal.split('\n')[0] + '...' : oldSrcVal;
                const tDisplayVal = oldTgtVal.includes('\n') ? oldTgtVal.split('\n')[0] + '...' : oldTgtVal;

                srcTd.innerHTML = `
                    <div class="flex gap-1.5 items-center w-full">
                        <input class="inp val-src" style="padding: 2px 6px; font-size: 11px; width: 100%;" value="${Utils.escapeHtml(sDisplayVal)}" placeholder="— (Empty)">
                        <textarea class="raw-val-src" style="display:none;">${Utils.escapeHtml(oldSrcVal)}</textarea>
                        ${showJsonBtn ? `<button type="button" class="btn btn-s btn-json-edit-trigger" style="padding: 3px 6px; font-size: 10px;" title="Edit JSON"><i class="fa-solid fa-code"></i></button>` : ''}
                    </div>
                `;
                tgtTd.innerHTML = `
                    <div class="flex gap-1.5 items-center w-full">
                        <input class="inp val-tgt" style="padding: 2px 6px; font-size: 11px; width: 100%;" value="${Utils.escapeHtml(tDisplayVal)}" placeholder="— (Empty)">
                        <textarea class="raw-val-tgt" style="display:none;">${Utils.escapeHtml(oldTgtVal)}</textarea>
                        ${showJsonBtn ? `<button type="button" class="btn btn-s btn-json-edit-trigger" style="padding: 3px 6px; font-size: 10px;" title="Edit JSON"><i class="fa-solid fa-code"></i></button>` : ''}
                    </div>
                `;

                const srcInp = srcTd.querySelector('.val-src') as HTMLInputElement;
                const tgtInp = tgtTd.querySelector('.val-tgt') as HTMLInputElement;

                srcInp.oninput = (e: any) => {
                    const rawTextarea = srcTd.querySelector('.raw-val-src') as HTMLTextAreaElement | null;
                    if (rawTextarea) rawTextarea.value = e.target.value;
                    checkShowJsonBtn(e.target);
                };
                tgtInp.oninput = (e: any) => {
                    const rawTextarea = tgtTd.querySelector('.raw-val-tgt') as HTMLTextAreaElement | null;
                    if (rawTextarea) rawTextarea.value = e.target.value;
                    checkShowJsonBtn(e.target);
                };

                if (showJsonBtn) {
                    row.querySelectorAll('.btn-json-edit-trigger').forEach(btn => {
                        (btn as HTMLElement).onclick = () => {
                            const srcInput = row.querySelector('.raw-val-src') || row.querySelector('.val-src');
                            const tgtInput = row.querySelector('.raw-val-tgt') || row.querySelector('.val-tgt');
                            App.openJsonEditorModal(row, key, srcInput as any, tgtInput as any);
                        };
                    });
                }
            }
        };

        tbody.querySelectorAll('.prop-edit-row').forEach(row => {
            const elRow = row as HTMLElement;
            const key = elRow.getAttribute('data-key') || '';
            (elRow.querySelector('.select-type') as HTMLSelectElement).onchange = (e: any) => handleTypeChange(elRow, key, e.target.value);

            const srcInp = elRow.querySelector('.val-src') as HTMLInputElement | null;
            const tgtInp = elRow.querySelector('.val-tgt') as HTMLInputElement | null;
            const srcTd = elRow.querySelectorAll('td')[2];
            const tgtTd = elRow.querySelectorAll('td')[3];

            if (srcInp) {
                srcInp.oninput = (e: any) => {
                    const rawTextarea = srcTd.querySelector('.raw-val-src') as HTMLTextAreaElement | null;
                    if (rawTextarea) rawTextarea.value = e.target.value;
                    checkShowJsonBtn(e.target);
                };
            }
            if (tgtInp) {
                tgtInp.oninput = (e: any) => {
                    const rawTextarea = tgtTd.querySelector('.raw-val-tgt') as HTMLTextAreaElement | null;
                    if (rawTextarea) rawTextarea.value = e.target.value;
                    checkShowJsonBtn(e.target);
                };
            }

            elRow.querySelectorAll('.btn-json-edit-trigger').forEach(btn => {
                (btn as HTMLElement).onclick = () => {
                    const srcInput = elRow.querySelector('.raw-val-src') || elRow.querySelector('.val-src');
                    const tgtInput = elRow.querySelector('.raw-val-tgt') || elRow.querySelector('.val-tgt');
                    App.openJsonEditorModal(elRow, key, srcInput as any, tgtInput as any);
                };
            });
        });

        const getPropertiesFromUI = (side: 'src' | 'tgt') => {
            const props: any = {};
            tbody.querySelectorAll('.prop-edit-row').forEach(row => {
                const key = row.getAttribute('data-key') || '';
                if (!key) return;
                const type = (row.querySelector('.select-type') as HTMLSelectElement).value as DatastoreEditorType;
                const initialType = row.getAttribute('data-initial-type') || 'String';
                const rawTextarea = row.querySelector(`.raw-val-${side}`) as HTMLTextAreaElement | null;
                const input = row.querySelector(`.val-${side}`) as HTMLInputElement | null;
                const val = rawTextarea ? rawTextarea.value : (input ? input.value : '');

                const original = side === 'src'
                    ? r.srcEntity?.properties?.[key]
                    : r.tgtEntity?.properties?.[key];
                if (!original && val === '') return;

                const originalText = original ? datastoreValueToEditorText(original) : '';
                if (original && type === initialType && val === originalText) {
                    props[key] = cloneDatastoreValue(original);
                } else {
                    props[key] = editorTextToDatastoreValue(type, val, original);
                }
            });
            Diff.minifyJsonProperties(props);
            return props;
        };

        const handleSave = async (side: 'src' | 'tgt') => {
            const pid = side === 'src' ? State.ds.src : State.ds.tgt;
            let props: any;
            try {
                props = getPropertiesFromUI(side);
            } catch (error: any) {
                Utils.toast(`Cannot save: ${error.message}`, 'err');
                return;
            }

            const confirmTmpl = Utils.$('template-ds-save-confirm') as HTMLTemplateElement;
            if (!confirmTmpl) return;
            const fragment = confirmTmpl.content.cloneNode(true) as DocumentFragment;

            fragment.querySelector('.entity-key-strong')!.textContent = keyStr;
            fragment.querySelector('.project-id-strong')!.textContent = pid;
            fragment.querySelector('.side-span')!.textContent = side === 'src' ? 'source' : 'target';

            UI.openModal(fragment);

            const cancelBtn = Utils.$('modal-root')!.querySelector('.btn-cancel') as HTMLButtonElement;
            const confirmBtn = Utils.$('modal-root')!.querySelector('.btn-confirm') as HTMLButtonElement;

            cancelBtn.onclick = () => {
                UI.closeModal();
            };

            confirmBtn.onclick = async () => {
                UI.closeModal();
                Utils.show('sec-loading');
                Utils.$('load-title')!.textContent = "Saving Entity...";
                Utils.$('load-msg')!.textContent = `Committing changes to ${pid}...`;

                let editAuditLogId: string | null = null;
                try {
                    const prevEntity = side === 'src' ? r.srcEntity : r.tgtEntity;
                    const dbId = side === 'src' ? State.ds.srcDb : State.ds.tgtDb;
                    const prevState = {
                        type: 'DATASTORE_EDIT',
                        prevEntity: prevEntity ? cloneDatastoreValue(prevEntity) : null,
                        rawKey: cloneDatastoreValue(r.rawKey),
                        keyStr,
                        dbId
                    };
                    if (!AuditLog.canPersistPrevState(prevState)) {
                        throw new Error('The entity backup is too large for a safe audit entry. Reduce the entity size before saving.');
                    }
                    editAuditLogId = await AuditLog.addLog(
                        'DATASTORE_EDIT',
                        '—',
                        pid,
                        `Started inline edit for entity ${keyStr}.`,
                        'IN_PROGRESS',
                        prevState
                    );
                    if (!editAuditLogId) {
                        throw new Error('The centralized audit backup could not be persisted. The entity was not changed.');
                    }
                    const entity = {
                        key: cloneDatastoreValue(r.rawKey),
                        properties: props
                    };
                    const db = (dbId === '(default)' || !dbId) ? '' : dbId;
                    const partitionId: any = { projectId: pid };
                    if (db) partitionId.databaseId = db;
                    entity.key.partitionId = partitionId;

                    await Api.commitDatastore(pid, [{ upsert: entity }], dbId);
                    Utils.toast(`Successfully saved entity to ${side === 'src' ? 'source' : 'target'} project.`, "ok");

                    const logged = await AuditLog.updateLog(
                        editAuditLogId,
                        'SUCCESS',
                        `Inline edited entity properties for ${keyStr}.`
                    );
                    if (!logged) {
                        Utils.toast(
                            'Entity saved, but its audit status could not be finalized. The pre-mutation revert backup remains available.',
                            'warn'
                        );
                    }

                    const expandedKey = keyStr;
                    await App.runDsAnalyze();

                    setTimeout(() => {
                        const newTr = Array.from(document.querySelectorAll('#ds-table-body tr')).find(tr => (tr as HTMLElement).innerText.includes(expandedKey)) as HTMLElement | null;
                        if (newTr) {
                            App.toggleDsRowExpand(newTr, expandedKey);
                        }
                    }, 800);
                } catch(err: any) {
                    console.error("Save failed:", err);
                    if (editAuditLogId) {
                        await AuditLog.updateLog(
                            editAuditLogId,
                            'FAILED',
                            `Inline edit failed for entity ${keyStr}: ${err.message}`
                        );
                    }
                    Utils.toast(`Save failed: ${err.message}`, "err");
                    Utils.hide('sec-loading');
                }
            };
        };

        (expTr.querySelector('.btn-save-src') as HTMLButtonElement).onclick = () => handleSave('src');
        (expTr.querySelector('.btn-save-tgt') as HTMLButtonElement).onclick = () => handleSave('tgt');
    },
    openDsCopyModal: (): void => {
        const tmpl = Utils.$('template-ds-copy-modal') as HTMLTemplateElement;
        if (!tmpl) return;
        const fragment = tmpl.content.cloneNode(true) as DocumentFragment;

        fragment.querySelector('.src-pid-strong')!.textContent = State.ds.src;
        fragment.querySelector('.tgt-pid-strong')!.textContent = State.ds.tgt;
        fragment.querySelector('.selected-cnt-span')!.textContent = String(State.ds.selected.size);

        UI.openModal(fragment);

        const chkReplace = Utils.$('modal-root')!.querySelector('.chk-apply-replace') as HTMLElement;
        const replaceInputsWrap = Utils.$('modal-root')!.querySelector('.replace-inputs-wrap') as HTMLElement;

        const modalFieldEl = Utils.$('modal-root')!.querySelector('.inp-field-val') as HTMLInputElement | null;
        const modalMenuEl = Utils.$('modal-root')!.querySelector('.modal-dd-ds-mod') as HTMLElement | null;
        const modalTargetEl = Utils.$('modal-root')!.querySelector('.inp-find-val') as HTMLInputElement | null;
        const modalReplaceEl = Utils.$('modal-root')!.querySelector('.inp-replace-val') as HTMLInputElement | null;

        if (modalFieldEl) {
            modalFieldEl.value = (Utils.$('ds-mod-field') as HTMLInputElement).value;
        }
        if (modalTargetEl) {
            modalTargetEl.value = (Utils.$('ds-mod-target') as HTMLInputElement).value;
        }
        if (modalReplaceEl) {
            modalReplaceEl.value = (Utils.$('ds-mod-replace') as HTMLInputElement).value;
        }

        if (modalFieldEl && modalMenuEl) {
            const properties = State.ds.properties;
            const renderModalDD = (filter = '') => {
                const filtered = properties.filter((k: string) => k.toLowerCase().includes(filter.toLowerCase()));
                modalMenuEl.replaceChildren();
                if (filtered.length === 0) {
                    const empty = document.createElement('div');
                    empty.className = 'dropdown-item';
                    empty.style.color = 'var(--muted)';
                    empty.textContent = 'No results';
                    modalMenuEl.appendChild(empty);
                    return;
                }
                filtered.forEach(property => {
                    const item = document.createElement('div');
                    item.className = 'dropdown-item';
                    item.dataset.id = property;
                    const label = document.createElement('span');
                    label.className = 'id';
                    label.textContent = property;
                    item.appendChild(label);
                    item.onmousedown = e => {
                        e.preventDefault();
                        modalFieldEl.value = property;
                        modalMenuEl.classList.remove('open');
                    };
                    modalMenuEl.appendChild(item);
                });
            };

            modalFieldEl.onfocus = () => {
                renderModalDD(modalFieldEl.value);
                modalMenuEl.classList.add('open');
            };
            modalFieldEl.oninput = () => {
                renderModalDD(modalFieldEl.value);
                modalMenuEl.classList.add('open');
            };
            modalFieldEl.onblur = () => {
                setTimeout(() => modalMenuEl.classList.remove('open'), 150);
            };
        }

        const updateVisibility = () => {
            const on = chkReplace.classList.contains('on');
            if (replaceInputsWrap) {
                replaceInputsWrap.style.display = on ? 'flex' : 'none';
            }
        };

        updateVisibility();

        chkReplace.onclick = () => {
            chkReplace.classList.toggle('on');
            updateVisibility();
        };

        (Utils.$('modal-root')!.querySelector('.btn-cancel') as HTMLButtonElement).onclick = () => UI.closeModal();
        (Utils.$('modal-root')!.querySelector('.btn-confirm') as HTMLButtonElement).onclick = () => {
            App.executeDsCopy();
        };
    },
    executeDsCopy: async (): Promise<void> => {
        const modalRoot = Utils.$('modal-root');
        const applyMod = modalRoot?.querySelector('.chk-apply-replace')?.classList.contains('on');
        const modalFieldEl = modalRoot?.querySelector('.inp-field-val') as HTMLInputElement | null;
        const modalTargetEl = modalRoot?.querySelector('.inp-find-val') as HTMLInputElement | null;
        const modalReplaceEl = modalRoot?.querySelector('.inp-replace-val') as HTMLInputElement | null;

        const modField = modalFieldEl ? modalFieldEl.value.trim() : (Utils.$('ds-mod-field') as HTMLInputElement).value.trim();
        const modTarget = modalTargetEl ? modalTargetEl.value : (Utils.$('ds-mod-target') as HTMLInputElement).value;
        const modReplace = modalReplaceEl ? modalReplaceEl.value : (Utils.$('ds-mod-replace') as HTMLInputElement).value;

        const keysToCopy = [...State.ds.selected];
        if (keysToCopy.length === 0) {
            UI.closeModal();
            Utils.toast('Select at least one entity to copy.', 'err');
            return;
        }

        UI.closeModal();
        Utils.show('sec-loading');
        Utils.hide('load-ds-stats');
        Utils.show('btn-cancel-ds');
        Utils.$('load-title')!.textContent = "Copying Entities...";
        State.cancelDs = false;

        const controller = beginDsOperation();
        const resultByKey = new Map(State.ds.results.map(result => [result.keyStr, result]));
        let ok = 0;
        let fail = 0;
        let replacementCount = 0;
        const backupData: any[] = [];
        let copyAuditLogId: string | null = null;

        try {
            Utils.$('load-msg')!.textContent = `Backing up ${keysToCopy.length} target entities...`;
            const targetKeyByString = new Map<string, any>();
            for (const keyStr of keysToCopy) {
                const result = resultByKey.get(keyStr);
                if (!result) throw new Error(`Selected entity ${keyStr} is no longer in the current analysis.`);
                const keyCopy = cloneDatastoreValue(result.rawKey);
                const tgtDbClean = (State.ds.tgtDb === '(default)' || !State.ds.tgtDb) ? '' : State.ds.tgtDb;
                const tgtPartitionId: any = { projectId: State.ds.tgt };
                if (tgtDbClean) tgtPartitionId.databaseId = tgtDbClean;
                keyCopy.partitionId = tgtPartitionId;
                targetKeyByString.set(keyStr, keyCopy);
            }

            const targetKeys = [...targetKeyByString.values()];
            const targetBackup = await Api.lookupEntities(
                State.ds.tgt,
                targetKeys,
                State.ds.tgtDb,
                controller.signal
            );
            const foundMap = new Map<string, any>(
                (targetBackup.found || []).map((entry: any) => [App.formatKey(entry.entity.key), entry.entity])
            );

            keysToCopy.forEach(keyStr => {
                const existingTarget = foundMap.get(keyStr);
                backupData.push({
                    keyStr,
                    action: existingTarget ? 'upsert' : 'delete',
                    prevEntity: existingTarget
                        ? cloneDatastoreValue(existingTarget)
                        : { key: cloneDatastoreValue(targetKeyByString.get(keyStr)) }
                });
            });

            const backupState = {
                type: "DATASTORE_COPY",
                kind: State.ds.kind,
                srcDb: State.ds.srcDb,
                tgtDb: State.ds.tgtDb,
                backupData
            };
            if (!AuditLog.canPersistPrevState(backupState)) {
                throw new Error('The selected entities exceed the safe audit-backup size. Copy a smaller selection.');
            }
            copyAuditLogId = await AuditLog.addLog(
                'DATASTORE_COPY',
                State.ds.src,
                State.ds.tgt,
                `Started copying ${keysToCopy.length} entities of kind ${State.ds.kind}.`,
                'IN_PROGRESS',
                backupState
            );
            if (!copyAuditLogId) {
                throw new Error('The centralized audit backup could not be persisted. No entities were changed.');
            }
        } catch (error: any) {
            Utils.hide('sec-loading');
            Utils.hide('btn-cancel-ds');
            if (isCancellationError(error)) {
                Utils.toast('Copy cancelled before any entities were changed.', 'info');
            } else {
                console.error("Failed to prepare target backup and audit record for revert", error);
                Utils.toast(`Copy stopped before mutation: ${error.message}`, 'err');
            }
            if (dsAbortController === controller) dsAbortController = null;
            return;
        }

        for (let i = 0; i < keysToCopy.length; i += 100) {
            if (State.cancelDs || controller.signal.aborted) break;
            const chunkStrs = keysToCopy.slice(i, i + 100);
            let batchFailureCount = chunkStrs.length;
            Utils.$('load-msg')!.textContent = `Copying ${ok} of ${keysToCopy.length}... (Fetching source entities)`;

            try {
                const rawKeys = chunkStrs
                    .map(keyStr => resultByKey.get(keyStr)?.rawKey)
                    .filter((key): key is any => Boolean(key))
                    .map(key => cloneDatastoreValue(key));
                if (rawKeys.length === 0) continue;

                const srcRes = await Api.lookupEntities(
                    State.ds.src,
                    rawKeys,
                    State.ds.srcDb,
                    controller.signal
                );
                const mutations: any[] = [];
                const foundSourceKeys = new Set(
                    (srcRes.found || []).map((entry: any) => App.formatKey(entry.entity.key))
                );
                const missingSourceCount = chunkStrs.filter(keyStr => !foundSourceKeys.has(keyStr)).length;
                fail += missingSourceCount;
                batchFailureCount = foundSourceKeys.size;

                for (const e of srcRes.found || []) {
                    const entity = cloneDatastoreValue(e.entity);
                    const tgtDbClean = (State.ds.tgtDb === '(default)' || !State.ds.tgtDb) ? '' : State.ds.tgtDb;
                    const tgtPartitionId: any = { projectId: State.ds.tgt };
                    if (tgtDbClean) tgtPartitionId.databaseId = tgtDbClean;
                    entity.key.partitionId = tgtPartitionId;

                    if (applyMod && modTarget && entity.properties) {
                        replacementCount += replaceDatastoreField(
                            entity.properties,
                            modField,
                            modTarget,
                            modReplace
                        );
                    }

                    if (entity.properties) {
                        Diff.minifyJsonProperties(entity.properties);
                        for (const [property, sourceValue] of Object.entries(e.entity.properties || {})) {
                            const copiedValue = entity.properties[property];
                            const sourceType = getDatastoreEditorType(sourceValue);
                            const copiedType = getDatastoreEditorType(copiedValue);
                            if (sourceType !== copiedType) {
                                throw new Error(`Type fidelity check failed for ${App.formatKey(e.entity.key)}.${property}`);
                            }
                        }
                    }

                    mutations.push({ upsert: entity });
                }

                if (mutations.length > 0) {
                    Utils.$('load-msg')!.textContent = `Copying ${ok} of ${keysToCopy.length}... (Writing to target)`;
                    await Api.commitDatastore(State.ds.tgt, mutations, State.ds.tgtDb, controller.signal);
                    ok += mutations.length;
                }
            } catch (e: any) {
                if (isCancellationError(e)) break;
                fail += batchFailureCount;
                Utils.toast(`Failed to copy batch: ${e.message}`, "err");
            }
        }

        const cancelled = State.cancelDs || controller.signal.aborted;
        Utils.hide('sec-loading');
        Utils.hide('btn-cancel-ds');
        Utils.toast(
            `${cancelled ? 'Copy cancelled' : 'Copy complete'}. Success: ${ok}, Failed: ${fail}`,
            cancelled ? 'info' : (ok > 0 ? 'ok' : 'err')
        );
        const status = !cancelled && fail === 0 && ok > 0 ? "SUCCESS" : (ok > 0 ? "PARTIAL" : "FAILED");
        let details = `Copied ${ok} entities of kind ${State.ds.kind}.`;
        if (applyMod) {
            const fieldText = (modField && modField.trim() !== "") ? `field '${modField}'` : "all fields (recursively)";
            details += ` Applied ${replacementCount} Find & Replace substitutions on ${fieldText}: "${modTarget}" -> "${modReplace}".`;
        }
        if (cancelled) {
            details += " Copy process was cancelled by the user.";
        }
        const logged = copyAuditLogId
            ? await AuditLog.updateLog(copyAuditLogId, status, details)
            : false;
        if (!logged) {
            Utils.toast(
                'Copy finished, but its audit status could not be finalized. The pre-mutation revert backup remains available.',
                'warn'
            );
        }
        if (dsAbortController === controller) dsAbortController = null;
        await App.runDsAnalyze();
    },

    openJsonEditorModal: (row: HTMLElement, propKey: string, srcInput: HTMLInputElement | HTMLTextAreaElement | null, tgtInput: HTMLInputElement | HTMLTextAreaElement | null): void => {
        Diff.openJsonEditorModal(row, propKey, srcInput, tgtInput);
    }
};

window.onload = () => {
    // Expose for E2E testing context
    (window as any).State = State;
    (window as any).App = App;

    App.init();
};
