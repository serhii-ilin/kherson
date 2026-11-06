// Summer soundscape. Wind, water and the fish splash are synthesised. Every bird
// voice is a CC0 or public-domain recording (see bird-samples.ts); a species whose
// files have not decoded stays silent rather than falling back to a synthetic call.
import { onLangChange, t } from '../i18n.ts';
import {
  BIRD_CLIPS, clipUrl, pickClip, readyClips, sampleVariation, screamCount, speciesHasClips,
  type BirdClip, type ClipKind, type RecordedSpecies,
} from './bird-samples.ts';

export interface AudioScene {
  listener: { x: number; y: number; z: number; yaw: number };
  groundY: number;
  treeDensity: number;
  waterDistance: number;
  swiftFlocks: ReadonlyArray<{ x: number; y: number; z: number; vx: number; vy: number; vz: number; count: number }>;
  doveGroups: ReadonlyArray<{ x: number; y: number; z: number; count: number; flying: boolean }>;
  splashes?: ReadonlyArray<{ x: number; y: number; z: number; size: number; t: number }>;
  /** 1 by day .. 0 at night: songbirds and swifts fall silent (default 1). */
  daylight?: number;
  /** Fraction of the surroundings occupied by buildings, 0..1. */
  builtUp?: number;
  /** Local in-game hour, when available; used for the evening swift lift. */
  timeOfDay?: number;
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

export interface PlopParams { duration: number; frequency: number; gain: number; noiseGain: number }

/** Pure parameters for the small, quiet fish splash sound. */
export function plopParameters(rng: Rng): PlopParams {
  return {
    duration: range(rng, 0.15, 0.3),
    frequency: range(rng, 180, 280),
    gain: range(rng, 0.16, 0.28),
    noiseGain: range(rng, 0.18, 0.34),
  };
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

/** Species in the ambience mix: exactly the recorded ones. Names are deliberately stable API keys. */
export type Species = RecordedSpecies;

export const SPECIES: readonly Species[] = [
  'houseSparrow', 'treeSparrow', 'starling', 'hoodedCrow', 'greatTit', 'blackbird',
  'whiteWagtail', 'woodpecker', 'cuckoo', 'rockPigeon', 'collaredDove', 'swift',
];

export interface BirdContext {
  treeDensity?: number;
  waterDistance: number;
  builtUp?: number;
  daylight?: number;
  timeOfDay?: number;
}

/**
 * Raw relative weights: habitat multipliers are applied by speciesWeights().
 * Crows, woodpeckers and cuckoos were few in the city, so they are heard only now and
 * then: with about half a phrase a second across the slots, a crow comes every couple
 * of minutes and a cuckoo every several, from the parks and the riverside.
 */
const BASE_SPECIES_WEIGHT: Record<Species, number> = {
  houseSparrow: 24, treeSparrow: 9, starling: 10, hoodedCrow: 1.2, greatTit: 9, blackbird: 9,
  whiteWagtail: 3, woodpecker: 0.7, cuckoo: 0.35, rockPigeon: 15, collaredDove: 10, swift: 3,
};

const clampWeight = (v: number): number => Math.max(0, v);

/** Bird activity multiplier: at night the species distribution remains testable, but voices stop. */
export function birdActivity(context: BirdContext): number {
  const day = clamp(context.daylight ?? 1, 0, 1);
  if (day <= 0.03) return 0;
  const hour = context.timeOfDay;
  const evening = hour === undefined ? 0 : (hour >= 18 && hour <= 22 ? 0.15 : 0);
  return clamp(day * (1 + evening), 0, 1);
}

/** Normalised species mix for the listener's current habitat. */
export function speciesWeights(context: BirdContext): Record<Species, number> {
  const built = clamp(context.builtUp ?? 0.5, 0, 1);
  const trees = clamp(context.treeDensity ?? 0, 0, 1);
  const water = context.waterDistance === Infinity
    ? 0
    : 1 - clamp((context.waterDistance - 10) / 140, 0, 1);
  const w = {} as Record<Species, number>;
  for (const species of SPECIES) w[species] = BASE_SPECIES_WEIGHT[species];

  w.houseSparrow = clampWeight(w.houseSparrow * (0.35 + 1.65 * built));
  w.treeSparrow = clampWeight(w.treeSparrow * (0.35 + 1.45 * built));
  w.rockPigeon = clampWeight(w.rockPigeon * (0.35 + 1.75 * built));
  w.collaredDove = clampWeight(w.collaredDove * (0.35 + 1.45 * built));
  w.hoodedCrow = clampWeight(w.hoodedCrow * (0.45 + 1.35 * built));
  w.starling = clampWeight(w.starling * (0.6 + 0.85 * built + 0.6 * trees));
  w.greatTit = clampWeight(w.greatTit * (0.35 + 1.75 * trees));
  w.blackbird = clampWeight(w.blackbird * (0.4 + 1.7 * trees));
  w.woodpecker = clampWeight(w.woodpecker * (0.2 + 1.8 * trees));
  w.cuckoo = clampWeight(w.cuckoo * (0.1 + 1.5 * trees + 0.6 * water));
  w.whiteWagtail = clampWeight(w.whiteWagtail * (0.4 + 0.3 * built + 1.6 * water));
  w.swift = clampWeight(w.swift * (0.35 + 0.65 * water + 0.2 * built));

  let total = 0;
  for (const species of SPECIES) total += w[species];
  if (total <= 0) {
    w.houseSparrow = 1;
    return w;
  }
  for (const species of SPECIES) w[species] /= total;
  return w;
}

/** Weighted choice with no dependency on Math.random, so callers can seed it in tests. */
export function pickSpecies(weights: Record<Species, number>, rng: Rng): Species {
  let total = 0;
  for (const species of SPECIES) total += Math.max(0, weights[species] ?? 0);
  if (!(total > 0)) return 'houseSparrow';
  let target = rng() * total;
  for (const species of SPECIES) {
    target -= Math.max(0, weights[species] ?? 0);
    if (target < 0) return species;
  }
  return SPECIES[SPECIES.length - 1];
}

/** Recordings are peak-normalised, so far-carrying calls are set back to sit in the distance. */
function speciesLevel(species: Species): number {
  if (species === 'hoodedCrow') return 0.6;
  if (species === 'cuckoo') return 0.55;
  if (species === 'woodpecker') return 0.7;
  if (species === 'swift') return 0.7;
  return 0.85;
}

function pickDoveSpecies(weights: Record<'rockPigeon' | 'collaredDove', number>, rng: Rng): 'rockPigeon' | 'collaredDove' {
  const total = Math.max(0, weights.rockPigeon) + Math.max(0, weights.collaredDove);
  return total <= 0 || rng() * total < Math.max(0, weights.rockPigeon) ? 'rockPigeon' : 'collaredDove';
}

// ---------------------------------------------------------------- audio engine

const STORAGE_KEY = 'vk-muted';
const MAX_VOICES = 24;
const LOOKAHEAD = 0.12;
const MAX_SWIFT_SLOTS = 4;
const MAX_DOVE_SLOTS = 3;
const NOISE_SECONDS = 4;
/** Anything a species says from a perch or overhead; wing claps stay with the visible dove groups. */
const PHRASE_KINDS: readonly ClipKind[] = ['song', 'call', 'drum', 'coo', 'scream'];
const SCREAM_KINDS: readonly ClipKind[] = ['scream'];
const WING_KINDS: readonly ClipKind[] = ['wing'];
const COO_KINDS: readonly ClipKind[] = ['coo'];
const BIRD_CLIP_IDS: readonly string[] = BIRD_CLIPS.map((c) => c.id);

interface Songbird {
  species: Species;
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
  species: 'rockPigeon' | 'collaredDove';
}

export class Ambience {
  private _muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private birdBus: GainNode | null = null;
  private swiftBus: GainNode | null = null;
  private doveBus: GainNode | null = null;
  private splashBus: GainNode | null = null;
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
  private splashPanners: PannerNode[] = [];
  private nextSplashPanner = 0;
  private lastSplashT = -Infinity;
  private readonly defaultBirdMix = speciesWeights({ treeDensity: 0.35, waterDistance: Infinity, builtUp: 0.6 });
  /** Decoded recordings, keyed by clip id. Empty until the first gesture, and stays empty if fetch/decode fails. */
  private samples = new Map<string, AudioBuffer>();
  private sampleIds = new Set<string>();
  private samplesState: 'idle' | 'loading' | 'done' = 'idle';

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
    this.beginSamples();
  }

  dispose(): void {
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    const ctx = this.ctx;
    this.ctx = null;
    this.birds.length = 0;
    this.swiftSlots.length = 0;
    this.doveSlots.length = 0;
    this.splashPanners.length = 0;
    this.samples.clear();
    this.sampleIds.clear();
    this.samplesState = 'idle';
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

    const day = scene.daylight ?? 1;
    const activity = birdActivity(scene);
    this.birdBus!.gain.setTargetAtTime(songbirdGain(scene.treeDensity, altitude) * activity, now, 0.8);
    const evening = scene.timeOfDay !== undefined && scene.timeOfDay >= 18 && scene.timeOfDay <= 22 ? 1.12 : 1;
    this.swiftBus!.gain.setTargetAtTime(0.5 * activity * evening, now, 0.8);
    this.doveBus!.gain.setTargetAtTime(0.6 * activity, now, 0.8);
    this.windGainNode!.gain.setTargetAtTime(windGain(altitude), now, 0.8);
    this.waterGainNode!.gain.setTargetAtTime(waterGain(scene.waterDistance), now, 0.8);

    if (day > 0.1) {
      this.updateSongbirds(ctx, now, scene, altitude);
      this.updateSwifts(ctx, now, scene);
    }
    if (day > 0.03) this.updateDoves(ctx, now, scene);
    this.updateSplashes(ctx, now, scene);
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
    this.splashBus = bus(0.28);
    this.buildWind(ctx, master);
    this.buildWater(ctx, master);

    const count = 3 + Math.floor(this.rng() * 4);
    for (let i = 0; i < count; i++) {
      const panner = makePanner(ctx, 8, 1);
      panner.connect(this.birdBus);
      this.birds.push({
        species: pickSpecies(this.defaultBirdMix, this.rng),
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
      this.doveSlots.push({ panner, nextCoo: 0, nextClap: 0, species: 'rockPigeon' });
    }
    for (let i = 0; i < 4; i++) {
      const panner = makePanner(ctx, 18, 1.1);
      panner.connect(this.splashBus);
      this.splashPanners.push(panner);
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

  /** Start fetching recordings after the gesture that created the context. Failures stay on the synthetic voice. */
  private beginSamples(): void {
    const ctx = this.ctx;
    if (!ctx || this.samplesState !== 'idle') return;
    this.samplesState = 'loading';
    void this.loadSamples(ctx).then(() => {
      if (this.ctx === ctx) this.samplesState = 'done';
    });
  }

  private async loadSamples(ctx: AudioContext): Promise<void> {
    const base = import.meta.env.BASE_URL;
    let format: 'webm' | 'm4a' = 'webm';
    const probe = BIRD_CLIP_IDS[0];
    if (probe && !(await this.decodeClip(ctx, base, probe, 'webm'))) format = 'm4a';
    await Promise.all(BIRD_CLIP_IDS.map(async (id) => {
      if (this.sampleIds.has(id)) return;
      if (await this.decodeClip(ctx, base, id, format)) return;
      if (format === 'webm') await this.decodeClip(ctx, base, id, 'm4a');
    }));
  }

  private async decodeClip(ctx: AudioContext, base: string, id: string, format: 'webm' | 'm4a'): Promise<boolean> {
    try {
      const res = await fetch(clipUrl(base, id, format));
      if (!res.ok) return false;
      const raw = await res.arrayBuffer();
      if (this.ctx !== ctx) return false;
      const audio = await ctx.decodeAudioData(raw);
      if (this.ctx !== ctx) return false;
      this.samples.set(id, audio);
      this.sampleIds.add(id);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * A decoded take, `'wait'` while its files are still loading, or null to use the synthetic voice.
   * The null result is also the permanent fallback when every file for that species failed.
   */
  private chooseClip(species: string, kinds: readonly ClipKind[]): { clip: BirdClip; buffer: AudioBuffer } | 'wait' | null {
    const clip = pickClip(readyClips(species, kinds, this.sampleIds), this.rng);
    if (clip) {
      const buffer = this.samples.get(clip.id);
      if (buffer) return { clip, buffer };
    }
    if (speciesHasClips(species, kinds) && this.samplesState !== 'done') return 'wait';
    return null;
  }

  /** One recording through an existing panner. Counts as a single voice. */
  private playSample(
    ctx: AudioContext, dest: AudioNode, buffer: AudioBuffer, at: number,
    rate: number, gain: number, attack: number,
  ): void {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.setValueAtTime(rate, at);
    const g = ctx.createGain();
    const dur = buffer.duration / Math.max(0.5, rate);
    const peak = Math.max(0.0001, gain);
    const fade = Math.min(Math.max(0.001, attack), dur * 0.3);
    const stop = at + Math.max(dur, fade + 0.02);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(peak, at + fade);
    const hold = Math.min(stop - 0.012, Math.max(at + fade, stop - 0.04));
    if (hold > at + fade) g.gain.setValueAtTime(peak, hold);
    g.gain.exponentialRampToValueAtTime(0.0001, stop);
    src.connect(g).connect(dest);
    this.voices++;
    src.onended = () => {
      this.voices--;
      g.disconnect();
    };
    src.start(at);
    src.stop(stop + 0.02);
  }

  private updateListener(ctx: AudioContext, L: AudioScene['listener']): void {
    const l = ctx.listener;
    // Keep the hot path allocation-free; forwardFromYaw remains the pure public helper.
    const fx = -Math.sin(L.yaw);
    const fz = -Math.cos(L.yaw);
    if (l.positionX) {
      l.positionX.value = L.x;
      l.positionY.value = L.y;
      l.positionZ.value = L.z;
      l.forwardX.value = fx;
      l.forwardY.value = 0;
      l.forwardZ.value = fz;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(L.x, L.y, L.z);
      l.setOrientation(fx, 0, fz, 0, 1, 0);
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
      // A slot chooses again only after its previous phrase and pause are over, so a walk
      // from houses to a park changes the chorus without allocating in every update frame.
      b.species = pickSpecies(speciesWeights(scene), rng);
      const recorded = this.chooseClip(b.species, PHRASE_KINDS);
      if (recorded === 'wait') {
        b.nextAt = now + 0.4;
        continue;
      }
      if (recorded === null) {
        b.nextAt = now + nextInterval(rng, 2, 9);
        continue;
      }
      if (this.voices >= MAX_VOICES) {
        b.nextAt = now + 0.5;
        continue;
      }
      const v = sampleVariation(rng);
      const at = Math.max(now, b.nextAt);
      this.playSample(ctx, b.panner, recorded.buffer, at, v.playbackRate, v.gain * 0.55 * b.level * speciesLevel(b.species), 0.012);
      b.nextAt = at + recorded.buffer.duration / v.playbackRate + nextInterval(rng, 2, 9);
    }
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
      const screams = readyClips('swift', SCREAM_KINDS, this.sampleIds);
      if (screams.length === 0 && this.samplesState !== 'done' && speciesHasClips('swift', SCREAM_KINDS)) {
        slot.nextAt = now + 0.4;
        continue;
      }
      if (screams.length === 0) {
        slot.nextAt = now + swiftInterval(rng, d);
        continue;
      }
      const partyPool = screams.filter((c) => c.party);
      const singlePool = screams.filter((c) => !c.party);
      const useParty = partyPool.length > 0 && (singlePool.length === 0 || rng() < 0.45);
      const pool = useParty ? partyPool : (singlePool.length > 0 ? singlePool : partyPool);
      const first = pickClip(pool, rng);
      if (!first) {
        slot.nextAt = now + 0.4;
        continue;
      }
      const n = screamCount(Boolean(first.party), d, rng);
      if (this.voices + n > MAX_VOICES) {
        slot.nextAt = now + 0.4;
        continue;
      }
      const t0 = Math.max(now, slot.nextAt);
      let end = t0;
      for (let i = 0; i < n; i++) {
        const clip = i === 0 ? first : (pickClip(pool, rng) ?? first);
        const buf = this.samples.get(clip.id);
        if (!buf) continue;
        const v = sampleVariation(rng, doppler);
        const at = t0 + (i === 0 ? 0 : range(rng, 0.04, 0.35));
        const layer = n > 1 ? 0.62 : 0.8;
        this.playSample(ctx, slot.panner, buf, at, v.playbackRate, v.gain * layer, 0.01);
        end = Math.max(end, at + buf.duration / v.playbackRate);
      }
      slot.nextAt = end + swiftInterval(rng, d);
    }
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
        const ownWings = this.chooseClip(slot.species, WING_KINDS);
        const wings = ownWings === null && slot.species === 'collaredDove'
          ? this.chooseClip('rockPigeon', WING_KINDS)
          : ownWings;
        if (wings === 'wait') {
          slot.nextClap = now + 0.4;
          continue;
        }
        if (wings === null) {
          slot.nextClap = now + range(rng, 2.5, 5);
          continue;
        }
        if (this.voices >= MAX_VOICES) {
          slot.nextClap = now + 0.4;
          continue;
        }
        const v = sampleVariation(rng);
        this.playSample(ctx, slot.panner, wings.buffer, now, v.playbackRate, v.gain * 0.8, 0.004);
        slot.nextClap = now + wings.buffer.duration / v.playbackRate + range(rng, 1.4, 3.4);
      } else {
        slot.nextClap = 0;
        if (now + LOOKAHEAD < slot.nextCoo) continue;
        if (slot.nextCoo === 0) {
          slot.nextCoo = now + range(rng, 0.2, 5);
          continue;
        }
        const mix = speciesWeights(scene);
        const doveWeights: Record<'rockPigeon' | 'collaredDove', number> = {
          rockPigeon: mix.rockPigeon,
          collaredDove: mix.collaredDove,
        };
        slot.species = pickDoveSpecies(doveWeights, rng);
        const coo = this.chooseClip(slot.species, COO_KINDS);
        if (coo === 'wait') {
          slot.nextCoo = now + 0.4;
          continue;
        }
        if (coo === null) {
          slot.nextCoo = now + nextInterval(rng, 4, 12);
          continue;
        }
        if (this.voices >= MAX_VOICES) {
          slot.nextCoo = now + 0.4;
          continue;
        }
        const v = sampleVariation(rng);
        this.playSample(ctx, slot.panner, coo.buffer, now, v.playbackRate, v.gain * 0.5, 0.015);
        slot.nextCoo = now + coo.buffer.duration / v.playbackRate + nextInterval(rng, 4, 12);
      }
    }
  }

  private updateSplashes(ctx: AudioContext, now: number, scene: AudioScene): void {
    const splashes = scene.splashes;
    if (splashes === undefined) return;
    const L = scene.listener;
    let newest = this.lastSplashT;
    for (let i = 0; i < splashes.length; i++) {
      const s = splashes[i]!;
      if (!(s.t > this.lastSplashT)) continue;
      if (s.t > newest) newest = s.t;
      const d = Math.hypot(s.x - L.x, s.y - L.y, s.z - L.z);
      if (d <= 80 && this.voices < MAX_VOICES) {
        const panner = this.splashPanners[this.nextSplashPanner]!;
        this.nextSplashPanner = (this.nextSplashPanner + 1) % this.splashPanners.length;
        setPos(panner, s.x, s.y, s.z);
        this.playPlop(ctx, panner, now, s.size);
      }
    }
    this.lastSplashT = newest;
  }

  private playPlop(ctx: AudioContext, dest: AudioNode, at: number, size: number): void {
    const p = plopParameters(this.rng);
    const stop = at + p.duration + 0.03;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = range(this.rng, 800, 1600);
    bp.Q.value = 0.8;
    const ng = ctx.createGain();
    const peak = p.noiseGain * clamp(size / 0.35, 0.55, 1.35);
    ng.gain.setValueAtTime(0.0001, at);
    ng.gain.linearRampToValueAtTime(peak, at + 0.006);
    ng.gain.exponentialRampToValueAtTime(0.0001, at + p.duration);
    src.connect(bp).connect(ng).connect(dest);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(p.frequency, at);
    osc.frequency.exponentialRampToValueAtTime(p.frequency * 0.52, at + p.duration * 0.8);
    const tone = ctx.createGain();
    tone.gain.setValueAtTime(0.0001, at);
    tone.gain.linearRampToValueAtTime(p.gain, at + 0.008);
    tone.gain.exponentialRampToValueAtTime(0.0001, at + p.duration);
    osc.connect(tone).connect(dest);
    src.onended = () => ng.disconnect();
    src.start(at, this.rng() * (NOISE_SECONDS - 1), p.duration + 0.03);
    this.track(osc, tone, at, stop);
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
