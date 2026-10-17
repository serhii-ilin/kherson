// Procedural WebAudio summer soundscape: songbirds, swifts, doves, wind and water.
// Everything is synthesised; no asset files.
import { onLangChange, t } from '../i18n.ts';

export interface AudioScene {
  listener: { x: number; y: number; z: number; yaw: number };
  groundY: number;
  treeDensity: number;
  waterDistance: number;
  swiftFlocks: ReadonlyArray<{ x: number; y: number; z: number; vx: number; vy: number; vz: number; count: number }>;
  doveGroups: ReadonlyArray<{ x: number; y: number; z: number; count: number; flying: boolean }>;
}

type Rng = () => number;

// ---------------------------------------------------------------- pure helpers

const SPEED_OF_SOUND = 343;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const range = (rng: Rng, lo: number, hi: number): number => lo + (hi - lo) * rng();

/** Pitch factor for a source with the given radial velocity (m/s, positive = receding). */
export function dopplerFactor(radialVelocity: number): number {
  const d = SPEED_OF_SOUND + radialVelocity;
  return d <= 0 ? 1.25 : clamp(SPEED_OF_SOUND / d, 0.8, 1.25);
}

/** Velocity component along the listener->source direction (positive = moving away). */
export function radialVelocity(
  dx: number, dy: number, dz: number, vx: number, vy: number, vz: number,
): number {
  const d = Math.hypot(dx, dy, dz);
  return d < 1e-6 ? 0 : (vx * dx + vy * dy + vz * dz) / d;
}

/** Listener forward vector; yaw 0 faces north (-z), positive yaw turns left. */
export function forwardFromYaw(yaw: number): { x: number; y: number; z: number } {
  return { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
}

/** Songbird level: scales with tree density, full below 15 m above ground, silent above 120 m. */
export function songbirdGain(treeDensity: number, altitude: number): number {
  const base = 0.25 + 0.75 * clamp(treeDensity, 0, 1);
  const fade = 1 - clamp((altitude - 15) / 105, 0, 1);
  return base * fade;
}

export function windGain(altitude: number): number {
  return 0.03 + 0.12 * clamp(altitude / 150, 0, 1);
}

export function waterGain(distance: number): number {
  return 0.12 * (1 - clamp((distance - 15) / 105, 0, 1));
}

/** Random delay in [min, max] seconds. */
export function nextInterval(rng: Rng, min: number, max: number): number {
  return range(rng, min, max);
}

/** Time until the next swift scream burst; denser when the flock is close. */
export function swiftInterval(rng: Rng, distance: number): number {
  if (distance < 60) return range(rng, 0.5, 1.6);
  return range(rng, 1.5, 3.5) + ((distance - 60) / 60) * 2.5;
}

export type BirdStyle = 'chaffinch' | 'greattit' | 'blackbird' | 'sparrow';
export const BIRD_STYLES: readonly BirdStyle[] = ['chaffinch', 'greattit', 'blackbird', 'sparrow'];

export interface NoteSpec {
  t: number; // offset from phrase start, s
  dur: number; // s
  freqs: number[]; // contour, evenly spread over dur (>= 2 points)
  peak: number; // 0..1
  attack: number; // s
  fmRate: number; // Hz, 0 = none
  fmDepth: number; // Hz
  harm: number; // level of the 2nd harmonic (0..0.5)
  type: 'sine' | 'triangle';
}

/**
 * One phrase of a songbird. `pitch` (~0.9..1.1) and `tempo` (~0.8..1.25) are per-individual
 * traits; everything else is re-rolled each time so no two phrases are identical.
 */
export function generatePhrase(style: BirdStyle, rng: Rng, pitch: number, tempo: number): NoteSpec[] {
  const notes: NoteSpec[] = [];
  const push = (n: NoteSpec): void => {
    n.freqs = n.freqs.map((f) => clamp(f * pitch, 700, 8000));
    n.dur = clamp(n.dur / tempo, 0.03, 0.22);
    n.t /= tempo;
    notes.push(n);
  };
  let t = 0;
  if (style === 'chaffinch') {
    // Descending rattle that speeds up, then a flourish.
    const n = 6 + Math.floor(rng() * 4);
    let f = range(rng, 4600, 5400);
    let gap = range(rng, 0.085, 0.11);
    for (let i = 0; i < n; i++) {
      const d = range(rng, 0.05, 0.075);
      push({ t, dur: d, freqs: [f * 1.05, f, f * 0.93], peak: range(rng, 0.45, 0.6) * (1 - i * 0.02),
        attack: 0.004, fmRate: 0, fmDepth: 0, harm: 0.12, type: 'sine' });
      t += gap;
      gap *= range(rng, 0.9, 0.97);
      f *= range(rng, 0.9, 0.96);
    }
    t += range(rng, 0.05, 0.1);
    const top = range(rng, 3600, 4600);
    const nf = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < nf; i++) {
      push({ t, dur: range(rng, 0.08, 0.13), freqs: [top * 0.7, top, top * (0.95 + rng() * 0.2)],
        peak: range(rng, 0.55, 0.7), attack: 0.006, fmRate: 0, fmDepth: 0, harm: 0.18, type: 'sine' });
      t += range(rng, 0.1, 0.15);
    }
  } else if (style === 'greattit') {
    // "tee-cher tee-cher": high, then lower, repeated with slight drift.
    const reps = 2 + Math.floor(rng() * 4);
    const hi = range(rng, 4800, 5600);
    const lo = hi * range(rng, 0.68, 0.78);
    for (let i = 0; i < reps && notes.length < 11; i++) {
      const drift = range(rng, 0.97, 1.04);
      push({ t, dur: range(rng, 0.07, 0.09), freqs: [hi * 0.97 * drift, hi * drift, hi * 0.93 * drift],
        peak: range(rng, 0.5, 0.65), attack: 0.005, fmRate: 0, fmDepth: 0, harm: 0.1, type: 'sine' });
      t += range(rng, 0.1, 0.13);
      push({ t, dur: range(rng, 0.08, 0.11), freqs: [lo * 1.04 * drift, lo * 0.98 * drift],
        peak: range(rng, 0.4, 0.55), attack: 0.005, fmRate: 0, fmDepth: 0, harm: 0.25, type: 'triangle' });
      t += range(rng, 0.2, 0.3);
    }
  } else if (style === 'blackbird') {
    // Slow flute-like warble: lower pitch, smooth glides, random-walk melody and pauses.
    const n = 4 + Math.floor(rng() * 6);
    let f = range(rng, 1700, 2500);
    for (let i = 0; i < n; i++) {
      const target = clamp(f * range(rng, 0.78, 1.28), 1400, 3100);
      push({ t, dur: range(rng, 0.11, 0.2), freqs: [f, (f + target) / 2 * range(rng, 0.95, 1.12), target],
        peak: range(rng, 0.5, 0.7), attack: range(rng, 0.012, 0.03), fmRate: range(rng, 6, 11),
        fmDepth: range(rng, 15, 40), harm: 0.08, type: 'sine' });
      t += range(rng, 0.14, 0.26) + (rng() < 0.2 ? range(rng, 0.15, 0.3) : 0);
      f = target;
    }
  } else {
    // House sparrow: irregular, scratchy chirps.
    const n = 3 + Math.floor(rng() * 6);
    for (let i = 0; i < n; i++) {
      const f = range(rng, 2400, 4000);
      push({ t, dur: range(rng, 0.04, 0.08), freqs: [f * range(rng, 0.85, 1.1), f * range(rng, 1.0, 1.25), f * range(rng, 0.8, 1.05)],
        peak: range(rng, 0.4, 0.6), attack: 0.003, fmRate: range(rng, 25, 40), fmDepth: range(rng, 100, 350),
        harm: 0.3, type: 'triangle' });
      t += range(rng, 0.08, 0.2) * (rng() < 0.25 ? 2 : 1);
    }
  }
  return notes;
}

// ---------------------------------------------------------------- audio engine

const STORAGE_KEY = 'vk-muted';
const MAX_VOICES = 24;
const LOOKAHEAD = 0.12;
const MAX_SWIFT_SLOTS = 4;
const MAX_DOVE_SLOTS = 3;
const NOISE_SECONDS = 4;

interface Songbird {
  style: BirdStyle;
  pitch: number;
  tempo: number;
  level: number;
  panner: PannerNode;
  nextAt: number;
}

interface SwiftSlot {
  panner: PannerNode;
  nextAt: number;
}

interface DoveSlot {
  panner: PannerNode;
  nextCoo: number;
  nextClap: number;
}

export class Ambience {
  private _muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private birdBus: GainNode | null = null;
  private swiftBus: GainNode | null = null;
  private doveBus: GainNode | null = null;
  private windGainNode: GainNode | null = null;
  private waterGainNode: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private birds: Songbird[] = [];
  private swiftSlots: SwiftSlot[] = [];
  private doveSlots: DoveSlot[] = [];
  private voices = 0;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private rng: Rng = Math.random;
  private near: number[] = [];
  private nearD: number[] = [];

  constructor() {
    try {
      this._muted = localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      // storage unavailable
    }
  }

  get muted(): boolean {
    return this._muted;
  }

  setMuted(m: boolean): void {
    this._muted = m;
    try {
      localStorage.setItem(STORAGE_KEY, m ? '1' : '0');
    } catch {
      // ignore
    }
    this.applyMute();
  }

  /** Call from a user gesture: creates or resumes the AudioContext. */
  unlock(): void {
    if (typeof AudioContext === 'undefined') return;
    if (!this.ctx) {
      try {
        this.build();
      } catch {
        this.ctx = null;
        return;
      }
    }
    this.applyMute();
  }

  dispose(): void {
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    const ctx = this.ctx;
    this.ctx = null;
    this.birds.length = 0;
    this.swiftSlots.length = 0;
    this.doveSlots.length = 0;
    if (ctx) void ctx.close().catch(() => {});
  }

  update(dt: number, scene: AudioScene): void {
    void dt;
    const ctx = this.ctx;
    if (!ctx || this._muted || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const L = scene.listener;
    this.updateListener(ctx, L);
    const altitude = L.y - scene.groundY;

    this.birdBus!.gain.setTargetAtTime(songbirdGain(scene.treeDensity, altitude), now, 0.8);
    this.windGainNode!.gain.setTargetAtTime(windGain(altitude), now, 0.8);
    this.waterGainNode!.gain.setTargetAtTime(waterGain(scene.waterDistance), now, 0.8);

    this.updateSongbirds(ctx, now, scene, altitude);
    this.updateSwifts(ctx, now, scene);
    this.updateDoves(ctx, now, scene);
  }

  // ------------------------------------------------------------ setup

  private build(): void {
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 20;
    comp.ratio.value = 5;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    master.connect(comp);
    comp.connect(ctx.destination);
    this.master = master;

    this.noise = makeNoiseBuffer(ctx, this.rng);
    const bus = (g: number): GainNode => {
      const n = ctx.createGain();
      n.gain.value = g;
      n.connect(master);
      return n;
    };
    this.birdBus = bus(0.5);
    this.swiftBus = bus(0.5);
    this.doveBus = bus(0.6);
    this.buildWind(ctx, master);
    this.buildWater(ctx, master);

    const count = 3 + Math.floor(this.rng() * 4);
    for (let i = 0; i < count; i++) {
      const panner = makePanner(ctx, 8, 1);
      panner.connect(this.birdBus);
      this.birds.push({
        style: BIRD_STYLES[Math.floor(this.rng() * BIRD_STYLES.length)],
        pitch: range(this.rng, 0.9, 1.1),
        tempo: range(this.rng, 0.8, 1.25),
        level: range(this.rng, 0.55, 1),
        panner,
        nextAt: ctx.currentTime + range(this.rng, 0.5, 6),
      });
      this.birds[i].panner.positionY.value = -9999; // placed on first update
    }
    for (let i = 0; i < MAX_SWIFT_SLOTS; i++) {
      const panner = makePanner(ctx, 25, 0.8);
      panner.connect(this.swiftBus);
      this.swiftSlots.push({ panner, nextAt: 0 });
    }
    for (let i = 0; i < MAX_DOVE_SLOTS; i++) {
      const panner = makePanner(ctx, 5, 1);
      panner.connect(this.doveBus);
      this.doveSlots.push({ panner, nextCoo: 0, nextClap: 0 });
    }
  }

  private buildWind(ctx: AudioContext, dest: AudioNode): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 650;
    lp.Q.value = 0.5;
    // Slow gusts move the cutoff and the level independently.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 250;
    lfo.connect(lfoG).connect(lp.frequency);
    const gust = ctx.createOscillator();
    gust.frequency.value = 0.13;
    const gustG = ctx.createGain();
    gustG.gain.value = 0.25;
    const amp = ctx.createGain();
    amp.gain.value = 0;
    gust.connect(gustG);
    const gustSum = ctx.createGain();
    gustSum.gain.value = 0.75;
    gustG.connect(gustSum.gain);
    src.connect(lp).connect(gustSum).connect(amp).connect(dest);
    src.start(0, this.rng() * 3);
    lfo.start();
    gust.start();
    this.windGainNode = amp;
  }

  private buildWater(ctx: AudioContext, dest: AudioNode): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1000;
    bp.Q.value = 0.6;
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 3500;
    shelf.gain.value = 5;
    const lap = ctx.createOscillator();
    lap.frequency.value = 0.31;
    const lapG = ctx.createGain();
    lapG.gain.value = 0.18;
    const mod = ctx.createGain();
    mod.gain.value = 0.82;
    lap.connect(lapG).connect(mod.gain);
    const amp = ctx.createGain();
    amp.gain.value = 0;
    src.connect(bp).connect(shelf).connect(mod).connect(amp).connect(dest);
    src.start(0, 1 + this.rng() * 2);
    lap.start();
    this.waterGainNode = amp;
  }

  private applyMute(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    if (this.suspendTimer) {
      clearTimeout(this.suspendTimer);
      this.suspendTimer = null;
    }
    const now = ctx.currentTime;
    if (this._muted) {
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + 0.3);
      this.suspendTimer = setTimeout(() => {
        this.suspendTimer = null;
        if (this._muted && this.ctx === ctx) void ctx.suspend().catch(() => {});
      }, 350);
    } else {
      const target = 0.8;
      const ramp = (): void => {
        const n = ctx.currentTime;
        master.gain.cancelScheduledValues(n);
        master.gain.setValueAtTime(master.gain.value, n);
        master.gain.linearRampToValueAtTime(target, n + 0.3);
      };
      if (ctx.state === 'running') ramp();
      else void ctx.resume().then(ramp).catch(() => {});
    }
  }

  private updateListener(ctx: AudioContext, L: AudioScene['listener']): void {
    const l = ctx.listener;
    const f = forwardFromYaw(L.yaw);
    if (l.positionX) {
      l.positionX.value = L.x;
      l.positionY.value = L.y;
      l.positionZ.value = L.z;
      l.forwardX.value = f.x;
      l.forwardY.value = f.y;
      l.forwardZ.value = f.z;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(L.x, L.y, L.z);
      l.setOrientation(f.x, f.y, f.z, 0, 1, 0);
    }
  }

  // ------------------------------------------------------------ songbirds

  private updateSongbirds(ctx: AudioContext, now: number, scene: AudioScene, altitude: number): void {
    if (altitude > 125) return;
    const L = scene.listener;
    const rng = this.rng;
    for (const b of this.birds) {
      const p = b.panner;
      const dx = p.positionX.value - L.x;
      const dz = p.positionZ.value - L.z;
      if (p.positionY.value < -9000 || dx * dx + dz * dz > 90 * 90) {
        const a = rng() * Math.PI * 2;
        const r = range(rng, 10, 60);
        setPos(p, L.x + Math.cos(a) * r, scene.groundY + range(rng, 3, 12), L.z + Math.sin(a) * r);
      }
      if (now + LOOKAHEAD < b.nextAt) continue;
      const notes = generatePhrase(b.style, rng, b.pitch * range(rng, 0.97, 1.03), b.tempo * range(rng, 0.92, 1.08));
      if (this.voices + notes.length > MAX_VOICES) {
        b.nextAt = now + 0.5;
        continue;
      }
      const t0 = Math.max(now, b.nextAt);
      let end = 0;
      for (const n of notes) {
        this.playNote(ctx, b.panner, t0 + n.t, n, b.level);
        end = Math.max(end, n.t + n.dur);
      }
      b.nextAt = t0 + end + nextInterval(rng, 2, 9);
    }
  }

  private playNote(ctx: AudioContext, dest: AudioNode, at: number, n: NoteSpec, level: number): void {
    const rng = this.rng;
    const osc = ctx.createOscillator();
    osc.type = n.type;
    const g = ctx.createGain();
    const pts = n.freqs;
    osc.frequency.setValueAtTime(pts[0], at);
    for (let i = 1; i < pts.length; i++) {
      osc.frequency.exponentialRampToValueAtTime(pts[i], at + (n.dur * i) / (pts.length - 1));
    }
    const peak = n.peak * level;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(peak, at + n.attack);
    g.gain.exponentialRampToValueAtTime(peak * range(rng, 0.45, 0.8), at + n.dur * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, at + n.dur);
    osc.connect(g);
    const stop = at + n.dur + 0.02;
    if (n.fmRate > 0) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = n.fmRate;
      const d = ctx.createGain();
      d.gain.value = n.fmDepth;
      lfo.connect(d).connect(osc.frequency);
      lfo.start(at);
      lfo.stop(stop);
    }
    if (n.harm > 0) {
      const h = ctx.createOscillator();
      h.type = 'sine';
      const hg = ctx.createGain();
      hg.gain.value = n.harm;
      h.frequency.setValueAtTime(pts[0] * 2, at);
      for (let i = 1; i < pts.length; i++) {
        h.frequency.exponentialRampToValueAtTime(pts[i] * 2, at + (n.dur * i) / (pts.length - 1));
      }
      h.connect(hg).connect(g);
      h.start(at);
      h.stop(stop);
    }
    g.connect(dest);
    this.track(osc, g, at, stop);
  }

  private track(osc: OscillatorNode, tail: AudioNode, at: number, stop: number): void {
    this.voices++;
    osc.onended = () => {
      this.voices--;
      tail.disconnect();
    };
    osc.start(at);
    osc.stop(stop);
  }

  // ------------------------------------------------------------ swifts

  private updateSwifts(ctx: AudioContext, now: number, scene: AudioScene): void {
    const L = scene.listener;
    // pick up to MAX_SWIFT_SLOTS nearest flocks within 120 m (insertion into small arrays)
    const near = this.near;
    const nearD = this.nearD;
    near.length = 0;
    nearD.length = 0;
    const flocks = scene.swiftFlocks;
    for (let i = 0; i < flocks.length; i++) {
      const f = flocks[i];
      const d = Math.hypot(f.x - L.x, f.y - L.y, f.z - L.z);
      if (d > 120) continue;
      let k = near.length;
      while (k > 0 && nearD[k - 1] > d) k--;
      if (k >= MAX_SWIFT_SLOTS) continue;
      near.splice(k, 0, i);
      nearD.splice(k, 0, d);
      if (near.length > MAX_SWIFT_SLOTS) {
        near.pop();
        nearD.pop();
      }
    }
    const rng = this.rng;
    for (let s = 0; s < near.length; s++) {
      const f = flocks[near[s]];
      const d = nearD[s];
      const slot = this.swiftSlots[s];
      setPos(slot.panner, f.x, f.y, f.z);
      if (now + LOOKAHEAD < slot.nextAt) continue;
      if (slot.nextAt === 0) slot.nextAt = now + range(rng, 0, 1.5);
      if (now + LOOKAHEAD < slot.nextAt) continue;
      const doppler = dopplerFactor(radialVelocity(f.x - L.x, f.y - L.y, f.z - L.z, f.vx, f.vy, f.vz));
      const max = d < 60 ? 6 : 3;
      const n = Math.min(max, 2 + Math.floor(rng() * (max - 1)));
      if (this.voices + n * 2 > MAX_VOICES) {
        slot.nextAt = now + 0.4;
        continue;
      }
      const base = range(rng, 0.9, 1.1);
      for (let i = 0; i < n; i++) {
        const at = Math.max(now, slot.nextAt) + (i === 0 ? 0 : range(rng, 0.03, 0.45));
        this.playScream(ctx, slot.panner, at, base * range(rng, 0.93, 1.07) * doppler, range(rng, 0.7, 1));
      }
      slot.nextAt = Math.max(now, slot.nextAt) + swiftInterval(rng, d);
    }
  }

  /** Saw through a swept bandpass with ~60 Hz tremolo plus a little breath noise. */
  private playScream(ctx: AudioContext, dest: AudioNode, at: number, pitch: number, level: number): void {
    const rng = this.rng;
    const dur = range(rng, 0.15, 0.4);
    const stop = at + dur + 0.03;
    const f0 = range(rng, 2300, 3100) * pitch;
    const glide = range(rng, 0.7, 0.88);
    const centre = range(rng, 5500, 7500) * pitch;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0 * range(rng, 1, 1.08), at);
    osc.frequency.exponentialRampToValueAtTime(f0, at + dur * 0.15);
    osc.frequency.exponentialRampToValueAtTime(f0 * glide, at + dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 6;
    bp.frequency.setValueAtTime(centre, at);
    bp.frequency.exponentialRampToValueAtTime(centre * range(rng, 0.78, 0.92), at + dur);

    const trem = ctx.createGain();
    trem.gain.value = 0.55;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = range(rng, 52, 70);
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.45;
    lfo.connect(lfoG).connect(trem.gain);

    const env = ctx.createGain();
    const peak = 1.1 * level;
    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(peak, at + dur * range(rng, 0.2, 0.35));
    env.gain.setValueAtTime(peak * 0.9, at + dur * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    osc.connect(bp).connect(trem);
    const ns = ctx.createBufferSource();
    ns.buffer = this.noise;
    const nbp = ctx.createBiquadFilter();
    nbp.type = 'bandpass';
    nbp.Q.value = 3;
    nbp.frequency.value = centre;
    const ng = ctx.createGain();
    ng.gain.value = 0.35;
    ns.connect(nbp).connect(ng).connect(trem);
    trem.connect(env).connect(dest);

    lfo.start(at);
    lfo.stop(stop);
    ns.start(at, rng() * (NOISE_SECONDS - 1), dur + 0.03);
    this.track(osc, env, at, stop);
  }

  // ------------------------------------------------------------ doves

  private updateDoves(ctx: AudioContext, now: number, scene: AudioScene): void {
    const L = scene.listener;
    const rng = this.rng;
    let s = 0;
    for (const g of scene.doveGroups) {
      if (s >= MAX_DOVE_SLOTS) break;
      const d = Math.hypot(g.x - L.x, g.y - L.y, g.z - L.z);
      if (g.flying ? d > 30 : d > 40) continue;
      const slot = this.doveSlots[s++];
      setPos(slot.panner, g.x, g.y, g.z);
      if (g.flying) {
        if (now + LOOKAHEAD < slot.nextClap) continue;
        if (slot.nextClap === 0) {
          slot.nextClap = now + range(rng, 0, 1);
          continue;
        }
        if (this.voices + 12 > MAX_VOICES) continue;
        this.playClaps(ctx, slot.panner, now, 8 + Math.floor(rng() * 5));
        slot.nextClap = now + range(rng, 2.5, 5);
      } else {
        slot.nextClap = 0;
        if (now + LOOKAHEAD < slot.nextCoo) continue;
        if (slot.nextCoo === 0) {
          slot.nextCoo = now + range(rng, 0.2, 5);
          continue;
        }
        if (this.voices + 3 > MAX_VOICES) continue;
        this.playCoo(ctx, slot.panner, now);
        slot.nextCoo = now + nextInterval(rng, 4, 12);
      }
    }
  }

  /** "coo-roo-coo": three sine syllables with vibrato, lowpassed, second one lower and shorter. */
  private playCoo(ctx: AudioContext, dest: AudioNode, at: number): void {
    const rng = this.rng;
    const base = range(rng, 350, 460);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    lp.Q.value = 0.7;
    lp.connect(dest);
    const sy: Array<{ d: number; f: number[]; gap: number }> = [
      { d: range(rng, 0.14, 0.2), f: [0.94, 1.02, 1.0], gap: range(rng, 0.04, 0.09) },
      { d: range(rng, 0.11, 0.16), f: [0.9, 0.97, 0.93], gap: range(rng, 0.04, 0.08) },
      { d: range(rng, 0.32, 0.5), f: [1.0, 1.12, 0.82], gap: 0 },
    ];
    let t = at + 0.01;
    const vibRate = range(rng, 5, 7.5);
    for (let i = 0; i < sy.length; i++) {
      const { d, f, gap } = sy[i];
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(base * f[0], t);
      osc.frequency.linearRampToValueAtTime(base * f[1], t + d * 0.4);
      osc.frequency.linearRampToValueAtTime(base * f[2], t + d);
      const vib = ctx.createOscillator();
      vib.frequency.value = vibRate;
      const vg = ctx.createGain();
      vg.gain.value = range(rng, 3, 8);
      vib.connect(vg).connect(osc.frequency);
      const h = ctx.createOscillator();
      h.frequency.setValueAtTime(base * f[0] * 2, t);
      h.frequency.linearRampToValueAtTime(base * f[1] * 2, t + d * 0.4);
      h.frequency.linearRampToValueAtTime(base * f[2] * 2, t + d);
      const hg = ctx.createGain();
      hg.gain.value = 0.15;
      const env = ctx.createGain();
      const pk = range(rng, 0.45, 0.65) * (i === 1 ? 0.8 : 1);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(pk, t + Math.min(0.04, d * 0.3));
      env.gain.setValueAtTime(pk * 0.85, t + d * 0.6);
      env.gain.exponentialRampToValueAtTime(0.0001, t + d);
      osc.connect(env);
      h.connect(hg).connect(env);
      env.connect(lp);
      vib.start(t);
      vib.stop(t + d + 0.02);
      h.start(t);
      h.stop(t + d + 0.02);
      this.track(osc, env, t, t + d + 0.02);
      t += d + gap;
    }
    // free the shared lowpass once the last syllable is done
    setTimeout(() => lp.disconnect(), Math.max(0, (t - ctx.currentTime + 0.2) * 1000));
  }

  /** Filtered-noise clicks that speed up then thin out, like wings clapping at take-off. */
  private playClaps(ctx: AudioContext, dest: AudioNode, at: number, count: number): void {
    const rng = this.rng;
    let t = at + 0.01;
    let gap = range(rng, 0.09, 0.12);
    for (let i = 0; i < count; i++) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = range(rng, 1500, 3200);
      bp.Q.value = range(rng, 0.8, 1.6);
      const env = ctx.createGain();
      const pk = range(rng, 0.5, 1.0);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(pk, t + 0.003);
      env.gain.exponentialRampToValueAtTime(0.0001, t + range(rng, 0.02, 0.04));
      src.connect(bp).connect(env).connect(dest);
      this.voices++;
      src.onended = () => {
        this.voices--;
        env.disconnect();
      };
      src.start(t, rng() * (NOISE_SECONDS - 1), 0.05);
      t += gap * range(rng, 0.8, 1.2);
      gap = Math.max(0.045, gap * range(rng, 0.88, 0.98));
    }
  }
}

// ---------------------------------------------------------------- helpers using WebAudio

function makePanner(ctx: AudioContext, ref: number, rolloff: number): PannerNode {
  const p = ctx.createPanner();
  p.panningModel = 'HRTF';
  p.distanceModel = 'inverse';
  p.refDistance = ref;
  p.rolloffFactor = rolloff;
  p.maxDistance = 10000;
  return p;
}

function setPos(p: PannerNode, x: number, y: number, z: number): void {
  if (p.positionX) {
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
  } else {
    p.setPosition(x, y, z);
  }
}

/** 4 s of seamlessly looping pink-ish noise (Kellet filter, tail crossfaded into the head). */
function makeNoiseBuffer(ctx: AudioContext, rng: Rng): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(NOISE_SECONDS * sr);
  const x = Math.floor(0.25 * sr);
  const gen = new Float32Array(n + x);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < gen.length; i++) {
    const w = rng() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    gen[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  const buf = ctx.createBuffer(1, n, sr);
  const out = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    out[i] = i < x ? gen[i] * (i / x) + gen[n + i] * (1 - i / x) : gen[i];
  }
  return buf;
}

/** Speaker button placed left of the language switcher. */
export function createMuteButton(parent: HTMLElement, amb: Ambience): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'vk-btn vk-mute';
  const render = (): void => {
    btn.textContent = amb.muted ? '🔇' : '🔊';
    const label = amb.muted ? t('unmute') : t('mute');
    btn.title = label;
    btn.setAttribute('aria-label', label);
  };
  btn.addEventListener('click', () => {
    amb.unlock();
    amb.setMuted(!amb.muted);
    render();
  });
  onLangChange(render);
  render();
  parent.appendChild(btn);
  return btn;
}
