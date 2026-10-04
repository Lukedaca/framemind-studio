import type { CullingResult, CullingGenre } from '../types';
import type { PhotoAnalysis, SimilarityInput, SimilarityAssignment } from './cullingEngine';

export type CullingRequest =
  | { id: number; kind: 'analyze'; file: File; metadataFile: File; source: NonNullable<CullingResult['source']> }
  | { id: number; kind: 'group'; items: SimilarityInput[] }
  | { id: number; kind: 'score'; analysis: PhotoAnalysis; genre: CullingGenre | null };
export interface CullingResponse { id: number; value?: PhotoAnalysis | [string, SimilarityAssignment][] | CullingResult; error?: string }
