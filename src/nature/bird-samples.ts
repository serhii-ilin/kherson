// CC0 / public-domain bird recordings that replace the matching synthetic voices.
// Provenance, authors and licences: docs/AUDIO_CREDITS.md.
// A species with no clip here is not part of the soundscape: there is no synthetic bird voice.

export type RecordedSpecies =
  | 'swift' | 'rockPigeon' | 'collaredDove' | 'houseSparrow' | 'treeSparrow'
  | 'greatTit' | 'blackbird' | 'starling' | 'hoodedCrow' | 'whiteWagtail'
  | 'woodpecker' | 'cuckoo';

export type ClipKind = 'scream' | 'coo' | 'wing' | 'song' | 'call' | 'drum';

export interface BirdClip {
  id: string;
  species: RecordedSpecies;
  kind: ClipKind;
  /** Catalogue token that docs/AUDIO_CREDITS.md must mention (XC id, Freesound id, or file title). */
  source: string;
  /** Already a screaming party, so the engine plays it once instead of layering singles. */
  party?: boolean;
}

/** Encoded Opus/WebM plus AAC/M4A together. Article 4 of the constitution. */
export const BIRD_AUDIO_BUDGET_BYTES = 1_500_000;

export const BIRD_AUDIO_DIR = 'audio/birds/';

export const BIRD_CLIPS: readonly BirdClip[] = [
  { id: 'swift-1', species: 'swift', kind: 'scream', source: 'XC1152512' },
  { id: 'swift-2', species: 'swift', kind: 'scream', source: 'XC1152512' },
  { id: 'swift-3', species: 'swift', kind: 'scream', source: 'XC1152512' },
  { id: 'swift-4', species: 'swift', kind: 'scream', source: 'XC1152513' },
  { id: 'swift-5', species: 'swift', kind: 'scream', source: 'XC1152513' },
  { id: 'swift-6', species: 'swift', kind: 'scream', source: 'XC819689', party: true },
  { id: 'swift-7', species: 'swift', kind: 'scream', source: 'XC819689', party: true },
  { id: 'swift-8', species: 'swift', kind: 'scream', source: 'XC819689', party: true },
  { id: 'pigeon-coo-1', species: 'rockPigeon', kind: 'coo', source: 'XC1136258' },
  { id: 'pigeon-coo-2', species: 'rockPigeon', kind: 'coo', source: 'XC1136258' },
  { id: 'pigeon-wing-1', species: 'rockPigeon', kind: 'wing', source: 'sounds/689998' },
  { id: 'pigeon-wing-2', species: 'rockPigeon', kind: 'wing', source: 'sounds/532180' },
  { id: 'pigeon-wing-3', species: 'rockPigeon', kind: 'wing', source: 'sounds/528250' },
  { id: 'pigeon-wing-4', species: 'rockPigeon', kind: 'wing', source: 'sounds/611106' },
  { id: 'dove-coo-1', species: 'collaredDove', kind: 'coo', source: 'XC1062731' },
  { id: 'dove-coo-2', species: 'collaredDove', kind: 'coo', source: 'XC1062731' },
  { id: 'dove-coo-3', species: 'collaredDove', kind: 'coo', source: 'XC1142043' },
  { id: 'dove-coo-4', species: 'collaredDove', kind: 'coo', source: 'XC1142043' },
  { id: 'dove-wing-1', species: 'collaredDove', kind: 'wing', source: 'XC1181443' },
  { id: 'sparrow-1', species: 'houseSparrow', kind: 'call', source: 'File:House Sparrow.ogg' },
  { id: 'sparrow-2', species: 'houseSparrow', kind: 'call', source: 'File:House Sparrow.ogg' },
  { id: 'sparrow-3', species: 'houseSparrow', kind: 'call', source: 'XC816843' },
  { id: 'sparrow-4', species: 'houseSparrow', kind: 'call', source: 'XC1152146' },
  { id: 'sparrow-5', species: 'houseSparrow', kind: 'call', source: 'XC819683' },
  { id: 'sparrow-6', species: 'houseSparrow', kind: 'call', source: 'XC816843' },
  { id: 'sparrow-7', species: 'houseSparrow', kind: 'call', source: 'XC1152174' },
  { id: 'tree-sparrow-1', species: 'treeSparrow', kind: 'call', source: 'XC1143699' },
  { id: 'tree-sparrow-2', species: 'treeSparrow', kind: 'call', source: 'XC1143702' },
  { id: 'tit-1', species: 'greatTit', kind: 'song', source: 'XC707385' },
  { id: 'tit-2', species: 'greatTit', kind: 'song', source: 'XC707385' },
  { id: 'tit-3', species: 'greatTit', kind: 'song', source: 'XC707385' },
  { id: 'blackbird-1', species: 'blackbird', kind: 'song', source: 'File:Common blackbird singing denoised.flac' },
  { id: 'blackbird-2', species: 'blackbird', kind: 'song', source: 'File:Turdus merula 2.ogg' },
  { id: 'blackbird-3', species: 'blackbird', kind: 'song', source: 'File:Turdus merula 2.ogg' },
  { id: 'blackbird-4', species: 'blackbird', kind: 'song', source: 'File:Turdus merula 2.ogg' },
  { id: 'starling-1', species: 'starling', kind: 'call', source: 'XC934628' },
  { id: 'starling-2', species: 'starling', kind: 'call', source: 'XC934628' },
  { id: 'starling-3', species: 'starling', kind: 'call', source: 'XC934628' },
  { id: 'crow-1', species: 'hoodedCrow', kind: 'call', source: 'XC707409' },
  { id: 'crow-2', species: 'hoodedCrow', kind: 'call', source: 'XC776850' },
  { id: 'wagtail-1', species: 'whiteWagtail', kind: 'call', source: 'XC1100607' },
  { id: 'wagtail-2', species: 'whiteWagtail', kind: 'call', source: 'XC707274' },
  { id: 'woodpecker-drum-1', species: 'woodpecker', kind: 'drum', source: 'XC730508' },
  { id: 'woodpecker-drum-2', species: 'woodpecker', kind: 'drum', source: 'XC1133218' },
  { id: 'woodpecker-call-1', species: 'woodpecker', kind: 'call', source: 'XC707123' },
  { id: 'cuckoo-1', species: 'cuckoo', kind: 'song', source: 'XC1095924' },
  { id: 'cuckoo-2', species: 'cuckoo', kind: 'song', source: 'XC987707' },
];

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function clipUrl(base: string, id: string, ext: 'webm' | 'm4a'): string {
  const root = base.endsWith('/') ? base : `${base}/`;
  return `${root}${BIRD_AUDIO_DIR}${id}.${ext}`;
}

/** Clips of a species whose buffers have decoded. `loaded` holds clip ids. */
export function readyClips(
  species: string,
  kinds: readonly ClipKind[],
  loaded: ReadonlySet<string>,
): BirdClip[] {
  const out: BirdClip[] = [];
  for (const clip of BIRD_CLIPS) {
    if (clip.species === species && kinds.includes(clip.kind) && loaded.has(clip.id)) out.push(clip);
  }
  return out;
}

export function speciesHasClips(species: string, kinds: readonly ClipKind[]): boolean {
  for (const clip of BIRD_CLIPS) {
    if (clip.species === species && kinds.includes(clip.kind)) return true;
  }
  return false;
}

export function pickClip(clips: readonly BirdClip[], rng: () => number): BirdClip | null {
  if (clips.length === 0) return null;
  const i = Math.min(clips.length - 1, Math.floor(rng() * clips.length));
  return clips[i] ?? null;
}

/**
 * Per-playback pitch and level. `doppler` is dopplerFactor() (about 0.8..1.25);
 * the extra wobble keeps repeated takes from sounding identical.
 */
export function sampleVariation(rng: () => number, doppler = 1): { playbackRate: number; gain: number } {
  const wobble = 0.96 + rng() * 0.08;
  return {
    playbackRate: clamp((Number.isFinite(doppler) ? doppler : 1) * wobble, 0.75, 1.35),
    gain: 0.72 + rng() * 0.36,
  };
}

/** How many scream one-shots to stack. A party take is already several birds. */
export function screamCount(party: boolean, distance: number, rng: () => number): number {
  if (party || distance >= 60) return 1;
  return rng() < 0.45 ? 3 : 2;
}
