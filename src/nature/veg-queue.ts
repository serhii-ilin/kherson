import type { VegModel } from './models.ts';
import type { VegRequest, VegResponse } from './veg.worker.ts';

export interface VegTransport {
  post(req: VegRequest): void;
  terminate(): void;
}

interface Waiting {
  species: number;
  variant: number;
  lod: 0 | 1 | 2 | 3;
  prio: number;
}

/**
 * Request/cache bookkeeping for asynchronous model builds. Pure (no Worker): the transport is injected
 * lazily, on the first request. The key is chosen by the caller (vegetation.ts: model * 4 + lod slot, i.e.
 * one key per (model, lod)). Each key is built at most once; results are cached by the caller.
 *
 * Requests wait in a priority list (smaller `priority` = sooner, typically the squared distance of the
 * nearest instance) and at most `maxInFlight` builds are at the worker at a time, so the nearest trees
 * arrive first and a far-away request never delays a near one by more than the builds already running.
 */
export class VegModelQueue {
  private readonly pending = new Map<number, number>(); // request id -> key
  private readonly requested = new Set<number>();
  private readonly waiting = new Map<number, Waiting>();
  private transport: VegTransport | null = null;
  private nextId = 1;
  private inFlight = 0;

  constructor(
    private readonly create: () => VegTransport,
    private readonly onModel: (key: number, model: VegModel) => void,
    private readonly maxInFlight = 2,
  ) {}

  /** True once `key` has been requested (done, in flight or waiting). */
  has(key: number): boolean {
    return this.requested.has(key);
  }

  /** Number of requests not yet sent to the worker. */
  get queued(): number { return this.waiting.size; }

  /** Marks every waiting request as unwanted (lowest priority) until it is requested again. Call once per LOD pass. */
  reprioritize(): void {
    for (const w of this.waiting.values()) w.prio = Infinity;
  }

  /** Requests a build unless `key` was requested before; for a waiting key the smaller priority wins. */
  request(key: number, species: number, variant: number, lod: 0 | 1 | 2 | 3, priority = 0): void {
    if (this.requested.has(key)) {
      const w = this.waiting.get(key);
      if (w !== undefined && priority < w.prio) w.prio = priority;
      return;
    }
    this.requested.add(key);
    this.waiting.set(key, { species, variant, lod, prio: priority });
    this.pump();
  }

  receive(res: VegResponse): void {
    const key = this.pending.get(res.id);
    if (key === undefined) return;
    this.pending.delete(res.id);
    this.inFlight--;
    if (res.model) this.onModel(key, res.model);
    // on error the key stays requested: the instances keep the coarser stand-in model
    this.pump();
  }

  dispose(): void {
    this.transport?.terminate();
    this.transport = null;
    this.pending.clear();
    this.waiting.clear();
    this.inFlight = 0;
  }

  private pump(): void {
    while (this.inFlight < this.maxInFlight && this.waiting.size > 0) {
      let bk = -1, bp = Infinity;
      for (const [k, w] of this.waiting) {
        if (bk < 0 || w.prio < bp) { bk = k; bp = w.prio; }
      }
      const w = this.waiting.get(bk)!;
      this.waiting.delete(bk);
      if (this.transport === null) this.transport = this.create();
      const id = this.nextId++;
      this.pending.set(id, bk);
      this.inFlight++;
      this.transport.post({ id, species: w.species, variant: w.variant, lod: w.lod });
    }
  }
}
