// Runs the AI background-removal model inside its OWN disposable Web Worker.
//
// The underlying WASM/ONNX runtime only ever grows its memory arena across
// calls — there's no public API to reset it mid-session (checked the
// library's own source directly). Reusing one long-lived session is exactly
// why processing several product photos back-to-back in one sitting gets
// progressively slower, and on a memory-constrained phone, can plausibly
// tip into visibly corrupted output (confirmed: measured processing time
// climb 25s -> 29s -> 39s across 3 sequential photos on a desktop browser,
// where even the smallest of the three was the slowest).
//
// A Web Worker is its own isolated JS execution context with its own
// memory. Spinning up a FRESH one for every single photo and terminating it
// immediately after gives a hard, guaranteed memory reset every time,
// regardless of what the AI library does internally — the correct fix for
// "an in-process resource that only grows," not a workaround around it.
//
// The library is worker-safe: it prefers OffscreenCanvas/createImageBitmap
// over document/Image when available (verified directly in its source),
// which is exactly what a Worker scope provides.

import { removeBackground } from '@imgly/background-removal';

export interface WorkerRequest {
  dataUrl: string;
  publicPath?: string;
}

export type WorkerResponse =
  | { type: 'progress'; current: number; total: number }
  | { type: 'done'; buffer: ArrayBuffer; mime: string }
  | { type: 'error'; message: string };

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { dataUrl, publicPath } = e.data;
  try {
    const blob = await removeBackground(dataUrl, {
      output: { format: 'image/png' },
      publicPath,
      progress: (_key, current, total) => {
        const msg: WorkerResponse = { type: 'progress', current, total };
        self.postMessage(msg);
      },
    });
    const buffer = await blob.arrayBuffer();
    const msg: WorkerResponse = { type: 'done', buffer, mime: blob.type || 'image/png' };
    self.postMessage(msg, { transfer: [buffer] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const msg: WorkerResponse = { type: 'error', message };
    self.postMessage(msg);
  }
};
