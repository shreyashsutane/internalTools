const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

// Mock browser environment globals
class MockLocalStorage {
    constructor() {
        this.store = {};
    }
    getItem(key) {
        return this.store[key] !== undefined ? this.store[key] : null;
    }
    setItem(key, value) {
        this.store[key] = String(value);
    }
    removeItem(key) {
        delete this.store[key];
    }
    clear() {
        this.store = {};
    }
}

global.localStorage = new MockLocalStorage();
global.window = {
    addEventListener: () => {},
    AudioContext: class {
        constructor() {
            this.state = 'running';
            this.currentTime = 0;
            this.destination = {};
        }
        createOscillator() {
            return {
                type: 'sine',
                frequency: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, linearRampToValueAtTime: () => {} },
                connect: () => {},
                start: () => {},
                stop: () => {}
            };
        }
        createGain() {
            return {
                gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
                connect: () => {}
            };
        }
        resume() {}
    }
};
global.document = {
    addEventListener: () => {},
    querySelectorAll: () => []
};

const entry = path.join(__dirname, '..', 'datastore-copier', 'src', 'sound.ts');
const build = buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    tsconfig: path.join(__dirname, '..', 'tsconfig.json'),
    write: false
});
const compiled = new Module(entry, module);
compiled.filename = entry;
compiled.paths = module.paths;
compiled._compile(build.outputFiles[0].text, entry);

const { SoundFX } = compiled.exports;

test('SoundFX is unmuted by default when localStorage is empty', () => {
    global.localStorage.clear();
    assert.equal(SoundFX.isMuted(), false);
    assert.equal(SoundFX.isEnabled(), true);
});

test('SoundFX.setMuted updates localStorage and isMuted/isEnabled state', () => {
    global.localStorage.clear();
    SoundFX.setMuted(true);
    assert.equal(global.localStorage.getItem('audio_muted'), 'true');
    assert.equal(SoundFX.isMuted(), true);
    assert.equal(SoundFX.isEnabled(), false);

    SoundFX.setMuted(false);
    assert.equal(global.localStorage.getItem('audio_muted'), 'false');
    assert.equal(SoundFX.isMuted(), false);
    assert.equal(SoundFX.isEnabled(), true);
});

test('SoundFX.toggleMute flips mute state and persists', () => {
    global.localStorage.clear();
    assert.equal(SoundFX.isMuted(), false);

    const muted = SoundFX.toggleMute();
    assert.equal(muted, true);
    assert.equal(SoundFX.isMuted(), true);
    assert.equal(global.localStorage.getItem('audio_muted'), 'true');

    const unmuted = SoundFX.toggleMute();
    assert.equal(unmuted, false);
    assert.equal(SoundFX.isMuted(), false);
    assert.equal(global.localStorage.getItem('audio_muted'), 'false');
});

test('SoundFX.setEnabled maintains backward compatibility with setMuted', () => {
    global.localStorage.clear();
    SoundFX.setEnabled(false);
    assert.equal(SoundFX.isMuted(), true);
    assert.equal(SoundFX.isEnabled(), false);

    SoundFX.setEnabled(true);
    assert.equal(SoundFX.isMuted(), false);
    assert.equal(SoundFX.isEnabled(), true);
});

test('SoundFX playback methods execute safely without errors when muted', () => {
    global.localStorage.clear();
    SoundFX.setMuted(true);

    assert.doesNotThrow(() => SoundFX.playPop());
    assert.doesNotThrow(() => SoundFX.playChime());
    assert.doesNotThrow(() => SoundFX.playGrumpy());
});
