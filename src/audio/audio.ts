/**
 * Procedural sound. Every effect is synthesised at runtime with oscillators and
 * noise buffers, so the game still ships with no audio assets — the same rule
 * the geometry follows.
 *
 * Browsers refuse to start audio before a user gesture, so the context is
 * created lazily and resumed from the first click or keypress.
 */

import { MusicEngine } from './music';

export type SoundName =
  | 'click'
  | 'deny'
  | 'build'
  | 'merge'
  | 'sell'
  | 'shoot'
  | 'mortar'
  | 'explode'
  | 'freeze'
  | 'zap'
  | 'spray'
  | 'pop'
  | 'hit'
  | 'wave'
  | 'boss'
  | 'win'
  | 'lose';

/**
 * Minimum gap between two plays of the same effect, in seconds. With a full
 * board dozens of towers fire in the same frame; without this the mix turns
 * into a click storm and the audio graph fills up with dead voices.
 */
const THROTTLE: Record<SoundName, number> = {
  click: 0.04,
  deny: 0.12,
  build: 0.05,
  merge: 0.1,
  sell: 0.08,
  shoot: 0.055,
  mortar: 0.08,
  explode: 0.07,
  freeze: 0.09,
  zap: 0.085,
  spray: 0.1,
  pop: 0.05,
  hit: 0.18,
  wave: 0.4,
  boss: 0.6,
  win: 1,
  lose: 1,
};

/** Hard ceiling on simultaneous voices, as a cheap guard against runaway stacks. */
const MAX_VOICES = 28;

/** Options shared by both kinds of voice. */
interface VoiceBase {
  /** Optional glide target, reached over the life of the voice. */
  to?: number;
  dur: number;
  gain: number;
  attack?: number;
  delay?: number;
  /** Filter cutoff at the start of the voice. */
  filter?: number;
  detune?: number;
}

interface ToneVoice extends VoiceBase {
  noise?: false;
  freq: number;
  type?: OscillatorType;
}

interface NoiseVoice extends VoiceBase {
  noise: true;
  filterType?: BiquadFilterType;
  q?: number;
}

type Voice = ToneVoice | NoiseVoice;

export class AudioEngine {
  /** Background music, fed from the same context so mute covers it too. */
  readonly music = new MusicEngine();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private lastPlayed = new Map<SoundName, number>();
  private voices = 0;
  private _enabled = true;
  private _volume = 0.7;

  /**
   * Called whenever the context starts or stops. Browsers flip state
   * asynchronously, so UI that depends on "can I make noise right now" has to
   * react to this rather than poll after a click.
   */
  onStateChange: (() => void) | null = null;

  get enabled(): boolean {
    return this._enabled;
  }

  get volume(): number {
    return this._volume;
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /**
   * True when the browser is refusing to let us make noise, which is the default
   * until the page has been interacted with. Surfaced in the UI so silence is
   * never a mystery.
   */
  get blocked(): boolean {
    return this.ctx !== null && this.ctx.state !== 'running';
  }

  /** Safe to call on every gesture; only the first one does any work. */
  unlock(): void {
    if (!this.ctx) this.create();
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
    // Music can only start once the context is actually running.
    if (this.ctx && this.ctx.state === 'running') {
      this.music.start(this.ctx, this.master ?? this.ctx.destination);
    }
  }

  /**
   * Try to start at page load. Browsers block audio until a user gesture, so
   * this usually lands in `suspended` — but it costs nothing and succeeds
   * outright wherever autoplay is permitted (site already interacted with,
   * user has the setting off, or the embedder allows it). Attempted once, so
   * the console only ever sees a single blocked-autoplay notice.
   */
  start(): void {
    if (this.ctx) return;
    this.create();
    const ctx = this.ctx as AudioContext | null;
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    // Where autoplay is permitted the music can begin immediately.
    if (ctx.state === 'running') this.music.start(ctx, this.master ?? ctx.destination);
  }

  private create(): void {
    if (this.ctx) return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      this.ctx = null;
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this._enabled ? this._volume : 0;
    this.master.connect(this.ctx.destination);
    this.noiseBuffer = this.makeNoise(this.ctx);
    this.ctx.addEventListener('statechange', () => this.onStateChange?.());
  }

  setEnabled(on: boolean): void {
    this._enabled = on;
    this.music.muted = !on;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(on ? this._volume : 0, this.ctx.currentTime, 0.02);
    }
  }

  toggle(): boolean {
    this.setEnabled(!this._enabled);
    return this._enabled;
  }

  setVolume(value: number): void {
    this._volume = Math.max(0, Math.min(1, value));
    if (this.master && this.ctx && this._enabled) {
      this.master.gain.setTargetAtTime(this._volume, this.ctx.currentTime, 0.02);
    }
  }

  play(name: SoundName, pitch = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this._enabled || ctx.state !== 'running') return;

    const now = ctx.currentTime;
    const last = this.lastPlayed.get(name) ?? -1;
    if (now - last < THROTTLE[name]) return;
    if (this.voices >= MAX_VOICES) return;
    this.lastPlayed.set(name, now);

    const spec = RECIPES[name];
    for (const voice of spec) {
      if (voice.noise) this.voiceNoise(ctx, voice, pitch);
      else this.voiceTone(ctx, voice, pitch);
    }
  }

  // ------------------------------------------------------------- primitives

  private voiceTone(ctx: AudioContext, spec: ToneVoice, pitch: number): void {
    const start = ctx.currentTime + (spec.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = spec.type ?? 'sine';
    osc.frequency.setValueAtTime(spec.freq * pitch, start);
    if (spec.to !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(1, spec.to * pitch),
        start + spec.dur,
      );
    }
    if (spec.detune) osc.detune.setValueAtTime(spec.detune, start);

    const gain = ctx.createGain();
    const peak = Math.max(0.0001, spec.gain);
    const attack = spec.attack ?? 0.006;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(peak, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + spec.dur);

    let tail: AudioNode = gain;
    if (spec.filter) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(spec.filter, start);
      gain.connect(lp);
      tail = lp;
    }

    osc.connect(gain);
    tail.connect(this.master!);
    this.track(start + spec.dur, () => {
      osc.disconnect();
      gain.disconnect();
    });
    osc.start(start);
    osc.stop(start + spec.dur + 0.02);
  }

  private voiceNoise(ctx: AudioContext, spec: NoiseVoice, pitch: number): void {
    if (!this.noiseBuffer) return;
    const start = ctx.currentTime + (spec.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = pitch;
    // Random offset so repeated hits do not sound like the same sample.
    const offset = Math.random() * (this.noiseBuffer.duration - spec.dur - 0.01);

    const filter = ctx.createBiquadFilter();
    filter.type = spec.filterType ?? 'bandpass';
    filter.frequency.setValueAtTime(spec.filter ?? 1200, start);
    filter.Q.value = spec.q ?? 1;
    if (spec.to !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(40, spec.to * pitch),
        start + spec.dur,
      );
    }

    const gain = ctx.createGain();
    const peak = Math.max(0.0001, spec.gain);
    const attack = spec.attack ?? 0.004;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(peak, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + spec.dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master!);
    this.track(start + spec.dur, () => {
      src.disconnect();
      filter.disconnect();
      gain.disconnect();
    });
    src.start(start, Math.max(0, offset));
    src.stop(start + spec.dur + 0.02);
  }

  /** Count a voice as active until it finishes, then release it. */
  private track(until: number, dispose: () => void): void {
    this.voices++;
    const ms = Math.max(0, (until - this.ctx!.currentTime) * 1000) + 40;
    window.setTimeout(() => {
      this.voices = Math.max(0, this.voices - 1);
      dispose();
    }, ms);
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 1.2);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
}

// ---------------------------------------------------------------- recipes

const RECIPES: Record<SoundName, Voice[]> = {
  // UI
  click: [{ freq: 900, to: 720, type: 'square', dur: 0.05, gain: 0.07 }],
  deny: [
    { freq: 190, type: 'square', dur: 0.07, gain: 0.1 },
    { freq: 150, type: 'square', dur: 0.09, gain: 0.1, delay: 0.09 },
  ],

  // Construction: a plastic brick snapping onto studs.
  build: [
    { noise: true, filter: 1700, to: 700, q: 1.2, dur: 0.09, gain: 0.24 },
    { freq: 190, to: 110, type: 'triangle', dur: 0.11, gain: 0.2 },
  ],
  merge: [
    { freq: 520, to: 700, type: 'triangle', dur: 0.14, gain: 0.15 },
    { freq: 700, to: 940, type: 'triangle', dur: 0.16, gain: 0.14, delay: 0.1 },
    { noise: true, filter: 2600, to: 1200, q: 2, dur: 0.12, gain: 0.14, delay: 0.18 },
  ],
  sell: [
    { freq: 1250, type: 'square', dur: 0.05, gain: 0.09 },
    { freq: 940, type: 'square', dur: 0.09, gain: 0.09, delay: 0.05 },
    { freq: 1750, to: 1100, type: 'triangle', dur: 0.12, gain: 0.07, delay: 0.1 },
  ],

  // Weapons — pitched per tower so a mixed board still reads as distinct.
  shoot: [
    { freq: 760, to: 480, type: 'square', dur: 0.06, gain: 0.06 },
    { noise: true, filter: 2400, to: 900, q: 0.8, dur: 0.05, gain: 0.05 },
  ],
  mortar: [
    { freq: 150, to: 62, type: 'sine', dur: 0.16, gain: 0.2 },
    { noise: true, filter: 900, to: 200, q: 0.7, dur: 0.12, gain: 0.13 },
  ],
  explode: [
    { noise: true, filterType: 'lowpass', filter: 2600, to: 180, dur: 0.3, gain: 0.3 },
    { freq: 110, to: 44, type: 'sine', dur: 0.28, gain: 0.22 },
  ],
  freeze: [
    { freq: 1250, to: 2000, type: 'triangle', dur: 0.2, gain: 0.11 },
    { freq: 1900, to: 1500, type: 'triangle', dur: 0.18, gain: 0.06, detune: 12, delay: 0.03 },
    { noise: true, filter: 5200, to: 3000, q: 3, dur: 0.16, gain: 0.07 },
  ],
  zap: [
    { freq: 96, to: 58, type: 'sawtooth', dur: 0.13, gain: 0.13 },
    { noise: true, filter: 3000, to: 1100, q: 1.6, dur: 0.12, gain: 0.11 },
  ],
  spray: [
    { noise: true, filter: 820, to: 1500, q: 2.2, dur: 0.19, gain: 0.1 },
    { freq: 300, to: 480, type: 'sine', dur: 0.16, gain: 0.05 },
  ],

  // Feedback
  pop: [
    { noise: true, filter: 1500, to: 420, q: 1.1, dur: 0.11, gain: 0.17 },
    { freq: 320, to: 130, type: 'triangle', dur: 0.1, gain: 0.12 },
  ],
  hit: [
    { freq: 210, to: 82, type: 'sawtooth', dur: 0.42, gain: 0.3 },
    { noise: true, filterType: 'lowpass', filter: 1400, to: 160, dur: 0.36, gain: 0.22 },
    { freq: 330, to: 300, type: 'square', dur: 0.16, gain: 0.1, delay: 0.16 },
    { freq: 250, to: 230, type: 'square', dur: 0.16, gain: 0.1, delay: 0.34 },
  ],

  // Pacing
  wave: [
    { freq: 175, to: 262, type: 'sawtooth', dur: 0.5, gain: 0.17, filter: 1200 },
    { freq: 262, to: 350, type: 'sawtooth', dur: 0.42, gain: 0.12, filter: 1200, delay: 0.22 },
  ],
  boss: [
    { freq: 110, to: 82, type: 'sawtooth', dur: 0.95, gain: 0.24, filter: 800 },
    { freq: 165, to: 123, type: 'sawtooth', dur: 0.85, gain: 0.15, filter: 900, delay: 0.1 },
    { freq: 1100, to: 820, type: 'square', dur: 0.5, gain: 0.08, delay: 0.5 },
    { noise: true, filterType: 'lowpass', filter: 700, to: 120, dur: 0.9, gain: 0.16, delay: 0.1 },
  ],

  // Outcomes
  win: [
    { freq: 523, type: 'triangle', dur: 0.16, gain: 0.17 },
    { freq: 659, type: 'triangle', dur: 0.16, gain: 0.17, delay: 0.13 },
    { freq: 784, type: 'triangle', dur: 0.16, gain: 0.17, delay: 0.26 },
    { freq: 1047, to: 1047, type: 'triangle', dur: 0.7, gain: 0.2, delay: 0.39 },
  ],
  lose: [
    { freq: 392, to: 330, type: 'sawtooth', dur: 0.32, gain: 0.16, filter: 900 },
    { freq: 311, to: 262, type: 'sawtooth', dur: 0.34, gain: 0.16, filter: 800, delay: 0.28 },
    { freq: 233, to: 155, type: 'sawtooth', dur: 0.8, gain: 0.18, filter: 700, delay: 0.56 },
  ],
};

export const audio = new AudioEngine();