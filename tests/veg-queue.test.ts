import { describe, it, expect } from 'vitest';
import { VegModelQueue, type VegTransport } from '../src/nature/veg-queue.ts';
import type { VegRequest } from '../src/nature/veg.worker.ts';
import type { VegModel } from '../src/nature/models.ts';

const fake = {} as VegModel;

function make(max?: number) {
  const posted: VegRequest[] = [];
  const got: number[] = [];
  let created = 0, terminated = 0;
  const q = new VegModelQueue(
    () => { created++; return { post: (r) => posted.push(r), terminate: () => terminated++ } satisfies VegTransport; },
    (k) => got.push(k),
    max,
  );
  return { q, posted, got, created: () => created, terminated: () => terminated };
}

describe('VegModelQueue', () => {
  it('creates the transport lazily and requests each key once', () => {
    const { q, posted, got, created, terminated } = make();
    expect(created()).toBe(0);
    q.request(5, 1, 2, 3);
    q.request(5, 1, 2, 3);
    q.request(6, 2, 0, 2);
    expect(created()).toBe(1);
    expect(posted.length).toBe(2);
    expect(q.has(5)).toBe(true);
    q.receive({ id: posted[0]!.id, model: fake });
    q.receive({ id: posted[0]!.id, model: fake }); // duplicate ignored
    q.receive({ id: posted[1]!.id, error: 'x' });
    expect(got).toEqual([5]);
    q.request(6, 2, 0, 2); // errored keys are not retried
    expect(posted.length).toBe(2);
    q.dispose();
    expect(terminated()).toBe(1);
  });

  it('keys are per (model, lod): the same model at two LODs is two builds', () => {
    const { q, posted } = make(8);
    q.request(3 * 4 + 0, 7, 1, 3);
    q.request(3 * 4 + 1, 7, 1, 0);
    expect(posted.map((p) => p.lod)).toEqual([3, 0]);
  });

  it('limits builds in flight and sends the nearest waiting request first', () => {
    const { q, posted, got } = make(1);
    q.request(1, 0, 0, 0, 900); // goes out at once (nothing else waiting)
    q.request(2, 0, 1, 0, 400);
    q.request(3, 0, 2, 0, 100);
    q.request(4, 0, 0, 2, 2500);
    expect(posted.length).toBe(1);
    expect(q.queued).toBe(3);
    q.receive({ id: posted[0]!.id, model: fake });
    expect(posted[1]!.variant).toBe(2); // key 3 (prio 100) first
    q.request(4, 0, 0, 2, 10); // a nearer instance appears for a waiting key
    q.receive({ id: posted[1]!.id, model: fake });
    expect(posted[2]!.lod).toBe(2); // key 4 now beats key 2
    q.receive({ id: posted[2]!.id, model: fake });
    expect(posted[3]!.variant).toBe(1);
    q.receive({ id: posted[3]!.id, model: fake });
    expect(got).toEqual([1, 3, 4, 2]);
    expect(q.queued).toBe(0);
  });

  it('reprioritize sinks unwanted requests below re-requested ones', () => {
    const { q, posted } = make(1);
    q.request(1, 0, 0, 0, 1);
    q.request(2, 0, 1, 0, 5);
    q.request(3, 0, 2, 0, 9);
    q.reprioritize();
    q.request(3, 0, 2, 0, 50); // key 2 is no longer wanted by the new camera cell
    q.receive({ id: posted[0]!.id, model: fake });
    expect(posted[1]!.variant).toBe(2);
  });
});
