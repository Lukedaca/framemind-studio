import type { CullingResult, CullingGenre, CullingIntent } from '../types';
import type { PhotoAnalysis, SimilarityInput, SimilarityAssignment } from './cullingEngine';
import type { CullingInspection, InspectionPoint } from './cullingInspection';

export type CullingRequest =
  | { id: number; kind: 'analyze'; file: File; metadataFile: File; source: NonNullable<CullingResult['source']>; focusRegion?: CullingResult['focusRegion']; focusRegions?: CullingResult['focusRegions']; automatic?: boolean }
  | { id: number; kind: 'verify-duplicate'; file: File; reference: File; bytesOnly?: boolean }
  | { id: number; kind: 'inspect'; file: File; point: InspectionPoint }
  | { id: number; kind: 'group'; items: SimilarityInput[] }
  | { id: number; kind: 'score'; analysis: PhotoAnalysis; genre: CullingGenre | null; intent?: CullingIntent };
export interface CullingResponse { id: number; value?: PhotoAnalysis | CullingInspection | [string, SimilarityAssignment][] | CullingResult | boolean; error?: string }
