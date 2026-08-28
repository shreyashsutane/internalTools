import { SoundFX } from './sound';

export type MascotState = 'idle' | 'hello' | 'thinking' | 'success' | 'warning' | 'happy' | 'angry';

export interface AssistStep {
    id: string;
    targetSelector: string;
    title: string;
    directive: string;
    explanation: string;
    mascotState: MascotState;
    position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
    inModal?: boolean;
}

export class AssistManager {
    private static active: boolean = true;
    private static mascotState: MascotState = 'idle';
    private static overrideStep: AssistStep | null = null;
    private static overrideTimer: any = null;

    public static init(): void {
        const saved = localStorage.getItem('gcp_assist_mode');
        this.active = saved === null ? true : saved === 'true';
    }

    public static isActive(): boolean {
        return this.active;
    }

    public static setActive(active: boolean): void {
        this.active = active;
        localStorage.setItem('gcp_assist_mode', active ? 'true' : 'false');
    }

    public static setTemporaryReaction(reaction: 'happy' | 'angry', message?: string, durationMs: number = 3200): void {
        if (this.overrideTimer) clearTimeout(this.overrideTimer);

        if (reaction === 'happy') {
            SoundFX.playChime();
        } else {
            SoundFX.playGrumpy();
        }

        const current = this.getCurrentStep();
        this.overrideStep = {
            id: `reaction-${reaction}`,
            targetSelector: current?.targetSelector || '#assist-mascot-svg',
            title: reaction === 'happy' ? 'Mochi is Happy! ✨' : 'Mochi is Grumpy! 💢',
            directive: reaction === 'happy'
                ? (message || '💖 Yay! Mochi loves helping you with your cloud ops! ( ^ _ ^ )')
                : (message || '💢 Whoa! Double-click made Mochi grumpy! Ò_Ó'),
            explanation: reaction === 'happy'
                ? 'Keep going! Single-click anytime to celebrate.'
                : 'Be gentle! Single click to make Mochi happy again ✨',
            mascotState: reaction
        };
        this.mascotState = reaction;

        this.overrideTimer = setTimeout(() => {
            this.overrideStep = null;
            this.overrideTimer = null;
        }, durationMs);
    }

    public static getMascotState(): MascotState {
        return this.mascotState;
    }

    public static setMascotState(state: MascotState): void {
        this.mascotState = state;
    }

    /**
     * Dynamically evaluates the current application state, active focused element,
     * visible DOM sections, and open modals to return the exact relevant guidance step.
     */
    public static getCurrentStep(): AssistStep | null {
        if (this.overrideStep) {
            return this.overrideStep;
        }

        const stateObj = (window as any).State || {};
        const activeEl = document.activeElement as HTMLElement | null;

        // 1. Check for Active Modals first (e.g. JSON Editor or SQL Query Comparison)
        const modalRoot = document.getElementById('modal-root');
        if (modalRoot && modalRoot.style.display !== 'none' && modalRoot.children.length > 0) {
            const jsonEditor = modalRoot.querySelector('.layout-json-editor-container');
            if (jsonEditor) {
                return {
                    id: 'modal-json-editor-guide',
                    targetSelector: '#modal-root .btn-fmt-tgt, #modal-root .layout-json-editor-container',
                    title: 'JSON Editor & Formatter Tools',
                    directive: '🪄 Lossless Formatting, Minify & Live Diff Preview',
                    explanation: 'Click Format for easy indented editing, Minify for compact storage, and review the live syntax validator & diffs below.',
                    mascotState: 'happy',
                    position: 'top',
                    inModal: true
                };
            }

            const queryModal = modalRoot.querySelector('.query-copy-modal, textarea, .sql-block');
            if (queryModal) {
                return {
                    id: 'modal-sql-diff-guide',
                    targetSelector: '#modal-root button.btn-p, #modal-root textarea, #modal-root',
                    title: 'SQL Formatter & Parameter Inspector',
                    directive: '📐 Smart SQL Formatting & {{variable}} Resolution',
                    explanation: 'Inspect query clause indentations, dynamic variable replacements, and semantic difference classifications.',
                    mascotState: 'thinking',
                    position: 'top',
                    inModal: true
                };
            }
        }

        // 2. Check if App is in Loading state
        const secLoading = document.getElementById('sec-loading');
        if (secLoading && secLoading.style.display !== 'none' && secLoading.offsetParent !== null) {
            const loadTitle = document.getElementById('load-title')?.textContent || 'Processing';
            return {
                id: 'app-loading-rocket',
                targetSelector: '#btn-toggle-assist',
                title: 'Operation in Progress',
                directive: `🚀 ${loadTitle}...`,
                explanation: 'Streaming live data from Google Cloud APIs and executing high-performance in-memory AST transforms.',
                mascotState: 'thinking',
                position: 'bottom'
            };
        }

        // 3. Screen 1: Unauthenticated
        const secAuth = document.getElementById('sec-auth');
        const tokenInput = document.getElementById('inp-token') as HTMLInputElement | null;
        if (!stateObj.token || (secAuth && secAuth.style.display !== 'none' && secAuth.offsetParent !== null)) {
            if (tokenInput && (activeEl === tokenInput || tokenInput.value.trim().length > 10)) {
                return {
                    id: 'auth-verify-step',
                    targetSelector: '#btn-verify',
                    title: 'Step 1: Verify Credentials',
                    directive: '👉 Click here to verify your access token',
                    explanation: 'Validates against Google OpenID endpoints to load your authorized GCP projects.',
                    mascotState: 'thinking',
                    position: 'top'
                };
            }
            return {
                id: 'auth-copy-cmd-step',
                targetSelector: '.btn-copy-token-cmd',
                title: 'Step 1: Cloud Shell Authentication',
                directive: '👉 Click here to copy the authentication command',
                explanation: 'Run this command inside Google Cloud Shell to print your temporary OAuth2 token, then paste it below.',
                mascotState: 'hello',
                position: 'top'
            };
        }

        // 4. Screen 2: Authenticated -> Select Mode
        const secModes = document.getElementById('sec-modes');
        if (secModes && secModes.style.display !== 'none' && secModes.offsetParent !== null && !stateObj.mode) {
            return {
                id: 'select-mode-step',
                targetSelector: 'button[data-mode="ds"], button[data-mode="bq"]',
                title: 'Step 2: Choose Operation Mode',
                directive: '👉 Select an operation mode to begin',
                explanation: 'Choose "Datastore" for entity comparison and copy, or "BQ Schema Comparator" for read-only table diffs.',
                mascotState: 'happy',
                position: 'bottom'
            };
        }

        // 5. ACTIVE ELEMENT INTERACTION PRIORITY (Handles user clicking backwards, editing filters, databases, modifications)
        if (activeEl) {
            // Source Project
            if (activeEl.id === 'ds-src' || activeEl.closest('#dd-ds-src')) {
                return {
                    id: 'focus-ds-src',
                    targetSelector: '#ds-src',
                    title: 'Source GCP Project',
                    directive: '👉 Select Source GCP Project',
                    explanation: 'Choose the origin GCP project containing the entities you want to analyze or migrate.',
                    mascotState: 'idle',
                    position: 'right'
                };
            }

            // Target Project
            if (activeEl.id === 'ds-tgt' || activeEl.closest('#dd-ds-tgt')) {
                return {
                    id: 'focus-ds-tgt',
                    targetSelector: '#ds-tgt',
                    title: 'Target GCP Project',
                    directive: '👉 Select Target GCP Project',
                    explanation: 'Choose the destination GCP project where transformed entities will be compared and copied.',
                    mascotState: 'idle',
                    position: 'right'
                };
            }

            // Source Database
            if (activeEl.id === 'ds-src-db' || activeEl.closest('#dd-ds-src-db')) {
                return {
                    id: 'focus-ds-src-db',
                    targetSelector: '#ds-src-db',
                    title: 'Source Database (Optional)',
                    directive: '👉 Select Source Datastore Database',
                    explanation: 'Defaults to `(default)`. If your project uses named multi-databases in Firestore/Datastore mode, pick it here.',
                    mascotState: 'idle',
                    position: 'right'
                };
            }

            // Target Database
            if (activeEl.id === 'ds-tgt-db' || activeEl.closest('#dd-ds-tgt-db')) {
                return {
                    id: 'focus-ds-tgt-db',
                    targetSelector: '#ds-tgt-db',
                    title: 'Target Database (Optional)',
                    directive: '👉 Select Target Datastore Database',
                    explanation: 'Defaults to `(default)`. Choose the target database namespace.',
                    mascotState: 'idle',
                    position: 'right'
                };
            }

            // Entity Kind
            if (activeEl.id === 'ds-kind' || activeEl.closest('#dd-ds-kind')) {
                return {
                    id: 'focus-ds-kind',
                    targetSelector: '#ds-kind',
                    title: 'Entity Kind Selection',
                    directive: '👉 Choose or Type Entity Kind',
                    explanation: 'Selecting a Kind fetches its live schema and synchronizes all filter property dropdowns automatically.',
                    mascotState: 'thinking',
                    position: 'right'
                };
            }

            // Filter Property Column Dropdown
            if (activeEl.classList.contains('filter-prop')) {
                return {
                    id: 'focus-filter-prop',
                    targetSelector: '.filter-prop:focus, .filter-prop',
                    title: 'Filter Column Selection',
                    directive: '👉 Pick Property Column to Filter',
                    explanation: 'Choose a column from live schema or use `__key__` to filter by Key / ID name.',
                    mascotState: 'idle',
                    position: 'right'
                };
            }

            // Filter Operator Dropdown
            if (activeEl.classList.contains('filter-op')) {
                return {
                    id: 'focus-filter-op',
                    targetSelector: '.filter-op:focus, .filter-op',
                    title: 'Filter Operator',
                    directive: '👉 Select Comparison Operator',
                    explanation: 'Choose an operator (`=`, `>`, `<`, `>=`, `<=`, `IN`, `NOT_IN`, `HAS_ANCESTOR`).',
                    mascotState: 'idle',
                    position: 'right'
                };
            }

            // Filter Data Type Dropdown
            if (activeEl.classList.contains('filter-type')) {
                return {
                    id: 'focus-filter-type',
                    targetSelector: '.filter-type:focus, .filter-type',
                    title: 'Filter Data Type',
                    directive: '👉 Select Value Data Type',
                    explanation: 'Set data type (String, Integer, Double, Boolean, Timestamp, Null, or Auto) for lossless type-safe matching.',
                    mascotState: 'idle',
                    position: 'right'
                };
            }

            // Filter Value Input
            if (activeEl.classList.contains('filter-val')) {
                return {
                    id: 'focus-filter-val',
                    targetSelector: '.filter-val:focus, .filter-val',
                    title: 'Filter Value Input',
                    directive: '👉 Enter Filter Value',
                    explanation: 'Type the value to filter on. Notice the Live Datastore GQL Query preview box generating syntax below in real time.',
                    mascotState: 'happy',
                    position: 'right'
                };
            }

            // Modification: Field to Modify
            if (activeEl.id === 'ds-mod-field' || activeEl.closest('#dd-ds-mod')) {
                return {
                    id: 'focus-ds-mod-field',
                    targetSelector: '#ds-mod-field',
                    title: 'Property to Modify',
                    directive: '👉 Select or Type Field to Modify',
                    explanation: 'Choose which entity property to perform Find & Replace on across all scanned entities.',
                    mascotState: 'idle',
                    position: 'right'
                };
            }

            // Modification: Target Substring
            if (activeEl.id === 'ds-mod-target') {
                return {
                    id: 'focus-ds-mod-target',
                    targetSelector: '#ds-mod-target',
                    title: 'Target Substring (Find)',
                    directive: '👉 Enter Substring to Find',
                    explanation: 'The exact string, URL, or project name to search for within the selected field.',
                    mascotState: 'idle',
                    position: 'right'
                };
            }

            // Modification: Replacement Substring
            if (activeEl.id === 'ds-mod-replace') {
                return {
                    id: 'focus-ds-mod-replace',
                    targetSelector: '#ds-mod-replace',
                    title: 'Replacement Substring',
                    directive: '👉 Enter Replacement String',
                    explanation: 'Replaces matching text across nested objects, embedded entities, and arrays losslessly.',
                    mascotState: 'happy',
                    position: 'right'
                };
            }
        }

        // 6. PROGRESSIVE COMPLETION WORKFLOW (When no input is actively focused)
        const secForms = document.getElementById('sec-forms');
        if (secForms && secForms.style.display !== 'none' && secForms.offsetParent !== null) {
            const currentMode = stateObj.mode || 'ds';

            if (currentMode === 'ds') {
                const dsSrc = (document.getElementById('ds-src') as HTMLInputElement | null)?.value || stateObj.ds?.src;
                const dsTgt = (document.getElementById('ds-tgt') as HTMLInputElement | null)?.value || stateObj.ds?.tgt;
                const dsKind = (document.getElementById('ds-kind') as HTMLInputElement | null)?.value || stateObj.ds?.kind;

                if (!dsSrc) {
                    return {
                        id: 'ds-select-src-step',
                        targetSelector: '#ds-src',
                        title: 'Select Source Project',
                        directive: '👉 Pick your Source GCP Project',
                        explanation: 'Choose the GCP project where your original Datastore entities are located.',
                        mascotState: 'idle',
                        position: 'right'
                    };
                }
                if (!dsTgt) {
                    return {
                        id: 'ds-select-tgt-step',
                        targetSelector: '#ds-tgt',
                        title: 'Select Target Project',
                        directive: '👉 Pick your Target GCP Project',
                        explanation: 'Choose the destination GCP project where entities will be compared and copied.',
                        mascotState: 'idle',
                        position: 'right'
                    };
                }
                if (!dsKind) {
                    return {
                        id: 'ds-select-kind-step',
                        targetSelector: '#ds-kind',
                        title: 'Select Entity Kind',
                        directive: '👉 Select or type an Entity Kind',
                        explanation: 'Picking a Kind fetches its schema and synchronizes all filter column dropdowns in real time.',
                        mascotState: 'thinking',
                        position: 'right'
                    };
                }

                // Kind is selected -> ready to add filter or analyze
                const filtersContainer = document.getElementById('ds-filters-container');
                const filterCount = filtersContainer ? filtersContainer.querySelectorAll('.filter-row').length : 0;
                if (filterCount === 0) {
                    return {
                        id: 'ds-analyze-or-filter-step',
                        targetSelector: '#btn-ds-analyze',
                        title: 'Ready for Analysis',
                        directive: '👉 Click Analyze & Compare Entities',
                        explanation: 'You can also click "+ Add Filter" above to filter by properties with live GQL preview before running.',
                        mascotState: 'happy',
                        position: 'top'
                    };
                }

                return {
                    id: 'ds-analyze-filtered-step',
                    targetSelector: '#btn-ds-analyze',
                    title: 'Filters Configured',
                    directive: '👉 Click Analyze to scan with your custom filters',
                    explanation: 'Streams filtered entities from source and target to compute property diffs.',
                    mascotState: 'thinking',
                    position: 'top'
                };
            }

            if (currentMode === 'bq') {
                const bqSrc = (document.getElementById('bq-src') as HTMLInputElement | null)?.value || stateObj.bq?.src;
                const bqTgt = (document.getElementById('bq-tgt') as HTMLInputElement | null)?.value || stateObj.bq?.tgt;

                if (!bqSrc) {
                    return {
                        id: 'bq-select-src-step',
                        targetSelector: '#bq-src',
                        title: 'BigQuery Source Project',
                        directive: '👉 Select BigQuery Source Project',
                        explanation: 'Discovers datasets and table schemas for read-only comparison.',
                        mascotState: 'idle',
                        position: 'right'
                    };
                }
                if (!bqTgt) {
                    return {
                        id: 'bq-select-tgt-step',
                        targetSelector: '#bq-tgt',
                        title: 'BigQuery Target Project',
                        directive: '👉 Select BigQuery Target Project',
                        explanation: 'The baseline project to compare tables and schemas against.',
                        mascotState: 'idle',
                        position: 'right'
                    };
                }
                return {
                    id: 'bq-run-compare-step',
                    targetSelector: '#btn-bq-compare',
                    title: 'Compare BigQuery Schemas',
                    directive: '👉 Click Compare Schemas (Read Only)',
                    explanation: 'Scans all datasets in parallel with zero write permissions.',
                    mascotState: 'thinking',
                    position: 'top'
                };
            }
        }

        // 7. Screen 4: Results View
        const secResults = document.getElementById('sec-results');
        if (secResults && secResults.style.display !== 'none' && secResults.offsetParent !== null) {
            const resDs = document.getElementById('res-ds');
            if (resDs && resDs.style.display !== 'none' && resDs.offsetParent !== null) {
                return {
                    id: 'ds-results-diff-step',
                    targetSelector: '#btn-ds-dry-run',
                    title: 'Review Differences & Simulate',
                    directive: '👉 Run a Pre-Flight Dry Run or Review Diffs',
                    explanation: 'Test transformations safely in memory with 0 writes to GCP. Click any row to open the JSON Editor.',
                    mascotState: 'happy',
                    position: 'top'
                };
            }

            const resBq = document.getElementById('res-bq');
            if (resBq && resBq.style.display !== 'none' && resBq.offsetParent !== null) {
                return {
                    id: 'bq-results-step',
                    targetSelector: '#bq-search',
                    title: 'BigQuery Schema Results',
                    directive: '👉 Search tables or export CSV report',
                    explanation: 'View column diffs, type mismatches, and missing tables across your datasets.',
                    mascotState: 'success',
                    position: 'bottom'
                };
            }
        }

        // Default Fallback
        return {
            id: 'fallback-portal-guide',
            targetSelector: '#btn-toggle-assist',
            title: 'GCP Infrastructure Manager',
            directive: '✨ Assist Mode is Active',
            explanation: 'Mochi follows your actions in real time. Click Mochi once for Happy or twice for Angry!',
            mascotState: 'idle',
            position: 'bottom'
        };
    }
}
