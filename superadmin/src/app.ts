import { State, QuestionEntity } from './state';
import { Api } from './api';
import { Utils } from './utils';
import { classifyBigQuerySql, extractVariables, resolveSqlVariables, formatBigQuerySql, formatEmailToDisplayName } from './sql-formatter';

let activeAbortController: AbortController | null = null;

export const App = {
    init: () => {
        // Theme initialization
        const savedTheme = localStorage.getItem('theme') || 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);
        App.updateThemeIcon(savedTheme);

        // Bind events
        Utils.$('btn-verify')?.addEventListener('click', App.handleVerifyToken);
        Utils.$('inp-token')?.addEventListener('input', () => {
            const val = (Utils.$('inp-token') as HTMLInputElement)?.value.trim();
            const btn = Utils.$('btn-verify') as HTMLButtonElement;
            if (btn) btn.disabled = !val;
        });

        Utils.$('btn-toggle-token')?.addEventListener('click', () => {
            const inp = Utils.$('inp-token') as HTMLInputElement;
            if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
        });

        // Project selector events
        Utils.$('sel-project-id')?.addEventListener('change', (e: Event) => {
            const val = (e.target as HTMLSelectElement).value;
            const inp = Utils.$('inp-project-id') as HTMLInputElement;
            if (inp && val) inp.value = val;
        });
        Utils.$('inp-project-id')?.addEventListener('input', (e: Event) => {
            const val = (e.target as HTMLInputElement).value.trim();
            const sel = Utils.$('sel-project-id') as HTMLSelectElement;
            if (sel) sel.value = val;
        });
        Utils.$('btn-refresh-projects')?.addEventListener('click', () => {
            void App.loadAccessibleProjects();
        });

        Utils.$('btn-fetch-questions')?.addEventListener('click', App.handleFetchQuestions);
        Utils.$('inp-search-questions')?.addEventListener('input', App.handleSearchQuestions);
        Utils.$('btn-format-sql')?.addEventListener('click', App.handleFormatSql);
        Utils.$('btn-run-query')?.addEventListener('click', App.handleRunQuery);
        Utils.$('btn-cancel-query')?.addEventListener('click', App.handleCancelQuery);
        Utils.$('btn-save-datastore')?.addEventListener('click', App.handleSaveToDatastore);
        Utils.$('btn-edit-properties')?.addEventListener('click', App.handleOpenPropertiesModal);

        // Audit Logs Modal
        Utils.$('btn-view-audit-logs')?.addEventListener('click', App.handleOpenAuditLogs);
        Utils.$('btn-close-audit-modal')?.addEventListener('click', () => Utils.hide('modal-audit-logs'));
        Utils.$('btn-refresh-audit-logs')?.addEventListener('click', App.handleOpenAuditLogs);
        Utils.$('inp-search-audit-logs')?.addEventListener('input', (e: Event) => {
            App.auditLogsFilter = (e.target as HTMLInputElement).value || '';
            App.renderAuditLogsList();
        });

        // Results grid controls
        Utils.$('inp-filter-results')?.addEventListener('input', App.handleFilterResults);
        Utils.$('btn-export-csv')?.addEventListener('click', App.handleExportCsv);
        Utils.$('btn-export-json')?.addEventListener('click', App.handleExportJson);
        Utils.$('sel-rows-per-page')?.addEventListener('change', (e: Event) => {
            State.rowsPerPage = Number((e.target as HTMLSelectElement).value) || 50;
            State.currentPage = 1;
            App.renderResultsTable();
        });
        Utils.$('btn-prev-page')?.addEventListener('click', () => {
            if (State.currentPage > 1) {
                State.currentPage--;
                App.renderResultsTable();
            }
        });
        Utils.$('btn-next-page')?.addEventListener('click', () => {
            const filteredRows = App.getFilteredRows();
            const totalPages = Math.ceil(filteredRows.length / State.rowsPerPage) || 1;
            if (State.currentPage < totalPages) {
                State.currentPage++;
                App.renderResultsTable();
            }
        });

        // Copy command button
        document.querySelector('.btn-copy-token-cmd')?.addEventListener('click', () => {
            void Utils.copyToClipboard('gcloud auth print-access-token');
            Utils.toast('Command copied to clipboard!', 'ok');
        });

        // Theme toggle
        Utils.$('themeToggle')?.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme') || 'dark';
            const next = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('theme', next);
            App.updateThemeIcon(next);
        });

        // Mute toggle
        App.updateMuteIcon();
        Utils.$('btn-mute-toggle')?.addEventListener('click', () => {
            App.toggleMute();
        });

        window.addEventListener('storage', (e: StorageEvent) => {
            if (e.key === 'audio_muted') {
                App.updateMuteIcon();
            }
        });

        window.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'm' || e.key === 'M') {
                if (e.ctrlKey || e.metaKey || e.altKey) return;
                const active = document.activeElement as HTMLElement | null;
                if (active) {
                    const tag = active.tagName.toLowerCase();
                    if (tag === 'input' || tag === 'textarea' || tag === 'select' || active.isContentEditable) {
                        return;
                    }
                }
                e.preventDefault();
                App.toggleMute();
            }
        });
    },

    isAudioMuted: (): boolean => {
        try {
            return localStorage.getItem('audio_muted') === 'true';
        } catch {
            return false;
        }
    },

    toggleMute: () => {
        const next = !App.isAudioMuted();
        try {
            localStorage.setItem('audio_muted', next ? 'true' : 'false');
        } catch {}
        App.updateMuteIcon();
        Utils.toast(next ? 'Audio muted' : 'Audio unmuted', 'info');
    },

    updateMuteIcon: () => {
        const btn = Utils.$('btn-mute-toggle');
        if (!btn) return;
        const muted = App.isAudioMuted();
        btn.title = muted ? 'Unmute Audio (Shortcut: M)' : 'Mute Audio (Shortcut: M)';
        btn.setAttribute('aria-label', btn.title);
        const icon = btn.querySelector('i');
        if (icon) {
            if (muted) {
                icon.className = 'fa-solid fa-volume-xmark text-red-400';
            } else {
                icon.className = 'fa-solid fa-volume-high text-slate-300';
            }
        }
    },

    updateThemeIcon: (theme: string) => {
        const icon = Utils.$('theme-icon');
        if (icon) icon.className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    },

    handleVerifyToken: async () => {
        const tokenInp = Utils.$('inp-token') as HTMLInputElement;
        const token = tokenInp?.value.trim();
        if (!token) return;

        const btn = Utils.$('btn-verify') as HTMLButtonElement;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Verifying...';

        try {
            const userInfo = await Api.verifyToken(token);
            State.token = token;
            State.userEmail = userInfo.email || 'user';
            State.userName = formatEmailToDisplayName(userInfo.email);

            // Update user badge in header
            const userBadge = Utils.$('header-user-badge');
            if (userBadge) {
                userBadge.innerHTML = `
                    <div class="user-pill">
                        <i class="fa-solid fa-circle-user text-amber-400"></i>
                        <span><strong>${Utils.escapeHtml(State.userName)}</strong> (${Utils.escapeHtml(State.userEmail)})</span>
                    </div>
                `;
            }

            Utils.hide('sec-auth');
            Utils.show('sec-workbench');
            Utils.toast(`Authenticated as ${State.userName}!`, 'ok');

            // Play GSAP welcome animation
            App.playWelcomeAnimation(State.userName, State.userEmail);

            // Set default project ID if available or focus project input
            const projInp = Utils.$('inp-project-id') as HTMLInputElement;
            if (projInp && !projInp.value) projInp.focus();

            // Load accessible projects dropdown automatically
            void App.loadAccessibleProjects();
        } catch (e: any) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-key mr-2"></i> Verify Token';
            Utils.toast(`Authentication failed: ${e.message}`, 'err');
        }
    },

    playWelcomeAnimation: (name: string, email: string) => {
        const overlay = Utils.$('welcome-splash-overlay');
        const card = Utils.$('welcome-splash-card');
        const nameEl = Utils.$('welcome-user-name');
        const emailEl = Utils.$('welcome-user-email');

        if (!overlay || !card) return;

        if (nameEl) nameEl.textContent = name;
        if (emailEl) emailEl.textContent = email;
        overlay.style.display = 'flex';

        // Trigger confetti celebration
        try {
            const confettiFn = (window as any).confetti;
            if (typeof confettiFn === 'function') {
                confettiFn({
                    particleCount: 80,
                    spread: 85,
                    origin: { y: 0.6 },
                    colors: ['#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#ffffff']
                });
            }
        } catch {}

        // GSAP timeline animation
        const gsap = (window as any).gsap;
        if (gsap) {
            const tl = gsap.timeline();
            tl.to(overlay, { opacity: 1, duration: 0.35, ease: 'power2.out' })
              .to(card, { opacity: 1, scale: 1, duration: 0.65, ease: 'back.out(1.8)' }, '-=0.2')
              .to(card, { scale: 1.05, opacity: 0, duration: 0.45, delay: 1.6, ease: 'power2.in' })
              .to(overlay, { opacity: 0, duration: 0.35, ease: 'power2.in' }, '-=0.2')
              .set(overlay, { display: 'none' });
        } else {
            overlay.style.opacity = '1';
            card.style.opacity = '1';
            card.style.transform = 'scale(1)';
            setTimeout(() => {
                overlay.style.opacity = '0';
                setTimeout(() => { overlay.style.display = 'none'; }, 300);
            }, 2000);
        }
    },

    loadAccessibleProjects: async () => {
        const badge = Utils.$('projects-status-badge');
        const sel = Utils.$('sel-project-id') as HTMLSelectElement;
        const inp = Utils.$('inp-project-id') as HTMLInputElement;
        const btnRefresh = Utils.$('btn-refresh-projects') as HTMLButtonElement;

        if (badge) badge.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Fetching projects...';
        if (btnRefresh) btnRefresh.disabled = true;

        try {
            const projects = await Api.fetchAccessibleProjects();
            State.accessibleProjects = projects;

            if (sel) {
                sel.innerHTML = '<option value="">-- Select from accessible projects --</option>' +
                    projects.map(p => `<option value="${Utils.escapeHtml(p.projectId)}">${Utils.escapeHtml(p.projectId)} (${Utils.escapeHtml(p.name)})</option>`).join('');

                if (inp?.value) {
                    sel.value = inp.value;
                } else if (projects.length > 0 && projects[0]) {
                    sel.value = projects[0].projectId;
                    if (inp) inp.value = projects[0].projectId;
                }
            }

            if (badge) badge.textContent = `${projects.length} projects found`;
        } catch (e: any) {
            if (badge) badge.textContent = 'Could not list projects';
        } finally {
            if (btnRefresh) btnRefresh.disabled = false;
        }
    },

    handleFetchQuestions: async () => {
        const sel = Utils.$('sel-project-id') as HTMLSelectElement;
        const projInp = Utils.$('inp-project-id') as HTMLInputElement;
        const dbInp = Utils.$('inp-database-id') as HTMLInputElement;
        const projectId = projInp?.value.trim() || sel?.value.trim();
        const databaseId = dbInp?.value.trim() || '(default)';

        if (!projectId) {
            Utils.toast('Please select or enter a valid GCP Project ID.', 'warn');
            projInp?.focus();
            return;
        }

        if (projInp) projInp.value = projectId;
        if (sel) sel.value = projectId;

        State.projectId = projectId;
        State.databaseId = databaseId;

        const btn = Utils.$('btn-fetch-questions') as HTMLButtonElement;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Loading Questions...';

        try {
            const questions = await Api.fetchQuestions(projectId, databaseId);
            State.questions = questions;
            State.filteredQuestions = questions;

            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-arrows-rotate mr-2"></i> Reload Questions';

            Utils.toast(`Fetched ${questions.length} Question entities successfully!`, 'ok');
            App.renderQuestionsList();
            void Api.recordAudit('FETCH_QUESTIONS', `Fetched ${questions.length} questions from kind 'Questions' in project ${projectId}.`)
                .catch(error => console.warn('Question-fetch audit logging failed:', error));
        } catch (e: any) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-bolt mr-2"></i> Load Questions';
            Utils.toast(`Failed to load Questions: ${e.message}`, 'err');
        }
    },

    handleSearchQuestions: (e: Event) => {
        const query = ((e.target as HTMLInputElement).value || '').toLowerCase().trim();
        State.searchQuery = query;

        if (!query) {
            State.filteredQuestions = State.questions;
        } else {
            State.filteredQuestions = State.questions.filter(q =>
                q.referenceName.toLowerCase().includes(query) ||
                q.keyStr.toLowerCase().includes(query) ||
                q.queryString.toLowerCase().includes(query)
            );
        }
        App.renderQuestionsList();
    },

    renderQuestionsList: () => {
        const listCont = Utils.$('questions-list-container');
        if (!listCont) return;

        const countBadge = Utils.$('questions-count-badge');
        if (countBadge) {
            countBadge.textContent = `${State.filteredQuestions.length} of ${State.questions.length}`;
        }

        if (State.filteredQuestions.length === 0) {
            listCont.innerHTML = `
                <div class="empty-state p-6 text-center text-xs" style="color:var(--muted)">
                    <i class="fa-solid fa-database mb-2" style="font-size:24px; opacity:0.5;"></i>
                    <p>No questions matched your search criteria.</p>
                </div>
            `;
            return;
        }

        listCont.innerHTML = State.filteredQuestions.map(q => {
            const isSelected = State.selectedQuestion?.keyStr === q.keyStr;
            const activeClass = isSelected ? 'active-item' : '';
            return `
                <div class="question-item ${activeClass} p-3 mb-2 rounded cursor-pointer transition-all" data-keystr="${Utils.escapeHtml(q.keyStr)}">
                    <div class="flex items-center justify-between">
                        <span class="font-semibold text-xs truncate max-w-[220px]" style="color:var(--fg)" title="${Utils.escapeHtml(q.referenceName)}">
                            ${Utils.escapeHtml(q.referenceName)}
                        </span>
                        <span class="badge-pill text-[10px]">${Utils.escapeHtml(q.queryField)}</span>
                    </div>
                    <div class="text-[11px] truncate mt-1" style="color:var(--muted)">
                        <i class="fa-solid fa-key mr-1 opacity-70"></i> ${Utils.escapeHtml(q.keyStr)}
                    </div>
                </div>
            `;
        }).join('');

        // Add click listeners
        listCont.querySelectorAll('.question-item').forEach(el => {
            el.addEventListener('click', () => {
                const keyStr = el.getAttribute('data-keystr');
                const targetQ = State.questions.find(q => q.keyStr === keyStr);
                if (targetQ) App.selectQuestion(targetQ);
            });
        });
    },

    selectQuestion: (question: QuestionEntity) => {
        State.selectedQuestion = question;
        State.rawSql = question.queryString || '';
        State.modifiedProperties = {};
        State.bqResults = null;

        // Extract variables
        State.variables = extractVariables(State.rawSql);
        State.variableValues = {};
        State.variables.forEach(v => {
            State.variableValues[v] = '';
        });

        // Update active selection in sidebar
        App.renderQuestionsList();

        // Update Editor UI
        const selectedBadge = Utils.$('selected-question-badge');
        if (selectedBadge) {
            selectedBadge.innerHTML = `
                <div class="flex items-center gap-2">
                    <span class="badge-accent">${Utils.escapeHtml(question.referenceName)}</span>
                    <span class="text-xs" style="color:var(--muted)">(${Utils.escapeHtml(question.keyStr)})</span>
                </div>
            `;
        }

        const sqlArea = Utils.$('txt-sql-editor') as HTMLTextAreaElement;
        if (sqlArea) sqlArea.value = State.rawSql;

        // Render variable inputs
        App.renderVariableInputs();

        // Enable actions
        Utils.$('btn-format-sql')?.removeAttribute('disabled');
        Utils.$('btn-save-datastore')?.removeAttribute('disabled');
        Utils.$('btn-edit-properties')?.removeAttribute('disabled');
        Utils.$('btn-run-query')?.removeAttribute('disabled');

        Utils.show('sec-query-editor');
        Utils.hide('sec-results-panel');
    },

    renderVariableInputs: () => {
        const varCont = Utils.$('variables-container');
        if (!varCont) return;

        if (State.variables.length === 0) {
            varCont.innerHTML = `
                <div class="p-4 text-center text-xs rounded border border-dashed" style="border-color:var(--brd2); color:var(--muted)">
                    <i class="fa-solid fa-code mr-1"></i> No <code>{{variables}}</code> found in this query.
                </div>
            `;
            return;
        }

        varCont.innerHTML = `
            <div class="text-xs font-semibold mb-2 flex items-center justify-between" style="color:var(--fg)">
                <span><i class="fa-solid fa-sliders mr-1 text-amber-400"></i> Query Variables (${State.variables.length})</span>
                <button class="text-[11px] hover:underline" style="color:var(--accent)" id="btn-clear-vars">Clear All</button>
            </div>
            ${State.variables.map(v => `
                <div class="mb-3">
                    <label class="block text-[11px] font-mono font-semibold mb-1" style="color:var(--accent)">
                        {{${Utils.escapeHtml(v)}}}
                    </label>
                    <input type="text" class="inp inp-sm var-input w-full text-xs font-mono" data-var="${Utils.escapeHtml(v)}" value="${Utils.escapeHtml(State.variableValues[v] || '')}" placeholder="Enter value for ${Utils.escapeHtml(v)}...">
                </div>
            `).join('')}
        `;

        varCont.querySelectorAll('.var-input').forEach(inp => {
            inp.addEventListener('input', (e: Event) => {
                const target = e.target as HTMLInputElement;
                const v = target.getAttribute('data-var');
                if (v) State.variableValues[v] = target.value;
            });
        });

        Utils.$('btn-clear-vars')?.addEventListener('click', () => {
            State.variables.forEach(v => { State.variableValues[v] = ''; });
            App.renderVariableInputs();
        });
    },

    handleFormatSql: () => {
        const sqlArea = Utils.$('txt-sql-editor') as HTMLTextAreaElement;
        if (!sqlArea) return;
        const currentSql = sqlArea.value;
        const formatted = formatBigQuerySql(currentSql);
        sqlArea.value = formatted;
        State.rawSql = formatted;

        // Re-extract variables in case user modified them
        State.variables = extractVariables(formatted);
        App.renderVariableInputs();
        Utils.toast('SQL Query formatted with BigQuery syntax standards!', 'ok');
    },

    handleRunQuery: async () => {
        const sqlArea = Utils.$('txt-sql-editor') as HTMLTextAreaElement;
        if (!sqlArea) return;
        const sql = sqlArea.value.trim();
        if (!sql) {
            Utils.toast('SQL Query cannot be empty.', 'warn');
            return;
        }

        // Resolve variables
        const resolvedSql = resolveSqlVariables(sql, State.rawSql ? State.variableValues : {});

        const btnRun = Utils.$('btn-run-query') as HTMLButtonElement;
        btnRun.disabled = true;
        btnRun.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Estimating Cost...';

        try {
            const dryRun = await Api.dryRunBigQuery(State.projectId, resolvedSql);
            btnRun.disabled = false;
            btnRun.innerHTML = '<i class="fa-solid fa-play mr-1.5"></i> Run Query on BigQuery';

            // Populate confirmation modal
            const scannedEl = Utils.$('confirm-data-scanned');
            const costEl = Utils.$('confirm-estimated-cost');
            const projEl = Utils.$('confirm-project-id');
            if (scannedEl) scannedEl.textContent = dryRun.formattedSize;
            if (costEl) costEl.textContent = dryRun.estimatedCostUsd;
            if (projEl) projEl.textContent = State.projectId;

            const safety = classifyBigQuerySql(resolvedSql);
            const warningEl = Utils.$('confirm-destructive-warning');
            const keywordEl = Utils.$('confirm-destructive-keyword');
            const ack = Utils.$('confirm-destructive-ack') as HTMLInputElement;
            if (keywordEl) keywordEl.textContent = safety.keyword || '';
            if (warningEl) warningEl.style.display = safety.requiresDestructiveConfirmation ? 'block' : 'none';
            if (ack) ack.checked = false;

            Utils.show('modal-confirm-query');

            // Wire confirm button once
            const proceedBtn = Utils.$('btn-proceed-run-query') as HTMLButtonElement;
            if (proceedBtn) {
                proceedBtn.disabled = safety.requiresDestructiveConfirmation;
                proceedBtn.innerHTML = safety.requiresDestructiveConfirmation
                    ? '<i class="fa-solid fa-triangle-exclamation mr-1.5"></i> Confirm Destructive Query'
                    : '<i class="fa-solid fa-play mr-1.5"></i> Confirm &amp; Run Query';
                if (ack) {
                    ack.onchange = () => {
                        proceedBtn.disabled = safety.requiresDestructiveConfirmation && !ack.checked;
                    };
                }
                proceedBtn.onclick = () => {
                    if (safety.requiresDestructiveConfirmation && !ack?.checked) return;
                    Utils.hide('modal-confirm-query');
                    void App.executeLiveQuery(resolvedSql);
                };
            }

            Utils.$('btn-cancel-confirm')!.onclick = () => Utils.hide('modal-confirm-query');
            Utils.$('btn-close-confirm-modal')!.onclick = () => Utils.hide('modal-confirm-query');
        } catch (e: any) {
            btnRun.disabled = false;
            btnRun.innerHTML = '<i class="fa-solid fa-play mr-1.5"></i> Run Query on BigQuery';
            Utils.toast(`Dry Run Error: ${e.message}`, 'err');
        }
    },

    executeLiveQuery: async (resolvedSql: string) => {
        const btnRun = Utils.$('btn-run-query') as HTMLButtonElement;
        btnRun.disabled = true;
        btnRun.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Querying BigQuery...';
        Utils.show('btn-cancel-query');

        activeAbortController = new AbortController();
        const safety = classifyBigQuerySql(resolvedSql);
        let queryAuditId: string | null = null;

        try {
            if (safety.requiresDestructiveConfirmation) {
                queryAuditId = await Api.recordAudit(
                    'BIGQUERY_EXECUTE',
                    `Started destructive BigQuery ${safety.keyword} statement on ${State.projectId}.`,
                    'IN_PROGRESS'
                );
            }
            const results = await Api.executeBigQuery(
                State.projectId,
                resolvedSql,
                activeAbortController.signal,
                // Instant first render callback (< 300ms)
                (initialResults, totalExpected) => {
                    State.bqResults = initialResults;
                    State.currentPage = 1;
                    State.resultsFilter = '';
                    Utils.show('sec-results-panel');
                    App.renderResultsHeader();
                    App.renderResultsTable();

                    if (totalExpected > initialResults.rows.length) {
                        btnRun.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i> Streaming ${initialResults.rows.length.toLocaleString()} / ${totalExpected.toLocaleString()} rows...`;
                    }
                },
                // Background parallel chunk arrival callback
                (_chunkRows, totalLoaded, totalExpected) => {
                    const pct = totalExpected > 0 ? Math.round((totalLoaded / totalExpected) * 100) : 0;
                    btnRun.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i> Streaming ${totalLoaded.toLocaleString()} / ${totalExpected.toLocaleString()} rows (${pct}%)...`;
                    if (State.bqResults) {
                        State.bqResults.totalRows = totalLoaded;
                        App.renderResultsHeader();
                        // Update table pagination info
                        const totalPages = Math.ceil(totalLoaded / State.rowsPerPage) || 1;
                        const pageInfo = Utils.$('page-info');
                        if (pageInfo && !State.resultsFilter) {
                            pageInfo.textContent = `Page ${State.currentPage} of ${totalPages} (${totalLoaded.toLocaleString()} rows)`;
                        }
                    }
                }
            );

            State.bqResults = results;
            btnRun.disabled = false;
            btnRun.innerHTML = '<i class="fa-solid fa-play mr-1.5"></i> Run Query on BigQuery';
            Utils.hide('btn-cancel-query');

            Utils.show('sec-results-panel');
            App.renderResultsHeader();
            App.renderResultsTable();

            const auditDetails = `Executed query on ${State.projectId}: ${results.totalRows} rows returned in ${results.executionTimeMs}ms. Billed: ${results.totalBytesBilled}`;
            if (queryAuditId) {
                try {
                    await Api.updateAudit(queryAuditId, 'SUCCESS', auditDetails);
                } catch (auditError) {
                    console.error('Destructive BigQuery audit finalization failed:', auditError);
                    Utils.toast('Query completed, but its pre-execution audit status could not be finalized.', 'warn');
                }
            } else {
                void Api.recordAudit('BIGQUERY_EXECUTE', auditDetails)
                    .catch(error => console.warn('BigQuery audit logging failed:', error));
            }
            Utils.toast(`BigQuery completed! (${results.totalRows.toLocaleString()} rows loaded in ${results.executionTimeMs}ms)`, 'ok');
        } catch (e: any) {
            if (queryAuditId) {
                void Api.updateAudit(
                    queryAuditId,
                    'FAILED',
                    `Destructive BigQuery ${safety.keyword} statement failed on ${State.projectId}: ${e.message}`
                ).catch(error => console.error('Failed to finalize destructive-query audit:', error));
            }
            btnRun.disabled = false;
            btnRun.innerHTML = '<i class="fa-solid fa-play mr-1.5"></i> Run Query on BigQuery';
            Utils.hide('btn-cancel-query');

            if (e.name === 'AbortError') {
                Utils.toast('Query execution cancelled.', 'info');
            } else {
                Utils.toast(`BigQuery Execution Error: ${e.message}`, 'err');
            }
        } finally {
            activeAbortController = null;
        }
    },

    handleCancelQuery: () => {
        if (activeAbortController) {
            activeAbortController.abort();
            activeAbortController = null;
        }
    },

    renderResultsHeader: () => {
        const statsEl = Utils.$('results-stats-container');
        if (!statsEl || !State.bqResults) return;

        const res = State.bqResults;
        statsEl.innerHTML = `
            <div class="flex flex-wrap items-center gap-3 text-xs">
                <span class="stat-pill border-emerald-500/40 bg-emerald-950/40 text-emerald-300 text-xs font-semibold">
                    <i class="fa-solid fa-table-cells mr-1.5 text-emerald-400"></i> Total Output Rows: <strong class="font-mono text-sm text-white ml-1">${res.totalRows.toLocaleString()}</strong>
                </span>
                <span class="stat-pill"><i class="fa-solid fa-stopwatch mr-1 text-cyan-400"></i> Duration: <strong>${res.executionTimeMs}ms</strong></span>
                <span class="stat-pill"><i class="fa-solid fa-hard-drive mr-1 text-amber-400"></i> Data Scanned: <strong>${res.totalBytesBilled}</strong></span>
                ${res.cacheHit ? '<span class="badge-pill bg-emerald-950 text-emerald-300 border-emerald-800"><i class="fa-solid fa-bolt mr-1"></i> Cache Hit</span>' : ''}
            </div>
        `;
    },

    getFilteredRows: (): any[][] => {
        if (!State.bqResults) return [];
        const filter = State.resultsFilter;
        if (!filter) return State.bqResults.rows;

        const lowerFilter = filter.toLowerCase();
        const rows = State.bqResults.rows;
        const total = rows.length;
        const matched: any[][] = [];

        for (let i = 0; i < total; i++) {
            const row = rows[i];
            if (!row) continue;
            const cols = row.length;
            let hasMatch = false;
            for (let j = 0; j < cols; j++) {
                const cell = row[j];
                if (cell !== null && cell !== undefined && String(cell).toLowerCase().includes(lowerFilter)) {
                    hasMatch = true;
                    break;
                }
            }
            if (hasMatch) matched.push(row);
        }

        return matched;
    },

    renderResultsTable: () => {
        const thead = Utils.$('results-table-head');
        const tbody = Utils.$('results-table-body');
        if (!thead || !tbody || !State.bqResults) return;

        const schema = State.bqResults.schema;
        const allFilteredRows = App.getFilteredRows();

        // Render Head
        thead.innerHTML = `
            <tr>
                <th class="p-2 text-left text-xs font-mono" style="width:50px">#</th>
                ${schema.map(f => `
                    <th class="p-2 text-left text-xs font-semibold truncate" title="${Utils.escapeHtml(f.name)} (${Utils.escapeHtml(f.type)})">
                        ${Utils.escapeHtml(f.name)}
                        <span class="text-[10px] font-normal block text-muted" style="color:var(--muted)">${Utils.escapeHtml(f.type)}</span>
                    </th>
                `).join('')}
            </tr>
        `;

        // Pagination calculations
        const totalRowsCount = allFilteredRows.length;
        const totalPages = Math.ceil(totalRowsCount / State.rowsPerPage) || 1;
        if (State.currentPage > totalPages) State.currentPage = totalPages;

        const startIdx = (State.currentPage - 1) * State.rowsPerPage;
        const endIdx = Math.min(startIdx + State.rowsPerPage, totalRowsCount);
        const pageRows = allFilteredRows.slice(startIdx, endIdx);

        // Update page text
        const pageInfo = Utils.$('page-info');
        if (pageInfo) {
            pageInfo.textContent = `Page ${State.currentPage} of ${totalPages} (${totalRowsCount.toLocaleString()} rows)`;
        }

        const prevBtn = Utils.$('btn-prev-page') as HTMLButtonElement;
        const nextBtn = Utils.$('btn-next-page') as HTMLButtonElement;
        if (prevBtn) prevBtn.disabled = State.currentPage <= 1;
        if (nextBtn) nextBtn.disabled = State.currentPage >= totalPages;

        if (pageRows.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="${schema.length + 1}" class="text-center p-8 text-xs" style="color:var(--muted)">
                        No rows found matching the search filter.
                    </td>
                </tr>
            `;
            return;
        }

        const rowsHtml: string[] = [];
        for (let i = 0; i < pageRows.length; i++) {
            const row = pageRows[i];
            if (!row) continue;
            const rowNumber = startIdx + i + 1;
            let cellsHtml = `<td class="p-2 text-xs font-mono" style="color:var(--muted)">${rowNumber}</td>`;
            for (let j = 0; j < row.length; j++) {
                const cell = row[j];
                if (cell === null || cell === undefined) {
                    cellsHtml += `<td class="p-2 text-xs font-mono" style="color:var(--muted)"><em>null</em></td>`;
                } else if (typeof cell === 'object') {
                    const str = JSON.stringify(cell);
                    cellsHtml += `<td class="p-2 text-xs font-mono truncate max-w-[200px]" title="${Utils.escapeHtml(str)}"><span class="badge-pill">{JSON}</span> ${Utils.escapeHtml(str)}</td>`;
                } else {
                    const s = String(cell);
                    cellsHtml += `<td class="p-2 text-xs truncate max-w-[250px]" title="${Utils.escapeHtml(s)}">${Utils.escapeHtml(s)}</td>`;
                }
            }
            rowsHtml.push(`<tr class="hover:bg-opacity-50 transition-all border-b border-[var(--brd2)]">${cellsHtml}</tr>`);
        }

        tbody.innerHTML = rowsHtml.join('');
    },

    searchDebounceTimer: null as any,
    handleFilterResults: (e: Event) => {
        const val = ((e.target as HTMLInputElement).value || '').trim();
        clearTimeout(App.searchDebounceTimer);
        App.searchDebounceTimer = setTimeout(() => {
            State.resultsFilter = val;
            State.currentPage = 1;
            App.renderResultsTable();
        }, 150);
    },

    handleExportCsv: () => {
        if (!State.bqResults) return;
        const headers = State.bqResults.schema.map(f => f.name);
        const rows = App.getFilteredRows();
        const filename = `${State.selectedQuestion?.referenceName || 'bigquery_full_sheet'}_${Date.now()}`;
        Utils.exportCsv(filename, headers, rows);
        Utils.toast(`Downloaded whole sheet (${rows.length.toLocaleString()} rows) as CSV!`, 'ok');
    },

    handleExportJson: () => {
        if (!State.bqResults) return;
        const schema = State.bqResults.schema;
        const rows = App.getFilteredRows();
        const jsonData = rows.map(row => {
            const obj: Record<string, any> = {};
            schema.forEach((f, idx) => {
                obj[f.name] = row[idx];
            });
            return obj;
        });
        const filename = `${State.selectedQuestion?.referenceName || 'bigquery_full_sheet'}_${Date.now()}`;
        Utils.exportJson(filename, jsonData);
        Utils.toast(`Downloaded ${rows.length.toLocaleString()} rows as JSON!`, 'ok');
    },

    handleSaveToDatastore: async () => {
        if (!State.selectedQuestion) return;
        const sqlArea = Utils.$('txt-sql-editor') as HTMLTextAreaElement;
        const newSql = sqlArea ? sqlArea.value.trim() : State.rawSql;

        if (!newSql) {
            Utils.toast('Query string cannot be empty.', 'warn');
            return;
        }

        const btn = Utils.$('btn-save-datastore') as HTMLButtonElement;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Saving to Datastore...';

        const prevProperties = JSON.parse(JSON.stringify(State.selectedQuestion.properties || {}));
        const prevSql = State.selectedQuestion.queryString || State.rawSql;

        const prevState = {
            type: 'UPDATE_QUESTION',
            keyStr: State.selectedQuestion.keyStr,
            referenceName: State.selectedQuestion.referenceName,
            prevSql,
            newSql,
            prevProperties,
            modifiedProperties: State.modifiedProperties,
            changedBy: State.userName,
            userEmail: State.userEmail,
            timestamp: new Date().toISOString()
        };
        const auditDetails = `Updated question '${State.selectedQuestion.referenceName}' (${State.selectedQuestion.keyStr}) in ${State.projectId} by ${State.userName} (${State.userEmail}).`;
        let auditId: string | null = null;

        try {
            auditId = await Api.recordAudit(
                'UPDATE_QUESTION',
                `Started: ${auditDetails}`,
                'IN_PROGRESS',
                prevState
            );
            await Api.saveQuestionEntity(
                State.projectId,
                State.selectedQuestion,
                newSql,
                State.modifiedProperties,
                State.databaseId
            );

            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up mr-2"></i> Save to Datastore';

            Utils.toast(`Saved question '${State.selectedQuestion.referenceName}'! updatedByName set to '${State.userName}'.`, 'ok');

            try {
                await Api.updateAudit(auditId, 'SUCCESS', auditDetails, prevState);
            } catch (auditError) {
                console.error('Question saved but audit finalization failed:', auditError);
                Utils.toast('Question saved, but the audit status could not be finalized. The pre-mutation backup remains available.', 'warn');
            }
        } catch (e: any) {
            if (auditId) {
                void Api.updateAudit(auditId, 'FAILED', `Failed: ${auditDetails} ${e.message}`, prevState)
                    .catch(error => console.error('Failed to mark mutation audit as failed:', error));
            }
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up mr-2"></i> Save to Datastore';
            Utils.toast(`Failed to save to Datastore: ${e.message}`, 'err');
        }
    },

    cachedAuditLogs: [] as any[],
    auditLogsFilter: '',

    handleOpenAuditLogs: async () => {
        Utils.show('modal-audit-logs');
        const bodyEl = Utils.$('modal-audit-logs-body');
        if (bodyEl) {
            bodyEl.innerHTML = `
                <div class="text-center py-8 text-xs text-[var(--muted)]">
                    <i class="fa-solid fa-spinner fa-spin mr-1"></i> Loading activity logs...
                </div>
            `;
        }

        const logs = await Api.fetchAuditLogs(100);
        App.cachedAuditLogs = logs;
        App.renderAuditLogsList();
    },

    renderAuditLogsList: () => {
        const bodyEl = Utils.$('modal-audit-logs-body');
        const countInfo = Utils.$('audit-logs-count-info');
        if (!bodyEl) return;

        const filter = (App.auditLogsFilter || '').toLowerCase().trim();
        const filtered = App.cachedAuditLogs.filter(log => {
            if (!filter) return true;
            const str = `${log.user} ${log.operation} ${log.details} ${log.srcProject} ${log.tgtProject} ${JSON.stringify(log.prevState || {})}`.toLowerCase();
            return str.includes(filter);
        });

        if (countInfo) {
            countInfo.textContent = `Showing ${filtered.length} of ${App.cachedAuditLogs.length} recent activity logs`;
        }

        if (filtered.length === 0) {
            bodyEl.innerHTML = `
                <div class="text-center py-10 text-xs text-[var(--muted)]">
                    <i class="fa-solid fa-clock-rotate-left text-2xl mb-2 block"></i>
                    No activity logs found matching the filter.
                </div>
            `;
            return;
        }

        bodyEl.innerHTML = filtered.map(log => {
            let state = log.prevState;
            if (typeof state === 'string') {
                try { state = JSON.parse(state); } catch {}
            }

            const isSuccess = log.status === 'SUCCESS';
            const statusBadge = isSuccess
                ? `<span class="badge-pill bg-emerald-950 text-emerald-300 border-emerald-800"><i class="fa-solid fa-check mr-1"></i> SUCCESS</span>`
                : `<span class="badge-pill bg-red-950 text-red-300 border-red-800"><i class="fa-solid fa-triangle-exclamation mr-1"></i> ${Utils.escapeHtml(log.status)}</span>`;

            let stateHtml = '';
            if (state && typeof state === 'object') {
                if (state.type === 'UPDATE_QUESTION' || state.type === 'QUESTION_EDIT') {
                    const prevSql = state.prevSql || '—';
                    const newSql = state.newSql || '—';
                    const modProps = state.modifiedProperties && Object.keys(state.modifiedProperties).length > 0
                        ? JSON.stringify(state.modifiedProperties, null, 2)
                        : null;

                    stateHtml = `
                        <div class="mt-3 pt-3 border-t border-[var(--brd2)] text-xs">
                            <div class="flex items-center justify-between text-[11px] font-semibold text-amber-400 mb-2">
                                <span><i class="fa-solid fa-code-compare mr-1"></i> SQL Query & Property Changes:</span>
                                <span class="font-mono text-muted text-[10px]">Target: ${Utils.escapeHtml(state.referenceName || state.keyStr)}</span>
                            </div>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                    <div class="text-[10px] text-[var(--muted)] font-semibold mb-1">PREVIOUS SQL:</div>
                                    <pre class="p-2 rounded bg-black/40 text-red-400 font-mono text-[11px] max-h-32 overflow-y-auto border border-red-900/30 whitespace-pre-wrap">${Utils.escapeHtml(prevSql)}</pre>
                                </div>
                                <div>
                                    <div class="text-[10px] text-[var(--muted)] font-semibold mb-1">NEW SQL COMMITTED:</div>
                                    <pre class="p-2 rounded bg-black/40 text-emerald-400 font-mono text-[11px] max-h-32 overflow-y-auto border border-emerald-900/30 whitespace-pre-wrap">${Utils.escapeHtml(newSql)}</pre>
                                </div>
                            </div>
                            ${modProps ? `
                                <div class="mt-2">
                                    <div class="text-[10px] text-[var(--muted)] font-semibold mb-1">MODIFIED PROPERTIES:</div>
                                    <pre class="p-2 rounded bg-black/40 text-cyan-400 font-mono text-[11px] max-h-24 overflow-y-auto border border-cyan-900/30 whitespace-pre-wrap">${Utils.escapeHtml(modProps)}</pre>
                                </div>
                            ` : ''}
                        </div>
                    `;
                } else if (state.backupData) {
                    stateHtml = `
                        <div class="mt-3 pt-2 border-t border-[var(--brd2)] text-xs">
                            <span class="badge-pill">{Backup State Included} (${state.backupData.length} records)</span>
                        </div>
                    `;
                }
            }

            let refNamesHtml = '';
            if (state?.referenceName) {
                refNamesHtml = `
                    <div class="mt-2 flex items-center gap-1.5">
                        <span class="text-[10px] text-zinc-400 font-mono">Reference:</span>
                        <span class="badge-pill bg-cyan-950/70 text-cyan-300 border-cyan-800/60 font-medium text-[11px]">${state.referenceField ? `${Utils.escapeHtml(state.referenceField)}: ` : ''}"${Utils.escapeHtml(state.referenceName)}"</span>
                    </div>
                `;
            } else if (state?.entityDisplayNames && typeof state.entityDisplayNames === 'object') {
                const entries = Object.entries(state.entityDisplayNames).slice(0, 8);
                if (entries.length > 0) {
                    refNamesHtml = `
                        <div class="mt-2 pt-2 border-t border-[var(--brd2)]">
                            <div class="text-[10px] text-[var(--muted)] font-semibold mb-1.5 flex items-center gap-1">
                                <i class="fa-solid fa-tag text-cyan-400"></i> Entity Reference Names (${Object.keys(state.entityDisplayNames).length}):
                            </div>
                            <div class="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                                ${entries.map(([k, v]: [string, any]) => `
                                    <span class="badge-pill bg-cyan-950/60 text-cyan-300 border-cyan-800/60 text-[10px]">
                                        <span class="font-mono text-zinc-400 mr-1">${Utils.escapeHtml(k.split('/').pop() || k)}:</span>
                                        <span class="font-semibold text-white">${Utils.escapeHtml(v.fieldName)}: "${Utils.escapeHtml(v.value)}"</span>
                                    </span>
                                `).join('')}
                                ${Object.keys(state.entityDisplayNames).length > 8 ? `<span class="text-[10px] text-zinc-500 self-center">+${Object.keys(state.entityDisplayNames).length - 8} more</span>` : ''}
                            </div>
                        </div>
                    `;
                }
            }

            return `
                <div class="p-3.5 rounded-xl border border-[var(--brd2)] bg-[var(--bg2)] hover:border-amber-500/30 transition-all text-xs">
                    <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                        <div class="flex items-center gap-2">
                            <span class="badge-pill font-mono font-bold text-amber-400 bg-amber-950/40 border-amber-800/60">${Utils.escapeHtml(log.operation)}</span>
                            <span class="font-semibold text-white">${Utils.escapeHtml(log.user || 'Unknown Operator')}</span>
                            ${state?.changedBy ? `<span class="text-[11px] text-[var(--muted)]">(${Utils.escapeHtml(state.changedBy)})</span>` : ''}
                        </div>
                        <div class="flex items-center gap-2">
                            ${statusBadge}
                            <span class="text-[11px] font-mono text-[var(--muted)]">${new Date(log.timestamp).toLocaleString()}</span>
                        </div>
                    </div>
                    <div class="text-xs text-[var(--fg)] leading-relaxed">${Utils.escapeHtml(log.details)}</div>
                    ${stateHtml}
                </div>
            `;
        }).join('');
    },

    handleOpenPropertiesModal: () => {
        if (!State.selectedQuestion) return;
        const modal = Utils.$('modal-properties');
        if (!modal) return;

        const props = { ...State.selectedQuestion.properties, ...State.modifiedProperties };
        const bodyCont = Utils.$('modal-props-body');
        if (bodyCont) {
            bodyCont.innerHTML = `
                <div class="text-xs mb-4 p-3 rounded" style="background:var(--accent-dim); border:1px solid var(--accent)">
                    <i class="fa-solid fa-info-circle mr-1"></i>
                    Modifying properties here will be committed atomically when clicking <strong>Save to Datastore</strong>.
                </div>
                <div class="space-y-4">
                    ${Object.entries(props).map(([propKey, propVal]) => {
                        if (propKey === State.selectedQuestion?.queryField) return '';
                        
                        let valStr = '';
                        let isJson = false;
                        if (propVal?.stringValue !== undefined) {
                            valStr = propVal.stringValue;
                            const trimmed = valStr.trim();
                            if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                                isJson = true;
                            }
                        } else if (propVal?.integerValue !== undefined) {
                            valStr = propVal.integerValue;
                        } else if (propVal?.booleanValue !== undefined) {
                            valStr = String(propVal.booleanValue);
                        } else if (propVal?.timestampValue !== undefined) {
                            valStr = propVal.timestampValue;
                        } else if (typeof propVal === 'object') {
                            valStr = JSON.stringify(propVal);
                            isJson = true;
                        } else {
                            valStr = String(propVal);
                        }

                        return `
                            <div class="border border-[var(--brd2)] rounded-lg p-3 bg-[var(--bg3)]">
                                <div class="flex items-center justify-between mb-2">
                                    <label class="font-mono text-xs font-semibold text-amber-400">${Utils.escapeHtml(propKey)}</label>
                                    ${isJson ? `
                                        <button class="btn btn-s btn-sm text-[11px] btn-open-json-editor" data-prop="${Utils.escapeHtml(propKey)}">
                                            <i class="fa-solid fa-code mr-1 text-cyan-400"></i> Open in JSON Editor
                                        </button>
                                    ` : ''}
                                </div>
                                <input type="text" class="inp w-full text-xs font-mono prop-input-field"
                                    data-prop="${Utils.escapeHtml(propKey)}"
                                    value="${Utils.escapeHtml(valStr)}"
                                    ${propKey === 'updatedByName' || propKey === 'updatedAt' ? 'placeholder="Auto-updated on save"' : ''}
                                />
                            </div>
                        `;
                    }).join('')}
                </div>
            `;

            // Wire property inputs
            bodyCont.querySelectorAll('.prop-input-field').forEach(inp => {
                inp.addEventListener('input', (e: Event) => {
                    const target = e.target as HTMLInputElement;
                    const prop = target.getAttribute('data-prop');
                    if (prop) {
                        State.modifiedProperties[prop] = { stringValue: target.value };
                    }
                });
            });

            // Wire JSON editor openers
            bodyCont.querySelectorAll('.btn-open-json-editor').forEach(btn => {
                btn.addEventListener('click', (e: Event) => {
                    const target = (e.currentTarget as HTMLElement).getAttribute('data-prop');
                    if (target) App.openJsonModal(target);
                });
            });
        }

        Utils.show('modal-properties');
        Utils.$('btn-close-props-modal')?.addEventListener('click', () => {
            Utils.hide('modal-properties');
        });
    },

    openJsonModal: (propKey: string) => {
        const val = State.modifiedProperties[propKey]?.stringValue ||
            State.selectedQuestion?.properties[propKey]?.stringValue || '{}';

        let pretty = val;
        try {
            pretty = JSON.stringify(JSON.parse(val), null, 2);
        } catch {}

        const jsonArea = Utils.$('txt-modal-json-editor') as HTMLTextAreaElement;
        const propTitle = Utils.$('json-modal-prop-title');
        if (propTitle) propTitle.textContent = propKey;
        if (jsonArea) jsonArea.value = pretty;

        Utils.show('modal-json-editor');

        Utils.$('btn-json-format')?.addEventListener('click', () => {
            try {
                jsonArea.value = JSON.stringify(JSON.parse(jsonArea.value), null, 2);
            } catch (e: any) {
                Utils.toast(`Invalid JSON: ${e.message}`, 'err');
            }
        });

        Utils.$('btn-json-minify')?.addEventListener('click', () => {
            try {
                jsonArea.value = JSON.stringify(JSON.parse(jsonArea.value));
            } catch (e: any) {
                Utils.toast(`Invalid JSON: ${e.message}`, 'err');
            }
        });

        Utils.$('btn-apply-json')?.addEventListener('click', () => {
            try {
                const parsed = JSON.parse(jsonArea.value);
                const minified = JSON.stringify(parsed);
                State.modifiedProperties[propKey] = { stringValue: minified };
                Utils.hide('modal-json-editor');
                App.handleOpenPropertiesModal(); // Refresh properties drawer
                Utils.toast(`Applied updated JSON for '${propKey}'!`, 'ok');
            } catch (e: any) {
                Utils.toast(`Cannot apply invalid JSON: ${e.message}`, 'err');
            }
        });

        Utils.$('btn-close-json-modal')?.addEventListener('click', () => {
            Utils.hide('modal-json-editor');
        });
    }
};

// Global init on DOM load
window.addEventListener('DOMContentLoaded', () => {
    App.init();
});
