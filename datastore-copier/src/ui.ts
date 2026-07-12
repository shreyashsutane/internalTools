import { State } from './state';
import { Utils } from './utils';
import { Api } from './api';

const setupSimpleDD = (inpId: string, menuId: string, dataArr: string[], stateKey: string, subObj: 'bq' | 'query' | 'ds' | null, cb?: (val: string) => void) => {
    const inp = Utils.$(inpId) as HTMLInputElement | null, menu = Utils.$(menuId);
    if (!inp || !menu) return;
    const render = (f = '') => { 
        const ft = dataArr.filter(k => k.toLowerCase().includes(f.toLowerCase())); 
        menu.innerHTML = ft.length ? ft.map(k => `<div class="dropdown-item" data-id="${k}"><span class="id">${k}</span></div>`).join('') : `<div class="dropdown-item" style="color:var(--muted)">No results</div>`; 
        menu.querySelectorAll('[data-id]').forEach(el => {
            (el as HTMLElement).onmousedown = e => { 
                e.preventDefault(); 
                const targetId = (el as HTMLElement).dataset.id || '';
                inp.value = targetId; 
                menu.classList.remove('open'); 
                if (subObj) {
                    (State[subObj] as any)[stateKey] = targetId; 
                } else {
                    (State.ds as any)[stateKey] = targetId; 
                }
                if (cb) cb(targetId); 
            };
        }); 
    };
    inp.onfocus = () => { render(inp.value); menu.classList.add('open'); }; 
    inp.oninput = () => { render(inp.value); menu.classList.add('open'); }; 
    inp.onblur = () => setTimeout(() => menu.classList.remove('open'), 150);
};

export const UI = {
    initDropdowns: () => {
        const p = State.projects;
        const setupDD = (inpId: string, menuId: string, cb?: (id: string) => void) => {
            const inp = Utils.$(inpId) as HTMLInputElement | null, menu = Utils.$(menuId);
            if (!inp || !menu) return;
            const render = (f = '') => { 
                const ft = p.filter(x => x.id.includes(f.toLowerCase()) || x.name.toLowerCase().includes(f.toLowerCase())); 
                menu.innerHTML = ft.length ? ft.map(x => `<div class="dropdown-item" data-id="${x.id}"><span class="id">${x.id}</span><span class="name">${x.name}</span></div>`).join('') : `<div class="dropdown-item" style="color:var(--muted)">No results</div>`; 
                menu.querySelectorAll('[data-id]').forEach(el => {
                    (el as HTMLElement).onmousedown = e => { 
                        e.preventDefault(); 
                        const targetId = (el as HTMLElement).dataset.id || '';
                        inp.value = targetId; 
                        menu.classList.remove('open'); 
                        if (cb) cb(targetId); 
                    };
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
            const tgtInp = Utils.$('ds-mod-target') as HTMLInputElement | null;
            if (tgtInp) {
                tgtInp.value = id;
                State.ds.modTarget = id;
            }
        });
        setupDD('ds-tgt', 'dd-ds-tgt', id => { 
            State.ds.tgt = id; 
            UI.loadDatabases(id, 'tgt'); 
            const repInp = Utils.$('ds-mod-replace') as HTMLInputElement | null;
            if (repInp) {
                repInp.value = id;
                State.ds.modReplace = id;
            }
        });

        const kInp = Utils.$('ds-kind') as HTMLInputElement | null; 
        const kMenu = Utils.$('dd-ds-kind');
        if (kInp && kMenu) {
            kInp.onfocus = () => { 
                const f = kInp.value.toLowerCase(); 
                const kinds = (State.ds as any).kinds || [];
                const ft = kinds.filter((k: string) => k.toLowerCase().includes(f)); 
                kMenu.innerHTML = ft.length ? ft.map((k: string) => `<div class="dropdown-item" data-id="${k}"><span class="id">${k}</span></div>`).join('') : ''; 
                kMenu.classList.add('open'); 
                kMenu.querySelectorAll('[data-id]').forEach(el => {
                    (el as HTMLElement).onmousedown = e => { 
                        e.preventDefault(); 
                        const targetId = (el as HTMLElement).dataset.id || '';
                        kInp.value = targetId; 
                        kMenu.classList.remove('open'); 
                        State.ds.kind = targetId; 
                        UI.loadProperties(); 
                    };
                }); 
            };
            kInp.onblur = () => setTimeout(() => kMenu.classList.remove('open'), 150); 
            kInp.oninput = () => kInp.onfocus();
        }

        setupSimpleDD('ds-mod-field', 'dd-ds-mod', (State.ds as any).properties || [], 'modField', null);
        setupSimpleDD('bq-src-ds', 'dd-bq-src-ds', State.bq.datasetsSrc, 'srcDs', 'bq', async (datasetId) => {
            if (!State.bq.src || !datasetId) return;
            try {
                const meta = await Api.getDataset(State.bq.src, datasetId);
                if (meta.location) {
                    const locInp = Utils.$('bq-loc') as HTMLSelectElement | null;
                    if (locInp) locInp.value = meta.location.toLowerCase();
                    State.bq.loc = meta.location.toLowerCase();
                }
            } catch (e) {
                console.error("Failed to auto-detect dataset location", e);
            }
        });
        setupSimpleDD('bq-tgt-ds', 'dd-bq-tgt-ds', State.bq.datasetsTgt, 'tgtDs', 'bq');
        
        if ((State.ds as any).databasesSrc) setupSimpleDD('ds-src-db', 'dd-ds-src-db', (State.ds as any).databasesSrc, 'srcDb', null, async (dbId) => {
            const kindInp = Utils.getInput('ds-kind');
            kindInp.value = '';
            await UI.loadKinds(State.ds.src, dbId);
        });
        if ((State.ds as any).databasesTgt) setupSimpleDD('ds-tgt-db', 'dd-ds-tgt-db', (State.ds as any).databasesTgt, 'tgtDb', null);
    },
    loadDatabases: async (projectId: string, side: 'src' | 'tgt') => {
        try {
            const res = await Api.fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases`);
            const dbs = (res.databases || []).map((db: any) => db.name.split('/').pop());
            if (dbs.length === 0) {
                dbs.push('(default)');
            }
            if (side === 'src') {
                (State.ds as any).databasesSrc = dbs;
            } else {
                (State.ds as any).databasesTgt = dbs;
            }
            UI.initDropdowns();
        } catch (e: any) {
            const { ErrorBoundary } = await import('./utils');
            await ErrorBoundary.handle(e, 'UI.loadDatabases');
            const defaultDb = ['(default)'];
            if (side === 'src') {
                (State.ds as any).databasesSrc = defaultDb;
            } else {
                (State.ds as any).databasesTgt = defaultDb;
            }
            UI.initDropdowns();
        }
    },
    loadKinds: async (pid: string, databaseId?: string) => { 
        if (!pid) return; 
        const kindInp = Utils.getInput('ds-kind');
        kindInp.placeholder = "Loading..."; 
        try { 
            (State.ds as any).kinds = await Api.getKinds(pid, databaseId); 
            kindInp.placeholder = "Select Kind..."; 
            UI.initDropdowns(); 
        } catch (e: any) { 
            const { ErrorBoundary } = await import('./utils');
            await ErrorBoundary.handle(e, 'UI.loadKinds');
            kindInp.placeholder = "Error loading kinds"; 
        } 
    },
    loadProperties: async () => { 
        if (!State.ds.src || !State.ds.kind) return; 
        try { 
            (State.ds as any).properties = await Api.getProperties(State.ds.src, State.ds.kind, State.ds.srcDb); 
            UI.initDropdowns(); 
            Utils.toast("Properties loaded", "ok"); 
        } catch (e: any) { 
            const { ErrorBoundary } = await import('./utils');
            await ErrorBoundary.handle(e, 'UI.loadProperties');
            (State.ds as any).properties = []; 
        } 
    },
    addDsFilter: () => {
        const c = Utils.$('ds-filters-container'); 
        if (!c) return;
        const tmpl = Utils.$('template-ds-filter-row') as HTMLTemplateElement;
        if (!tmpl) return;
        const fragment = tmpl.content.cloneNode(true) as DocumentFragment;

        const select = fragment.querySelector('.filter-prop') as HTMLSelectElement;
        if (select) {
            const properties = (State.ds as any).properties || [];
            const props = ['__key__', ...properties.filter((p: string) => p !== '__key__')];
            select.innerHTML = props.map(p => {
                const display = p === '__key__' ? '__key__ (ID / Name)' : p;
                return `<option value="${p}">${display}</option>`;
            }).join('');
        }

        const removeBtn = fragment.querySelector('.btn-remove-filter') as HTMLButtonElement;
        if (removeBtn) {
            removeBtn.onclick = (e) => {
                const target = e.currentTarget as HTMLElement;
                target.closest('.filter-row')?.remove();
            };
        }

        c.appendChild(fragment);
    },
    openModal: (content: string | HTMLElement | DocumentFragment, isLarge = false) => { 
        const root = Utils.$('modal-root');
        if (!root) return;
        root.style.display = ''; 
        root.innerHTML = `<div class="modal-bg"><div class="card modal ${isLarge ? 'modal-large' : ''}" style="padding:0"></div></div>`; 
        
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
                        Utils.getHtml('header-right').innerHTML = `<span class="text-xs mono" style="color:var(--muted)">${Utils.escapeHtml(State.authEmail)}</span>`;
                    }
                    
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
    }
};
