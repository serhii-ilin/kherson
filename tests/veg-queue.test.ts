import { describe, it, expect } from 'vitest';
import { VegModelQueue, type VegTransport } from '../src/nature/veg-queue.ts';
import type { VegRequest } from '../src/nature/veg.worker.ts';
import type { VegModel } from '../src/nature/models.ts';

const fake = {} as VegModel;

describe('VegModelQueue', () => {
  it('creates the transport lazily and requests each key once', () => {
    const posted: VegRequest[] = [];
    let created = 0, terminated = 0;
    const got: number[] = [];
    const q = new VegModelQueue(
      () => { created++; return { post: (r) => posted.push(r), terminate: () => terminated++ } satisfies VegTransport; },
      (k) => got.push(k),
    );
    expect(created).toBe(0);
    q.request(5, 1, 2, 3);
    q.request(5, 1, 2, 3);
    q.request(6, 2, 0, 3);
    expect(created).toBe(1);
    expect(posted.length).toBe(2);
    expect(q.has(5)).toBe(true);
    q.receive({ id: posted[0]!.id, model: fake });
    q.receive({ id: posted[0]!.id, model: fake }); // duplicate ignored
    q.receive({ id: posted[1]!.id, error: 'x' });
    expect(got).toEqual([5]);
    q.request(6, 2, 0, 3); // errored keys are not retried
    expect(posted.length).toBe(2);
    q.dispose();
    expect(terminated).toBe(1);
  });
});
