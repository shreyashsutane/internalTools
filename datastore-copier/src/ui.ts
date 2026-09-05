import { State } from './state';
import { Utils } from './utils';
import { Api } from './api';

const renderEmptyMenu = (menu: HTMLElement, message = 'No results'): void => {
    menu.replaceChildren();
    const item = document.createElement('div');
    item.className = 'dropdown-item';
    item.style.color = 'var(--muted)';
    item.textContent = message;
    menu.appendChild(item);
};

const appendSimpleMenuItem = (
    menu: HTMLElement,
    value: string,
    onSelect: (value: string) => void
): void => {
    const item = document.createElement('div');
    item.className = 'dropdown-item';
    item.dataset.id = value;
    const label = document.createElement('span');
    label.className = 'id';
    label.textContent = value;
    item.appendChild(label);
    item.onmousedown = event => {
        event.preventDefault();
        onSelect(value);
    };
    menu.appendChild(item);
};

const setupSimpleDD = (inpId: string, menuId: string, dataArr: string[], stateKey: string, subObj: 'bq' | 'query' | 'ds' | null, cb?: (val: string) => void) => {
    const inp = Utils.$(inpId) as HTMLInputElement | null, menu = Utils.$(menuId);
    if (!inp || !menu) return;
    const render = (f = '') => {
        const ft = dataArr.filter(k => k.toLowerCase().includes(f.toLowerCase()));
        if (ft.length === 0) return renderEmptyMenu(menu);
        menu.replaceChildren();
        ft.forEach(value => appendSimpleMenuItem(menu, value, targetId => {
            inp.value = targetId;
            menu.classList.remove('open');
            if (subObj) {
                (State[subObj] as any)[stateKey] = targetId;
            } else {
                (State.ds as any)[stateKey] = targetId;
            }
            if (cb) cb(targetId);
        }));
    };
    inp.onfocus = () => { render(inp.value); menu.classList.add('open'); };
    inp.oninput = () => { render(inp.value); menu.classList.add('open'); };
    inp.onblur = () => setTimeout(() => menu.classList.remove('open'), 150);
};

export const UI = {
    initDropdowns: () => {
        UI.renderDsRules();
        const p = State.projects;
        const setupDD = (inpId: string, menuId: string, cb?: (id: string) => void) => {
            const inp = Utils.$(inpId) as HTMLInputElement | null, menu = Utils.$(menuId);
            if (!inp || !menu) return;
            const render = (f = '') => {
                const normalized = f.toLowerCase();
                const ft = p.filter(x => x.id.toLowerCase().includes(normalized) || x.name.toLowerCase().includes(normalized));
                if (ft.length === 0) return renderEmptyMenu(menu);
                menu.replaceChildren();
                ft.forEach(project => {
                    const item = document.createElement('div');
                    item.className = 'dropdown-item';
                    item.dataset.id = project.id;
                    const id = document.createElement('span');
                    id.className = 'id';
                    id.textContent = project.id;
                    const name = document.createElement('span');
                    name.className = 'name';
                    name.textContent = project.name;
                    item.append(id, name);
                    item.onmousedown = event => {
                        event.preventDefault();
                        inp.value = project.id;
                        menu.classList.remove('open');
                        if (cb) cb(project.id);
                    };
                    menu.appendChild(item);
                });
            };
            inp.onfocus = () => { render(inp.value); menu.classList.add('open'); };
            inp.oninput = () => { render(inp.value); menu.classList.add('open'); };
            inp.onblur = () => setTimeout(() => menu.classList.remove('open'), 150);
        };
        setupDD('bq-src', 'dd-bq-src', id => {
            State.bq.src = id;
            Api.getDatasets(id).then(ds => { State.bq.datasetsSrc = ds; UI.initDropdowns(); }).catch(() => {});
        });
        setupDD('bq-tgt', 'dd-bq-tgt', id => {
            State.bq.tgt = id;
            Api.getDatasets(id).then(ds => { State.bq.datasetsTgt = ds; UI.initDropdowns(); }).catch(() => {});
        });
        setupDD('q-src', 'dd-q-src', id => State.query.src = id);
        setupDD('q-tgt', 'dd-q-tgt', id => State.query.tgt = id);
        setupDD('ds-src', 'dd-ds-src', id => {
            State.ds.src = id;
            UI.loadDatabases(id, 'src');
            UI.loadKinds(id, State.ds.srcDb);
            if (!State.ds.modRules || State.ds.modRules.length === 0) {
                State.ds.modRules = [{ id: 'rule-1', field: '*', target: id, replacement: State.ds.modReplace || '' }];
            } else {
                State.ds.modRules[0].target = id;
            }
            State.ds.modTarget = id;
            UI.renderDsRules();
        });

        const dsSrcInp = Utils.$('ds-src') as HTMLInputElement | null;
        if (dsSrcInp) {
            dsSrcInp.addEventListener('change', () => {
                if (dsSrcInp.value) {
                    State.ds.src = dsSrcInp.value;
                    UI.loadKinds(dsSrcInp.value, State.ds.srcDb);
                }
            });
        }
        setupDD('ds-tgt', 'dd-ds-tgt', id => {
            State.ds.tgt = id;
            UI.loadDatabases(id, 'tgt');
            if (!State.ds.modRules || State.ds.modRules.length === 0) {
                State.ds.modRules = [{ id: 'rule-1', field: '*', target: State.ds.modTarget || '', replacement: id }];
            } else {
                State.ds.modRules[0].replacement = id;
            }
            State.ds.modReplace = id;
            UI.renderDsRules();
        });

        const kInp = Utils.$('ds-kind') as HTMLInputElement | null;
        const kMenu = Utils.$('dd-ds-kind');
        if (kInp && kMenu) {
            const renderKinds = () => {
                const f = kInp.value.toLowerCase();
                const ft = State.ds.kinds.filter(kind => kind.toLowerCase().includes(f));
                if (ft.length === 0) {
                    renderEmptyMenu(kMenu, 'No matching kinds');
                } else {
                    kMenu.replaceChildren();
                    ft.forEach(kind => {
                        const checked = State.ds.selectedKinds.has(kind);
                        const item = document.createElement('div');
                        item.className = 'dropdown-item flex items-center justify-between';
                        item.dataset.id = kind;
                        item.innerHTML = `
                            <div class="flex items-center gap-2">
                                <div class="chk ${checked ? 'on' : ''}" style="pointer-events:none"></div>
                                <span class="id">${Utils.escapeHtml(kind)}</span>
                            </div>
                        `;
                        item.onmousedown = (e) => {
                            e.preventDefault();
                            UI.toggleKind(kind);
                            renderKinds();
                        };
                        kMenu.appendChild(item);
                    });
                }
                kMenu.classList.add('open');
            };
            kInp.onfocus = renderKinds;
            kInp.onblur = () => setTimeout(() => kMenu.classList.remove('open'), 180);
            kInp.oninput = () => {
                renderKinds();
            };
        }

        setupSimpleDD('ds-mod-field', 'dd-ds-mod', State.ds.properties, 'modField', null);
        setupSimpleDD('bq-src-ds', 'dd-bq-src-ds', State.bq.datasetsSrc, 'srcDs', 'bq');
        setupSimpleDD('bq-tgt-ds', 'dd-bq-tgt-ds', State.bq.datasetsTgt, 'tgtDs', 'bq');

        if (State.ds.databasesSrc) setupSimpleDD('ds-src-db', 'dd-ds-src-db', State.ds.databasesSrc, 'srcDb', null, async (dbId) => {
            const kindInp = Utils.getInput('ds-kind');
            kindInp.value = '';
            State.ds.selectedKinds.clear();
            State.ds.kind = '';
            State.ds.properties = [];
            UI.renderKindChips();
            UI.refreshAllFilterPropertyDropdowns();
            UI.updateGqlPreview();
            await UI.loadKinds(State.ds.src, dbId);
        });
        if (State.ds.databasesTgt) setupSimpleDD('ds-tgt-db', 'dd-ds-tgt-db', State.ds.databasesTgt, 'tgtDb', null);
    },
    toggleKind: (kind: string) => {
        if (State.ds.selectedKinds.has(kind)) {
            State.ds.selectedKinds.delete(kind);
        } else {
            State.ds.selectedKinds.add(kind);
        }
        State.ds.kind = [...State.ds.selectedKinds].join(',');
        UI.renderKindChips();
        UI.updateGqlPreview();
        UI.loadProperties();
    },
    renderKindChips: () => {
        const c = Utils.$('ds-kind-chips');
        if (!c) return;
        c.replaceChildren();
        State.ds.selectedKinds.forEach(k => {
            const chip = document.createElement('span');
            chip.className = 'kind-chip';
            chip.innerHTML = `${Utils.escapeHtml(k)} <button type="button" title="Remove"><i class="fa-solid fa-xmark"></i></button>`;
            chip.querySelector('button')!.onclick = () => {
                UI.toggleKind(k);
            };
            c.appendChild(chip);
        });
        if (State.ds.selectedKinds.size === 0) {
            const placeholder = document.createElement('span');
            placeholder.className = 'text-xs italic';
            placeholder.style.color = 'var(--muted)';
            placeholder.textContent = 'No kinds selected (select at least one)';
            c.appendChild(placeholder);
        }
    },
    selectAllKinds: () => {
        State.ds.kinds.forEach(k => State.ds.selectedKinds.add(k));
        State.ds.kind = [...State.ds.selectedKinds].join(',');
        UI.renderKindChips();
        UI.updateGqlPreview();
        UI.loadProperties();
    },
    clearAllKinds: () => {
        State.ds.selectedKinds.clear();
        State.ds.kind = '';
        UI.renderKindChips();
        UI.updateGqlPreview();
        UI.loadProperties();
    },
    loadDatabases: async (pid: string, side: 'src' | 'tgt') => {
        if (!pid) return;
        if (pid === 'my-first-project' || pid === 'my-second-project') {
            if (side === 'src') State.ds.databasesSrc = ['(default)'];
            else State.ds.databasesTgt = ['(default)'];
            UI.initDropdowns();
            return;
        }
        const dbInp = Utils.getInput(`ds-${side}-db`);
        dbInp.placeholder = "Loading databases...";
        try {
            const res = await Api.fetch(`https://firestore.googleapis.com/v1/projects/${pid}/databases`);
            const dbs = (res.databases || []).map((db: any) => db.name.split('/').pop());
            if (dbs.length === 0) {
                dbs.push('(default)');
            }
            if (side === 'src') {
                State.ds.databasesSrc = dbs;
            } else {
                State.ds.databasesTgt = dbs;
            }
            UI.initDropdowns();
        } catch (e: any) {
            const { ErrorBoundary } = await import('./utils');
            await ErrorBoundary.handle(e, 'UI.loadDatabases');
            const defaultDb = ['(default)'];
            if (side === 'src') {
                State.ds.databasesSrc = defaultDb;
            } else {
                State.ds.databasesTgt = defaultDb;
            }
            UI.initDropdowns();
        }
    },
    loadKinds: async (pid: string, databaseId?: string) => {
        if (!pid) return;
        const kindInp = Utils.getInput('ds-kind');
        kindInp.placeholder = "Loading kinds...";
        try {
            State.ds.kinds = await Api.getKinds(pid, databaseId);
            kindInp.placeholder = "Search and select kinds...";
            State.ds.selectedKinds.clear();
            State.ds.kind = '';
            UI.renderKindChips();
            UI.initDropdowns();
        } catch (e: any) {
            const { ErrorBoundary } = await import('./utils');
            await ErrorBoundary.handle(e, 'UI.loadKinds');
            kindInp.placeholder = "Error loading kinds";
        }
    },
    loadProperties: async () => {
        if (!State.ds.src || State.ds.selectedKinds.size === 0) {
            State.ds.properties = [];
            State.ds.kindProperties = {};
            UI.initDropdowns();
            UI.refreshAllFilterPropertyDropdowns();
            UI.updateGqlPreview();
            return;
        }
        try {
            const kinds = [...State.ds.selectedKinds];
            const propSets = await Promise.all(
                kinds.map(k => Api.getProperties(State.ds.src, k, State.ds.srcDb))
            );
            const unionProps = new Set<string>();
            const kindPropsMap: Record<string, string[]> = {};
            kinds.forEach((k, idx) => {
                const ps = propSets[idx] || [];
                kindPropsMap[k] = ps;
                ps.forEach(p => unionProps.add(p));
            });
            State.ds.kindProperties = kindPropsMap;
            State.ds.properties = [...unionProps].sort();
            UI.initDropdowns();
            UI.refreshAllFilterPropertyDropdowns();
            UI.updateGqlPreview();
            Utils.toast(`Loaded ${State.ds.properties.length} unique properties across selected kinds`, "ok");
        } catch (e: any) {
            const { ErrorBoundary } = await import('./utils');
            await ErrorBoundary.handle(e, 'UI.loadProperties');
            State.ds.properties = [];
            State.ds.kindProperties = {};
            UI.refreshAllFilterPropertyDropdowns();
            UI.updateGqlPreview();
        }
    },
    refreshAllFilterPropertyDropdowns: () => {
        const c = Utils.$('ds-filters-container');
        if (!c) return;
        const rows = c.querySelectorAll('.filter-row');
        const selectedKinds = [...State.ds.selectedKinds];

        rows.forEach(r => {
            const kindSelect = r.querySelector('.filter-kind') as HTMLSelectElement | null;
            if (kindSelect) {
                const currentKind = kindSelect.value;
                kindSelect.replaceChildren();
                const allOpt = document.createElement('option');
                allOpt.value = 'all';
                allOpt.textContent = 'All Kinds';
                kindSelect.appendChild(allOpt);

                selectedKinds.forEach(k => {
                    const opt = document.createElement('option');
                    opt.value = k;
                    opt.textContent = k;
                    kindSelect.appendChild(opt);
                });

                if (currentKind && (currentKind === 'all' || selectedKinds.includes(currentKind))) {
                    kindSelect.value = currentKind;
                } else {
                    kindSelect.value = 'all';
                }
            }

            const propSelect = r.querySelector('.filter-prop') as HTMLSelectElement | null;
            if (!propSelect) return;
            const currentProp = propSelect.value;
            const chosenKind = kindSelect?.value || 'all';

            const properties = chosenKind !== 'all' && State.ds.kindProperties?.[chosenKind]
                ? State.ds.kindProperties[chosenKind]
                : State.ds.properties;
            const props = ['__key__', ...properties.filter((p: string) => p !== '__key__')];

            propSelect.replaceChildren();
            props.forEach(property => {
                const option = document.createElement('option');
                option.value = property;
                option.textContent = property === '__key__' ? '__key__ (ID / Name)' : property;
                propSelect.appendChild(option);
            });

            if (currentProp && props.includes(currentProp)) {
                propSelect.value = currentProp;
            } else {
                propSelect.value = '__key__';
            }

            if (propSelect.selectedIndex >= 0) {
                const txt = propSelect.options[propSelect.selectedIndex]?.text || '';
                propSelect.style.minWidth = Math.min(Math.max(txt.length + 3, 20), 45) + 'ch';
            }
            if (kindSelect && kindSelect.selectedIndex >= 0) {
                const txt = kindSelect.options[kindSelect.selectedIndex]?.text || '';
                kindSelect.style.minWidth = Math.min(Math.max(txt.length + 3, 12), 30) + 'ch';
            }
        });
    },
    updateGqlPreview: () => {
        const previewEl = Utils.$('gql-preview-content');
        if (!previewEl) return;

        const kind = State.ds.kind || '{Kind}';
        const rows = document.querySelectorAll('#ds-filters-container .filter-row');
        const conditions: string[] = [];

        rows.forEach(r => {
            const kScope = (r.querySelector('.filter-kind') as HTMLSelectElement)?.value || 'all';
            const prop = (r.querySelector('.filter-prop') as HTMLSelectElement)?.value || '__key__';
            const op = (r.querySelector('.filter-op') as HTMLSelectElement)?.value || 'EQUAL';
            const type = (r.querySelector('.filter-type') as HTMLSelectElement)?.value || 'auto';
            const val = (r.querySelector('.filter-val') as HTMLInputElement)?.value || '';

            let opSym = '=';
            if (op === 'LESS_THAN') opSym = '<';
            else if (op === 'LESS_THAN_OR_EQUAL') opSym = '<=';
            else if (op === 'GREATER_THAN') opSym = '>';
            else if (op === 'GREATER_THAN_OR_EQUAL') opSym = '>=';
            else if (op === 'IN') opSym = 'IN';
            else if (op === 'NOT_IN') opSym = 'NOT IN';
            else if (op === 'HAS_ANCESTOR') opSym = 'HAS ANCESTOR';

            let valStr = val ? `"${val}"` : '...';
            if (type === 'integer' || type === 'double' || type === 'boolean' || type === 'null') {
                valStr = val || (type === 'null' ? 'null' : '0');
            } else if (op === 'IN' || op === 'NOT_IN') {
                valStr = `[${val || '...'}]`;
            } else if (op === 'HAS_ANCESTOR') {
                valStr = `KEY(${val || '...'})`;
            }

            const prefix = kScope !== 'all' ? `[${kScope}] ` : '';
            conditions.push(`${prefix}${prop} ${opSym} ${valStr}`);
        });

        const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
        previewEl.textContent = `SELECT * FROM ${kind}${whereClause} ORDER BY __key__ ASC`;
    },
    addDsFilter: (presetProp?: string, presetOp?: string, presetType?: string, presetVal?: string, presetKind?: string) => {
        const c = Utils.$('ds-filters-container');
        if (!c) return;

        const selectedKinds = [...State.ds.selectedKinds];
        if (selectedKinds.length === 0 && !presetKind) {
            Utils.toast('Please select at least one Entity Kind first before adding filters.', 'warn');
            const kindInp = Utils.$('ds-kind');
            if (kindInp) {
                kindInp.focus();
                kindInp.classList.add('border-cyan-400');
                setTimeout(() => kindInp.classList.remove('border-cyan-400'), 1500);
            }
            return;
        }

        const tmpl = Utils.$('template-ds-filter-row') as HTMLTemplateElement;
        if (!tmpl) return;
        const fragment = tmpl.content.cloneNode(true) as DocumentFragment;

        const kindSelect = fragment.querySelector('.filter-kind') as HTMLSelectElement;
        const propSelect = fragment.querySelector('.filter-prop') as HTMLSelectElement;
        const opSelect = fragment.querySelector('.filter-op') as HTMLSelectElement;
        const typeSelect = fragment.querySelector('.filter-type') as HTMLSelectElement;
        const valContainer = fragment.querySelector('.filter-val-container') as HTMLElement;

        if (kindSelect) {
            kindSelect.replaceChildren();
            if (selectedKinds.length > 1) {
                const allOpt = document.createElement('option');
                allOpt.value = 'all';
                allOpt.textContent = 'All Selected Kinds';
                kindSelect.appendChild(allOpt);
            }

            selectedKinds.forEach((k, idx) => {
                const opt = document.createElement('option');
                opt.value = k;
                opt.textContent = k;
                if (presetKind && presetKind === k) opt.selected = true;
                else if (!presetKind && selectedKinds.length === 1 && idx === 0) opt.selected = true;
                kindSelect.appendChild(opt);
            });

            kindSelect.onchange = async () => {
                const chosen = kindSelect.value;
                if (chosen !== 'all' && State.ds.src && (!State.ds.kindProperties || !State.ds.kindProperties[chosen])) {
                    if (propSelect) {
                        propSelect.disabled = true;
                        propSelect.innerHTML = '<option value="__key__">Loading fields...</option>';
                    }
                    try {
                        const props = await Api.getProperties(State.ds.src, chosen, State.ds.srcDb);
                        if (!State.ds.kindProperties) State.ds.kindProperties = {};
                        State.ds.kindProperties[chosen] = props;
                    } catch (err) {
                        console.warn('Failed to load properties for kind:', chosen, err);
                    } finally {
                        if (propSelect) propSelect.disabled = false;
                    }
                }
                populateProps();
                updateValInput();
                UI.updateGqlPreview();
            };
        }

        const populateProps = () => {
            if (!propSelect) return;
            const chosenKind = kindSelect?.value || (selectedKinds.length === 1 ? selectedKinds[0] : 'all');
            const properties = chosenKind !== 'all' && State.ds.kindProperties?.[chosenKind]
                ? State.ds.kindProperties[chosenKind]
                : (State.ds.properties || []);
            const props = ['__key__', ...properties.filter((p: string) => p !== '__key__')];
            if (presetProp && !props.includes(presetProp)) {
                props.push(presetProp);
            }
            const currentProp = propSelect.value;
            propSelect.replaceChildren();
            props.forEach(property => {
                const option = document.createElement('option');
                option.value = property;
                option.textContent = property === '__key__' ? '__key__ (ID / Name)' : property;
                if (presetProp && property === presetProp) option.selected = true;
                propSelect.appendChild(option);
            });
            if (currentProp && props.includes(currentProp)) {
                propSelect.value = currentProp;
            } else if (presetProp && props.includes(presetProp)) {
                propSelect.value = presetProp;
            }

            if (propSelect.selectedIndex >= 0) {
                const txt = propSelect.options[propSelect.selectedIndex]?.text || '';
                propSelect.style.minWidth = Math.min(Math.max(txt.length + 3, 20), 45) + 'ch';
            }
        };

        if (propSelect) {
            populateProps();
            propSelect.onchange = () => {
                if (propSelect.selectedIndex >= 0) {
                    const txt = propSelect.options[propSelect.selectedIndex]?.text || '';
                    propSelect.style.minWidth = Math.min(Math.max(txt.length + 3, 20), 45) + 'ch';
                }
                updateValInput();
                UI.updateGqlPreview();
            };
        }

        if (opSelect) {
            if (presetOp) opSelect.value = presetOp;
            opSelect.onchange = () => {
                updateValInput();
                UI.updateGqlPreview();
            };
        }

        if (typeSelect && presetType) {
            typeSelect.value = presetType;
        }

        const updateValInput = () => {
            if (!valContainer || !typeSelect) return;
            const selectedType = typeSelect.value;
            const currentProp = propSelect?.value || '__key__';
            const currentOp = opSelect?.value || 'EQUAL';

            let placeholder = "Value";
            if (currentProp === '__key__') {
                if (currentOp === 'IN' || currentOp === 'NOT_IN') {
                    placeholder = "Comma-separated IDs (e.g. 1001, 1002)";
                } else if (currentOp === 'HAS_ANCESTOR') {
                    placeholder = "Ancestor Path (e.g. UserMaster:1001)";
                } else {
                    placeholder = "Entity ID or Name (e.g. 1001 or user_001)";
                }
            }

            if (selectedType === 'boolean') {
                valContainer.innerHTML = `
                    <select class="inp filter-val text-xs filter-val-width">
                        <option value="true">true</option>
                        <option value="false">false</option>
                    </select>
                `;
            } else if (selectedType === 'null') {
                valContainer.innerHTML = `
                    <input class="inp filter-val text-xs filter-val-width" value="null" disabled style="opacity:0.6">
                `;
            } else if (selectedType === 'timestamp') {
                valContainer.innerHTML = `
                    <input class="inp filter-val text-xs filter-val-width" placeholder="2026-08-19T00:00:00Z">
                `;
            } else if (selectedType === 'integer' && currentOp !== 'IN' && currentOp !== 'NOT_IN') {
                valContainer.innerHTML = `
                    <input class="inp filter-val text-xs filter-val-width" type="number" step="1" placeholder="${placeholder}">
                `;
            } else if (selectedType === 'double' && currentOp !== 'IN' && currentOp !== 'NOT_IN') {
                valContainer.innerHTML = `
                    <input class="inp filter-val text-xs filter-val-width" type="number" step="any" placeholder="${placeholder}">
                `;
            } else {
                valContainer.innerHTML = `
                    <textarea class="inp filter-val text-xs filter-val-width resize-none" rows="1" placeholder="${placeholder}" style="min-height:32px; height:32px; line-height:1.4; overflow-y:auto;"></textarea>
                `;
            }
            const valInput = valContainer.querySelector('.filter-val') as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
            const adjustValSizing = () => {
                if (valInput instanceof HTMLTextAreaElement) {
                    valInput.style.height = 'auto';
                    valInput.style.height = Math.max(32, Math.min(valInput.scrollHeight + 2, 160)) + 'px';
                    const textLen = valInput.value ? valInput.value.length : (valInput.placeholder ? valInput.placeholder.length : 15);
                    const ch = Math.min(Math.max(textLen + 3, 22), 65);
                    valInput.style.minWidth = ch + 'ch';
                } else if (valInput instanceof HTMLInputElement) {
                    const textLen = valInput.value ? valInput.value.length : (valInput.placeholder ? valInput.placeholder.length : 15);
                    const ch = Math.min(Math.max(textLen + 3, 22), 65);
                    valInput.style.minWidth = ch + 'ch';
                }
            };
            if (valInput) {
                if (presetVal) valInput.value = presetVal;
                adjustValSizing();
                valInput.oninput = () => {
                    adjustValSizing();
                    UI.updateGqlPreview();
                };
                valInput.onchange = () => {
                    adjustValSizing();
                    UI.updateGqlPreview();
                };
                if (valInput instanceof HTMLTextAreaElement) {
                    valInput.onkeydown = (e: KeyboardEvent) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            UI.updateGqlPreview();
                        }
                    };
                }
            }
            UI.updateGqlPreview();
        };

        if (typeSelect) {
            typeSelect.onchange = updateValInput;
        }

        const removeBtn = fragment.querySelector('.btn-remove-filter') as HTMLButtonElement;
        if (removeBtn) {
            removeBtn.onclick = (e) => {
                const target = e.currentTarget as HTMLElement;
                target.closest('.filter-row')?.remove();
                UI.updateGqlPreview();
            };
        }

        c.appendChild(fragment);
        updateValInput();
    },
    openModal: (content: string | HTMLElement | DocumentFragment, isLarge = false) => {
        const root = Utils.$('modal-root');
        if (!root) return;
        root.style.display = '';
        root.innerHTML = `<div class="modal-bg"><div class="modal ${isLarge ? 'modal-large' : ''}" style="padding:0; background:#0c101d; border:1px solid var(--brd2); box-shadow:0 25px 60px -12px rgba(0,0,0,0.95); border-radius:16px;"></div></div>`;

        const modalBg = root.querySelector('.modal-bg') as HTMLElement;
        modalBg.onclick = (e) => {
            if (e.target === modalBg) UI.closeModal();
        };

        const modalBody = root.querySelector('.modal') as HTMLElement;
        if (typeof content === 'string') {
            modalBody.innerHTML = content;
        } else {
            modalBody.appendChild(content);
        }
    },
    closeModal: () => {
        const root = Utils.$('modal-root');
        if (!root) return;
        root.style.display = 'none';
        root.innerHTML = '';
    },
    showTokenRenewalModal: (): Promise<string> => {
        return new Promise((resolve, reject) => {
            const tmpl = Utils.$('template-renew-token-modal') as HTMLTemplateElement;
            if (!tmpl) return reject(new Error("Template not found"));
            const fragment = tmpl.content.cloneNode(true) as DocumentFragment;

            UI.openModal(fragment);

            const inp = Utils.getInput('renew-token-inp');
            const submitBtn = Utils.getButton('btn-renew-submit');
            const cancelBtn = Utils.getButton('btn-renew-cancel');
            const errDiv = Utils.getHtml('renew-token-err');

            inp.focus();

            inp.oninput = () => {
                submitBtn.disabled = !inp.value.trim();
                errDiv.style.display = 'none';
            };

            inp.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (inp.value.trim() && !submitBtn.disabled) {
                        submitBtn.click();
                    }
                }
            });

            cancelBtn.onclick = () => {
                UI.closeModal();
                reject(new Error("Auth Error"));
            };

            submitBtn.onclick = async () => {
                const token = inp.value.trim();
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<span class="spinner"></span> Verifying...';
                try {
                    const identity = await Api.validateToken(token);
                    State.projects = identity.projects;
                    State.authEmail = identity.email;
                    Utils.getHtml('header-right').innerHTML = `<span class="text-xs mono" style="color:var(--muted)">${Utils.escapeHtml(State.authEmail)}</span>`;

                    UI.closeModal();
                    resolve(token);
                } catch (e: any) {
                    errDiv.textContent = e.message;
                    errDiv.style.display = 'block';
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = 'Verify & Resume';
                }
            };
        });
    },
    showWelcomeAnimation: (name: string): Promise<void> => {
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
            const content = overlay.querySelector('#welcome-content') as HTMLElement;
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
    },
    renderDsRules: (containerOrId: string | HTMLElement = 'ds-rules-container', isModal = false) => {
        const container = typeof containerOrId === 'string'
            ? (Utils.$(containerOrId) || document.querySelector('.' + containerOrId) as HTMLElement | null)
            : containerOrId;
        if (!container) return;

        if (!State.ds.modRules || State.ds.modRules.length === 0) {
            State.ds.modRules = [
                { id: 'rule-1', field: '*', target: State.ds.modTarget || '', replacement: State.ds.modReplace || '' }
            ];
        }

        const badge = Utils.$('ds-rules-count-badge');
        if (badge && !isModal) {
            badge.textContent = `${State.ds.modRules.length} ${State.ds.modRules.length === 1 ? 'rule' : 'rules'}`;
        }

        container.replaceChildren();

        State.ds.modRules.forEach((rule, idx) => {
            const card = document.createElement('div');
            card.className = 'p-2.5 rounded-lg border border-white/10 bg-black/40 space-y-2 rule-card-item transition-all';
            card.dataset.ruleId = rule.id;

            // Card Header
            const header = document.createElement('div');
            header.className = 'flex items-center justify-between text-[11px] font-mono border-b border-white/5 pb-1';
            
            const titleWrap = document.createElement('div');
            titleWrap.className = 'flex items-center gap-1.5 text-cyan-400 font-bold';
            titleWrap.innerHTML = `<i class="fa-solid fa-code-compare text-[10px]"></i><span>RULE ${String(idx + 1).padStart(2, '0')}</span>`;
            header.appendChild(titleWrap);

            if (State.ds.modRules.length > 1) {
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'text-rose-400 hover:text-rose-300 text-[11px] px-1.5 py-0.5 rounded hover:bg-rose-500/10 transition';
                delBtn.title = 'Remove this rule';
                delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
                delBtn.onclick = () => {
                    State.ds.modRules.splice(idx, 1);
                    if (idx === 0 && State.ds.modRules[0]) {
                        State.ds.modField = State.ds.modRules[0].field;
                        State.ds.modTarget = State.ds.modRules[0].target;
                        State.ds.modReplace = State.ds.modRules[0].replacement;
                    }
                    UI.renderDsRules('ds-rules-container', false);
                    const modalList = document.querySelector('.modal-ds-rules-list') as HTMLElement | null;
                    if (modalList) UI.renderDsRules('modal-ds-rules-list', true);
                };
                header.appendChild(delBtn);
            }
            card.appendChild(header);

            // Property field input with autocomplete dropdown
            const fieldWrap = document.createElement('div');
            fieldWrap.className = 'dropdown-wrapper';
            
            const fieldLabel = document.createElement('label');
            fieldLabel.className = 'block text-[10px] uppercase tracking-wider text-zinc-400 mb-0.5';
            fieldLabel.textContent = 'Property Field (* for all fields)';
            fieldWrap.appendChild(fieldLabel);

            const fieldInp = document.createElement('input');
            fieldInp.type = 'text';
            fieldInp.className = 'inp inp-rule-field w-full text-xs font-mono ' + (idx === 0 ? 'inp-field-val' : '');
            if (idx === 0 && !isModal) fieldInp.id = 'ds-mod-field';
            fieldInp.style.padding = '5px 8px';
            fieldInp.placeholder = 'e.g. * or query, endpoint, role...';
            fieldInp.value = rule.field;
            fieldWrap.appendChild(fieldInp);

            const menuEl = document.createElement('div');
            menuEl.className = 'dropdown-menu';
            fieldWrap.appendChild(menuEl);

            const renderDD = (filter = '') => {
                const props = ['*', ...State.ds.properties];
                const filtered = props.filter(p => p.toLowerCase().includes(filter.toLowerCase()));
                menuEl.replaceChildren();
                if (filtered.length === 0) {
                    menuEl.classList.remove('open');
                    return;
                }
                filtered.forEach(p => {
                    const it = document.createElement('div');
                    it.className = 'dropdown-item text-xs font-mono';
                    it.textContent = p;
                    it.onmousedown = (ev) => {
                        ev.preventDefault();
                        fieldInp.value = p;
                        rule.field = p;
                        if (idx === 0) State.ds.modField = p;
                        menuEl.classList.remove('open');
                    };
                    menuEl.appendChild(it);
                });
            };
            fieldInp.onfocus = () => { renderDD(fieldInp.value); menuEl.classList.add('open'); };
            fieldInp.oninput = (e: any) => {
                rule.field = e.target.value;
                if (idx === 0) State.ds.modField = e.target.value;
                renderDD(fieldInp.value);
                menuEl.classList.add('open');
            };
            fieldInp.onblur = () => setTimeout(() => menuEl.classList.remove('open'), 150);

            card.appendChild(fieldWrap);

            // Find (Target) & Replace Inputs (Textareas for long strings / multiline)
            const grid = document.createElement('div');
            grid.className = 'ds-rule-grid flex flex-wrap gap-2 items-start';

            // Target (Find)
            const colFind = document.createElement('div');
            colFind.className = 'ds-rule-col flex-1 min-w-[220px] flex flex-col transition-all';
            const lblFind = document.createElement('label');
            lblFind.className = 'block text-[10px] uppercase tracking-wider text-zinc-400 mb-0.5';
            lblFind.textContent = 'Find Value';
            const txtFind = document.createElement('textarea');
            txtFind.rows = 1;
            txtFind.className = 'inp inp-rule-target w-full text-xs font-mono resize-y ' + (idx === 0 ? 'inp-find-val' : '');
            if (idx === 0 && !isModal) txtFind.id = 'ds-mod-target';
            txtFind.style.padding = '5px 8px';
            txtFind.style.minHeight = '32px';
            txtFind.placeholder = 'String, long value, or integer...';
            txtFind.value = rule.target;

            // Replacement
            const colRep = document.createElement('div');
            colRep.className = 'ds-rule-col flex-1 min-w-[220px] flex flex-col transition-all';
            const lblRep = document.createElement('label');
            lblRep.className = 'block text-[10px] uppercase tracking-wider text-zinc-400 mb-0.5';
            lblRep.textContent = 'Replace With';
            const txtRep = document.createElement('textarea');
            txtRep.rows = 1;
            txtRep.className = 'inp inp-rule-replace w-full text-xs font-mono resize-y ' + (idx === 0 ? 'inp-replace-val' : '');
            if (idx === 0 && !isModal) txtRep.id = 'ds-mod-replace';
            txtRep.style.padding = '5px 8px';
            txtRep.style.minHeight = '32px';
            txtRep.placeholder = 'Replacement string or value...';
            txtRep.value = rule.replacement;

            const updateRuleSizing = () => {
                const isLong = (txtFind.value && txtFind.value.length > 28) || (txtRep.value && txtRep.value.length > 28);
                if (isLong) {
                    colFind.style.flex = '1 1 100%';
                    colRep.style.flex = '1 1 100%';
                } else {
                    colFind.style.flex = '1 1 220px';
                    colRep.style.flex = '1 1 220px';
                }
                [txtFind, txtRep].forEach(ta => {
                    ta.style.height = 'auto';
                    ta.style.height = Math.max(32, Math.min(ta.scrollHeight + 2, 200)) + 'px';
                });
            };

            txtFind.oninput = (e: any) => {
                rule.target = e.target.value;
                if (idx === 0) State.ds.modTarget = e.target.value;
                updateRuleSizing();
            };

            txtRep.oninput = (e: any) => {
                rule.replacement = e.target.value;
                if (idx === 0) State.ds.modReplace = e.target.value;
                updateRuleSizing();
            };

            colFind.append(lblFind, txtFind);
            colRep.append(lblRep, txtRep);
            grid.append(colFind, colRep);
            card.appendChild(grid);

            updateRuleSizing();

            container.appendChild(card);
        });
    }
};
