/**
 * Web Audio API Sound Effects Engine
 * Pure synthesized, zero-asset audio chimes, pops, and mascot sound cues.
 */

export class SoundFX {
    private static ctx: AudioContext | null = null;
    private static initialized: boolean = false;

    public static isMuted(): boolean {
        try {
            return typeof localStorage !== 'undefined' && localStorage.getItem('audio_muted') === 'true';
        } catch {
            return false;
        }
    }

    public static isEnabled(): boolean {
        return !SoundFX.isMuted();
    }

    public static setEnabled(val: boolean): void {
        SoundFX.setMuted(!val);
    }

    public static setMuted(muted: boolean): void {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem('audio_muted', muted ? 'true' : 'false');
            }
        } catch {}
        SoundFX.updateUI();
    }

    public static toggleMute(): boolean {
        const nextMuted = !SoundFX.isMuted();
        SoundFX.setMuted(nextMuted);
        return nextMuted;
    }

    public static init(): void {
        if (SoundFX.initialized) return;
        SoundFX.initialized = true;

        SoundFX.updateUI();

        if (typeof document !== 'undefined') {
            document.addEventListener('click', (e) => {
                const target = (e.target as HTMLElement)?.closest('#btn-mute-toggle, #muteToggle');
                if (target) {
                    e.preventDefault();
                    SoundFX.toggleMute();
                }
            });

            window.addEventListener('storage', (e: StorageEvent) => {
                if (e.key === 'audio_muted') {
                    SoundFX.updateUI();
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
                    SoundFX.toggleMute();
                }
            });
        }
    }

    public static updateUI(): void {
        if (typeof document === 'undefined') return;
        const isMuted = SoundFX.isMuted();
        const buttons = document.querySelectorAll<HTMLElement>('#btn-mute-toggle, #muteToggle');
        buttons.forEach(btn => {
            btn.title = isMuted ? 'Unmute Audio (Shortcut: M)' : 'Mute Audio (Shortcut: M)';
            btn.setAttribute('aria-label', btn.title);

            const icon = btn.querySelector('i');
            if (icon) {
                if (isMuted) {
                    icon.className = 'fa-solid fa-volume-xmark';
                    icon.style.color = 'var(--danger, #ff4d4f)';
                } else {
                    icon.className = 'fa-solid fa-volume-high';
                    icon.style.color = '';
                }
            } else {
                btn.textContent = isMuted ? '🔇' : '🔊';
            }
        });
    }

    private static getContext(): AudioContext | null {
        if (SoundFX.isMuted()) return null;
        if (!SoundFX.ctx) {
            const AudioCtx = typeof window !== 'undefined' ? (window.AudioContext || (window as any).webkitAudioContext) : null;
            if (AudioCtx) {
                SoundFX.ctx = new AudioCtx();
            }
        }
        if (SoundFX.ctx && SoundFX.ctx.state === 'suspended') {
            SoundFX.ctx.resume();
        }
        return SoundFX.ctx;
    }

    /**
     * Soft kawaii bubble pop on mascot click or input interaction
     */
    public static playPop(): void {
        const ctx = SoundFX.getContext();
        if (!ctx) return;
        try {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const now = ctx.currentTime;

            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, now);
            osc.frequency.exponentialRampToValueAtTime(320, now + 0.08);

            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now);
            osc.stop(now + 0.08);
        } catch {
            // Audio policy fallback
        }
    }

    /**
     * Joyful melodic chime on successful filter, verification, or happy state
     */
    public static playChime(): void {
        const ctx = SoundFX.getContext();
        if (!ctx) return;
        try {
            const now = ctx.currentTime;
            const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6 arpeggio

            notes.forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                const noteTime = now + (idx * 0.06);

                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, noteTime);

                gain.gain.setValueAtTime(0.09, noteTime);
                gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 0.28);

                osc.connect(gain);
                gain.connect(ctx.destination);

                osc.start(noteTime);
                osc.stop(noteTime + 0.28);
            });
        } catch {
            // Audio fallback
        }
    }

    /**
     * Low playful grumpy chirp for angry state
     */
    public static playGrumpy(): void {
        const ctx = SoundFX.getContext();
        if (!ctx) return;
        try {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const now = ctx.currentTime;

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(220, now);
            osc.frequency.linearRampToValueAtTime(140, now + 0.16);

            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now);
            osc.stop(now + 0.16);
        } catch {
            // Audio fallback
        }
    }
}
