/**
 * Assist Mode UI & Mascot Renderer
 * Adaptive Magnetic Companion with Smart Evasion, Zero Latency & Left-Flank Filter Positioning.
 */

import { AssistManager, AssistStep, MascotState } from './assist';
import { Utils } from './utils';
import { SoundFX } from './sound';
import { D0198EasterEgg } from './easter-egg';

export const AssistUI = {
    private_typingTimer: null as any,
    private_renderRaf: null as any,

    init: () => {
        AssistManager.init();
        AssistUI.injectMascotContainer();
        AssistUI.bindGlobalKeyShortcuts();
        AssistUI.bindReactiveObservers();
        AssistUI.bindSmartEvasion();

        if (AssistManager.isActive()) {
            setTimeout(() => AssistUI.render(), 100);
        }
    },

    getMascotSvg: (state: MascotState = 'idle'): string => {
        const cheekFill = state === 'angry' ? '#ff5b67' : '#ff9cac';
        const cheekOpacity = state === 'happy' ? '0.72' : state === 'angry' ? '0.58' : '0.4';

        let eyesMarkup = `
            <g class="eyes">
                <ellipse class="eye" cx="78" cy="124" rx="10" ry="17" fill="#16172b" />
                <ellipse class="eye" cx="122" cy="124" rx="10" ry="17" fill="#16172b" />
                <circle cx="74" cy="118" r="3.5" fill="white" />
                <circle cx="118" cy="118" r="3.5" fill="white" />
                <circle cx="80" cy="133" r="2.5" fill="#665cff" />
                <circle cx="124" cy="133" r="2.5" fill="#665cff" />
            </g>
        `;
        if (state === 'happy') {
            eyesMarkup = `
                <g class="happy-eyes">
                    <path d="M68 126 Q78 116 88 126" fill="none" stroke="#16172b" stroke-width="5" stroke-linecap="round" />
                    <path d="M112 126 Q122 116 132 126" fill="none" stroke="#16172b" stroke-width="5" stroke-linecap="round" />
                </g>
            `;
        } else if (state === 'angry') {
            eyesMarkup = `
                <g class="angry-eyes">
                    <path d="M66 116 L89 124" fill="none" stroke="#32171b" stroke-width="5" stroke-linecap="round" />
                    <path d="M111 124 L134 116" fill="none" stroke="#32171b" stroke-width="5" stroke-linecap="round" />
                    <ellipse cx="78" cy="130" rx="8" ry="11" fill="#24151a" />
                    <ellipse cx="122" cy="130" rx="8" ry="11" fill="#24151a" />
                    <circle cx="76" cy="127" r="2.4" fill="#ff8a8a" />
                    <circle cx="120" cy="127" r="2.4" fill="#ff8a8a" />
                </g>
            `;
        }

        let mouthMarkup = `
            <g class="mouth">
                <path d="M89 145 Q100 155 111 145 Q110 165 100 166 Q90 164 89 145" fill="#4d1625" />
                <ellipse cx="100" cy="158" rx="7" ry="4" fill="#ff8193" />
            </g>
        `;
        if (state === 'happy') {
            mouthMarkup = `
                <g class="happy-mouth">
                    <path d="M84 145 Q100 170 116 145 Q114 172 100 174 Q86 171 84 145" fill="#54182b" />
                    <ellipse cx="100" cy="164" rx="9" ry="5" fill="#ff7f9d" />
                </g>
            `;
        } else if (state === 'angry') {
            mouthMarkup = `
                <g class="angry-mouth">
                    <path d="M88 164 Q100 150 112 164" fill="none" stroke="#5b1f27" stroke-width="5" stroke-linecap="round" />
                </g>
            `;
        }

        let overlays = '';
        if (state === 'thinking') {
            overlays = `
                <g class="thinking-dots">
                    <circle cx="147" cy="70" r="3" fill="#7066ff" />
                    <circle cx="157" cy="60" r="4" fill="#57dfff" />
                    <circle cx="169" cy="48" r="5" fill="#ab7aff" />
                </g>
            `;
        } else if (state === 'success') {
            overlays = `
                <g class="success-stars">
                    <text x="155" y="70" font-size="22">✨</text>
                </g>
            `;
        } else if (state === 'happy') {
            overlays = `
                <g class="happy-effects">
                    <text x="30" y="82" font-size="20">✨</text>
                    <text x="151" y="88" font-size="18">✨</text>
                    <text x="18" y="118" font-size="17">💖</text>
                    <text x="164" y="118" font-size="17">💖</text>
                </g>
            `;
        } else if (state === 'angry') {
            overlays = `
                <g class="angry-effects">
                    <text x="25" y="90" font-size="22">💢</text>
                    <text x="151" y="92" font-size="20">💢</text>
                </g>
            `;
        }

        return `
            <svg viewBox="0 0 200 220" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
                <defs>
                    <linearGradient id="astBodyGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stop-color="#ffffff" />
                        <stop offset="65%" stop-color="#fffaf4" />
                        <stop offset="100%" stop-color="#e9e8ff" />
                    </linearGradient>

                    <radialGradient id="astOrbGrad">
                        <stop offset="0%" stop-color="#7ffcff" />
                        <stop offset="35%" stop-color="#4f9cff" />
                        <stop offset="70%" stop-color="#725cff" />
                        <stop offset="100%" stop-color="#be82ff" />
                    </radialGradient>

                    <linearGradient id="astEarGrad">
                        <stop offset="0%" stop-color="#56e7ff" />
                        <stop offset="100%" stop-color="#8c5cff" />
                    </linearGradient>

                    <filter id="astOrbGlow" x="-100%" y="-100%" width="300%" height="300%">
                        <feGaussianBlur stdDeviation="5" result="blur" />
                        <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>

                    <filter id="astShadow">
                        <feDropShadow dx="0" dy="6" stdDeviation="6" flood-opacity="0.2" />
                    </filter>
                </defs>

                <!-- ORB & HALO -->
                <g class="mascot-orb">
                    <circle cx="100" cy="30" r="19" fill="url(#astOrbGrad)" filter="url(#astOrbGlow)" />
                    <circle cx="94" cy="24" r="4" fill="white" opacity="0.85" />
                    <ellipse class="orb-ring" cx="100" cy="30" rx="31" ry="8" fill="none" stroke="#70eaff" stroke-width="2" />
                </g>

                <rect x="96" y="48" width="8" height="18" rx="4" fill="#d4d1ff" />

                <!-- BODY -->
                <g class="mascot-body" filter="url(#astShadow)">
                    <path d="
                        M100 58
                        C58 58 35 85 35 126
                        C35 160 52 180 66 188
                        C74 205 87 199 94 195
                        C100 206 111 203 116 195
                        C128 203 140 197 142 187
                        C160 174 166 152 165 126
                        C165 84 141 58 100 58
                    " fill="url(#astBodyGrad)" />

                    <!-- EARS -->
                    <g>
                        <ellipse cx="39" cy="128" rx="10" ry="23" fill="#f4f2ff" />
                        <ellipse cx="39" cy="128" rx="5" ry="16" fill="url(#astEarGrad)" />
                    </g>
                    <g>
                        <ellipse cx="161" cy="128" rx="10" ry="23" fill="#f4f2ff" />
                        <ellipse cx="161" cy="128" rx="5" ry="16" fill="url(#astEarGrad)" />
                    </g>

                    ${eyesMarkup}

                    <!-- CHEEKS -->
                    <ellipse cx="61" cy="145" rx="11" ry="6" fill="${cheekFill}" opacity="${cheekOpacity}" />
                    <ellipse cx="139" cy="145" rx="11" ry="6" fill="${cheekFill}" opacity="${cheekOpacity}" />

                    ${mouthMarkup}
                </g>

                <!-- HANDS -->
                <g class="left-hand">
                    <circle cx="27" cy="150" r="14" fill="url(#astBodyGrad)" />
                    <circle cx="20" cy="143" r="7" fill="url(#astBodyGrad)" />
                </g>
                <g class="right-hand">
                    <circle cx="173" cy="150" r="14" fill="url(#astBodyGrad)" />
                    <circle cx="180" cy="143" r="7" fill="url(#astBodyGrad)" />
                </g>

                <!-- SHADOW -->
                <ellipse class="ground-shadow" cx="100" cy="207" rx="42" ry="7" fill="#35325d" opacity="0.16" />

                <!-- OVERLAYS -->
                ${overlays}
            </svg>
        `;
    },

    injectMascotContainer: () => {
        if (document.getElementById('assist-root')) return;

        const root = document.createElement('div');
        root.id = 'assist-root';
        root.innerHTML = `
            <!-- Floating Adaptive Magnetic Mascot Card -->
            <div id="assist-card-wrapper" class="assist-floating-card" style="display:none;">
                <div class="assist-mascot-box" id="assist-mascot-interactive-box" title="Single click: Happy ✨ | Double click: Angry 💢">
                    <div id="assist-mascot-svg" class="assist-mascot mascot-idle"></div>
                </div>
                <div class="assist-content-box">
                    <div class="assist-header">
                        <div class="assist-badge" id="assist-step-counter">LIVE ASSIST</div>
                        <div class="assist-tour-title" id="assist-tour-name">GCP Infrastructure Assistant</div>
                        <button id="btn-assist-close" class="assist-btn-close" title="Close Assist Mode (Esc)"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    <div class="assist-directive" id="assist-directive-text">Ready to guide you</div>
                    <div class="assist-explanation" id="assist-explanation-text">Follow highlighted instructions on screen.</div>
                </div>
                <div id="assist-pointer-arrow" class="assist-pointer-arrow"></div>
            </div>
        `;
        document.body.appendChild(root);

        // Bind Close Event
        const closeBtn = document.getElementById('btn-assist-close');
        if (closeBtn) closeBtn.onclick = () => AssistUI.toggle(false);

        // Mascot Rolling-Window Click Combo (1=Happy, 2=Angry, 3=Annoyed, 4=Warning, 5=Overheat Rage -> 10s Hacking)
        const mascotBox = document.getElementById('assist-mascot-interactive-box');
        if (mascotBox) {
            let clickTimestamps: number[] = [];

            mascotBox.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const now = Date.now();
                // Retain all clicks within a generous 3-second window
                clickTimestamps = clickTimestamps.filter(t => now - t < 3000);
                clickTimestamps.push(now);

                const count = clickTimestamps.length;

                if (count >= 5) {
                    // 💥 5 CLICKS REACHED!
                    clickTimestamps = [];

                    // 1. Mochi swells to 2.2x giant size with vibrating electrical rage
                    AssistManager.setTemporaryReaction('angry', '⚠️ CRITICAL OVERHEAT: Mochi has reached maximum rage! 💢⚡');
                    SoundFX.playGrumpy();
                    AssistUI.render();

                    const mascotEl = document.getElementById('assist-mascot-interactive-box');
                    if (mascotEl) {
                        mascotEl.classList.add('mochi-rage-overheat');
                    }

                    // 2. Dramatic 1.3-second rage swell, then launches the 10s hacking sequence
                    setTimeout(() => {
                        if (mascotEl) mascotEl.classList.remove('mochi-rage-overheat');
                        D0198EasterEgg.trigger();
                    }, 1300);
                    return;
                }

                if (count === 1) {
                    AssistManager.setTemporaryReaction('happy', '💖 Mochi is delighted to help you! ✨');
                    SoundFX.playPop();
                    AssistUI.render();
                } else if (count === 2) {
                    AssistManager.setTemporaryReaction('angry', '💢 Whoa! Double-click made Mochi grumpy! Ò_Ó');
                    SoundFX.playGrumpy();
                    AssistUI.render();
                } else if (count === 3) {
                    AssistManager.setTemporaryReaction('angry', '⚡ Mochi is getting agitated... (3/5 clicks) 💢');
                    SoundFX.playGrumpy();
                    AssistUI.render();
                } else if (count === 4) {
                    AssistManager.setTemporaryReaction('angry', '🔥 SYSTEM WARNING: Overheat imminent! (4/5 clicks) ⚠️');
                    SoundFX.playGrumpy();
                    AssistUI.render();
                }
            });
        }
    },

    bindSmartEvasion: () => {
        const card = document.getElementById('assist-card-wrapper');
        if (!card) return;

        // When mouse approaches card while dropdown or input is focused, apply glass ghost
        document.addEventListener('mousemove', (e: MouseEvent) => {
            if (!AssistManager.isActive() || card.style.display === 'none') return;

            const isInputActive = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT');
            const hasOpenDropdown = document.querySelector('.dropdown-menu.show, .dropdown-menu.active, #ds-filters-container') !== null;

            if (isInputActive || hasOpenDropdown) {
                const rect = card.getBoundingClientRect();
                const dist = Math.hypot(
                    e.clientX - (rect.left + rect.width / 2),
                    e.clientY - (rect.top + rect.height / 2)
                );

                if (dist < 140) {
                    card.classList.add('assist-ghost');
                } else {
                    card.classList.remove('assist-ghost');
                }
            } else {
                card.classList.remove('assist-ghost');
            }
        });
    },

    bindReactiveObservers: () => {
        const scheduleRender = () => {
            if (!AssistManager.isActive()) return;
            if (AssistUI.private_renderRaf) cancelAnimationFrame(AssistUI.private_renderRaf);
            AssistUI.private_renderRaf = requestAnimationFrame(() => {
                AssistUI.render();
            });
        };

        // Listen for user typing -> mini mode
        document.addEventListener('input', () => {
            const card = document.getElementById('assist-card-wrapper');
            if (card) card.classList.add('assist-mini-mode');

            if (AssistUI.private_typingTimer) clearTimeout(AssistUI.private_typingTimer);
            AssistUI.private_typingTimer = setTimeout(() => {
                if (card) card.classList.remove('assist-mini-mode');
                scheduleRender();
            }, 500);
        });

        // Instant Zero-Latency Observers
        document.addEventListener('focusin', scheduleRender);
        document.addEventListener('focusout', () => setTimeout(scheduleRender, 30));
        document.addEventListener('pointerdown', scheduleRender);
        document.addEventListener('change', scheduleRender);
        document.addEventListener('click', scheduleRender);

        window.addEventListener('resize', scheduleRender);
        window.addEventListener('scroll', scheduleRender, true);

        const observer = new MutationObserver(() => {
            scheduleRender();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class', 'display']
        });
    },

    toggle: (forceState?: boolean) => {
        const nextActive = forceState !== undefined ? forceState : !AssistManager.isActive();
        AssistManager.setActive(nextActive);

        const toggleBtn = document.getElementById('btn-toggle-assist');
        if (toggleBtn) {
            toggleBtn.classList.toggle('active', nextActive);
            toggleBtn.innerHTML = nextActive
                ? '<i class="fa-solid fa-wand-magic-sparkles text-cyan-400"></i> Assist: ON'
                : '<i class="fa-solid fa-wand-magic-sparkles"></i> Assist Mode';
        }

        if (nextActive) {
            AssistUI.render();
            Utils.toast('Adaptive Assist active! Mochi stays clear of all dropdowns ✨', 'ok');
        } else {
            AssistUI.clearSpotlights();
            const card = document.getElementById('assist-card-wrapper');
            if (card) card.style.display = 'none';
        }
    },

    render: () => {
        if (!AssistManager.isActive()) return;

        const card = document.getElementById('assist-card-wrapper');
        const step = AssistManager.getCurrentStep();
        if (!card || !step) return;

        // Update Mascot SVG & state
        const mascotSvg = document.getElementById('assist-mascot-svg');
        if (mascotSvg) {
            mascotSvg.className = `assist-mascot mascot-${step.mascotState}`;
            mascotSvg.innerHTML = AssistUI.getMascotSvg(step.mascotState);
        }

        // Update text
        const stepCounter = document.getElementById('assist-step-counter');
        if (stepCounter) stepCounter.textContent = step.title.toUpperCase();

        const tourName = document.getElementById('assist-tour-name');
        if (tourName) tourName.textContent = step.inModal ? 'Modal Assistant' : 'Smart Companion';

        const directive = document.getElementById('assist-directive-text');
        if (directive) directive.textContent = step.directive;

        const explanation = document.getElementById('assist-explanation-text');
        if (explanation) explanation.textContent = step.explanation;

        // Clear existing spotlights
        AssistUI.clearSpotlights();

        // Locate Target Element
        let targetEl: HTMLElement | null = null;
        const selectors = step.targetSelector.split(',').map(s => s.trim());
        for (const sel of selectors) {
            const el = document.querySelector(sel) as HTMLElement | null;
            if (el && el.offsetParent !== null && getComputedStyle(el).display !== 'none') {
                targetEl = el;
                break;
            }
        }

        const arrow = document.getElementById('assist-pointer-arrow');

        if (targetEl && targetEl.offsetParent !== null) {
            targetEl.classList.add('assist-target-pulse');

            const rect = targetEl.getBoundingClientRect();
            card.style.display = 'flex';
            card.style.position = 'fixed';
            card.style.zIndex = step.inModal ? '100001' : '9999';

            const cardWidth = 360;
            const cardHeight = 150;

            const isFilterProp = targetEl.classList.contains('filter-prop');
            const isFilterControl = targetEl.classList.contains('filter-op') ||
                                    targetEl.classList.contains('filter-type') ||
                                    targetEl.classList.contains('filter-val');

            let top = rect.top;
            let left = rect.left;
            let arrowClass = 'assist-pointer-arrow arrow-top';

            if (step.inModal) {
                // IN-MODAL GUIDANCE: Dock neatly to the top-right corner of the modal
                const modalBox = targetEl.closest('.modal') || targetEl;
                const mRect = modalBox.getBoundingClientRect();
                top = Math.max(16, mRect.top + 16);
                left = Math.max(16, mRect.right - cardWidth - 24);
                if (arrow) arrow.style.display = 'none';
            } else if (isFilterProp) {
                // FILTER COLUMN SELECTOR: Always anchor to LEFT FLANK so entire operator & value controls remain 100% visible!
                const leftFlankLeft = rect.left - cardWidth - 18;
                if (leftFlankLeft > 16) {
                    left = leftFlankLeft;
                    top = Math.max(16, Math.min(window.innerHeight - cardHeight - 16, rect.top + (rect.height / 2) - 45));
                    arrowClass = 'assist-pointer-arrow arrow-right';
                } else {
                    // Above filter row
                    top = Math.max(16, rect.top - cardHeight - 14);
                    left = Math.max(16, Math.min(window.innerWidth - cardWidth - 16, rect.left));
                    arrowClass = 'assist-pointer-arrow arrow-bottom';
                }
            } else if (isFilterControl) {
                // FILTER OPERATOR / VALUE / TYPE: Always place ABOVE filter row to never block horizontal inputs!
                top = Math.max(16, rect.top - cardHeight - 14);
                left = Math.max(16, Math.min(window.innerWidth - cardWidth - 16, rect.left + (rect.width / 2) - (cardWidth / 2)));
                arrowClass = 'assist-pointer-arrow arrow-bottom';
            } else if (targetEl.tagName === 'INPUT' || targetEl.tagName === 'SELECT' || targetEl.id.startsWith('ds-') || targetEl.id.startsWith('bq-') || targetEl.classList.contains('inp')) {
                // STANDARD DROPDOWNS & PROJECT SELECTORS: Right Flank (or Left Flank)
                const rightFlankLeft = rect.right + 18;
                const leftFlankLeft = rect.left - cardWidth - 18;

                if (rightFlankLeft + cardWidth < window.innerWidth - 16) {
                    left = rightFlankLeft;
                    top = Math.max(16, Math.min(window.innerHeight - cardHeight - 16, rect.top + (rect.height / 2) - 45));
                    arrowClass = 'assist-pointer-arrow arrow-left';
                } else if (leftFlankLeft > 16) {
                    left = leftFlankLeft;
                    top = Math.max(16, Math.min(window.innerHeight - cardHeight - 16, rect.top + (rect.height / 2) - 45));
                    arrowClass = 'assist-pointer-arrow arrow-right';
                } else {
                    top = Math.max(16, rect.top - cardHeight - 14);
                    left = Math.max(16, Math.min(window.innerWidth - cardWidth - 16, rect.left + (rect.width / 2) - (cardWidth / 2)));
                    arrowClass = 'assist-pointer-arrow arrow-bottom';
                }
            } else {
                // Standard Action Buttons
                top = rect.bottom + 14;
                left = Math.max(16, Math.min(window.innerWidth - cardWidth - 16, rect.left + (rect.width / 2) - (cardWidth / 2)));

                if (top + cardHeight > window.innerHeight - 20) {
                    top = Math.max(16, rect.top - cardHeight - 14);
                    arrowClass = 'assist-pointer-arrow arrow-bottom';
                } else {
                    arrowClass = 'assist-pointer-arrow arrow-top';
                }
            }

            if (arrow) {
                arrow.style.display = 'block';
                arrow.className = arrowClass;
            }

            card.style.top = `${top}px`;
            card.style.left = `${left}px`;
            card.style.bottom = 'auto';
            card.style.right = 'auto';
        } else {
            // Target not found or off-screen -> dock unobtrusively to bottom right
            card.style.display = 'flex';
            card.style.position = 'fixed';
            card.style.bottom = '24px';
            card.style.right = '24px';
            card.style.top = 'auto';
            card.style.left = 'auto';
            card.style.zIndex = '9999';
            if (arrow) arrow.style.display = 'none';
        }
    },

    clearSpotlights: () => {
        document.querySelectorAll('.assist-target-pulse').forEach(el => {
            el.classList.remove('assist-target-pulse');
        });
    },

    bindGlobalKeyShortcuts: () => {
        window.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === '?' || (e.key === 'F1' && !e.ctrlKey)) {
                e.preventDefault();
                AssistUI.toggle();
            } else if (e.key === 'Escape') {
                if (AssistManager.isActive()) {
                    AssistUI.toggle(false);
                }
            }
        });
    }
};
