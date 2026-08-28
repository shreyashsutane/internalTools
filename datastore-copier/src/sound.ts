/**
 * Web Audio API Sound Effects Engine
 * Pure synthesized, zero-asset audio chimes, pops, and mascot sound cues.
 */

export class SoundFX {
    private static ctx: AudioContext | null = null;
    private static enabled: boolean = true;

    private static getContext(): AudioContext | null {
        if (!SoundFX.enabled) return null;
        if (!SoundFX.ctx) {
            const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
            if (AudioCtx) {
                SoundFX.ctx = new AudioCtx();
            }
        }
        if (SoundFX.ctx && SoundFX.ctx.state === 'suspended') {
            SoundFX.ctx.resume();
        }
        return SoundFX.ctx;
    }

    public static isEnabled(): boolean {
        return SoundFX.enabled;
    }

    public static setEnabled(val: boolean): void {
        SoundFX.enabled = val;
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
