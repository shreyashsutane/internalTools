import { State, BqTable, QueryComparison, DsResult } from './state';
import { Utils } from './utils';
import { Api } from './api';
import { UI } from './ui';
import { Diff } from './diff';
import { AuditLog } from './audit';
import { AssistUI } from './assist-ui';
import { AssistManager } from './assist';
import { SoundFX } from './sound';
import { D0198EasterEgg } from './easter-egg';
import {
    buildDatastoreFilterObject,
    cloneDatastoreValue,
    compressJsonToBase64,
    datastoreValueToEditorText,
    editorTextToDatastoreValue,
    extractEntityDisplayName,
    getDatastoreEditorType,
    mapConcurrent,
    replaceDatastoreField,
    replaceDatastoreRules,
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
        SoundFX.init();
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
            verifyInp.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (verifyInp.value.trim()) {
                        void App.verify();
                    }
                }
            });
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
        if (dsAddFilterBtn) {
            dsAddFilterBtn.onclick = () => {
                UI.addDsFilter();
                SoundFX.playPop();
            };
        }

        document.querySelectorAll('.btn-preset-filter').forEach((btn: any) => {
            btn.onclick = () => {
                const prop = btn.dataset.prop || '__key__';
                const op = btn.dataset.op || '=';
                const type = btn.dataset.type || 'string';
                const val = btn.dataset.val || '';
                UI.addDsFilter(prop, op, type, val);
                SoundFX.playChime();
                Utils.toast(`Preset applied: ${prop} ${op} "${val}"`, 'ok');
            };
        });

        const addRuleBtn = Utils.$('btn-add-ds-rule');
        if (addRuleBtn) {
            addRuleBtn.onclick = () => {
                if (!State.ds.modRules) State.ds.modRules = [];
                State.ds.modRules.push({
                    id: 'rule-' + Date.now(),
                    field: '*',
                    target: '',
                    replacement: ''
                });
                UI.renderDsRules('ds-rules-container', false);
                SoundFX.playChime();
            };
        }

        const dsModField = Utils.$('ds-mod-field') as HTMLInputElement | null;
        if (dsModField) dsModField.oninput = (e: any) => {
            State.ds.modField = e.target.value;
            if (State.ds.modRules && State.ds.modRules[0]) State.ds.modRules[0].field = e.target.value;
        };

        const dsModTarget = Utils.$('ds-mod-target') as HTMLInputElement | null;
        if (dsModTarget) dsModTarget.oninput = (e: any) => {
            State.ds.modTarget = e.target.value;
            if (State.ds.modRules && State.ds.modRules[0]) State.ds.modRules[0].target = e.target.value;
        };

        const dsModReplace = Utils.$('ds-mod-replace') as HTMLInputElement | null;
        if (dsModReplace) dsModReplace.oninput = (e: any) => {
            State.ds.modReplace = e.target.value;
            if (State.ds.modRules && State.ds.modRules[0]) State.ds.modRules[0].replacement = e.target.value;
        };

        const dsSelectAllKindsBtn = Utils.$('btn-ds-select-all-kinds');
        if (dsSelectAllKindsBtn) dsSelectAllKindsBtn.onclick = UI.selectAllKinds;

        const dsClearKindsBtn = Utils.$('btn-ds-clear-kinds');
        if (dsClearKindsBtn) dsClearKindsBtn.onclick = UI.clearAllKinds;

        const dsKindFilter = Utils.$('ds-kind-filter') as HTMLSelectElement | null;
        if (dsKindFilter) {
            dsKindFilter.onchange = () => App.setDsKindFilter(dsKindFilter.value);
        }

        const dsExpandAllBtn = Utils.$('btn-ds-expand-all');
        if (dsExpandAllBtn) dsExpandAllBtn.onclick = () => App.toggleAllAccordions(true);

        const dsCollapseAllBtn = Utils.$('btn-ds-collapse-all');
        if (dsCollapseAllBtn) dsCollapseAllBtn.onclick = () => App.toggleAllAccordions(false);

        const dsAnalyzeBtn = Utils.$('btn-ds-analyze');
        if (dsAnalyzeBtn) dsAnalyzeBtn.onclick = App.runDsAnalyze;

        const cancelDsBtn = Utils.$('btn-cancel-ds');
        if (cancelDsBtn) cancelDsBtn.onclick = App.cancelDsOperation;

        const dsCsvBtn = Utils.$('btn-ds-csv');
        if (dsCsvBtn) dsCsvBtn.onclick = App.exportDsCsv;

        const dsExportMdBtn = Utils.$('btn-ds-export-md');
        if (dsExportMdBtn) dsExportMdBtn.onclick = App.exportDsMarkdown;

        const dsDryRunBtn = Utils.$('btn-ds-dry-run');
        if (dsDryRunBtn) dsDryRunBtn.onclick = App.runDsDryRun;

        const dsDiffSearchInp = Utils.$('ds-diff-search') as HTMLInputElement | null;
        if (dsDiffSearchInp) {
            dsDiffSearchInp.oninput = (e: any) => App.filterDsDiffSearch(e.target.value);
        }

        const dsCopyBtn = Utils.$('btn-ds-copy');
        if (dsCopyBtn) dsCopyBtn.onclick = App.openDsCopyModal;

        const toggleAssistBtn = Utils.$('btn-toggle-assist');
        if (toggleAssistBtn) toggleAssistBtn.onclick = () => AssistUI.toggle();

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
        AssistUI.init();
        UI.renderDsRules();
        (window as any).State = State;
        (window as any).App = App;
        (window as any).UI = UI;
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
            if (!SoundFX.isEnabled()) return;
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
        if (mode === 'ds') UI.renderDsRules();
        if (AssistManager.isActive()) AssistUI.render();
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
        if (AssistManager.isActive()) AssistUI.render();
    },
    toggleQSelect: (qId: string, el: HTMLElement): void => {
        if (State.query.selected.has(qId)) State.query.selected.delete(qId);
        else State.query.selected.add(qId);
        el.classList.toggle('on');
        (Utils.$('btn-q-copy') as HTMLButtonElement).disabled = State.query.selected.size === 0;
        App.updateSelectAllQState();
        if (AssistManager.isActive()) AssistUI.render();
    },
    toggleAllQ: (): void => {
        const copyableQueries = State.query.queries.filter(q => q.srcQuery !== null);
        const allSel = State.query.selected.size === copyableQueries.length && copyableQueries.length > 0;
        if (allSel) State.query.selected.clear();
        else copyableQueries.forEach(q => State.query.selected.add(q.name));
        App.renderQueryResults();
        (Utils.$('btn-q-copy') as HTMLButtonElement).disabled = State.query.selected.size === 0;
        if (AssistManager.isActive()) AssistUI.render();
    },
    updateSelectAllQState: (): void => {
        const chkAll = Utils.$('chk-all-q'); if(!chkAll) return;
        const copyableQueries = State.query.queries.filter(q => q.srcQuery !== null);
        const isAll = copyableQueries.length > 0 && State.query.selected.size === copyableQueries.length;
        chkAll.classList.toggle('on', isAll);
    },
    toggleQueryDetails: (tr: HTMLElement, q: QueryComparison): void => {
        const existingNext = tr.nextElementSibling;
        if (existingNext?.classList.contains('expand-row')) { 
            existingNext.remove(); 
            if (AssistManager.isActive()) AssistUI.render();
            return; 
        }
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
            let persistedBackupIndex = -1;
            try {
                if (cmpObj.tgtQuery) {
                    backupData.push(backupCandidate);
                    persistedBackupIndex = backupData.length - 1;
                    const preDeleteBackupPersisted = await AuditLog.updateLog(
                        queryAuditLogId,
                        'IN_PROGRESS',
                        `Backed up ${backupData.length} of ${selected.length} scheduled query configurations before mutation.`,
                        { type: 'QUERY_SYNC', backupData }
                    );
                    if (!preDeleteBackupPersisted) {
                        backupData.pop();
                        persistedBackupIndex = -1;
                        throw new Error('Scheduled-query backup could not be persisted; the existing configuration was not deleted.');
                    }
                    await Api.deleteQuery(cmpObj.tgtQuery.name);
                    removedPreviousTarget = true;
                }
                const created = await Api.createQuery(State.query.tgt, State.query.tgtLoc, q);
                if (!created?.name) throw new Error('Scheduled-query create response did not include a resource name.');
                if (persistedBackupIndex >= 0) {
                    backupData[persistedBackupIndex] = { ...backupCandidate, name: created.name };
                } else {
                    backupData.push({ ...backupCandidate, name: created.name });
                    persistedBackupIndex = backupData.length - 1;
                }
                const backupPersisted = await AuditLog.updateLog(
                    queryAuditLogId,
                    'IN_PROGRESS',
                    `Copied ${backupData.length} of ${selected.length} scheduled query configurations.`,
                    { type: 'QUERY_SYNC', backupData }
                );
                if (!backupPersisted) {
                    try {
                        await Api.deleteQuery(created.name);
                        if (prevQuery) {
                            const restored = await Api.createQuery(State.query.tgt, State.query.tgtLoc, prevQuery);
                            if (restored?.name && persistedBackupIndex >= 0) {
                                backupData[persistedBackupIndex] = { ...backupCandidate, name: restored.name };
                            }
                            removedPreviousTarget = false;
                        } else if (persistedBackupIndex >= 0) {
                            backupData.splice(persistedBackupIndex, 1);
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
                        const restored = await Api.createQuery(State.query.tgt, State.query.tgtLoc, prevQuery);
                        if (restored?.name && persistedBackupIndex >= 0) {
                            backupData[persistedBackupIndex] = { ...backupCandidate, name: restored.name };
                            await AuditLog.updateLog(
                                queryAuditLogId,
                                'IN_PROGRESS',
                                `Restored ${q.displayName} after a failed copy; its revert backup remains durable.`,
                                { type: 'QUERY_SYNC', backupData }
                            );
                        }
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
        State.ds.srcDb = (Utils.$('ds-src-db') as HTMLInputElement).value;
        State.ds.tgtDb = (Utils.$('ds-tgt-db') as HTMLInputElement).value;

        const kindsToProcess = State.ds.selectedKinds.size > 0
            ? [...State.ds.selectedKinds]
            : ((Utils.$('ds-kind') as HTMLInputElement).value ? (Utils.$('ds-kind') as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean) : []);

        if (!State.ds.src || !State.ds.tgt || kindsToProcess.length === 0) {
            return Utils.toast("Please select Source Project, Target Project, and at least one Kind.", "err");
        }

        State.ds.results = [];
        State.ds.filtered = [];
        State.ds.selected.clear();
        State.ds.stats = {identical:0, different:0, missing:0, mapped:0, total:0};
        State.cancelDs = false;

        const copyButton = Utils.$('btn-ds-copy') as HTMLButtonElement | null;
        if (copyButton) copyButton.disabled = true;

        Utils.hide('sec-forms');
        Utils.show('sec-loading');
        Utils.show('load-ds-stats');
        Utils.show('btn-cancel-ds');
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

        const parseTypedVal = (v: string, type: string) => {
            const trimmed = (v || '').trim();
            switch (type) {
                case 'string':
                    return { stringValue: v };
                case 'integer':
                    if (trimmed === '' || isNaN(Number(trimmed))) {
                        throw new Error(`Invalid Integer value: "${v}"`);
                    }
                    return { integerValue: String(BigInt(parseInt(trimmed, 10))) };
                case 'double':
                    if (trimmed === '' || isNaN(Number(trimmed))) {
                        throw new Error(`Invalid Double value: "${v}"`);
                    }
                    return { doubleValue: parseFloat(trimmed) };
                case 'boolean':
                    return { booleanValue: trimmed.toLowerCase() === 'true' };
                case 'timestamp': {
                    if (!trimmed) throw new Error("Timestamp value cannot be empty");
                    const date = new Date(trimmed);
                    if (isNaN(date.getTime())) throw new Error(`Invalid ISO timestamp: "${v}"`);
                    return { timestampValue: date.toISOString() };
                }
                case 'null':
                    return { nullValue: null };
                case 'auto':
                default:
                    return parseVal(v);
            }
        };

        const filterElements = Utils.$('ds-filters-container')?.querySelectorAll('.filter-row');
        const rawFilters: Array<{ kindScope: string; prop: string; op: string; type: string; val: string }> = [];
        if (filterElements && filterElements.length > 0) {
            filterElements.forEach((r: any) => {
                const kindScope = (r.querySelector('.filter-kind') as HTMLSelectElement)?.value || 'all';
                const prop = (r.querySelector('.filter-prop') as HTMLSelectElement)?.value;
                const op = (r.querySelector('.filter-op') as HTMLSelectElement)?.value || 'EQUAL';
                const type = (r.querySelector('.filter-type') as HTMLSelectElement)?.value || 'auto';
                const valInput = r.querySelector('.filter-val') as HTMLInputElement | HTMLSelectElement | null;
                const val = valInput ? valInput.value : '';

                if (prop && (val || type === 'null')) {
                    rawFilters.push({ kindScope, prop, op, type, val });
                }
            });
        }

        const controller = beginDsOperation();
        const discoveredProperties = new Set(State.ds.properties);
        try {
            let totalScanned = 0;

            const updateStatsDisplay = () => {
                Utils.$('ld-identical')!.textContent = String(State.ds.stats.identical);
                Utils.$('ld-different')!.textContent = String(State.ds.stats.different);
                Utils.$('ld-missing')!.textContent = String(State.ds.stats.missing);
            };

            // Process kinds concurrently with bounded concurrency (up to 3 parallel streams)
            await mapConcurrent(kindsToProcess, Math.min(3, kindsToProcess.length), async (currentKind, kIdx) => {
                if (State.cancelDs || controller.signal.aborted) return;
                const kindPrefix = `[${kIdx + 1}/${kindsToProcess.length}] Kind "${currentKind}"`;

                // Filter props that are either for 'all' kinds or specifically for this kind
                const applicableFilters = rawFilters
                    .filter(f => f.kindScope === 'all' || f.kindScope === currentKind)
                    .map(f => buildDatastoreFilterObject(f.prop, f.op, f.val, f.type, currentKind, State.ds.src, State.ds.srcDb));

                const srcPartitionId: any = { projectId: State.ds.src };
                const dbClean = (State.ds.srcDb === '(default)' || !State.ds.srcDb) ? '' : State.ds.srcDb;
                if (dbClean) srcPartitionId.databaseId = dbClean;

                const body: any = { partitionId: srcPartitionId, query: { kind: [{ name: currentKind }] } };
                if (applicableFilters.length === 1) {
                    body.query.filter = applicableFilters[0];
                } else if (applicableFilters.length > 1) {
                    body.query.filter = { compositeFilter: { op: 'AND', filters: applicableFilters } };
                }

                let cursor = null;
                let nextBatchPromise: Promise<any> | null = null;

                do {
                    if (State.cancelDs || controller.signal.aborted) throw new DOMException("Process Cancelled", 'AbortError');

                    Utils.$('load-msg')!.textContent = `${kindPrefix}: Fetching batch (${totalScanned} scanned)...`;

                    // Pipelined fetch: use pre-fetched batch if available, otherwise fetch
                    const res = nextBatchPromise
                        ? await nextBatchPromise
                        : await Api.runDatastoreQuery(State.ds.src, body, State.ds.srcDb, controller.signal);

                    const srcEntities = res.batch?.entityResults || [];
                    cursor = res.batch?.moreResults === 'NO_MORE_RESULTS' ? null : (res.batch?.endCursor || null);

                    // Pipeline: If there is a next cursor, start pre-fetching it in parallel while we process current batch
                    if (cursor) {
                        const nextBody = { ...body, query: { ...body.query, startCursor: cursor } };
                        nextBatchPromise = Api.runDatastoreQuery(State.ds.src, nextBody, State.ds.srcDb, controller.signal);
                    } else {
                        nextBatchPromise = null;
                    }

                    if (srcEntities.length === 0) break;

                    // Collect property names
                    srcEntities.forEach((result: any) => {
                        Object.keys(result.entity?.properties || {}).forEach(name => discoveredProperties.add(name));
                    });

                    // Prepare 100-key chunks for parallel lookup
                    const CHUNK_SIZE = 100;
                    const chunks: any[][] = [];
                    for (let i = 0; i < srcEntities.length; i += CHUNK_SIZE) {
                        chunks.push(srcEntities.slice(i, i + CHUNK_SIZE));
                    }

                    Utils.$('load-msg')!.textContent = `${kindPrefix}: Comparing ${srcEntities.length} entities in parallel...`;

                    // Parallel target lookup across all chunks with Promise.all
                    const lookupResults = await Promise.all(
                        chunks.map(chunk => {
                            const keysToLookup = chunk.map((e: any) => {
                                const keyCopy = cloneDatastoreValue(e.entity.key);
                                const tgtDbClean = (State.ds.tgtDb === '(default)' || !State.ds.tgtDb) ? '' : State.ds.tgtDb;
                                const tgtPartitionId: any = { projectId: State.ds.tgt };
                                if (tgtDbClean) tgtPartitionId.databaseId = tgtDbClean;
                                keyCopy.partitionId = tgtPartitionId;
                                return keyCopy;
                            });
                            return Api.lookupEntities(State.ds.tgt, keysToLookup, State.ds.tgtDb, controller.signal);
                        })
                    );

                    // Process results per chunk
                    chunks.forEach((chunk, cIdx) => {
                        const tgtRes = lookupResults[cIdx];
                        const tgtMap = new Map((tgtRes.found || []).map((e: any) => [App.formatKey(e.entity.key), e.entity]));
                        const missingSet = new Set((tgtRes.missing || []).map((e: any) => App.formatKey(e.entity.key)));

                        for (const srcE of chunk) {
                            const kStr = App.formatKey(srcE.entity.key);
                            State.ds.stats.total++;
                            totalScanned++;
                            const tgtEnt = tgtMap.get(kStr);
                            if (missingSet.has(kStr) || !tgtEnt) {
                                State.ds.stats.missing++;
                                State.ds.results.push({ kind: currentKind, keyStr: kStr, rawKey: srcE.entity.key, status: 'missing', diffSum: 'Missing in Target', srcEntity: srcE.entity, tgtEntity: null });
                            } else {
                                const diff = App.compareEntities(srcE.entity, tgtEnt);
                                const hasRealDiff = diff.some(d => d.type !== 'mapped');
                                const hasMapped = diff.some(d => d.type === 'mapped');

                                if (hasRealDiff) {
                                    State.ds.stats.different++;
                                    const diffSum = diff.filter(d => d.type !== 'mapped').map(d => d.prop).join(', ');
                                    State.ds.results.push({ kind: currentKind, keyStr: kStr, rawKey: srcE.entity.key, status: 'different', diff, diffSum, srcEntity: srcE.entity, tgtEntity: tgtEnt });
                                } else if (hasMapped) {
                                    State.ds.stats.mapped++;
                                    const diffSum = diff.map(d => `${d.prop} (project mapped)`).join(', ');
                                    State.ds.results.push({ kind: currentKind, keyStr: kStr, rawKey: srcE.entity.key, status: 'mapped', diff, diffSum, srcEntity: srcE.entity, tgtEntity: tgtEnt });
                                } else {
                                    State.ds.stats.identical++;
                                    State.ds.results.push({ kind: currentKind, keyStr: kStr, rawKey: srcE.entity.key, status: 'identical', diff: [], diffSum: '—', srcEntity: srcE.entity, tgtEntity: tgtEnt });
                                }
                            }
                        }
                    });

                    updateStatsDisplay();
                    await new Promise(resolve => setTimeout(resolve, 0));
                } while (cursor);
            });

            State.ds.properties = [...discoveredProperties].sort();
            UI.initDropdowns();

            // Populate kind filter dropdown in results
            const uniqueKindsInResults = [...new Set(State.ds.results.map(r => r.kind).filter(Boolean))];
            const filterDropdown = Utils.$('ds-kind-filter') as HTMLSelectElement | null;
            if (filterDropdown) {
                filterDropdown.innerHTML = `<option value="all">All Kinds (${uniqueKindsInResults.length})</option>` +
                    uniqueKindsInResults.map(k => `<option value="${Utils.escapeHtml(k!)}">${Utils.escapeHtml(k!)}</option>`).join('');
                filterDropdown.value = 'all';
            }
            State.ds.filterKind = 'all';

            Utils.hide('sec-loading'); Utils.show('sec-results'); Utils.show('res-ds'); App.filterDsResults('all');
            const logged = await AuditLog.addLog(
                'DATASTORE_ANALYZE',
                State.ds.src,
                State.ds.tgt,
                `Analyzed ${kindsToProcess.length} kinds (${kindsToProcess.join(', ')}). Total: ${State.ds.stats.total}; identical: ${State.ds.stats.identical}; mapped: ${State.ds.stats.mapped}; different: ${State.ds.stats.different}; missing: ${State.ds.stats.missing}.`,
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
                    `Cancelled analysis for kinds ${State.ds.kind || 'not selected'}.`,
                    'CANCELLED'
                );
            } else {
                void AuditLog.addLog(
                    'DATASTORE_ANALYZE',
                    State.ds.src || '—',
                    State.ds.tgt || '—',
                    `Datastore analysis failed: ${e.message || String(e)}`,
                    'FAILED'
                );
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
        const diffs: any[] = [];
        const srcProps = src?.properties || {};
        const tgtProps = tgt?.properties || {};
        const allKeys = new Set([...Object.keys(srcProps), ...Object.keys(tgtProps)]);

        for (const k of allKeys) {
            const sVal = srcProps[k];
            const tVal = tgtProps[k];

            // 1. Instant reference equality or missing side
            if (sVal === tVal) continue;
            if (!sVal && tVal) {
                diffs.push({ prop: k, type: 'added', src: '—', tgt: App.formatVal(tVal) });
                continue;
            }
            if (sVal && !tVal) {
                diffs.push({ prop: k, type: 'removed', src: App.formatVal(sVal), tgt: '—' });
                continue;
            }

            // 2. Fast-path check: if deepEqual returns true, properties match identically
            if (App.valsEqual(sVal, tVal)) {
                continue;
            }

            // 3. If it's a query property, check semantic SQL match
            if (Diff.isQueryKey(k)) {
                const sStr = typeof sVal?.stringValue === 'string' ? sVal.stringValue : '';
                const tStr = typeof tVal?.stringValue === 'string' ? tVal.stringValue : '';
                if (sStr && tStr) {
                    const queryDiff = Diff.isQuerySemanticallyEqual(sStr, tStr, State.ds.src, State.ds.tgt);
                    if (queryDiff.match && queryDiff.type === 'identical') {
                        continue; // Semantically identical query! No difference.
                    }
                    if (queryDiff.match && queryDiff.type === 'project_mapped') {
                        diffs.push({ prop: k, type: 'mapped', src: App.formatVal(sVal), tgt: App.formatVal(tVal) });
                        continue;
                    }
                }
            }

            diffs.push({ prop: k, type: 'modified', src: App.formatVal(sVal), tgt: App.formatVal(tVal) });
        }
        return diffs;
    },
    valsEqual: (a: any, b: any): boolean => Diff.areValuesEqual(a, b),
    formatVal: (v: any): string => {
        if (!v) return '—'; const k = Object.keys(v).find(k => v[k] !== null && v[k] !== undefined && !(Array.isArray(v[k]?.values) && v[k].values.length === 0));
        if (!k) return '—'; if(k === 'arrayValue') return `[Array:${(v[k].values||[]).length}]`; if(k === 'mapValue') return `{Map}`; if(k === 'entityValue') return `{Entity}`;
        return String(v[k]).substring(0, 50);
    },

    exportDsCsv: (): void => {
        const rows = [['Kind', 'Key', 'Status', 'Diff Summary']];
        State.ds.results.forEach(r => rows.push([r.kind || '—', r.keyStr, r.status, r.diffSum]));
        const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        const kindLabel = State.ds.selectedKinds.size > 0 ? [...State.ds.selectedKinds].join('_') : (State.ds.kind || 'all');
        a.download = `ds_compare_${kindLabel}.csv`;
        a.click();
        void AuditLog.addLog(
            'DATASTORE_CSV_EXPORT',
            State.ds.src || '—',
            State.ds.tgt || '—',
            `Exported ${State.ds.results.length} Datastore comparison rows for kinds: ${kindLabel}.`,
            'SUCCESS'
        ).then(logged => {
            if (!logged) Utils.toast('CSV exported, but the export action could not be logged.', 'warn');
        });
    },
    exportDsMarkdown: (): void => {
        const kindLabel = State.ds.selectedKinds.size > 0 ? [...State.ds.selectedKinds].join(', ') : (State.ds.kind || 'All');
        const lines = [
            `# Datastore Comparison Report (${kindLabel})`,
            `* **Source Project:** \`${State.ds.src || '—'}\``,
            `* **Target Project:** \`${State.ds.tgt || '—'}\``,
            `* **Entity Kinds:** \`${kindLabel}\``,
            `* **Total Analyzed:** ${State.ds.stats.total}`,
            `* **Identical:** ${State.ds.stats.identical}`,
            `* **Different:** ${State.ds.stats.different}`,
            `* **Missing in Target:** ${State.ds.stats.missing}`,
            `* **Project Mapped:** ${State.ds.stats.mapped}`,
            `* **Generated At:** ${new Date().toISOString()}`,
            '',
            `| Kind | Entity Key | Status | Diff Summary |`,
            `| :--- | :--- | :--- | :--- |`
        ];
        State.ds.results.forEach(r => {
            lines.push(`| \`${r.kind || '—'}\` | \`${r.keyStr}\` | **${r.status.toUpperCase()}** | ${r.diffSum} |`);
        });
        const md = lines.join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
        a.download = `datastore_report_${State.ds.selectedKinds.size > 0 ? [...State.ds.selectedKinds].join('_') : (State.ds.kind || 'export')}.md`;
        a.click();
        Utils.toast('Markdown report exported', 'ok');
    },
    filterDsDiffSearch: (term: string): void => {
        const t = term.toLowerCase().trim();
        if (!t) {
            App.filterDsResults(State.ds.filterStatus);
            return;
        }
        State.ds.filtered = State.ds.results.filter(r => 
            (State.ds.filterStatus === 'all' || r.status === State.ds.filterStatus) &&
            (r.keyStr.toLowerCase().includes(t) || r.diffSum.toLowerCase().includes(t))
        );
        State.ds.page = 1;
        App.renderDsTable();
    },
    runDsDryRun: async (): Promise<void> => {
        if (!State.ds.src || !State.ds.kind) {
            Utils.toast('Please select Source Project and Entity Kind first', 'warn');
            return;
        }
        AssistManager.setMascotState('thinking');
        if (AssistManager.isActive()) AssistUI.render();
        Utils.toast('Executing in-memory Dry Run simulation...', 'info');

        try {
            const body: any = {
                partitionId: { projectId: State.ds.src },
                query: { kind: [{ name: State.ds.kind }], limit: 5 }
            };
            if (State.ds.srcDb) body.partitionId.databaseId = State.ds.srcDb;

            const res = await Api.runDatastoreQuery(State.ds.src, body, State.ds.srcDb);
            const entities = (res.batch?.entityResults || []).map((r: any) => r.entity);

            if (entities.length === 0) {
                Utils.toast('No sample entities found to simulate', 'warn');
                AssistManager.setMascotState('idle');
                if (AssistManager.isActive()) AssistUI.render();
                return;
            }

            const simulated = entities.map((ent: any) => {
                const cloned = cloneDatastoreValue({ entityValue: ent }).entityValue;
                let modified = false;
                const activeRules = (State.ds.modRules || []).filter(r => r && r.target);
                if (activeRules.length > 0) {
                    modified = replaceDatastoreRules(cloned.properties || {}, activeRules) > 0;
                } else if (State.ds.modField && State.ds.modTarget) {
                    modified = replaceDatastoreField(cloned.properties || {}, State.ds.modField, State.ds.modTarget, State.ds.modReplace) > 0;
                }
                return {
                    key: ent.key?.path?.[0]?.name || ent.key?.path?.[0]?.id || 'sample-key',
                    before: JSON.stringify(ent.properties || {}, null, 2),
                    after: JSON.stringify(cloned.properties || {}, null, 2),
                    modified
                };
            });

            AssistManager.setMascotState('success');
            if (AssistManager.isActive()) AssistUI.render();

            const modalContent = `
                <div style="padding:20px;max-width:850px">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
                        <div style="display:flex;align-items:center;gap:10px">
                            <i class="fa-solid fa-flask" style="color:var(--accent-teal, #00d4ff);font-size:22px"></i>
                            <div>
                                <h3 style="font-weight:700;font-size:16px">Dry Run Pre-Flight Simulation</h3>
                                <p style="font-size:12px;color:var(--muted)">In-memory preview for kind <strong>${State.ds.kind}</strong> (5 sample entities). 0 writes sent to GCP.</p>
                            </div>
                        </div>
                        <button class="btn btn-s" onclick="UI.closeModal()"><i class="fa-solid fa-xmark"></i></button>
                    </div>

                    <div style="display:flex;flex-direction:column;gap:16px;max-height:60vh;overflow-y:auto;padding-right:8px">
                        ${simulated.map((s: any, idx: number) => `
                            <div style="background:var(--bg2);border:1px solid var(--brd);border-radius:12px;padding:14px">
                                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                                    <span class="mono" style="font-weight:600;font-size:12px;color:var(--fg)">Sample #${idx + 1}: ${s.key}</span>
                                    <span class="badge font-semibold" style="background:${s.modified ? 'var(--warn-dim)' : 'var(--ok-dim)'};color:${s.modified ? 'var(--warn)' : 'var(--ok)'}">
                                        ${s.modified ? 'TRANSFORM APPLIED' : 'UNMODIFIED'}
                                    </span>
                                </div>
                                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                                    <div>
                                        <div style="font-size:10px;font-weight:600;color:var(--muted);margin-bottom:4px">BEFORE (SOURCE RAW)</div>
                                        <pre style="background:var(--bg);border:1px solid var(--brd);border-radius:8px;padding:8px;font-size:10.5px;max-height:140px;overflow:auto" class="mono">${Utils.escapeHtml(s.before)}</pre>
                                    </div>
                                    <div>
                                        <div style="font-size:10px;font-weight:600;color:var(--accent-teal, #00d4ff);margin-bottom:4px">AFTER (SIMULATED MUTATION)</div>
                                        <pre style="background:var(--bg);border:1px solid var(--brd);border-radius:8px;padding:8px;font-size:10.5px;max-height:140px;overflow:auto" class="mono">${Utils.escapeHtml(s.after)}</pre>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>

                    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px;border-top:1px solid var(--brd);padding-top:14px">
                        <button class="btn btn-s" onclick="UI.closeModal()">Close Preview</button>
                    </div>
                </div>
            `;
            UI.openModal(modalContent);
        } catch (e: any) {
            Utils.toast(e.message || 'Dry Run simulation failed', 'err');
            AssistManager.setMascotState('warning');
            if (AssistManager.isActive()) AssistUI.render();
        }
    },
    setDsKindFilter: (kind: string): void => {
        State.ds.filterKind = kind;
        App.filterDsResults(State.ds.filterStatus);
    },
    filterDsResults: (status: string): void => {
        State.ds.filterStatus = status;
        let filtered = status === 'all' ? State.ds.results : State.ds.results.filter(r => r.status === status);
        if (State.ds.filterKind && State.ds.filterKind !== 'all') {
            filtered = filtered.filter(r => r.kind === State.ds.filterKind);
        }
        State.ds.filtered = filtered;
        Utils.$('ds-cnt-all')!.textContent = String(State.ds.stats.total);
        Utils.$('ds-cnt-diff')!.textContent = String(State.ds.stats.different);
        const mappedCnt = Utils.$('ds-cnt-mapped');
        if (mappedCnt) mappedCnt.textContent = String(State.ds.stats.mapped);
        Utils.$('ds-cnt-miss')!.textContent = String(State.ds.stats.missing);
        Utils.$('ds-cnt-eq')!.textContent = String(State.ds.stats.identical);
        State.ds.page = 1; App.renderDsTable();
    },
    toggleAllAccordions: (expand: boolean): void => {
        const accordions = document.querySelectorAll('.kind-accordion-card');
        accordions.forEach(acc => {
            const kind = acc.getAttribute('data-kind');
            if (expand) {
                acc.classList.add('open');
                if (kind) State.ds.collapsedKinds.delete(kind);
                // Trigger lazy population if tbody is empty
                const tbody = acc.querySelector('.kind-table-body');
                if (tbody && tbody.children.length === 0 && kind) {
                    App.renderDsTable();
                }
            } else {
                acc.classList.remove('open');
                if (kind) State.ds.collapsedKinds.add(kind);
            }
        });
    },
    toggleKindSelectAll: (kind: string, checked: boolean): void => {
        const entitiesOfKind = State.ds.filtered.filter(r => (r.kind || 'Unknown') === kind);
        entitiesOfKind.forEach(r => {
            if (checked) State.ds.selected.add(r.keyStr);
            else State.ds.selected.delete(r.keyStr);
        });
        App.renderDsTable();
        (Utils.$('btn-ds-copy') as HTMLButtonElement).disabled = State.ds.selected.size === 0;
    },
    renderDsTable: (): void => {
        const container = Utils.$('ds-accordions-container');
        if (!container) return;
        container.innerHTML = '';

        if (State.ds.filtered.length === 0) {
            container.innerHTML = `
                <div class="card p-8 text-center" style="color:var(--muted)">
                    <i class="fa-solid fa-filter text-2xl mb-2 block"></i>
                    No entities found matching the current filter.
                </div>
            `;
            const pagination = Utils.$('ds-pagination');
            if (pagination) pagination.innerHTML = '';
            return;
        }

        // Group filtered entities by Kind
        const kindGroups = new Map<string, typeof State.ds.filtered>();
        State.ds.filtered.forEach(r => {
            const k = r.kind || 'Unknown';
            if (!kindGroups.has(k)) kindGroups.set(k, []);
            kindGroups.get(k)!.push(r);
        });

        kindGroups.forEach((items, kind) => {
            const isCollapsed = State.ds.collapsedKinds.has(kind);
            const total = items.length;
            const identical = items.filter(x => x.status === 'identical').length;
            const different = items.filter(x => x.status === 'different').length;
            const missing = items.filter(x => x.status === 'missing').length;
            const mapped = items.filter(x => x.status === 'mapped').length;

            const kindSelectedCount = items.filter(x => State.ds.selected.has(x.keyStr)).length;
            const allKindSelected = total > 0 && kindSelectedCount === total;

            const card = document.createElement('div');
            card.className = `kind-accordion kind-accordion-card ${isCollapsed ? '' : 'open'}`;
            card.setAttribute('data-kind', kind);

            card.innerHTML = `
                <div class="kind-accordion-header">
                    <div class="kind-accordion-title">
                        <div class="chk chk-kind-all ${allKindSelected ? 'on' : ''}" title="Select all ${Utils.escapeHtml(kind)}"></div>
                        <i class="fa-solid fa-folder-tree text-cyan-400"></i>
                        <span>KIND: <span class="text-cyan-300 mono">${Utils.escapeHtml(kind)}</span></span>
                        <span class="badge" style="background:var(--accent-dim);color:var(--accent);font-size:11px">${total}</span>
                    </div>
                    <div class="flex items-center gap-3">
                        <div class="flex items-center gap-2 text-xs mono">
                            ${identical > 0 ? `<span style="color:var(--ok)">${identical} Identical</span>` : ''}
                            ${different > 0 ? `<span style="color:var(--warn)">${different} Diff</span>` : ''}
                            ${missing > 0 ? `<span style="color:var(--danger)">${missing} Missing</span>` : ''}
                            ${mapped > 0 ? `<span style="color:#10b981">${mapped} Mapped</span>` : ''}
                        </div>
                        <i class="fa-solid fa-chevron-down kind-accordion-chevron"></i>
                    </div>
                </div>
                <div class="kind-accordion-content">
                    <table class="w-full text-xs mono" style="border-collapse:collapse">
                        <thead>
                            <tr style="background:var(--bg2);border-bottom:1px solid var(--brd)">
                                <th class="text-left px-4 py-2.5 w-10"></th>
                                <th class="text-left px-4 py-2.5" style="color:var(--muted)">Key</th>
                                <th class="text-left px-4 py-2.5 w-32" style="color:var(--muted)">Status</th>
                                <th class="text-left px-4 py-2.5 w-64" style="color:var(--muted)">Diff Summary</th>
                            </tr>
                        </thead>
                        <tbody class="kind-table-body"></tbody>
                    </table>
                </div>
            `;

            // Populate rows lazily: only render rows if accordion is open!
            const tbody = card.querySelector('.kind-table-body') as HTMLElement;
            const populateRows = () => {
                if (tbody.children.length > 0) return; // already rendered
                items.forEach(r => {
                    const stCfg = {
                        different: { l: 'DIFFERENT', c: 'var(--warn)', b: 'var(--warn-dim)' },
                        missing: { l: 'MISSING IN TGT', c: 'var(--danger)', b: 'var(--danger-dim)' },
                        identical: { l: 'IDENTICAL', c: 'var(--ok)', b: 'var(--ok-dim)' },
                        mapped: { l: 'PROJECT MAPPED', c: '#10b981', b: 'rgba(16,185,129,0.15)' }
                    }[r.status];

                    const sel = State.ds.selected.has(r.keyStr);
                    const tr = document.createElement('tr');
                    tr.style.borderBottom = '1px solid var(--brd)';
                    tr.innerHTML = `
                        <td class="px-4 py-3"><div class="chk chk-row ${sel ? 'on' : ''}" data-key="${Utils.escapeHtml(r.keyStr)}"></div></td>
                        <td class="px-4 py-3 cursor-pointer" style="color:var(--fg)">${Utils.escapeHtml(r.keyStr)} <i class="fa-solid fa-chevron-down" style="font-size:9px;color:var(--muted);margin-left:4px"></i></td>
                        <td class="px-4 py-3"><span class="badge font-semibold" style="background:${stCfg.b};color:${stCfg.c}">${stCfg.l}</span></td>
                        <td class="px-4 py-3" style="color:var(--muted)">${Utils.escapeHtml(r.diffSum)}</td>
                    `;

                    const chk = tr.querySelector('.chk') as HTMLElement;
                    chk.onclick = () => App.toggleDsSelect(r.keyStr, chk);

                    const keyTd = tr.querySelectorAll('td')[1] as HTMLElement;
                    keyTd.onclick = () => App.toggleDsRowExpand(tr, r.keyStr);

                    tbody.appendChild(tr);
                });
            };

            if (!isCollapsed) {
                populateRows();
            }

            // Accordion toggle click
            const header = card.querySelector('.kind-accordion-header') as HTMLElement;
            header.onclick = (e) => {
                const target = e.target as HTMLElement;
                if (target.closest('.chk-kind-all')) return; // let checkbox click handle selection
                const open = card.classList.toggle('open');
                if (open) {
                    State.ds.collapsedKinds.delete(kind);
                    populateRows();
                } else {
                    State.ds.collapsedKinds.add(kind);
                }
            };

            // Select all inside kind
            const chkKindAll = card.querySelector('.chk-kind-all') as HTMLElement;
            chkKindAll.onclick = (e) => {
                e.stopPropagation();
                populateRows();
                App.toggleKindSelectAll(kind, !allKindSelected);
            };

            container.appendChild(card);
        });

        const pagination = Utils.$('ds-pagination');
        if (pagination) pagination.innerHTML = '';
        App.updateSelectAllDsState();
    },
    toggleDsSelect: (keyStr: string, el: HTMLElement): void => {
        if (State.ds.selected.has(keyStr)) State.ds.selected.delete(keyStr); else State.ds.selected.add(keyStr);
        el.classList.toggle('on');
        (Utils.$('btn-ds-copy') as HTMLButtonElement).disabled = State.ds.selected.size === 0;
        App.updateSelectAllDsState();
        App.renderDsTable(); // update per-kind Select All state
    },
    toggleAllDs: (): void => {
        const allSel = State.ds.selected.size === State.ds.filtered.length && State.ds.filtered.length > 0;
        if (allSel) State.ds.selected.clear(); else State.ds.filtered.forEach(r => State.ds.selected.add(r.keyStr));
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
            const isQuery = Diff.isQueryKey(key);
            const jsonEditableTypes = ['String', 'Array', 'Map', 'Entity', 'Key', 'GeoPoint'];
            const showJsonBtn = jsonEditableTypes.includes(type) && (isSrcJson || isTgtJson || type !== 'String');
            const showInspectBtn = !isBool;
            const inspectIcon = showJsonBtn ? 'fa-code' : isQuery ? 'fa-terminal' : 'fa-expand';
            const inspectTitle = showJsonBtn ? 'Edit JSON' : isQuery ? 'Inspect & Compare Query' : 'Expand & Compare';

            const sDisplayVal = sVal.includes('\n') ? sVal.split('\n')[0] + '...' : sVal;
            const tDisplayVal = tVal.includes('\n') ? tVal.split('\n')[0] + '...' : tVal;

            return `
                <tr class="prop-edit-row ${diffClass}" data-key="${Utils.escapeHtml(key)}" data-initial-type="${type}">
                    <td class="px-3 py-1.5 font-semibold text-xs text-left" style="color:var(--fg)">
                        <div class="flex items-center justify-between">
                            <span>${Utils.escapeHtml(key)}</span>
                            ${diffClass === 'diff-mapped' ? `<span class="badge" style="background:rgba(16,185,129,0.15); color:var(--ok); font-size:9px; padding:1px 5px;" title="Semantic match after Project ID substitution"><i class="fa-solid fa-circle-check mr-1"></i>Mapped</span>` : ''}
                        </div>
                    </td>
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
                                ${showInspectBtn ? `<button type="button" class="btn btn-s btn-json-edit-trigger" style="padding: 3px 6px; font-size: 10px;" title="${inspectTitle}"><i class="fa-solid ${inspectIcon}"></i></button>` : ''}
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
                                ${showInspectBtn ? `<button type="button" class="btn btn-s btn-json-edit-trigger" style="padding: 3px 6px; font-size: 10px;" title="${inspectTitle}"><i class="fa-solid ${inspectIcon}"></i></button>` : ''}
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
                if (Diff.isQueryKey(key) && Diff.isQuerySemanticallyEqual(sVal, tVal, State.ds.src, State.ds.tgt).type === 'project_mapped') {
                    diffClass = 'diff-mapped';
                } else {
                    diffClass = 'diff-mod';
                }
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
                const isQuery = Diff.isQueryKey(key);
                const jsonEditableTypes = ['String', 'Array', 'Map', 'Entity', 'Key', 'GeoPoint'];
                const showJsonBtn = jsonEditableTypes.includes(newType) && (isSrcJson || isTgtJson || newType !== 'String');
                const showInspectBtn = true;
                const inspectIcon = showJsonBtn ? 'fa-code' : isQuery ? 'fa-terminal' : 'fa-expand';
                const inspectTitle = showJsonBtn ? 'Edit JSON' : isQuery ? 'Inspect & Compare Query' : 'Expand & Compare';

                const sDisplayVal = oldSrcVal.includes('\n') ? oldSrcVal.split('\n')[0] + '...' : oldSrcVal;
                const tDisplayVal = oldTgtVal.includes('\n') ? oldTgtVal.split('\n')[0] + '...' : oldTgtVal;

                srcTd.innerHTML = `
                    <div class="flex gap-1.5 items-center w-full">
                        <input class="inp val-src" style="padding: 2px 6px; font-size: 11px; width: 100%;" value="${Utils.escapeHtml(sDisplayVal)}" placeholder="— (Empty)">
                        <textarea class="raw-val-src" style="display:none;">${Utils.escapeHtml(oldSrcVal)}</textarea>
                        ${showInspectBtn ? `<button type="button" class="btn btn-s btn-json-edit-trigger" style="padding: 3px 6px; font-size: 10px;" title="${inspectTitle}"><i class="fa-solid ${inspectIcon}"></i></button>` : ''}
                    </div>
                `;
                tgtTd.innerHTML = `
                    <div class="flex gap-1.5 items-center w-full">
                        <input class="inp val-tgt" style="padding: 2px 6px; font-size: 11px; width: 100%;" value="${Utils.escapeHtml(tDisplayVal)}" placeholder="— (Empty)">
                        <textarea class="raw-val-tgt" style="display:none;">${Utils.escapeHtml(oldTgtVal)}</textarea>
                        ${showInspectBtn ? `<button type="button" class="btn btn-s btn-json-edit-trigger" style="padding: 3px 6px; font-size: 10px;" title="${inspectTitle}"><i class="fa-solid ${inspectIcon}"></i></button>` : ''}
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

                row.querySelectorAll('.btn-json-edit-trigger').forEach(btn => {
                    (btn as HTMLElement).onclick = () => {
                        const srcInput = row.querySelector('.raw-val-src') || row.querySelector('.val-src');
                        const tgtInput = row.querySelector('.raw-val-tgt') || row.querySelector('.val-tgt');
                        App.openJsonEditorModal(row, key, srcInput as any, tgtInput as any, State.ds.src, State.ds.tgt);
                    };
                });
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
                    App.openJsonEditorModal(elRow, key, srcInput as any, tgtInput as any, State.ds.src, State.ds.tgt);
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

            const prevEntity = side === 'src' ? r.srcEntity : r.tgtEntity;
            const dispInfo = extractEntityDisplayName(prevEntity) || extractEntityDisplayName({ properties: props });
            const badgeWrap = fragment.querySelector('.entity-ref-badge-wrap');
            if (badgeWrap && dispInfo) {
                badgeWrap.innerHTML = `
                    <div class="flex items-center gap-2 p-2 rounded bg-zinc-900/80 border border-zinc-800">
                        <span class="text-[11px] text-zinc-400 font-semibold uppercase tracking-wider">Entity Name:</span>
                        <span class="badge px-2 py-0.5 rounded text-xs font-semibold bg-cyan-950 text-cyan-300 border border-cyan-800 flex items-center gap-1">
                            <span class="text-zinc-400 font-mono text-[10px]">${Utils.escapeHtml(dispInfo.fieldName)}:</span>
                            <span class="text-white font-medium">"${Utils.escapeHtml(dispInfo.value)}"</span>
                        </span>
                    </div>
                `;
            }

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
                        dbId,
                        referenceName: dispInfo ? dispInfo.value : undefined,
                        referenceField: dispInfo ? dispInfo.fieldName : undefined
                    };
                    const refSuffix = dispInfo ? ` [${dispInfo.fieldName}: "${dispInfo.value}"]` : '';
                    editAuditLogId = await AuditLog.addLog(
                        'DATASTORE_EDIT',
                        '—',
                        pid,
                        `Started inline edit for entity ${keyStr}${refSuffix}.`,
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

        const selectedEntitiesList = fragment.querySelector('.modal-ds-selected-entities');
        if (selectedEntitiesList) {
            selectedEntitiesList.replaceChildren();
            const keys = [...State.ds.selected];
            const resultByKey = new Map(State.ds.results.map(r => [r.keyStr, r]));

            keys.forEach(keyStr => {
                const res = resultByKey.get(keyStr);
                const entity = res?.srcEntity || res?.tgtEntity;
                const dispInfo = extractEntityDisplayName(entity);

                const item = document.createElement('div');
                item.className = 'flex items-center justify-between text-xs py-1.5 px-2.5 rounded bg-zinc-900/70 border border-zinc-800/80';
                item.innerHTML = `
                    <div class="flex items-center gap-2">
                        ${res?.kind ? `<span class="badge" style="background:var(--accent-dim);color:var(--accent);border:1px solid rgba(0,212,255,0.3);font-size:10px">${Utils.escapeHtml(res.kind)}</span>` : ''}
                        <span class="mono text-zinc-300 font-medium">${Utils.escapeHtml(keyStr)}</span>
                    </div>
                    ${dispInfo ? `
                        <span class="badge px-2 py-0.5 rounded text-[11px] font-semibold bg-cyan-950 text-cyan-300 border border-cyan-800/80 flex items-center gap-1">
                            <span class="text-zinc-400 font-mono text-[10px]">${Utils.escapeHtml(dispInfo.fieldName)}:</span>
                            <span class="text-white font-medium">"${Utils.escapeHtml(dispInfo.value)}"</span>
                        </span>
                    ` : `
                        <span class="text-[10px] text-zinc-500 font-mono italic">No reference name</span>
                    `}
                `;
                selectedEntitiesList.appendChild(item);
            });
        }

        UI.openModal(fragment);

        const chkReplace = Utils.$('modal-root')!.querySelector('.chk-apply-replace') as HTMLElement;
        const replaceInputsWrap = Utils.$('modal-root')!.querySelector('.replace-inputs-wrap') as HTMLElement;
        const modalRulesList = Utils.$('modal-root')!.querySelector('.modal-ds-rules-list') as HTMLElement | null;

        if (modalRulesList) {
            UI.renderDsRules(modalRulesList, true);
        }

        const modalAddRuleBtn = Utils.$('modal-root')!.querySelector('.btn-modal-add-rule') as HTMLButtonElement | null;
        if (modalAddRuleBtn) {
            modalAddRuleBtn.onclick = () => {
                if (!State.ds.modRules) State.ds.modRules = [];
                State.ds.modRules.push({
                    id: 'rule-' + Date.now(),
                    field: '*',
                    target: '',
                    replacement: ''
                });
                if (modalRulesList) UI.renderDsRules(modalRulesList, true);
                UI.renderDsRules('ds-rules-container', false);
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
        const activeRules = (State.ds.modRules || []).filter(r => r && r.target);
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
        const CHUNK_SIZE = 50;
        const chunks: string[][] = [];
        for (let i = 0; i < keysToCopy.length; i += CHUNK_SIZE) {
            chunks.push(keysToCopy.slice(i, i + CHUNK_SIZE));
        }
        const totalBatches = chunks.length;

        await mapConcurrent(chunks, 3, async (chunkStrs, batchIdx) => {
            if (State.cancelDs || controller.signal.aborted) return;
            const batchNum = batchIdx + 1;
            let batchFailureCount = chunkStrs.length;

            Utils.$('load-msg')!.textContent = `Copying entities (${ok} of ${keysToCopy.length} copied across parallel streams)...`;

            let batchAuditLogId: string | null = null;
            try {
                const targetKeyByString = new Map<string, any>();
                const rawKeys: any[] = [];

                for (const keyStr of chunkStrs) {
                    const result = resultByKey.get(keyStr);
                    if (!result) throw new Error(`Selected entity ${keyStr} is no longer in current analysis.`);
                    const keyCopy = cloneDatastoreValue(result.rawKey);
                    const tgtDbClean = (State.ds.tgtDb === '(default)' || !State.ds.tgtDb) ? '' : State.ds.tgtDb;
                    const tgtPartitionId: any = { projectId: State.ds.tgt };
                    if (tgtDbClean) tgtPartitionId.databaseId = tgtDbClean;
                    keyCopy.partitionId = tgtPartitionId;
                    targetKeyByString.set(keyStr, keyCopy);

                    if (result.rawKey) {
                        rawKeys.push(cloneDatastoreValue(result.rawKey));
                    }
                }

                const targetKeys = [...targetKeyByString.values()];
                if (targetKeys.length === 0 || rawKeys.length === 0) return;

                const [targetBackup, srcRes] = await Promise.all([
                    Api.lookupEntities(State.ds.tgt, targetKeys, State.ds.tgtDb, controller.signal),
                    Api.lookupEntities(State.ds.src, rawKeys, State.ds.srcDb, controller.signal)
                ]);

                const foundMap = new Map<string, any>(
                    (targetBackup.found || []).map((entry: any) => [App.formatKey(entry.entity.key), entry.entity])
                );

                const chunkBackupData: any[] = [];
                chunkStrs.forEach(keyStr => {
                    const existingTarget = foundMap.get(keyStr);
                    if (existingTarget?.properties) {
                        Diff.minifyJsonProperties(existingTarget.properties);
                    }
                    chunkBackupData.push({
                        keyStr,
                        action: existingTarget ? 'upsert' : 'delete',
                        prevEntity: existingTarget
                            ? cloneDatastoreValue(existingTarget)
                            : { key: cloneDatastoreValue(targetKeyByString.get(keyStr)) }
                    });
                });

                const entityDisplayNames: Record<string, { fieldName: string; value: string }> = {};
                const batchKindsSet = new Set<string>();
                (srcRes.found || []).forEach((entry: any) => {
                    const k = App.formatKey(entry.entity?.key);
                    const disp = extractEntityDisplayName(entry.entity);
                    if (disp && k) entityDisplayNames[k] = disp;
                    const entityKind = entry.entity?.key?.path?.[entry.entity.key.path.length - 1]?.kind;
                    if (entityKind) batchKindsSet.add(entityKind);
                });

                // Fallback to resultByKey kinds if not found in srcRes
                if (batchKindsSet.size === 0) {
                    chunkStrs.forEach(kStr => {
                        const r = resultByKey.get(kStr);
                        if (r?.kind) batchKindsSet.add(r.kind);
                    });
                }

                const batchKinds = [...batchKindsSet];
                const batchKindLabel = batchKinds.length > 0 ? batchKinds.join(', ') : (State.ds.kind || 'Unknown');

                const refNamesList = Object.values(entityDisplayNames).slice(0, 3).map(d => `${d.fieldName}: "${d.value}"`);
                const refSummary = refNamesList.length > 0
                    ? ` [Ref: ${refNamesList.join(', ')}${Object.keys(entityDisplayNames).length > 3 ? '...' : ''}]`
                    : '';

                const entitySummary = chunkBackupData.map(item => {
                    const keyStr = item.keyStr || '';
                    let kind = batchKindLabel;
                    let id = keyStr;

                    if (keyStr.includes(' | ')) {
                        const segs = keyStr.split(' | ');
                        const lastSeg = segs[segs.length - 1];
                        const colonIdx = lastSeg.indexOf(':');
                        if (colonIdx !== -1) {
                            kind = lastSeg.slice(0, colonIdx);
                            id = lastSeg.slice(colonIdx + 1);
                        }
                    } else if (keyStr.includes(':')) {
                        const colonIdx = keyStr.indexOf(':');
                        kind = keyStr.slice(0, colonIdx);
                        id = keyStr.slice(colonIdx + 1);
                    } else if (keyStr.includes('/')) {
                        const slashIdx = keyStr.indexOf('/');
                        kind = keyStr.slice(0, slashIdx);
                        id = keyStr.slice(slashIdx + 1);
                    }

                    const rawDisp = entityDisplayNames[keyStr];
                    const name = rawDisp ? (typeof rawDisp === 'object' ? rawDisp.value : rawDisp) : id;
                    const isNewEntity = item.action === 'delete' || item.action === 'CREATE' || item.action === 'CREATED';
                    const action = isNewEntity ? 'CREATED' : 'UPDATED';
                    return { kind, id, key: keyStr, name, action };
                });

                const rulesSummary = activeRules.map(r => ({
                    property: r.field || '*',
                    target: r.target,
                    replacement: r.replacement
                }));

                let backupState: any = {
                    type: "DATASTORE_COPY",
                    kind: batchKindLabel,
                    kinds: batchKinds,
                    srcDb: State.ds.srcDb,
                    tgtDb: State.ds.tgtDb,
                    batch: `${batchNum}/${totalBatches}`,
                    backupData: chunkBackupData,
                    entityDisplayNames,
                    entitySummary,
                    rulesSummary
                };

                // Native Gzip compression for maximum 1-click revert fidelity
                try {
                    const compressedB64 = await compressJsonToBase64(backupState);
                    const compressedState = {
                        type: "DATASTORE_COPY",
                        compressed: true,
                        data: compressedB64,
                        kind: batchKindLabel,
                        kinds: batchKinds,
                        srcDb: State.ds.srcDb,
                        tgtDb: State.ds.tgtDb,
                        batch: `${batchNum}/${totalBatches}`,
                        count: chunkStrs.length,
                        entityDisplayNames,
                        entitySummary,
                        rulesSummary
                    };
                    if (AuditLog.canPersistPrevState(compressedState)) {
                        backupState = compressedState;
                    }
                } catch (compErr) {
                    console.warn('Gzip compression fallback:', compErr);
                }

                batchAuditLogId = await AuditLog.addLog(
                    'DATASTORE_COPY',
                    State.ds.src,
                    State.ds.tgt,
                    `Started copying batch ${batchNum}/${totalBatches} (${chunkStrs.length} entities of kind ${batchKindLabel})${refSummary}.`,
                    'IN_PROGRESS',
                    backupState,
                    true
                );

                if (!batchAuditLogId) {
                    throw new Error('The centralized audit backup could not be persisted. No entities were changed.');
                }

                const mutations: any[] = [];
                for (const e of srcRes.found || []) {
                    let entity = cloneDatastoreValue(e.entity);
                    const targetKey = cloneDatastoreValue(targetKeyByString.get(App.formatKey(e.entity.key)));
                    entity.key = targetKey;

                    if (applyMod) {
                        if (activeRules.length > 0) {
                            replaceDatastoreRules(entity, activeRules);
                            replacementCount++;
                        } else if (modTarget) {
                            replaceDatastoreField(entity, modField, modTarget, modReplace);
                            replacementCount++;
                        }
                    }

                    if (entity.properties) {
                        Diff.minifyJsonProperties(entity.properties);
                    }

                    // Pre-flight type fidelity verification
                    if (e.entity.properties && entity.properties) {
                        for (const property of Object.keys(e.entity.properties)) {
                            const sourceType = getDatastoreEditorType(e.entity.properties[property]);
                            const copiedType = getDatastoreEditorType(entity.properties[property]);
                            if (sourceType !== copiedType) {
                                throw new Error(`Type fidelity check failed for ${App.formatKey(e.entity.key)}.${property}`);
                            }
                        }
                    }

                    mutations.push({ upsert: entity });
                }

                if (mutations.length > 0) {
                    await Api.commitDatastore(State.ds.tgt, mutations, State.ds.tgtDb, controller.signal);
                    ok += mutations.length;
                    Utils.$('load-msg')!.textContent = `Copying entities (${ok} of ${keysToCopy.length} completed across parallel streams)...`;
                }

                if (batchAuditLogId) {
                    const entityNamesList = entitySummary.slice(0, 20).map(e => `${e.kind}:${e.id} (${e.name}) [${e.action}]`);
                    const overflowNote = entitySummary.length > 20 ? `\n... and ${entitySummary.length - 20} more entities` : '';
                    const itemizedSummaryText = `\nItemized Records (${entitySummary.length}):\n• ` + entityNamesList.join('\n• ') + overflowNote;

                    let batchDetails = `Datastore batch ${batchNum}/${totalBatches} copied ${mutations.length} entities across kinds: ${batchKindLabel}.\n` +
                        `Source: ${State.ds.src} (database: ${State.ds.srcDb || '(default)'})\n` +
                        `Target: ${State.ds.tgt} (database: ${State.ds.tgtDb || '(default)'})\n` +
                        `Status: ${mutations.length} entities written successfully (0 failed).\n`;

                    if (applyMod) {
                        if (activeRules.length > 0) {
                            const rulesSummary = activeRules.map((r, i) => `\n  - Rule ${i + 1} [field '${r.field || '*'}']: "${r.target}" -> "${r.replacement}"`).join('');
                            batchDetails += `Find & Replace: Applied ${activeRules.length} rule(s):${rulesSummary}\n`;
                        } else if (modTarget) {
                            const fieldText = (modField && modField.trim() !== "") ? `field '${modField}'` : "all fields";
                            batchDetails += `Find & Replace: Applied on ${fieldText}: "${modTarget}" -> "${modReplace}"\n`;
                        }
                    }
                    batchDetails += itemizedSummaryText;

                    await AuditLog.updateLog(
                        batchAuditLogId,
                        'SUCCESS',
                        batchDetails,
                        undefined,
                        true
                    );
                }
            } catch (e: any) {
                if (isCancellationError(e)) return;
                fail += batchFailureCount;
                Utils.toast(`Batch ${batchNum} failed: ${e.message}`, "err");
                if (batchAuditLogId) {
                    await AuditLog.updateLog(
                        batchAuditLogId,
                        'FAILED',
                        `Batch ${batchNum}/${totalBatches} failed: ${e.message}`,
                        undefined,
                        true
                    );
                }
            }
        });

        const cancelled = State.cancelDs || controller.signal.aborted;

        if (!cancelled && ok > 0) {
            Utils.$('load-title')!.textContent = "🚀 Copy Complete!";
            Utils.$('load-msg')!.textContent = `Successfully copied ${ok} entities! Finalizing and refreshing...`;
            // Ensure minimum visual feedback so user sees the successful rocket launch completion
            await new Promise(r => setTimeout(r, 1400));
        }

        Utils.hide('sec-loading');
        Utils.hide('btn-cancel-ds');
        Utils.toast(
            `${cancelled ? 'Copy cancelled' : 'Copy complete'}. Success: ${ok}, Failed: ${fail}`,
            cancelled ? 'info' : (ok > 0 ? 'ok' : 'err')
        );

        if (dsAbortController === controller) dsAbortController = null;
        await AuditLog.renderLogs();

        // If operation was cancelled or had 0 successful entities copied, navigate back without modal
        if (cancelled || ok === 0) {
            Utils.hide('sec-results');
            Utils.show('sec-forms');
            return;
        }

        // Show comprehensive Copy Completion Popup
        const uniqueKinds = [...new Set(keysToCopy.map(k => resultByKey.get(k)?.kind).filter(Boolean))];
        const kindsHtml = uniqueKinds.length > 0
            ? uniqueKinds.map(k => `<span class="badge" style="background:var(--accent-dim); color:var(--accent); font-size:11px; padding:2px 8px; border:1px solid var(--accent); margin-right:4px;"><i class="fa-solid fa-folder-tree mr-1"></i>${Utils.escapeHtml(k!)}</span>`).join('')
            : `<span class="badge" style="background:var(--brd2); color:var(--fg); font-size:11px;">${Utils.escapeHtml(State.ds.kind || 'Datastore')}</span>`;

        let replacedRulesHtml = '';
        if (applyMod) {
            if (activeRules.length > 0) {
                const rulesItems = activeRules.map((r, idx) => `
                    <div style="background:var(--bg); border:1px solid var(--brd); border-radius:6px; padding:8px 12px; margin-bottom:6px; font-size:12px;">
                        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
                            <span style="font-weight:600; color:var(--muted); font-size:10px; text-transform:uppercase;">Rule #${idx + 1} (Field: <code class="mono text-cyan-400">${Utils.escapeHtml(r.field || '* (all fields)')}</code>)</span>
                        </div>
                        <div style="font-family:var(--font-mono); font-size:11px; display:flex; align-items:center; gap:8px;">
                            <span style="color:var(--danger); text-decoration:line-through;">"${Utils.escapeHtml(r.target)}"</span>
                            <i class="fa-solid fa-arrow-right text-xs" style="color:var(--muted)"></i>
                            <span style="color:var(--ok); font-weight:600;">"${Utils.escapeHtml(r.replacement)}"</span>
                        </div>
                    </div>
                `).join('');
                replacedRulesHtml = `
                    <div style="margin-top:14px;">
                        <div style="font-weight:700; font-size:11px; color:var(--muted); text-transform:uppercase; margin-bottom:6px; display:flex; align-items:center; justify-content:space-between;">
                            <span>Find &amp; Replace Modifications</span>
                            <span class="badge" style="background:rgba(0,212,255,0.15); color:var(--accent2); font-size:10px;">${replacementCount} field substitutions</span>
                        </div>
                        <div>${rulesItems}</div>
                    </div>
                `;
            } else if (modTarget) {
                const fieldLabel = (modField && modField.trim() !== "") ? `field '${modField}'` : "all fields (*)";
                replacedRulesHtml = `
                    <div style="margin-top:14px;">
                        <div style="font-weight:700; font-size:11px; color:var(--muted); text-transform:uppercase; margin-bottom:6px;">Find &amp; Replace Modifications</div>
                        <div style="background:var(--bg); border:1px solid var(--brd); border-radius:6px; padding:8px 12px; font-size:12px;">
                            <div style="color:var(--muted); font-size:10px; margin-bottom:4px; text-transform:uppercase;">Scope: <code class="mono text-cyan-400">${Utils.escapeHtml(fieldLabel)}</code></div>
                            <div style="font-family:var(--font-mono); font-size:11px; display:flex; align-items:center; gap:8px;">
                                <span style="color:var(--danger); text-decoration:line-through;">"${Utils.escapeHtml(modTarget)}"</span>
                                <i class="fa-solid fa-arrow-right text-xs" style="color:var(--muted)"></i>
                                <span style="color:var(--ok); font-weight:600;">"${Utils.escapeHtml(modReplace)}"</span>
                            </div>
                        </div>
                    </div>
                `;
            }
        } else {
            replacedRulesHtml = `
                <div style="margin-top:14px; background:var(--bg); border:1px dashed var(--brd); border-radius:6px; padding:8px 12px; font-size:11px; color:var(--muted);">
                    <i class="fa-solid fa-circle-check mr-1.5" style="color:var(--ok)"></i>No Find &amp; Replace rules applied — entities copied exactly as-is.
                </div>
            `;
        }

        const modalHtml = `
            <div class="p-6 text-left" style="max-width:540px; margin:0 auto; background:#0c101d; border-radius:16px;">
                <div class="flex items-center gap-3 mb-4">
                    <div class="w-10 h-10 rounded-full flex items-center justify-center" style="background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.3); color:var(--ok); font-size:18px;">
                        <i class="fa-solid fa-circle-check"></i>
                    </div>
                    <div>
                        <h3 class="font-bold text-base text-fg leading-tight">Copying Completed Successfully!</h3>
                        <p class="text-xs text-muted">All selected Datastore mutations were committed to the destination project.</p>
                    </div>
                </div>

                <div class="p-3.5 rounded-lg mb-3" style="background:var(--bg2); border:1px solid var(--brd2);">
                    <div class="grid grid-cols-2 gap-2 text-xs mb-3">
                        <div>
                            <span class="text-[10px] uppercase font-bold text-muted block mb-1">Source Project</span>
                            <code class="mono text-cyan-400 text-xs">${Utils.escapeHtml(State.ds.src)}</code>
                            <div class="text-[10px] text-muted mt-0.5">DB: ${Utils.escapeHtml(State.ds.srcDb || '(default)')}</div>
                        </div>
                        <div>
                            <span class="text-[10px] uppercase font-bold text-muted block mb-1">Target Project</span>
                            <code class="mono text-emerald-400 text-xs">${Utils.escapeHtml(State.ds.tgt)}</code>
                            <div class="text-[10px] text-muted mt-0.5">DB: ${Utils.escapeHtml(State.ds.tgtDb || '(default)')}</div>
                        </div>
                    </div>

                    <div class="border-t border-white/5 pt-2.5 flex items-center justify-between text-xs">
                        <span class="text-muted">Total Entities Copied:</span>
                        <span class="font-bold mono text-emerald-400 text-sm">${ok} / ${keysToCopy.length}${fail > 0 ? ` <span class="text-rose-400 text-xs font-normal">(${fail} failed)</span>` : ''}</span>
                    </div>

                    <div class="border-t border-white/5 pt-2.5 mt-2">
                        <span class="text-[10px] uppercase font-bold text-muted block mb-1.5">Kinds Copied</span>
                        <div class="flex flex-wrap gap-1">${kindsHtml}</div>
                    </div>
                </div>

                ${replacedRulesHtml}

                <div class="mt-6 flex items-center justify-end gap-2.5">
                    <button class="btn btn-s text-xs" id="btn-copy-done-reanalyze">
                        <i class="fa-solid fa-magnifying-glass-chart mr-1"></i> Re-Analyze Now
                    </button>
                    <button class="btn btn-p text-xs" id="btn-copy-done-main-menu">
                        <i class="fa-solid fa-house mr-1"></i> Return to Datastore Main Menu
                    </button>
                </div>
            </div>
        `;

        UI.openModal(modalHtml);

        const returnBtn = Utils.$('btn-copy-done-main-menu');
        if (returnBtn) {
            returnBtn.onclick = () => {
                UI.closeModal();
                Utils.hide('sec-loading');
                Utils.hide('sec-results');
                Utils.show('sec-forms');
                // Scroll smoothly to Datastore form
                Utils.$('form-ds')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            };
        }

        const reanalyzeBtn = Utils.$('btn-copy-done-reanalyze');
        if (reanalyzeBtn) {
            reanalyzeBtn.onclick = async () => {
                UI.closeModal();
                await App.runDsAnalyze();
            };
        }
    },

    openJsonEditorModal: (
        row: HTMLElement,
        propKey: string,
        srcInput: HTMLInputElement | HTMLTextAreaElement | null,
        tgtInput: HTMLInputElement | HTMLTextAreaElement | null,
        srcProject?: string | null,
        tgtProject?: string | null
    ): void => {
        Diff.openJsonEditorModal(row, propKey, srcInput, tgtInput, srcProject || State.ds.src, tgtProject || State.ds.tgt);
    }
};

const bootstrap = () => {
    (window as any).State = State;
    (window as any).App = App;
    (window as any).AssistUI = AssistUI;
    (window as any).AssistManager = AssistManager;
    (window as any).D0198EasterEgg = D0198EasterEgg;
    D0198EasterEgg.init();
    App.init();
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap();
}
