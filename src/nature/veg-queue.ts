import type { VegModel } from './models.ts';
import type { VegRequest, VegResponse } from './veg.worker.ts';

export interface VegTransport {
  post(req: VegRequest): void;
  terminate(): void;
}

/**
 * Request/cache bookkeeping for asynchronous model builds. Pure (no Worker): the transport is injected
 * lazily, on the first request. Each key is requested at most once; results are cached by the caller.
 */
export class VegModelQueue {
  private readonly pending = new Map<number, number>(); // request id -> key
  private readonly requested = new Set<number>();
  private transport: VegTransport | null = null;
  private nextId = 1;

  constructor(
    private readonly create: () => VegTransport,
    private readonly onModel: (key: number, model: VegModel) => void,
  ) {}

  /** True once `key` has been requested (done or in flight). */
  has(key: number): boolean {
    return this.requested.has(key);
  }

  /** Requests a build unless `key` was requested before. */
  request(key: number, species: number, variant: number, lod: 0 | 1 | 2 | 3): void {
    if (this.requested.has(key)) return;
    this.requested.add(key);
    if (this.transport === null) this.transport = this.create();
    const id = this.nextId++;
    this.pending.set(id, key);
    this.transport.post({ id, species, variant, lod });
  }

  receive(res: VegResponse): void {
    const key = this.pending.get(res.id);
    if (key === undefined) return;
    this.pending.delete(res.id);
    if (res.model) this.onModel(key, res.model);
    // on error the key stays requested: the instances keep the 0.5 m model
  }

  dispose(): void {
    this.transport?.terminate();
    this.transport = null;
    this.pending.clear();
  }
}
