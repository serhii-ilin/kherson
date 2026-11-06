/**
 * WebP decoder for the PBR material library. Runs off the main thread: `createImageBitmap` reads the WebP,
 * an `OffscreenCanvas` draws it at the target size (a no-op scale when the asset is already square) and
 * `getImageData` gives the RGBA bytes uploaded to a `DataArrayTexture`. One worker serves all layers.
 *
 * The asset files carry no alpha, so premultiplied readback cannot distort the colour channels; we still
 * ask for no premultiplication and no colour conversion to keep the bytes exactly as the asset packed them.
 */

export interface PbrDecodeRequest {
  id: number;
  /** Encoded WebP file. */
  bytes: ArrayBuffer;
  /** Texture edge length in texels (512 or 256). */
  size: number;
}

export interface PbrDecodeResponse {
  id: number;
  data?: Uint8Array;
  error?: string;
}

interface WorkerScope {
  onmessage: ((e: MessageEvent<PbrDecodeRequest>) => void) | null;
  postMessage(message: PbrDecodeResponse, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

async function decode(request: PbrDecodeRequest): Promise<void> {
  const { id, bytes, size } = request;
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    try {
      const canvas = new OffscreenCanvas(size, size);
      const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
      if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');
      if (bitmap.width === size && bitmap.height === size) ctx.drawImage(bitmap, 0, 0);
      else ctx.drawImage(bitmap, 0, 0, size, size);
      const image = ctx.getImageData(0, 0, size, size);
      const data = new Uint8Array(image.data.buffer);
      scope.postMessage({ id, data }, [data.buffer]);
    } finally {
      bitmap.close();
    }
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
}

scope.onmessage = (e) => {
  void decode(e.data);
};
