
export type Language = 'cs' | 'en';

export interface UploadedFile {
  id: string;
  file: File;
  previewUrl: string;
  originalPreviewUrl: string;
  analysis?: AnalysisResult;
  isAnalyzing?: boolean;
  socialContent?: SocialMediaContent;
  generatedVideo?: GeneratedVideo;
  assessment?: QualityAssessment;
  culling?: CullingResult;
  originalFile?: File; // metadata and read-only original during this session
  cullingSource?: 'image' | 'embedded-jpeg-preview';
  category?: string;
}

export interface QualityAssessment {
    score: number; // 0-100
    isBestPick: boolean;
    flags: string[]; // ['Blurry', 'Closed Eyes', 'Bad Exposure', 'Great Composition']
}

// --- Local technical culling (FrameMind Solutions for Photo 1.0) ---

export type CullingDecision = 'keep' | 'review' | 'reject';

export type CullingVerdictSource = 'technical' | 'manual' | 'legacy';

export interface CullingExif {
  captureTimeMs?: number;
  exposureTime?: number; // seconds
  iso?: number;
  aperture?: number;
  focalLength?: number; // mm
}

export interface CullingSignature {
  averageHash: string; // 256 bits
  differenceHash: string; // 256 bits
  luma: number[]; // 32 x 32 area averages, 0-1
  color: number[]; // 16 x 16 RGB area averages, 0-1
  histogram: number[]; // 16 luminance bins, unit sum
  detail: number; // luminance standard deviation / 255
}

export interface CullingTechnicalMetrics {
  width: number;
  height: number;
  medianLuma: number;
  p1: number;
  p5: number;
  p95: number;
  p99: number;
  standardDeviation: number;
  entropy: number; // bits
  dynamicRange: number; // p95 - p5, luminance units
  redClip: number;
  greenClip: number;
  blueClip: number;
  redShadowClip: number;
  greenShadowClip: number;
  blueShadowClip: number;
  laplacianVariance: number; // denoised, noise-floor corrected
  tenengrad: number; // denoised Sobel mean squared magnitude
  edgeDensity: number;
  detailConfidence: number; // evidence of measurable structure, not probability
  noiseEstimate: number; // approximate luminance sigma, 0-255 scale
  noiseConfidence: number; // coverage of usable low-texture samples
  gradientAnisotropy: number;
  motionBlurEstimate: number; // weak directional cue, never a sole reject rule
  motionConfidence: number;
}

export type CullingScorePart = 'sharpness' | 'exposure' | 'clipping' | 'noise' | 'contrast' | 'motion';
export type CullingScoreBreakdown = Record<CullingScorePart, { score: number; weight: number; contribution: number }>;

export type CullingGenre =
  | 'sport'
  | 'portrait'
  | 'wedding'
  | 'product'
  | 'landscape'
  | 'street'
  | 'wildlife'
  | 'event'
  | 'other';

export interface CullingMetrics {
  hash: string;
  meanLuma: number;
  sharpnessScore: number; // 0-1
  exposureScore: number; // 0-1
  highlightClipping: number; // 0-1, podíl přepálených pixelů
  shadowClipping: number; // 0-1
  contrastScore: number; // 0-1
  noiseScore: number; // 0-1, 1 = čistý
  compositionScore: number; // legacy/taste storage only, local culling sets 0
  // Legacy measurement, retained for existing stored projects; local 1.0 sets 0.
  nativeSharpness: number;
  subjectFound?: boolean; // legacy storage only
  // New diagnostics are optional only so pre-1.0 stored projects remain readable.
  // The 1.0 engine requires these before producing automatic technical verdicts.
  technical?: CullingTechnicalMetrics;
  signature?: CullingSignature;
}

export interface CullingResult {
  metrics: CullingMetrics;
  finalScore: number; // 0-100 (žánrově vážený)
  decision: CullingDecision;
  manualDecision?: CullingDecision;
  reasons: string[]; // translation keys derived from measured evidence
  risks: string[];
  aspectRatio: number;
  duplicateGroupId?: string;
  isBestInGroup?: boolean;
  groupRank?: number;
  genre?: CullingGenre;
  engineVersion?: string;
  analysisStatus?: 'done' | 'error';
  source?: 'image' | 'embedded-jpeg-preview';
  exif?: CullingExif;
  scoreBreakdown?: CullingScoreBreakdown;
  groupKind?: 'near-duplicate' | 'burst';
  similarityToBest?: number;
  relativeSharpness?: number;
  scoreGap?: number; // fractional difference from the best technical score
}

export interface SocialMediaContent {
    captions: {
        tone: string;
        text: string;
    }[];
    hashtags: string[];
}

export interface GeneratedVideo {
    url: string;
    expiry: number;
}

export interface ProactiveSuggestion {
  text: string;
  action: 'remove-object' | 'auto-crop';
}

export interface AnalysisResult {
  description: string;
  suggestions: string[];
  technicalInfo: {
    ISO: string;
    Aperture: string;
    ShutterSpeed: string;
  };
  proactiveSuggestions?: ProactiveSuggestion[];
}

export interface WatermarkSettings {
    enabled: boolean;
    text: string;
    opacity: number; // 0-100
    size: number; // 10-100 (percentage of width mostly)
    position: 'center' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'tiled';
    color: string;
}

export interface ManualEdits {
  brightness: number;
  contrast: number;
  saturation: number;
  vibrance: number;
  shadows: number;
  highlights: number;
  clarity: number;
  sharpness: number;
  noiseReduction: number;
  cropRect?: CropCoordinates;
  aspectRatio?: number;
  watermark?: WatermarkSettings;
}

export interface CropCoordinates {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AutoCropComposition = 'centered' | 'rule-of-thirds' | 'golden-ratio';

export interface AutoCropSuggestion {
  aspectRatio: '1:1' | '4:3' | '3:2' | '16:9';
  rect: CropCoordinates;
  confidence: number;
}

export interface AutoCropResult {
  mainSubject: CropCoordinates;
  facesBoundingBox?: CropCoordinates | null;
  suggestedCrops: AutoCropSuggestion[];
  safeZone: CropCoordinates;
  composition: AutoCropComposition;
}

export type EnhancementMode =
  | 'auto'
  | 'portrait'
  | 'landscape'
  | 'product'
  | 'food'
  | 'real-estate'
  | 'social-media'
  | 'print'
  | 'cinematic'
  | 'your-style';

export interface GeneratedPreset {
  id: string;
  name: string;
  edits: Omit<ManualEdits, 'cropRect'>;
}

export interface AIAutopilotAnalysis {
  exposure: { value: number; suggestion: string };
  colors: { temperature: number; saturation: number; suggestion: string };
  composition: { score: number; suggestion: string };
  sharpness: { value: number; suggestion: string };
}

export interface AIAutopilotResult {
  enhancedImageBase64: string;
  enhancedFile?: File;
  appliedEdits: ManualEdits;
  analysis: AIAutopilotAnalysis;
  stylePresets: GeneratedPreset[];
  nextSuggestions: string[];
}

export type EditorAction = {
  action: string;
  timestamp: number;
} | null;

export type View =
  | 'dashboard'
  | 'upload'
  | 'culling'
  | 'editor'
  | 'projects'
  | 'project-detail'
  | 'clients'
  | 'client-detail'
  | 'gallery-preview';

export type JobTemplate = 'portrait' | 'event' | 'product' | 'social' | 'none';

export type WorkflowStep = 'import' | 'culling' | 'edit' | 'retouch' | 'export';

export type ProjectStatus = 'draft' | 'editing' | 'review' | 'delivered';

export interface Client {
  id: string;
  name: string;
  email: string;
  phone?: string;
  notes?: string;
  createdAt: string;
}

export interface GallerySettings {
  published: boolean;
  link?: string;
  selectedFileIds: string[];
  allowDownload: boolean;
  expiresAt?: string;
}

export interface ActivityEvent {
  id: string;
  type: 'created' | 'uploaded' | 'edited' | 'published' | 'viewed' | 'downloaded';
  timestamp: string;
  description: string;
}

export interface Project {
  id: string;
  name: string;
  clientId: string;
  type: JobTemplate;
  status: ProjectStatus;
  date: string;
  notes?: string;
  files: UploadedFile[];
  gallery: GallerySettings;
  activity: ActivityEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface HistoryEntry {
  state: UploadedFile[];
  actionName: string;
}

export interface History {
  past: HistoryEntry[];
  present: HistoryEntry;
  future: HistoryEntry[];
}

export interface Preset {
  id: string;
  name: string;
  edits: Omit<ManualEdits, 'cropRect'>;
}

export type AIGalleryType = 'generate' | 'autopilot' | 'youtube-thumbnail';

export type YouTubeThumbnailTemplate =
  | 'shock-face'
  | 'authority-clean'
  | 'split-drama'
  | 'cinematic-poster';

export interface AIGalleryAsset {
  id: string;
  createdAt: string;
  type: AIGalleryType;
  prompt?: string;
  sourceFileId?: string;
  projectId?: string | null;
  fileName: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  tags?: string[];
  blob: Blob;
}

export interface AutopilotTendencies {
  brightness: number;
  contrast: number;
  saturation: number;
  vibrance: number;
  shadows: number;
  highlights: number;
  clarity: number;
  sharpness: number;
  noiseReduction: number;
}

export type Feedback = 'good' | 'bad';

export interface UserProfile {
  autopilotTendencies: AutopilotTendencies;
  feedbackHistory: Record<string, Feedback>;
  presets: Preset[];
  credits: number;
  hasSeenOnboarding: boolean;
  isAdmin: boolean;
}
