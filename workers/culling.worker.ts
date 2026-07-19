// Pixelové heuristiky běží mimo main thread, aby velká dávka nezamrazila UI.
// Main thread dekóduje fotku na RGBA bajty a přenese buffer sem; worker vrací
// skóre. Matika žije v utils/cullingMetrics.ts, sdílená se sync fallbackem.

import { readMetrics } from '../utils/cullingMetrics';

self.onmessage = (event: MessageEvent<{ id: number; data: ArrayBuffer; width: number; height: number }>) => {
  const { id, data, width, height } = event.data || ({} as never);
  try {
    const metrics = readMetrics(new Uint8ClampedArray(data), width, height);
    self.postMessage({ id, metrics });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
