import { describe, expect, it } from 'vitest';
import { decodePose, encodePose, type SavedPose } from '../src/player/pose-memory.ts';

const W = 20000;
const H = 16000;

describe('pose memory', () => {
  it('round-trips a walk and a fly pose', () => {
    const walk: SavedPose = { mode: 'walk', x: 10234.56, y: 3.2, z: 9100.04, yaw: 1.23456, pitch: -0.1 };
    const back = decodePose(encodePose(walk), W, H)!;
    expect(back.mode).toBe('walk');
    expect(back.x).toBeCloseTo(walk.x, 1);
    expect(back.z).toBeCloseTo(walk.z, 1);
    expect(back.yaw).toBeCloseTo(walk.yaw, 3);
    const fly: SavedPose = { mode: 'fly', x: 500, y: 240, z: 700, yaw: -2, pitch: -0.4 };
    expect(decodePose(encodePose(fly), W, H)).toEqual(fly);
  });

  it('rejects missing, damaged and out-of-world values', () => {
    expect(decodePose(null, W, H)).toBeNull();
    expect(decodePose('not json', W, H)).toBeNull();
    expect(decodePose('null', W, H)).toBeNull();
    expect(decodePose('{"mode":"swim","x":1,"y":1,"z":1,"yaw":0,"pitch":0}', W, H)).toBeNull();
    expect(decodePose('{"mode":"walk","x":"1","y":1,"z":1,"yaw":0,"pitch":0}', W, H)).toBeNull();
    expect(decodePose(encodePose({ mode: 'walk', x: W + 1, y: 0, z: 1, yaw: 0, pitch: 0 }), W, H)).toBeNull();
    expect(decodePose(encodePose({ mode: 'fly', x: 1, y: 9000, z: 1, yaw: 0, pitch: 0 }), W, H)).toBeNull();
    expect(decodePose('{"mode":"walk","x":1,"y":null,"z":1,"yaw":0,"pitch":0}', W, H)).toBeNull();
  });
});
