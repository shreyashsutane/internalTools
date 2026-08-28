/**
 * D-0198 Easter Egg Controller for GCP Infrastructure Manager
 * Global keyboard secret trigger: Typing "d0198", "d-0198", or "shreyash" anywhere on any screen.
 */

export class D0198EasterEgg {
    private static isRunning = false;
    private static buffer = '';
    private static maxBufferLength = 20;
    private static audioCtx: AudioContext | null = null;
    private static timers: number[] = [];

    public static init(): void {
        window.addEventListener('keydown', (e: KeyboardEvent) => {
            // If already running, allow Escape to close immediately
            if (this.isRunning) {
                if (e.key === 'Escape') {
                    this.close();
                }
                return;
            }

            // If user pressed Enter in an input field, check value
            const target = e.target as HTMLElement | null;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
                if (e.key === 'Enter') {
                    const val = (target as HTMLInputElement).value.trim().toLowerCase();
                    if (val === 'd0198' || val === 'd-0198' || val === 'shreyash') {
                        e.preventDefault();
                        this.trigger();
                    }
                }
                return;
            }

            // Global letter typing buffer (outside of inputs)
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                this.buffer += e.key.toLowerCase();
                if (this.buffer.length > this.maxBufferLength) {
                    this.buffer = this.buffer.slice(-this.maxBufferLength);
                }

                if (
                    this.buffer.endsWith('d0198') ||
                    this.buffer.endsWith('d-0198') ||
                    this.buffer.endsWith('shreyash')
                ) {
                    this.buffer = '';
                    this.trigger();
                }
            }
        });
    }

    private static getAudioCtx(): AudioContext | null {
        try {
            if (!this.audioCtx) {
                const AudioClass = window.AudioContext || (window as any).webkitAudioContext;
                if (AudioClass) {
                    this.audioCtx = new AudioClass();
                }
            }
            if (this.audioCtx && this.audioCtx.state === 'suspended') {
                this.audioCtx.resume();
            }
            return this.audioCtx;
        } catch {
            return null;
        }
    }

    private static playGlitchAudio(durationMs: number): void {
        const ctx = this.getAudioCtx();
        if (!ctx) return;
        try {
            const now = ctx.currentTime;
            const dur = durationMs / 1000;

            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(100, now);
            osc.frequency.linearRampToValueAtTime(50, now + dur);

            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now);
            osc.stop(now + dur);

            const numBeeps = Math.floor(durationMs / 600);
            for (let i = 0; i < numBeeps; i++) {
                const beepTime = now + (i * 0.6) + (Math.random() * 0.2);
                const bOsc = ctx.createOscillator();
                const bGain = ctx.createGain();
                bOsc.type = 'square';
                bOsc.frequency.setValueAtTime(220 + Math.random() * 380, beepTime);
                bGain.gain.setValueAtTime(0.05, beepTime);
                bGain.gain.exponentialRampToValueAtTime(0.0001, beepTime + 0.12);
                bOsc.connect(bGain);
                bGain.connect(ctx.destination);
                bOsc.start(beepTime);
                bOsc.stop(beepTime + 0.12);
            }
        } catch {}
    }

    private static playChimeAudio(): void {
        const ctx = this.getAudioCtx();
        if (!ctx) return;
        try {
            const now = ctx.currentTime;
            const freqs = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
            freqs.forEach((f, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                const t = now + (i * 0.08);

                osc.type = 'triangle';
                osc.frequency.setValueAtTime(f, t);

                gain.gain.setValueAtTime(0.12, t);
                gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);

                osc.connect(gain);
                gain.connect(ctx.destination);

                osc.start(t);
                osc.stop(t + 0.45);
            });
        } catch {}
    }

    public static trigger(horrorMs = 10000, revealMs = 3800): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.clearTimers();

        // Create overlay container
        const overlay = document.createElement('div');
        overlay.id = 'd0198-easter-egg-overlay';
        overlay.className = 'shreyash-easter-egg phase-horror';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');

        overlay.innerHTML = `
            <div class="ee-noise" aria-hidden="true"></div>
            <div class="ee-scanlines" aria-hidden="true"></div>

            <div id="ee-stage-horror" class="horror-stage">
                <div class="horror-vignette" aria-hidden="true"></div>
                <div class="horror-eyes" aria-hidden="true"><span></span><span></span></div>
                <div class="horror-copy">
                    <div class="terminal-fragments" aria-hidden="true">
                        <span>CRITICAL_SYSTEM_FAIL</span>
                        <span>MEM_CORRUPT_0x8F9</span>
                        <span>REMOTE_DUMP_ACTIVE</span>
                        <span>ROOT_ACCESS_EXPOSED</span>
                    </div>
                    <h1 class="hack-title" data-text="YOUR PC HAS BEEN HACKED">
                        YOUR PC HAS BEEN HACKED
                    </h1>
                </div>
            </div>

            <div id="ee-stage-reveal" class="reveal-stage" style="display:none;">
                <div class="reveal-spark spark-one" aria-hidden="true">✦</div>
                <div class="reveal-spark spark-two" aria-hidden="true">✧</div>
                <div class="reveal-spark spark-three" aria-hidden="true">✦</div>

                <div class="reveal-card">
                    <div class="mascot-orb" aria-hidden="true">
                        <div class="orb-face">
                            <span class="orb-eye left"></span>
                            <span class="orb-eye right"></span>
                            <span class="orb-smile"></span>
                        </div>
                    </div>

                    <div class="kidding-row">
                        <span class="kidding-star">✦</span>
                        <span>JUST KIDDING</span>
                        <span class="kidding-star">✦</span>
                    </div>

                    <div class="prompted-label">Prompted by</div>
                    <div class="creator-name">
                        D-0198
                        <span class="creator-underline" aria-hidden="true"></span>
                        <span class="creator-spark" aria-hidden="true">✦</span>
                    </div>

                    <div class="help-line">with help from</div>
                    <div class="credits">
                        <span>Antigravity 2.0</span>
                        <span class="credit-x">×</span>
                        <span>GPT-5.6 Sol</span>
                    </div>

                    <div style="margin-top: 28px;">
                        <button id="btn-close-ee" class="btn btn-s" style="padding: 8px 24px; font-size: 13px; font-weight: 600; border-radius: 999px; cursor: pointer;">
                            <i class="fa-solid fa-arrow-left"></i> Return Now (Esc)
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // Bind close button
        const closeBtn = overlay.querySelector('#btn-close-ee');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }

        // Start Glitch Audio for 10 seconds
        this.playGlitchAudio(horrorMs);

        // Phase 2: CRT Off after horrorMs (10 seconds)
        const t1 = window.setTimeout(() => {
            overlay.className = 'shreyash-easter-egg phase-crt';

            // Phase 3: Reveal
            const t2 = window.setTimeout(() => {
                overlay.className = 'shreyash-easter-egg phase-reveal';
                const stageHorror = overlay.querySelector('#ee-stage-horror') as HTMLElement | null;
                const stageReveal = overlay.querySelector('#ee-stage-reveal') as HTMLElement | null;
                if (stageHorror) stageHorror.style.display = 'none';
                if (stageReveal) {
                    stageReveal.style.display = 'grid';
                    stageReveal.classList.remove('reveal-stage-anim');
                    void stageReveal.offsetWidth;
                    stageReveal.classList.add('reveal-stage-anim');
                }
                this.playChimeAudio();

                // Phase 4: Automatically fade out and return to previous screen
                const t3 = window.setTimeout(() => {
                    overlay.style.transition = 'opacity 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
                    overlay.style.opacity = '0';
                    const t4 = window.setTimeout(() => {
                        this.close();
                    }, 600);
                    this.timers.push(t4);
                }, revealMs);

                this.timers.push(t3);
            }, 280);

            this.timers.push(t2);
        }, horrorMs);

        this.timers.push(t1);
    }

    public static close(): void {
        this.clearTimers();
        const overlay = document.getElementById('d0198-easter-egg-overlay');
        if (overlay) {
            overlay.remove();
        }
        this.isRunning = false;
    }

    private static clearTimers(): void {
        this.timers.forEach(t => clearTimeout(t));
        this.timers = [];
    }
}
