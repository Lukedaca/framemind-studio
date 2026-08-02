// Detekce osob pro měření ostrosti na subjektu.
//
// Proč vlastní detektor: ostrost se dá měřit spolehlivě, ale jen tam, kde je
// subjekt. Levné heuristiky pro jeho nalezení selhaly každá jinak — pevná
// mřížka 3×3 pokryje 1,9 % plochy a hráče míjí, těžiště hranové energie míří
// na dav v tribuně (ten má obrovskou plochu s hranami i rozostřený) a maska
// zeleného hřiště trefuje jen nohy, protože trup je nad horizontem trávy.
//
// MediaPipe už appka načítá kvůli obličejům, takže tohle je stejný FilesetResolver
// a stejný lazy pattern, jen jiný model. Stahuje se až při prvním použití.

const MP_VERSION = '0.10.35';
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
// EfficientDet-Lite0, 7,25 MB. Lite2 je přesnější na malé objekty, ale 12,1 MB
// — na hráče přes celé hřiště Lite0 stačí a stažení je znatelně rychlejší.
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';

// Nízko schválně: radši víc kandidátů a vybrat největšího, než přijít o hráče
// v protisvětle. Falešná detekce se stejně projeví jen jako místo měření.
const SCORE_THRESHOLD = 0.28;
const MAX_RESULTS = 24;

export interface SubjectBox {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

export interface SubjectDetectionResult {
  subjects: SubjectBox[];
  /** Největší nalezená osoba — na ní se měří ostrost. */
  primary: SubjectBox | null;
}

interface ObjectDetectorLike {
  detect(source: CanvasImageSource): {
    detections?: Array<{
      boundingBox?: { originX: number; originY: number; width: number; height: number };
      categories?: Array<{ categoryName?: string; score?: number }>;
    }>;
  } | null;
}

interface MediaPipeVisionModule {
  FilesetResolver: { forVisionTasks(baseUrl: string): Promise<unknown> };
  ObjectDetector: {
    createFromOptions(
      vision: unknown,
      options: {
        baseOptions: { modelAssetPath: string };
        scoreThreshold: number;
        maxResults: number;
        runningMode: 'IMAGE';
        categoryAllowlist: string[];
      }
    ): Promise<ObjectDetectorLike>;
  };
}

let detectorPromise: Promise<ObjectDetectorLike> | null = null;

function loadDetector(): Promise<ObjectDetectorLike> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const moduleUrl = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`;
      const { FilesetResolver, ObjectDetector } = (await import(
        /* @vite-ignore */ moduleUrl
      )) as MediaPipeVisionModule;
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
      return ObjectDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL },
        scoreThreshold: SCORE_THRESHOLD,
        maxResults: MAX_RESULTS,
        runningMode: 'IMAGE',
        categoryAllowlist: ['person'],
      });
    })().catch((error) => {
      detectorPromise = null;
      throw error;
    });
  }
  return detectorPromise;
}

/** Rámeček menší než tohle nemá dost pixelů, aby z něj ostrost něco řekla. */
export const MIN_SUBJECT_SIDE = 8;

export interface RawDetection {
  boundingBox?: { originX: number; originY: number; width: number; height: number };
  categories?: Array<{ categoryName?: string; score?: number }>;
}

/**
 * Oddělené od volání modelu, aby šlo testovat bez sítě a bez WASM.
 * Ořízne rámečky do snímku, zahodí drobty a seřadí podle plochy.
 */
export function normalizeDetections(
  detections: RawDetection[],
  width: number,
  height: number
): SubjectDetectionResult {
  const subjects: SubjectBox[] = [];
  for (const detection of detections) {
    const box = detection.boundingBox;
    if (!box) continue;
    if (![box.originX, box.originY, box.width, box.height].every(Number.isFinite)) continue;
    // Model občas vrátí rámeček přesahující okraj — ořízneme do snímku, včetně
    // záporného počátku, aby se ořez nepromítl do šířky jako záporné číslo.
    const x = Math.max(0, Math.min(width - 1, box.originX));
    const y = Math.max(0, Math.min(height - 1, box.originY));
    const right = Math.min(width, box.originX + box.width);
    const bottom = Math.min(height, box.originY + box.height);
    const w = right - x;
    const h = bottom - y;
    if (w < MIN_SUBJECT_SIDE || h < MIN_SUBJECT_SIDE) continue;
    subjects.push({ x, y, w, h, score: detection.categories?.[0]?.score ?? 0 });
  }

  // Největší plocha = hlavní subjekt. U sportu je to hráč v popředí, u skupiny
  // ten nejblíž — a přesně na něm fotograf ostří.
  subjects.sort((first, second) => second.w * second.h - first.w * first.h);
  return { subjects, primary: subjects[0] || null };
}

export async function detectSubjects(
  source: CanvasImageSource,
  width: number,
  height: number
): Promise<SubjectDetectionResult> {
  const detector = await loadDetector();
  return normalizeDetections(detector.detect(source)?.detections || [], width, height);
}
