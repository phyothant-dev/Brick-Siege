/**
 * Procedural background music.
 *
 * No audio files: everything is synthesised with oscillators scheduled a short
 * distance ahead of the clock, so the loop never drifts. Each mood is a chord
 * progression, a bass line and an arpeggio over the top.
 *
 * Mute and volume are owned by AudioEngine's master bus, so this only has to
 * feed into the same context and stay out of the way of sound effects.
 */

export type MusicMood = 'menu' | 'building' | 'battle' | 'boss' | 'victory' | 'defeat';

/** Semitones above the root for each chord tone. */
type Chord = number[];

interface Mood {
  /** Chord progression, one entry per bar. */
  progression: Chord[];
  /** Seconds per beat. */
  beat: number;
  /** Steps per bar (8th notes = 8). */
  steps: number;
  /** Peak gain for the arpeggio voice. */
  arp: number;
  /** Peak gain for the bass voice. */
  bass: number;
  /** Peak gain for the sustained pad. */
  pad: number;
  /** Note length as a fraction of one step. */
  arpLength: number;
  /** Root note as a MIDI number. */
  root: number;
}

const MINOR: Chord = [0, 3, 7, 10, 12];

/**
 * Progressions chosen to feel like a toy-box at night rather than a boss fight:
 * i - VI - III - VII in A minor for the calm moods, with a tritone push on the
 * darker ones.
 */
const MOODS: Record<MusicMood, Mood> = {
  menu: {
    progression: [MINOR, [8, 12, 15, 19], [3, 7, 10, 15], [10, 14, 17, 22]],
    beat: 0.62,
    steps: 8,
    arp: 0.1,
    bass: 0.13,
    pad: 0.055,
    arpLength: 0.85,
    root: 45,
  },
  building: {
    progression: [MINOR, [8, 12, 15, 19], [3, 7, 10, 15], [10, 14, 17, 22]],
    beat: 0.55,
    steps: 8,
    arp: 0.12,
    bass: 0.15,
    pad: 0.05,
    arpLength: 0.7,
    root: 45,
  },
  battle: {
    progression: [MINOR, [8, 12, 15, 20], [3, 7, 10, 14], [10, 14, 18, 22]],
    beat: 0.42,
    steps: 8,
    arp: 0.11,
    bass: 0.2,
    pad: 0.04,
    arpLength: 0.42,
    root: 45,
  },
  boss: {
    progression: [MINOR, [6, 10, 13, 18], [1, 5, 8, 13], [10, 14, 17, 21]],
    beat: 0.38,
    steps: 8,
    arp: 0.1,
    bass: 0.24,
    pad: 0.05,
    arpLength: 0.32,
    root: 43,
  },
  victory: {
    progression: [[0, 4, 7, 12], [5, 9, 12, 17], [7, 11, 14, 19], [0, 4, 7, 12]],
    beat: 0.5,
    steps: 8,
    arp: 0.13,
    bass: 0.14,
    pad: 0.07,
    arpLength: 0.9,
    root: 48,
  },
  defeat: {
    progression: [[0, 3, 7, 10], [-2, 2, 5, 10], [-4, 0, 3, 8], [-5, -1, 2, 7]],
    beat: 0.75,
    steps: 8,
    arp: 0.08,
    bass: 0.16,
    pad: 0.06,
    arpLength: 1.1,
    root: 41,
  },
};

/** How far ahead of the audio clock notes are written, in seconds. */
const LOOKAHEAD = 0.25;
/** Scheduler wake-up interval. */
const TICK_MS = 40;

function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

export class MusicEngine {
  private ctx: AudioContext | null = null;
  /** Music sits well under the effects bus so it never fights the SFX. */
  private bus: GainNode | null = null;
  private timer: number | null = null;

  private mood: MusicMood = 'menu';
  private nextNoteTime = 0;
  private step = 0;
  private bar = 0;
  /** 0..1 fade applied when switching moods, so changes are not jarring. */
  private intensity = 0.6;

  /** Set by the host so the music can yield while the player has muted. */
  muted = false;

  get currentMood(): MusicMood {
    return this.mood;
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  /**
   * Attach to an existing context and begin scheduling. `destination` should be
   * the effects master bus, so the mute button and volume apply to music too.
   */
  start(ctx: AudioContext, destination?: AudioNode): void {
    if (this.timer !== null) return;
    this.ctx = ctx;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(destination ?? ctx.destination);

    this.step = 0;
    this.bar = 0;
    this.nextNoteTime = ctx.currentTime + 0.08;
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
  }

  /**
   * Switch mood. The change lands on the next bar so the loop stays coherent
   * instead of cutting mid-phrase.
   */
  setMood(mood: MusicMood): void {
    if (this.mood === mood) return;
    this.mood = mood;
    this.bar = 0;
    this.step = 0;
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (this.bus && this.ctx) {
      const now = this.ctx.currentTime;
      this.bus.gain.cancelScheduledValues(now);
      this.bus.gain.setTargetAtTime(0, now, 0.12);
    }
  }

  dispose(): void {
    this.stop();
    this.bus?.disconnect();
    this.bus = null;
    this.ctx = null;
  }

  // -------------------------------------------------------------- scheduler

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.bus) return;

    // Muted, suspended, or tab in the background: stop feeding the graph.
    const target = this.muted || ctx.state !== 'running' ? 0 : 1;
    // Drop fast so muting feels instant, ease back in so it is not jarring.
    const rate = target < this.intensity ? 0.3 : 0.06;
    this.intensity += (target - this.intensity) * rate;
    this.bus.gain.setTargetAtTime(this.intensity * 0.5, ctx.currentTime, 0.04);

    if (this.intensity < 0.01) return;

    const mood = MOODS[this.mood];
    const stepDur = mood.beat / 2;

    while (this.nextNoteTime < ctx.currentTime + LOOKAHEAD) {
      this.writeStep(this.nextNoteTime, stepDur);
      this.nextNoteTime += stepDur;
      this.step++;
      if (this.step >= mood.steps) {
        this.step = 0;
        this.bar++;
      }
    }
  }

  private writeStep(time: number, stepDur: number): void {
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !bus) return;

    const mood = MOODS[this.mood];
    const chord = mood.progression[this.bar % mood.progression.length];
    const isDownbeat = this.step === 0;
    const beat = Math.floor(this.step / 2) % 4;

    // Pad: one soft sustained chord per bar.
    if (isDownbeat) {
      for (let i = 0; i < chord.length - 1; i++) {
        this.tone(
          midiToFreq(mood.root + chord[i]),
          time,
          mood.beat * 4 * 0.95,
          mood.pad / chord.length,
          'triangle',
          0.6,
        );
      }
    }

    // Bass: root on the downbeat, fifth on beat 3 for movement.
    if (isDownbeat || beat === 2) {
      const note = isDownbeat ? chord[0] : chord[0] + 7;
      this.tone(
        midiToFreq(mood.root - 12 + note),
        time,
        stepDur * 1.6,
        mood.bass,
        'sine',
        0.25,
      );
    }

    // Arpeggio: walk the chord, skipping the root on most steps so it moves.
    const toneIndex = (this.step * 3 + beat) % (chord.length - 1);
    const octave = this.step % 4 === 3 ? 12 : 0;
    if (!(this.step % 2 === 1 && this.mood === 'menu')) {
      this.tone(
        midiToFreq(mood.root + 12 + chord[toneIndex] + octave),
        time,
        stepDur * mood.arpLength,
        mood.arp,
        'square',
        0.5,
      );
    }

    // A soft tick on the backbeat gives the loop a pulse without a drum kit.
    if (beat === 1 || beat === 3) {
      this.tick(time, mood.arp * 0.5);
    }
  }

  /** Short filtered noise blip, used as a stand-in hi-hat. */
  private tick(time: number, gain: number): void {
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !bus) return;

    const len = Math.floor(ctx.sampleRate * 0.05);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 5200;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);

    src.connect(filter).connect(env).connect(bus);
    src.start(time);
    src.stop(time + 0.06);
  }

  private tone(
    freq: number,
    time: number,
    dur: number,
    gain: number,
    type: OscillatorType,
    attack: number,
  ): void {
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !bus) return;

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;

    const env = ctx.createGain();
    const peak = Math.max(0.0002, gain);
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(peak, time + Math.min(attack, dur * 0.5));
    env.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    // Gentle low-pass keeps the square arpeggio from being harsh.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2600;

    osc.connect(filter).connect(env).connect(bus);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }
}