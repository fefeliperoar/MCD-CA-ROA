import './style.css';
import {
  ACESFilmicToneMapping,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  MOUSE,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  Vector2,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { DifferentialGrowthEngine, type DifferentialGrowthSnapshot } from './core/differentialGrowthEngine';
import { buildShapeGeometry } from './core/meshFactory';
import { MaterialController } from './core/materialController';
import type {
  AppState,
  BaseShape,
  GradientType,
  GrowthSettings,
  MaterialSettings,
  ShapeSettings,
  SimulationSettings,
} from './types';

type UiRefs = {
  panel: HTMLDivElement;
  handleTop: HTMLDivElement;
  handleBottom: HTMLDivElement;
  collapseToggle: HTMLButtonElement;
  start: HTMLButtonElement;
  reset: HTMLButtonElement;
  resetSubdivision: HTMLButtonElement;
  resetTransform: HTMLButtonElement;
  growthSpeed: HTMLInputElement;
  growthSpeedValue: HTMLSpanElement;
  timeline: HTMLInputElement;
  timelineValue: HTMLSpanElement;
  seed: HTMLInputElement;
  seedValueLabel: HTMLSpanElement;
  seedInfluence: HTMLInputElement;
  seedInfluenceValue: HTMLSpanElement;
  baseShape: HTMLSelectElement;
  subdivision: HTMLInputElement;
  subdivisionValue: HTMLSpanElement;
  scaleX: HTMLInputElement;
  scaleXValue: HTMLSpanElement;
  scaleY: HTMLInputElement;
  scaleYValue: HTMLSpanElement;
  scaleZ: HTMLInputElement;
  scaleZValue: HTMLSpanElement;
  showWireframe: HTMLInputElement;
  showMesh: HTMLInputElement;
  growthStep: HTMLInputElement;
  growthStepValue: HTMLSpanElement;
  targetEdgeLength: HTMLInputElement;
  targetEdgeLengthValue: HTMLSpanElement;
  splitThreshold: HTMLInputElement;
  splitThresholdValue: HTMLSpanElement;
  repulsion: HTMLInputElement;
  repulsionValue: HTMLSpanElement;
  smoothing: HTMLInputElement;
  smoothingValue: HTMLSpanElement;
  finalSmoothing: HTMLInputElement;
  finalSmoothingValue: HTMLSpanElement;
  shapeRetention: HTMLInputElement;
  shapeRetentionValue: HTMLSpanElement;
  maxVertices: HTMLInputElement;
  maxVerticesValue: HTMLSpanElement;
  gradientType: HTMLSelectElement;
  gradientStart: HTMLInputElement;
  gradientEnd: HTMLInputElement;
  curvatureContrast: HTMLInputElement;
  curvatureContrastValue: HTMLSpanElement;
  curvatureBias: HTMLInputElement;
  curvatureBiasValue: HTMLSpanElement;
  gradientBlur: HTMLInputElement;
  gradientBlurValue: HTMLSpanElement;
  fresnel: HTMLInputElement;
  fresnelValue: HTMLSpanElement;
  specular: HTMLInputElement;
  specularValue: HTMLSpanElement;
  bloom: HTMLInputElement;
  bloomValue: HTMLSpanElement;
  micReactiveToggle: HTMLButtonElement;
  exportScreenshot: HTMLButtonElement;
};

const MAX_TIMELINE_SNAPSHOTS = 240;
const MAX_HISTORY_STATES = 100;
type TimelineEntry = { step: number; snapshot: DifferentialGrowthSnapshot };
type HistorySnapshot = {
  simulationSettings: SimulationSettings;
  shapeSettings: ShapeSettings;
  growthSettings: GrowthSettings;
  materialSettings: MaterialSettings;
  appState: AppState;
  finalSmoothingAmount: number;
  finalSmoothingSource: Float32Array | null;
  engineSnapshot: DifferentialGrowthSnapshot;
};
type HistoryEntry = {
  before: HistorySnapshot;
  after: HistorySnapshot;
};

function revealUiWhenStyled(maxWaitMs = 1500): void {
  const start = performance.now();
  const tryReveal = (): void => {
    const styled = getComputedStyle(document.documentElement).getPropertyValue('--ui-size-scale').trim().length > 0;
    if (styled || performance.now() - start >= maxWaitMs) {
      document.documentElement.classList.add('ui-ready');
      return;
    }
    requestAnimationFrame(tryReveal);
  };
  tryReveal();
}

function requiredElement<T extends Element>(
  id: string,
  check: (element: Element) => element is T,
): T {
  const element = document.getElementById(id);
  if (!element || !check(element)) {
    throw new Error(`Required element #${id} was not found or has an unexpected type.`);
  }
  return element;
}

function isInput(element: Element): element is HTMLInputElement {
  return element instanceof HTMLInputElement;
}

function isSelect(element: Element): element is HTMLSelectElement {
  return element instanceof HTMLSelectElement;
}

function isButton(element: Element): element is HTMLButtonElement {
  return element instanceof HTMLButtonElement;
}

function isDiv(element: Element): element is HTMLDivElement {
  return element instanceof HTMLDivElement;
}

function isSpan(element: Element): element is HTMLSpanElement {
  return element instanceof HTMLSpanElement;
}

const ui: UiRefs = {
  panel: requiredElement('ui-panel', isDiv),
  handleTop: requiredElement('ui-handle', isDiv),
  handleBottom: requiredElement('ui-handle-bottom', isDiv),
  collapseToggle: requiredElement('collapse-toggle', isButton),
  start: requiredElement('start-sim', isButton),
  reset: requiredElement('reset-sim', isButton),
  resetSubdivision: requiredElement('reset-subdivision', isButton),
  resetTransform: requiredElement('reset-transform', isButton),
  growthSpeed: requiredElement('growth-speed', isInput),
  growthSpeedValue: requiredElement('growth-speed-value', isSpan),
  timeline: requiredElement('simulation-timeline', isInput),
  timelineValue: requiredElement('simulation-timeline-value', isSpan),
  seed: requiredElement('seed-value', isInput),
  seedValueLabel: requiredElement('seed-value-label', isSpan),
  seedInfluence: requiredElement('seed-influence', isInput),
  seedInfluenceValue: requiredElement('seed-influence-value', isSpan),
  baseShape: requiredElement('base-shape', isSelect),
  subdivision: requiredElement('subdivision', isInput),
  subdivisionValue: requiredElement('subdivision-value', isSpan),
  scaleX: requiredElement('scale-x', isInput),
  scaleXValue: requiredElement('scale-x-value', isSpan),
  scaleY: requiredElement('scale-y', isInput),
  scaleYValue: requiredElement('scale-y-value', isSpan),
  scaleZ: requiredElement('scale-z', isInput),
  scaleZValue: requiredElement('scale-z-value', isSpan),
  showWireframe: requiredElement('show-wireframe', isInput),
  showMesh: requiredElement('show-mesh', isInput),
  growthStep: requiredElement('growth-step', isInput),
  growthStepValue: requiredElement('growth-step-value', isSpan),
  targetEdgeLength: requiredElement('target-edge-length', isInput),
  targetEdgeLengthValue: requiredElement('target-edge-length-value', isSpan),
  splitThreshold: requiredElement('split-threshold', isInput),
  splitThresholdValue: requiredElement('split-threshold-value', isSpan),
  repulsion: requiredElement('repulsion', isInput),
  repulsionValue: requiredElement('repulsion-value', isSpan),
  smoothing: requiredElement('smoothing', isInput),
  smoothingValue: requiredElement('smoothing-value', isSpan),
  finalSmoothing: requiredElement('final-smoothing', isInput),
  finalSmoothingValue: requiredElement('final-smoothing-value', isSpan),
  shapeRetention: requiredElement('shape-retention', isInput),
  shapeRetentionValue: requiredElement('shape-retention-value', isSpan),
  maxVertices: requiredElement('max-vertices', isInput),
  maxVerticesValue: requiredElement('max-vertices-value', isSpan),
  gradientType: requiredElement('gradient-type', isSelect),
  gradientStart: requiredElement('gradient-start-color', isInput),
  gradientEnd: requiredElement('gradient-end-color', isInput),
  curvatureContrast: requiredElement('curvature-contrast', isInput),
  curvatureContrastValue: requiredElement('curvature-contrast-value', isSpan),
  curvatureBias: requiredElement('curvature-bias', isInput),
  curvatureBiasValue: requiredElement('curvature-bias-value', isSpan),
  gradientBlur: requiredElement('gradient-blur', isInput),
  gradientBlurValue: requiredElement('gradient-blur-value', isSpan),
  fresnel: requiredElement('fresnel', isInput),
  fresnelValue: requiredElement('fresnel-value', isSpan),
  specular: requiredElement('specular', isInput),
  specularValue: requiredElement('specular-value', isSpan),
  bloom: requiredElement('bloom', isInput),
  bloomValue: requiredElement('bloom-value', isSpan),
  micReactiveToggle: requiredElement('mic-reactive-toggle', isButton),
  exportScreenshot: requiredElement('export-screenshot', isButton),
};

const canvas = document.querySelector<HTMLCanvasElement>('#app-canvas');
if (!canvas) {
  throw new Error('Canvas #app-canvas was not found.');
}

revealUiWhenStyled();

const simulationSettings: SimulationSettings = {
  growthSpeed: Number.parseFloat(ui.growthSpeed.value),
  seed: Number.parseInt(ui.seed.value, 10),
  seedInfluence: Number.parseFloat(ui.seedInfluence.value),
};

const shapeSettings: ShapeSettings = {
  baseShape: ui.baseShape.value as BaseShape,
  subdivision: Number.parseInt(ui.subdivision.value, 10),
  scaleX: Number.parseFloat(ui.scaleX.value),
  scaleY: Number.parseFloat(ui.scaleY.value),
  scaleZ: Number.parseFloat(ui.scaleZ.value),
  showWireframe: ui.showWireframe.checked,
  showMesh: ui.showMesh.checked,
};

const growthSettings: GrowthSettings = {
  growthStep: Number.parseFloat(ui.growthStep.value),
  targetEdgeLength: Number.parseFloat(ui.targetEdgeLength.value),
  splitThreshold: Number.parseFloat(ui.splitThreshold.value),
  repulsion: Number.parseFloat(ui.repulsion.value),
  smoothing: Number.parseFloat(ui.smoothing.value),
  shapeRetention: Number.parseFloat(ui.shapeRetention.value),
  maxVertices: Number.parseInt(ui.maxVertices.value, 10),
};

const materialSettings: MaterialSettings = {
  gradientType: ui.gradientType.value as GradientType,
  gradientStart: ui.gradientStart.value,
  gradientEnd: ui.gradientEnd.value,
  curvatureContrast: Number.parseFloat(ui.curvatureContrast.value),
  curvatureBias: Number.parseFloat(ui.curvatureBias.value),
  gradientBlur: Number.parseFloat(ui.gradientBlur.value),
  fresnel: Number.parseFloat(ui.fresnel.value),
  specular: Number.parseFloat(ui.specular.value),
  bloom: Number.parseFloat(ui.bloom.value),
};

const appState: AppState = {
  running: false,
};

let finalSmoothingAmount = Number.parseFloat(ui.finalSmoothing.value);
let finalSmoothingSource: Float32Array | null = null;

const renderer = new WebGLRenderer({ antialias: true, canvas });
const getPixelRatio = (): number => Math.min(window.devicePixelRatio * 1.5, 3);
renderer.setPixelRatio(getPixelRatio());
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;

const scene = new Scene();
scene.background = new Color(0x000000);

const camera = new PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0, 0.25, 4.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = true;
controls.enableZoom = true;
controls.target.set(0, 0, 0);
controls.mouseButtons = {
  LEFT: -1 as unknown as MOUSE,
  MIDDLE: MOUSE.PAN,
  RIGHT: MOUSE.ROTATE,
};
controls.update();
renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());
window.addEventListener('contextmenu', (event) => event.preventDefault());

function buildScaledShapeGeometry(): BufferGeometry {
  const geometry = buildShapeGeometry(shapeSettings.baseShape, shapeSettings.subdivision);
  geometry.scale(shapeSettings.scaleX, shapeSettings.scaleY, shapeSettings.scaleZ);
  return geometry;
}

const materialController = new MaterialController(materialSettings);
const initialGeometry = buildScaledShapeGeometry();
prepareGeometry(initialGeometry);
const mesh = new Mesh(initialGeometry, materialController.material);
mesh.visible = shapeSettings.showMesh;
scene.add(mesh);
const wireframeMaterial = new MeshBasicMaterial({
  color: 0xe6f1ff,
  wireframe: true,
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
});
const wireframeMesh = new Mesh(initialGeometry, wireframeMaterial);
wireframeMesh.visible = shapeSettings.showWireframe;
wireframeMesh.renderOrder = 1;
scene.add(wireframeMesh);

const engine = new DifferentialGrowthEngine(initialGeometry, growthSettings, simulationSettings.seed);
engine.setGradientBlur(materialSettings.gradientBlur);

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const bloomPass = new UnrealBloomPass(
  new Vector2(window.innerWidth, window.innerHeight),
  materialSettings.bloom,
  0.7,
  0.15,
);
composer.addPass(bloomPass);
const fxaaPass = new ShaderPass(FXAAShader);
fxaaPass.enabled = true;
composer.addPass(fxaaPass);

let draggingPanel = false;
const dragOffset = { x: 0, y: 0 };
let shapeResetQueued = false;
let controlsInitialized = false;
let subdivisionWireframePreviewActive = false;
const timelineEntries: TimelineEntry[] = [];
let currentTimelineStep = 0;
let timelineSliderSyncing = false;
let timelineRangeBound = false;
const undoHistory: HistoryEntry[] = [];
const redoHistory: HistoryEntry[] = [];
let historyPendingBefore: HistorySnapshot | null = null;
let isApplyingHistory = false;
let suppressRangeHistory = false;
resetTimelineToCurrentState();

let micReactiveEnabled = false;
let micStream: MediaStream | null = null;
let micAudioContext: AudioContext | null = null;
let micAnalyser: AnalyserNode | null = null;
let micDataArray: Uint8Array | null = null;
let micSmoothedLevel = 0;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function readMicLevel(): number {
  if (!micAnalyser || !micDataArray) {
    return 0;
  }
  micAnalyser.getByteTimeDomainData(micDataArray as Uint8Array<ArrayBuffer>);
  let sumSquares = 0;
  for (let i = 0; i < micDataArray.length; i += 1) {
    const normalized = (micDataArray[i] - 128) / 128;
    sumSquares += normalized * normalized;
  }
  const rms = Math.sqrt(sumSquares / micDataArray.length);
  return clamp01(rms * 5);
}

async function enableMicReactive(): Promise<void> {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    console.error('Microphone access failed.', error);
    return;
  }
  micAudioContext = new AudioContext();
  const source = micAudioContext.createMediaStreamSource(micStream);
  micAnalyser = micAudioContext.createAnalyser();
  micAnalyser.fftSize = 512;
  micAnalyser.smoothingTimeConstant = 0.6;
  micDataArray = new Uint8Array(micAnalyser.frequencyBinCount);
  source.connect(micAnalyser);
  micSmoothedLevel = 0;
  micReactiveEnabled = true;
  ui.micReactiveToggle.textContent = 'Disable Mic Reactive';
  ui.micReactiveToggle.classList.add('is-mic-active');
}

function disableMicReactive(): void {
  micReactiveEnabled = false;
  ui.micReactiveToggle.textContent = 'Enable Mic Reactive';
  ui.micReactiveToggle.classList.remove('is-mic-active');
  if (micStream) {
    micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
  }
  if (micAudioContext) {
    micAudioContext.close().catch(() => undefined);
    micAudioContext = null;
  }
  micAnalyser = null;
  micDataArray = null;
}

function updateMicReactiveMaterial(): void {
  if (!micReactiveEnabled || appState.running) {
    return;
  }
  const rawLevel = readMicLevel();
  micSmoothedLevel += (rawLevel - micSmoothedLevel) * 0.25;
  const bloomValue = clamp01(micSmoothedLevel) * 2;
  const specularValue = clamp01(micSmoothedLevel) * 2;
  setRangeValue(ui.bloom, Number(bloomValue.toFixed(3)));
  setRangeValue(ui.specular, Number(specularValue.toFixed(3)));
}

function syncWireframeVisibility(): void {
  wireframeMesh.visible = shapeSettings.showWireframe || subdivisionWireframePreviewActive;
}

function setSubdivisionWireframePreview(active: boolean): void {
  if (subdivisionWireframePreviewActive === active) {
    return;
  }
  subdivisionWireframePreviewActive = active;
  syncWireframeVisibility();
}

function prepareGeometry(geometry: BufferGeometry): void {
  geometry.computeVertexNormals();
  const position = geometry.getAttribute('position') as BufferAttribute;
  position.setUsage(DynamicDrawUsage);
  const normal = geometry.getAttribute('normal') as BufferAttribute;
  normal.setUsage(DynamicDrawUsage);
}

function updateRangeProgress(range: HTMLInputElement): void {
  const min = Number.parseFloat(range.min);
  const max = Number.parseFloat(range.max);
  const value = Number.parseFloat(range.value);
  const span = max - min;
  const progress = span > 1e-8 ? ((value - min) / span) * 100 : 100;
  range.style.setProperty('--range-progress', `${progress}%`);
}

function captureHistorySnapshot(): HistorySnapshot {
  return {
    simulationSettings: { ...simulationSettings },
    shapeSettings: { ...shapeSettings },
    growthSettings: { ...growthSettings },
    materialSettings: { ...materialSettings },
    appState: { ...appState },
    finalSmoothingAmount,
    finalSmoothingSource: finalSmoothingSource ? Float32Array.from(finalSmoothingSource) : null,
    engineSnapshot: engine.exportSnapshot(),
  };
}

function disposeHistorySnapshot(snapshot: HistorySnapshot): void {
  disposeSnapshot(snapshot.engineSnapshot);
}

function disposeHistoryEntry(entry: HistoryEntry): void {
  disposeHistorySnapshot(entry.before);
  disposeHistorySnapshot(entry.after);
}

function clearRedoHistory(): void {
  while (redoHistory.length > 0) {
    const entry = redoHistory.pop();
    if (entry) {
      disposeHistoryEntry(entry);
    }
  }
}

function pushUndoHistory(entry: HistoryEntry): void {
  undoHistory.push(entry);
  while (undoHistory.length > MAX_HISTORY_STATES) {
    const removed = undoHistory.shift();
    if (removed) {
      disposeHistoryEntry(removed);
    }
  }
  clearRedoHistory();
}

function beginHistoryCapture(): void {
  if (isApplyingHistory || suppressRangeHistory || historyPendingBefore) {
    return;
  }
  historyPendingBefore = captureHistorySnapshot();
}

function finishHistoryCapture(): void {
  if (isApplyingHistory || !historyPendingBefore) {
    return;
  }
  const after = captureHistorySnapshot();
  pushUndoHistory({
    before: historyPendingBefore,
    after,
  });
  historyPendingBefore = null;
}

function recordHistoryAction(action: () => void): void {
  if (isApplyingHistory) {
    action();
    return;
  }
  if (historyPendingBefore) {
    finishHistoryCapture();
  }
  const before = captureHistorySnapshot();
  action();
  const after = captureHistorySnapshot();
  pushUndoHistory({ before, after });
}

function refreshUiFromCurrentState(): void {
  const dispatchInput = (input: HTMLInputElement): void => {
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const dispatchSelectChange = (select: HTMLSelectElement): void => {
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };

  ui.growthSpeed.value = `${simulationSettings.growthSpeed}`;
  dispatchInput(ui.growthSpeed);
  ui.seed.value = `${simulationSettings.seed}`;
  dispatchInput(ui.seed);
  ui.seedInfluence.value = `${simulationSettings.seedInfluence}`;
  dispatchInput(ui.seedInfluence);

  ui.baseShape.value = shapeSettings.baseShape;
  dispatchSelectChange(ui.baseShape);
  ui.subdivision.value = `${shapeSettings.subdivision}`;
  dispatchInput(ui.subdivision);
  ui.scaleX.value = `${shapeSettings.scaleX}`;
  dispatchInput(ui.scaleX);
  ui.scaleY.value = `${shapeSettings.scaleY}`;
  dispatchInput(ui.scaleY);
  ui.scaleZ.value = `${shapeSettings.scaleZ}`;
  dispatchInput(ui.scaleZ);
  ui.showWireframe.checked = shapeSettings.showWireframe;
  ui.showMesh.checked = shapeSettings.showMesh;

  ui.growthStep.value = `${growthSettings.growthStep}`;
  dispatchInput(ui.growthStep);
  ui.targetEdgeLength.value = `${growthSettings.targetEdgeLength}`;
  dispatchInput(ui.targetEdgeLength);
  ui.splitThreshold.value = `${growthSettings.splitThreshold}`;
  dispatchInput(ui.splitThreshold);
  ui.repulsion.value = `${growthSettings.repulsion}`;
  dispatchInput(ui.repulsion);
  ui.smoothing.value = `${growthSettings.smoothing}`;
  dispatchInput(ui.smoothing);
  ui.finalSmoothing.value = `${finalSmoothingAmount}`;
  dispatchInput(ui.finalSmoothing);
  ui.shapeRetention.value = `${growthSettings.shapeRetention}`;
  dispatchInput(ui.shapeRetention);
  ui.maxVertices.value = `${growthSettings.maxVertices}`;
  dispatchInput(ui.maxVertices);

  ui.gradientType.value = materialSettings.gradientType;
  dispatchSelectChange(ui.gradientType);
  ui.gradientStart.value = materialSettings.gradientStart;
  ui.gradientEnd.value = materialSettings.gradientEnd;
  ui.curvatureContrast.value = `${materialSettings.curvatureContrast}`;
  dispatchInput(ui.curvatureContrast);
  ui.curvatureBias.value = `${materialSettings.curvatureBias}`;
  dispatchInput(ui.curvatureBias);
  ui.gradientBlur.value = `${materialSettings.gradientBlur}`;
  dispatchInput(ui.gradientBlur);
  ui.fresnel.value = `${materialSettings.fresnel}`;
  dispatchInput(ui.fresnel);
  ui.specular.value = `${materialSettings.specular}`;
  dispatchInput(ui.specular);
  ui.bloom.value = `${materialSettings.bloom}`;
  dispatchInput(ui.bloom);

  mesh.visible = shapeSettings.showMesh;
  syncWireframeVisibility();
}

function applyHistorySnapshot(snapshot: HistorySnapshot): void {
  isApplyingHistory = true;
  suppressRangeHistory = true;
  try {
    simulationSettings.growthSpeed = snapshot.simulationSettings.growthSpeed;
    simulationSettings.seed = snapshot.simulationSettings.seed;
    simulationSettings.seedInfluence = snapshot.simulationSettings.seedInfluence;

    shapeSettings.baseShape = snapshot.shapeSettings.baseShape;
    shapeSettings.subdivision = snapshot.shapeSettings.subdivision;
    shapeSettings.scaleX = snapshot.shapeSettings.scaleX;
    shapeSettings.scaleY = snapshot.shapeSettings.scaleY;
    shapeSettings.scaleZ = snapshot.shapeSettings.scaleZ;
    shapeSettings.showWireframe = snapshot.shapeSettings.showWireframe;
    shapeSettings.showMesh = snapshot.shapeSettings.showMesh;

    growthSettings.growthStep = snapshot.growthSettings.growthStep;
    growthSettings.targetEdgeLength = snapshot.growthSettings.targetEdgeLength;
    growthSettings.splitThreshold = snapshot.growthSettings.splitThreshold;
    growthSettings.repulsion = snapshot.growthSettings.repulsion;
    growthSettings.smoothing = snapshot.growthSettings.smoothing;
    growthSettings.shapeRetention = snapshot.growthSettings.shapeRetention;
    growthSettings.maxVertices = snapshot.growthSettings.maxVertices;

    materialSettings.gradientType = snapshot.materialSettings.gradientType;
    materialSettings.gradientStart = snapshot.materialSettings.gradientStart;
    materialSettings.gradientEnd = snapshot.materialSettings.gradientEnd;
    materialSettings.curvatureContrast = snapshot.materialSettings.curvatureContrast;
    materialSettings.curvatureBias = snapshot.materialSettings.curvatureBias;
    materialSettings.gradientBlur = snapshot.materialSettings.gradientBlur;
    materialSettings.fresnel = snapshot.materialSettings.fresnel;
    materialSettings.specular = snapshot.materialSettings.specular;
    materialSettings.bloom = snapshot.materialSettings.bloom;

    finalSmoothingAmount = snapshot.finalSmoothingAmount;
    finalSmoothingSource = snapshot.finalSmoothingSource ? Float32Array.from(snapshot.finalSmoothingSource) : null;

    engine.importSnapshot(snapshot.engineSnapshot);
    engine.reseed(simulationSettings.seed);
    engine.setGrowthSettings(growthSettings);
    engine.setGradientBlur(materialSettings.gradientBlur);
    materialController.setMaterialSettings(materialSettings);
    bloomPass.strength = materialSettings.bloom;
    syncGeometryWithEngine();

    appState.running = snapshot.appState.running;
    refreshUiFromCurrentState();
    resetTimelineToCurrentState();
    syncUiState();
    controls.update();
  } finally {
    suppressRangeHistory = false;
    isApplyingHistory = false;
  }
}

function undoHistoryStep(): void {
  if (historyPendingBefore) {
    finishHistoryCapture();
  }
  const entry = undoHistory.pop();
  if (!entry) {
    return;
  }
  applyHistorySnapshot(entry.before);
  redoHistory.push(entry);
  while (redoHistory.length > MAX_HISTORY_STATES) {
    const removed = redoHistory.shift();
    if (removed) {
      disposeHistoryEntry(removed);
    }
  }
}

function redoHistoryStep(): void {
  if (historyPendingBefore) {
    finishHistoryCapture();
  }
  const entry = redoHistory.pop();
  if (!entry) {
    return;
  }
  applyHistorySnapshot(entry.after);
  undoHistory.push(entry);
  while (undoHistory.length > MAX_HISTORY_STATES) {
    const removed = undoHistory.shift();
    if (removed) {
      disposeHistoryEntry(removed);
    }
  }
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

function exportScreenshot(filename: string): void {
  // Render a fresh frame so the capture reflects the latest state.
  composer.render();
  renderer.domElement.toBlob((blob) => {
    if (!blob) {
      console.error('Screenshot export failed: unable to encode canvas as PNG.');
      return;
    }
    downloadBlob(filename, blob);
  }, 'image/png');
}

function disposeSnapshot(snapshot: DifferentialGrowthSnapshot): void {
  snapshot.geometry.dispose();
}

function findTimelineEntryIndex(step: number): number {
  for (let i = 0; i < timelineEntries.length; i += 1) {
    if (timelineEntries[i].step === step) {
      return i;
    }
  }
  return -1;
}

function syncTimelineSliderState(): void {
  const minStep = timelineEntries.length > 0 ? timelineEntries[0].step : 0;
  const maxStep = timelineEntries.length > 0 ? timelineEntries[timelineEntries.length - 1].step : 0;
  ui.timeline.min = `${minStep}`;
  ui.timeline.max = `${maxStep}`;
  currentTimelineStep = Math.min(maxStep, Math.max(minStep, currentTimelineStep));
  ui.timeline.disabled = appState.running || minStep === maxStep;

  if (timelineRangeBound) {
    timelineSliderSyncing = true;
    ui.timeline.value = `${currentTimelineStep}`;
    ui.timeline.dispatchEvent(new Event('input', { bubbles: true }));
    timelineSliderSyncing = false;
    return;
  }

  ui.timeline.value = `${currentTimelineStep}`;
  ui.timelineValue.textContent = `${currentTimelineStep}`;
  updateRangeProgress(ui.timeline);
}

function resetTimelineToCurrentState(): void {
  for (let i = 0; i < timelineEntries.length; i += 1) {
    disposeSnapshot(timelineEntries[i].snapshot);
  }
  timelineEntries.length = 0;
  currentTimelineStep = 0;
  timelineEntries.push({
    step: currentTimelineStep,
    snapshot: engine.exportSnapshot(),
  });
  syncTimelineSliderState();
}

function trimTimelineFutureFromCurrentStep(): void {
  const keepIndex = findTimelineEntryIndex(currentTimelineStep);
  if (keepIndex < 0 || keepIndex >= timelineEntries.length - 1) {
    return;
  }
  for (let i = keepIndex + 1; i < timelineEntries.length; i += 1) {
    disposeSnapshot(timelineEntries[i].snapshot);
  }
  timelineEntries.length = keepIndex + 1;
}

function appendTimelineStepFromCurrentState(): void {
  const last = timelineEntries[timelineEntries.length - 1];
  const nextStep = last ? last.step + 1 : currentTimelineStep + 1;
  timelineEntries.push({
    step: nextStep,
    snapshot: engine.exportSnapshot(),
  });
  currentTimelineStep = nextStep;

  while (timelineEntries.length > MAX_TIMELINE_SNAPSHOTS) {
    const removed = timelineEntries.shift();
    if (!removed) {
      break;
    }
    disposeSnapshot(removed.snapshot);
  }

  syncTimelineSliderState();
}

function seekTimelineStep(step: number): void {
  if (appState.running) {
    return;
  }
  const entryIndex = findTimelineEntryIndex(step);
  if (entryIndex < 0) {
    syncTimelineSliderState();
    return;
  }

  engine.importSnapshot(timelineEntries[entryIndex].snapshot);
  syncGeometryWithEngine();
  currentTimelineStep = timelineEntries[entryIndex].step;
  finalSmoothingSource = engine.getPositionSnapshot();
  applyFinalSmoothingPreview();
  syncTimelineSliderState();
}

function syncGeometryWithEngine(): void {
  const activeGeometry = engine.getGeometry();
  if (mesh.geometry === activeGeometry) {
    return;
  }
  const previous = mesh.geometry;
  mesh.geometry = activeGeometry;
  wireframeMesh.geometry = activeGeometry;
  previous.dispose();
}

function applyFinalSmoothingPreview(): void {
  if (appState.running) {
    return;
  }
  if (!finalSmoothingSource) {
    finalSmoothingSource = engine.getPositionSnapshot();
  }
  engine.applyFinalSmoothingFromSnapshot(finalSmoothingSource, finalSmoothingAmount);
  syncGeometryWithEngine();
}

function startSimulation(): void {
  trimTimelineFutureFromCurrentStep();
  if (finalSmoothingSource) {
    engine.applyFinalSmoothingFromSnapshot(finalSmoothingSource, 0);
    syncGeometryWithEngine();
  }
  finalSmoothingSource = null;
  appState.running = true;
  syncUiState();
}

function stopSimulation(): void {
  appState.running = false;
  finalSmoothingSource = engine.getPositionSnapshot();
  applyFinalSmoothingPreview();
  syncUiState();
}

function resetSimulation(): void {
  const nextGeometry = buildScaledShapeGeometry();
  prepareGeometry(nextGeometry);
  const previousGeometry = mesh.geometry;
  mesh.geometry = nextGeometry;
  wireframeMesh.geometry = nextGeometry;
  previousGeometry.dispose();
  engine.reseed(simulationSettings.seed);
  engine.setGeometry(nextGeometry);
  syncGeometryWithEngine();
  resetTimelineToCurrentState();
  if (appState.running) {
    finalSmoothingSource = null;
  } else {
    finalSmoothingSource = engine.getPositionSnapshot();
    applyFinalSmoothingPreview();
  }
  controls.update();
}

function syncUiState(): void {
  ui.start.textContent = appState.running ? 'Pause' : 'Start';
  ui.start.classList.toggle('is-start-state', !appState.running);
  ui.start.classList.toggle('is-stop-state', appState.running);
  syncTimelineSliderState();
}

function scheduleShapeReset(): void {
  if (!controlsInitialized || shapeResetQueued) {
    return;
  }
  shapeResetQueued = true;
  requestAnimationFrame(() => {
    shapeResetQueued = false;
    resetSimulation();
  });
}

function clampPanelToViewport(): void {
  const margin = 10;
  const rootStyles = getComputedStyle(document.documentElement);
  const menuScaleRaw = rootStyles.getPropertyValue('--menu-scale').trim();
  const parsedMenuScale = Number.parseFloat(menuScaleRaw);
  const menuScale = Number.isFinite(parsedMenuScale) && parsedMenuScale > 0 ? parsedMenuScale : 1;
  const scaledPanelHeight = ui.panel.offsetHeight * menuScale;
  const scaledPanelWidth = ui.panel.offsetWidth * menuScale;
  const maxTop = Math.max(margin, window.innerHeight - scaledPanelHeight - margin);
  const maxLeft = Math.max(margin, window.innerWidth - scaledPanelWidth - margin);
  const top = Math.min(Math.max(ui.panel.offsetTop, margin), maxTop);
  const left = Math.min(Math.max(ui.panel.offsetLeft, margin), maxLeft);
  ui.panel.style.top = `${top}px`;
  ui.panel.style.left = `${left}px`;
  ui.panel.style.right = 'auto';
}

function handleResize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const pixelRatio = getPixelRatio();
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height);
  composer.setSize(width, height);
  composer.setPixelRatio(pixelRatio);
  bloomPass.setSize(width, height);
  fxaaPass.material.uniforms.resolution.value.set(
    1 / (width * pixelRatio),
    1 / (height * pixelRatio),
  );
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  clampPanelToViewport();
}

function bindRange(
  input: HTMLInputElement,
  valueLabel: HTMLSpanElement,
  format: (value: number) => string,
  onInput: (value: number) => void,
): void {
  let hasInitialized = false;
  let rangeHistoryActive = false;

  const beginRangeHistory = (): void => {
    if (hasInitialized && !isApplyingHistory && !suppressRangeHistory && !rangeHistoryActive) {
      beginHistoryCapture();
      rangeHistoryActive = true;
    }
  };

  const finishRangeHistory = (): void => {
    if (!rangeHistoryActive) {
      return;
    }
    finishHistoryCapture();
    rangeHistoryActive = false;
  };

  const stepDecimals = (stepValue: string): number => {
    if (!stepValue || stepValue === 'any') {
      return 6;
    }
    const normalized = stepValue.toLowerCase();
    const expIndex = normalized.indexOf('e-');
    if (expIndex >= 0) {
      const expDigits = Number.parseInt(normalized.slice(expIndex + 2), 10);
      return Number.isFinite(expDigits) ? expDigits : 6;
    }
    const dotIndex = stepValue.indexOf('.');
    return dotIndex >= 0 ? stepValue.length - dotIndex - 1 : 0;
  };

  const commitManualValue = (rawValue: string): void => {
    beginRangeHistory();
    let next = Number.parseFloat(rawValue);
    if (!Number.isFinite(next)) {
      update();
      finishRangeHistory();
      return;
    }

    const min = Number.parseFloat(input.min);
    const max = Number.parseFloat(input.max);
    if (Number.isFinite(min)) {
      next = Math.max(min, next);
    }
    if (Number.isFinite(max)) {
      next = Math.min(max, next);
    }

    const parsedStep = Number.parseFloat(input.step);
    if (Number.isFinite(parsedStep) && parsedStep > 0) {
      const base = Number.isFinite(min) ? min : 0;
      next = base + Math.round((next - base) / parsedStep) * parsedStep;
      if (Number.isFinite(min)) {
        next = Math.max(min, next);
      }
      if (Number.isFinite(max)) {
        next = Math.min(max, next);
      }
    }

    input.value = next.toFixed(stepDecimals(input.step));
    update();
    finishRangeHistory();
  };

  let isManualEditing = false;
  const beginManualEdit = (): void => {
    if (isManualEditing) {
      return;
    }
    isManualEditing = true;

    const editor = document.createElement('input');
    editor.type = 'number';
    editor.className = 'value-editor';
    editor.value = input.value;
    if (input.min) {
      editor.min = input.min;
    }
    if (input.max) {
      editor.max = input.max;
    }
    if (input.step) {
      editor.step = input.step;
    }

    valueLabel.replaceWith(editor);
    editor.focus();
    editor.select();

    let finalized = false;
    const finish = (commit: boolean): void => {
      if (finalized) {
        return;
      }
      finalized = true;
      const submitted = editor.value;
      editor.replaceWith(valueLabel);
      isManualEditing = false;
      if (commit) {
        commitManualValue(submitted);
      } else {
        update();
      }
    };

    editor.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    editor.addEventListener('blur', () => {
      finish(true);
    });
  };

  valueLabel.addEventListener('click', (event) => {
    event.stopPropagation();
    beginManualEdit();
  });

  const update = (): void => {
    beginRangeHistory();
    const value = Number.parseFloat(input.value);
    valueLabel.textContent = format(value);
    updateRangeProgress(input);
    if (!isApplyingHistory) {
      onInput(value);
    }
    hasInitialized = true;
  };
  input.addEventListener('input', update);
  input.addEventListener('change', finishRangeHistory);
  input.addEventListener('blur', finishRangeHistory);
  input.addEventListener('pointerup', finishRangeHistory);
  input.addEventListener('keyup', (event) => {
    if (event.key.startsWith('Arrow') || event.key === 'PageUp' || event.key === 'PageDown') {
      finishRangeHistory();
    }
  });
  update();
}

function bindSectionCollapseToggles(): void {
  const headers = ui.panel.querySelectorAll<HTMLDivElement>('.panel-section-header');
  headers.forEach((header) => {
    const section = header.closest('.panel-section');
    if (!section) {
      return;
    }

    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', section.classList.contains('is-collapsed') ? 'false' : 'true');

    const toggle = (): void => {
      const collapsed = section.classList.toggle('is-collapsed');
      header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    };

    header.addEventListener('click', toggle);
    header.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
  });
}

function bindCustomSelect(select: HTMLSelectElement): void {
  const control = select.closest('.select-control');
  const shell = control?.querySelector('.select-shell');
  if (!control || !shell) {
    return;
  }
  select.classList.add('native-select-hidden');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'select-trigger';
  trigger.id = `${select.id}-trigger`;
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const menu = document.createElement('ul');
  menu.className = 'select-menu';
  menu.id = `${select.id}-menu`;
  menu.hidden = true;
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-labelledby', trigger.id);

  type OptionButton = HTMLButtonElement & { dataset: DOMStringMap & { value: string; index: string } };
  const optionButtons: OptionButton[] = [];
  const optionValues = Array.from(select.options).map((option) => option.value);

  const buildOptionButton = (index: number, label: string, value: string): OptionButton => {
    const item = document.createElement('li');
    const button = document.createElement('button') as OptionButton;
    button.type = 'button';
    button.className = 'select-option';
    button.dataset.value = value;
    button.dataset.index = `${index}`;
    button.textContent = label;
    button.setAttribute('role', 'option');
    item.appendChild(button);
    menu.appendChild(item);
    return button;
  };

  Array.from(select.options).forEach((option, index) => {
    const button = buildOptionButton(index, option.textContent ?? option.value, option.value);
    optionButtons.push(button);
  });

  let activeIndex = Math.max(0, optionValues.indexOf(select.value));

  const setOpen = (open: boolean): void => {
    control.classList.toggle('is-open', open);
    menu.hidden = !open;
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  const updateSelectionUi = (): void => {
    const selectedIndex = Math.max(0, optionValues.indexOf(select.value));
    const selectedButton = optionButtons[selectedIndex];
    trigger.textContent = selectedButton?.textContent ?? select.value;
    optionButtons.forEach((button, index) => {
      const selected = index === selectedIndex;
      const active = index === activeIndex;
      button.classList.toggle('is-selected', selected);
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.tabIndex = active ? 0 : -1;
    });
  };

  const setActiveIndex = (index: number): void => {
    if (optionButtons.length === 0) {
      return;
    }
    const count = optionButtons.length;
    activeIndex = ((index % count) + count) % count;
    updateSelectionUi();
  };

  const chooseIndex = (index: number): void => {
    const nextValue = optionValues[index];
    if (nextValue === undefined) {
      return;
    }
    const changed = select.value !== nextValue;
    select.value = nextValue;
    activeIndex = index;
    updateSelectionUi();
    setOpen(false);
    if (changed) {
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  const openMenu = (focusOption = false): void => {
    setActiveIndex(Math.max(0, optionValues.indexOf(select.value)));
    setOpen(true);
    if (focusOption) {
      optionButtons[activeIndex]?.focus();
    }
  };

  select.addEventListener('change', () => {
    activeIndex = Math.max(0, optionValues.indexOf(select.value));
    updateSelectionUi();
    setOpen(false);
  });

  trigger.addEventListener('click', () => {
    if (control.classList.contains('is-open')) {
      setOpen(false);
    } else {
      openMenu();
    }
  });

  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!control.classList.contains('is-open')) {
        openMenu(true);
      } else {
        setActiveIndex(activeIndex + 1);
        optionButtons[activeIndex]?.focus();
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!control.classList.contains('is-open')) {
        openMenu(true);
      } else {
        setActiveIndex(activeIndex - 1);
        optionButtons[activeIndex]?.focus();
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (control.classList.contains('is-open')) {
        chooseIndex(activeIndex);
      } else {
        openMenu(true);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  });

  optionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number.parseInt(button.dataset.index, 10);
      chooseIndex(index);
      trigger.focus();
    });
    button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex(activeIndex + 1);
        optionButtons[activeIndex]?.focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex(activeIndex - 1);
        optionButtons[activeIndex]?.focus();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        chooseIndex(activeIndex);
        trigger.focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger.focus();
      } else if (event.key === 'Tab') {
        setOpen(false);
      }
    });
  });

  document.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (!(target instanceof Node) || !control.contains(target)) {
      setOpen(false);
    }
  });

  shell.prepend(menu);
  shell.prepend(trigger);
  updateSelectionUi();
}

bindSectionCollapseToggles();
bindCustomSelect(ui.baseShape);
bindCustomSelect(ui.gradientType);

bindRange(ui.growthSpeed, ui.growthSpeedValue, (value) => value.toFixed(2), (value) => {
  simulationSettings.growthSpeed = value;
});
bindRange(ui.timeline, ui.timelineValue, (value) => `${Math.round(value)}`, (value) => {
  const requestedStep = Math.round(value);
  if (timelineSliderSyncing) {
    return;
  }
  if (appState.running) {
    syncTimelineSliderState();
    return;
  }
  if (requestedStep === currentTimelineStep) {
    return;
  }
  seekTimelineStep(requestedStep);
});
timelineRangeBound = true;
syncTimelineSliderState();
bindRange(ui.seed, ui.seedValueLabel, (value) => `${Math.round(value)}`, (value) => {
  simulationSettings.seed = Math.round(value);
  engine.reseed(simulationSettings.seed);
  if (!appState.running) {
    resetSimulation();
  }
});
bindRange(ui.seedInfluence, ui.seedInfluenceValue, (value) => value.toFixed(2), (value) => {
  simulationSettings.seedInfluence = value;
});
bindRange(ui.subdivision, ui.subdivisionValue, (value) => `${Math.round(value)}`, (value) => {
  shapeSettings.subdivision = Math.round(value);
  scheduleShapeReset();
});
bindRange(ui.scaleX, ui.scaleXValue, (value) => value.toFixed(2), (value) => {
  shapeSettings.scaleX = value;
  scheduleShapeReset();
});
bindRange(ui.scaleY, ui.scaleYValue, (value) => value.toFixed(2), (value) => {
  shapeSettings.scaleY = value;
  scheduleShapeReset();
});
bindRange(ui.scaleZ, ui.scaleZValue, (value) => value.toFixed(2), (value) => {
  shapeSettings.scaleZ = value;
  scheduleShapeReset();
});
bindRange(ui.growthStep, ui.growthStepValue, (value) => value.toFixed(2), (value) => {
  growthSettings.growthStep = value;
  engine.setGrowthSettings(growthSettings);
});
bindRange(ui.targetEdgeLength, ui.targetEdgeLengthValue, (value) => value.toFixed(3), (value) => {
  growthSettings.targetEdgeLength = value;
  engine.setGrowthSettings(growthSettings);
});
bindRange(ui.splitThreshold, ui.splitThresholdValue, (value) => value.toFixed(2), (value) => {
  growthSettings.splitThreshold = value;
  engine.setGrowthSettings(growthSettings);
});
bindRange(ui.repulsion, ui.repulsionValue, (value) => value.toFixed(2), (value) => {
  growthSettings.repulsion = value;
  engine.setGrowthSettings(growthSettings);
});
bindRange(ui.smoothing, ui.smoothingValue, (value) => value.toFixed(2), (value) => {
  growthSettings.smoothing = value;
  engine.setGrowthSettings(growthSettings);
});
bindRange(ui.finalSmoothing, ui.finalSmoothingValue, (value) => value.toFixed(2), (value) => {
  finalSmoothingAmount = value;
  if (!appState.running) {
    applyFinalSmoothingPreview();
  }
});
bindRange(ui.shapeRetention, ui.shapeRetentionValue, (value) => value.toFixed(2), (value) => {
  growthSettings.shapeRetention = value;
  engine.setGrowthSettings(growthSettings);
});
bindRange(ui.maxVertices, ui.maxVerticesValue, (value) => `${Math.round(value)}`, (value) => {
  growthSettings.maxVertices = Math.round(value);
  engine.setGrowthSettings(growthSettings);
});
bindRange(ui.curvatureContrast, ui.curvatureContrastValue, (value) => value.toFixed(2), (value) => {
  materialSettings.curvatureContrast = value;
  materialController.setMaterialSettings(materialSettings);
});
bindRange(ui.curvatureBias, ui.curvatureBiasValue, (value) => value.toFixed(2), (value) => {
  materialSettings.curvatureBias = value;
  materialController.setMaterialSettings(materialSettings);
});
bindRange(ui.gradientBlur, ui.gradientBlurValue, (value) => value.toFixed(2), (value) => {
  materialSettings.gradientBlur = value;
  engine.setGradientBlur(value);
});
bindRange(ui.fresnel, ui.fresnelValue, (value) => value.toFixed(2), (value) => {
  materialSettings.fresnel = value;
  materialController.setMaterialSettings(materialSettings);
});
bindRange(ui.specular, ui.specularValue, (value) => value.toFixed(2), (value) => {
  materialSettings.specular = value;
  materialController.setMaterialSettings(materialSettings);
});
bindRange(ui.bloom, ui.bloomValue, (value) => value.toFixed(2), (value) => {
  materialSettings.bloom = value;
  bloomPass.strength = value;
});

ui.gradientStart.addEventListener('input', () => {
  materialSettings.gradientStart = ui.gradientStart.value;
  materialController.setMaterialSettings(materialSettings);
});
ui.gradientEnd.addEventListener('input', () => {
  materialSettings.gradientEnd = ui.gradientEnd.value;
  materialController.setMaterialSettings(materialSettings);
});
ui.gradientType.addEventListener('change', () => {
  if (isApplyingHistory) {
    return;
  }
  recordHistoryAction(() => {
    materialSettings.gradientType = ui.gradientType.value as GradientType;
    materialController.setMaterialSettings(materialSettings);
  });
});

ui.baseShape.addEventListener('change', () => {
  if (isApplyingHistory) {
    return;
  }
  recordHistoryAction(() => {
    shapeSettings.baseShape = ui.baseShape.value as BaseShape;
    resetSimulation();
  });
});
ui.subdivision.addEventListener('pointerdown', () => {
  setSubdivisionWireframePreview(true);
});
ui.subdivision.addEventListener('input', () => {
  setSubdivisionWireframePreview(true);
});
ui.subdivision.addEventListener('keydown', () => {
  setSubdivisionWireframePreview(true);
});
ui.subdivision.addEventListener('keyup', () => {
  setSubdivisionWireframePreview(false);
});
ui.subdivision.addEventListener('change', () => {
  setSubdivisionWireframePreview(false);
});
ui.subdivision.addEventListener('blur', () => {
  setSubdivisionWireframePreview(false);
});
ui.showWireframe.addEventListener('change', () => {
  if (isApplyingHistory) {
    return;
  }
  recordHistoryAction(() => {
    shapeSettings.showWireframe = ui.showWireframe.checked;
    syncWireframeVisibility();
  });
});
ui.showMesh.addEventListener('change', () => {
  if (isApplyingHistory) {
    return;
  }
  recordHistoryAction(() => {
    shapeSettings.showMesh = ui.showMesh.checked;
    mesh.visible = shapeSettings.showMesh;
  });
});

const setRangeValue = (input: HTMLInputElement, value: number): void => {
  const previousSuppress = suppressRangeHistory;
  suppressRangeHistory = true;
  input.value = `${value}`;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  suppressRangeHistory = previousSuppress;
};

ui.resetSubdivision.addEventListener('click', () => {
  if (isApplyingHistory) {
    return;
  }
  recordHistoryAction(() => {
    const defaultSubdivision = Number.parseFloat(ui.subdivision.defaultValue);
    setRangeValue(ui.subdivision, Number.isFinite(defaultSubdivision) ? defaultSubdivision : 1);
    setSubdivisionWireframePreview(false);
  });
});

ui.resetTransform.addEventListener('click', () => {
  if (isApplyingHistory) {
    return;
  }
  recordHistoryAction(() => {
    setRangeValue(ui.scaleX, 1);
    setRangeValue(ui.scaleY, 1);
    setRangeValue(ui.scaleZ, 1);
  });
});

ui.exportScreenshot.addEventListener('click', () => {
  exportScreenshot(`differential-growth-step-${currentTimelineStep}.png`);
});

ui.micReactiveToggle.addEventListener('click', () => {
  if (micReactiveEnabled) {
    disableMicReactive();
  } else {
    void enableMicReactive();
  }
});

ui.start.addEventListener('click', () => {
  if (isApplyingHistory) {
    return;
  }
  recordHistoryAction(() => {
    if (appState.running) {
      stopSimulation();
    } else {
      startSimulation();
    }
  });
});

ui.reset.addEventListener('click', () => {
  if (isApplyingHistory) {
    return;
  }
  recordHistoryAction(() => {
    resetSimulation();
  });
});

ui.collapseToggle.addEventListener('pointerdown', (event) => {
  event.stopPropagation();
});
ui.collapseToggle.addEventListener('click', () => {
  const collapsed = ui.panel.classList.toggle('is-collapsed');
  ui.collapseToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
});

const beginPanelDrag = (event: PointerEvent): void => {
  if (event.target instanceof Element && event.target.closest('.collapse-button')) {
    return;
  }
  draggingPanel = true;
  const rect = ui.panel.getBoundingClientRect();
  ui.panel.style.left = `${rect.left}px`;
  ui.panel.style.top = `${rect.top}px`;
  ui.panel.style.right = 'auto';
  ui.panel.style.bottom = 'auto';
  dragOffset.x = event.clientX - rect.left;
  dragOffset.y = event.clientY - rect.top;
};

ui.handleTop.addEventListener('pointerdown', beginPanelDrag);
ui.handleBottom.addEventListener('pointerdown', beginPanelDrag);
window.addEventListener('pointermove', (event) => {
  if (!draggingPanel) {
    return;
  }
  const x = event.clientX - dragOffset.x;
  const y = event.clientY - dragOffset.y;
  ui.panel.style.left = `${x}px`;
  ui.panel.style.top = `${y}px`;
  clampPanelToViewport();
});
window.addEventListener('pointerup', () => {
  setSubdivisionWireframePreview(false);
  draggingPanel = false;
});
window.addEventListener('pointercancel', () => {
  setSubdivisionWireframePreview(false);
  draggingPanel = false;
});

window.addEventListener('keydown', (event) => {
  const withModifier = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (withModifier && !event.altKey && key === 'z' && !event.shiftKey) {
    event.preventDefault();
    undoHistoryStep();
    return;
  }
  if (withModifier && !event.altKey && (key === 'y' || (key === 'z' && event.shiftKey))) {
    event.preventDefault();
    redoHistoryStep();
  }
});

window.addEventListener('resize', handleResize);

controlsInitialized = true;

let lastTime = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  controls.update();
  if (appState.running) {
    engine.step(dt, simulationSettings.growthSpeed, simulationSettings.seedInfluence);
    syncGeometryWithEngine();
    appendTimelineStepFromCurrentState();
  } else {
    updateMicReactiveMaterial();
  }

  composer.render();
});

syncUiState();
handleResize();
