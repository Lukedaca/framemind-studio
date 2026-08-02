// Local face / eye detection ported from framemind-agent. MediaPipe is loaded
// lazily so ordinary imports stay fast and photo pixels remain in the browser.

const MP_VERSION = '0.10.35';
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export interface FaceBoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DetectedFace {
  bbox: FaceBoundingBox;
  area: number;
  eyeBlink: number;
}

export interface FaceDetectionResult {
  faceCount: number;
  faces: DetectedFace[];
  primary: DetectedFace | null;
}

interface FaceLandmarkerLike {
  detect(source: CanvasImageSource): {
    faceLandmarks?: Array<Array<{ x: number; y: number }>>;
    faceBlendshapes?: Array<{ categories?: Array<{ categoryName?: string; score?: number }> }>;
  } | null;
}

interface MediaPipeVisionModule {
  FilesetResolver: {
    forVisionTasks(baseUrl: string): Promise<unknown>;
  };
  FaceLandmarker: {
    createFromOptions(
      vision: unknown,
      options: {
        baseOptions: { modelAssetPath: string };
        outputFaceBlendshapes: boolean;
        numFaces: number;
        runningMode: 'IMAGE';
      }
    ): Promise<FaceLandmarkerLike>;
  };
}

let landmarkerPromise: Promise<FaceLandmarkerLike> | null = null;

function loadLandmarker(): Promise<FaceLandmarkerLike> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const moduleUrl = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`;
      const { FilesetResolver, FaceLandmarker } = (await import(
        /* @vite-ignore */ moduleUrl
      )) as MediaPipeVisionModule;
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
      return FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL },
        outputFaceBlendshapes: true,
        numFaces: 8,
        runningMode: 'IMAGE',
      });
    })().catch((error) => {
      landmarkerPromise = null;
      throw error;
    });
  }
  return landmarkerPromise;
}

export async function detectFaces(
  source: CanvasImageSource,
  width: number,
  height: number
): Promise<FaceDetectionResult> {
  const landmarker = await loadLandmarker();
  const result = landmarker.detect(source);
  const faceLandmarks = result?.faceLandmarks || [];
  if (!faceLandmarks.length) return { faceCount: 0, faces: [], primary: null };

  const blendshapes = result?.faceBlendshapes || [];
  const faces = faceLandmarks.map((landmarks, index) => {
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;
    for (const point of landmarks) {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }

    const categories = blendshapes[index]?.categories || [];
    const score = (name: string) =>
      categories.find((category) => category.categoryName === name)?.score || 0;

    return {
      bbox: {
        x: minX * width,
        y: minY * height,
        w: Math.max(1, (maxX - minX) * width),
        h: Math.max(1, (maxY - minY) * height),
      },
      area: Math.max(0, (maxX - minX) * (maxY - minY)),
      eyeBlink: Math.max(score('eyeBlinkLeft'), score('eyeBlinkRight')),
    };
  });

  faces.sort((first, second) => second.area - first.area);
  return { faceCount: faces.length, faces, primary: faces[0] || null };
}
