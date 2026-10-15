import type { ManualEdits } from '../types';

export const EDITOR_PREVIEW_MAX_SIZE = 1600;

export interface PreviewRequest {
  id: number;
  sourceKey: string;
  file: File;
  edits: ManualEdits;
}

export type PreviewResponse = { id: number; blob?: Blob; error?: string };
