import { renderEdits } from '../utils/imageRenderer';
import { EDITOR_PREVIEW_MAX_SIZE, type PreviewRequest, type PreviewResponse } from '../utils/editorPreviewProtocol';

let sourceKey: string | null = null;
let bitmap: ImageBitmap | null = null;

// The client serializes work. Keep only the active source decoded between slider changes.
self.onmessage = async ({ data }: MessageEvent<PreviewRequest>) => {
  try {
    if (sourceKey !== data.sourceKey || !bitmap) {
      bitmap?.close();
      bitmap = null;
      sourceKey = null;
      bitmap = await createImageBitmap(data.file);
      sourceKey = data.sourceKey;
    }
    const canvas = renderEdits(
      { image: bitmap, width: bitmap.width, height: bitmap.height }, data.edits,
      { scale: 1, maxSize: EDITOR_PREVIEW_MAX_SIZE }, () => new OffscreenCanvas(1, 1),
    );
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    self.postMessage({ id: data.id, blob } satisfies PreviewResponse);
  } catch (error) {
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) } satisfies PreviewResponse);
  }
};
