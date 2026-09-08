export type BaseShape = 'torus' | 'sphere' | 'cylinder';
export type GradientType = 'curvature' | 'displacement';

export type SimulationSettings = {
  growthSpeed: number;
  seed: number;
  seedInfluence: number;
};

export type ShapeSettings = {
  baseShape: BaseShape;
  subdivision: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  showWireframe: boolean;
  showMesh: boolean;
};

export type GrowthSettings = {
  growthStep: number;
  targetEdgeLength: number;
  splitThreshold: number;
  repulsion: number;
  smoothing: number;
  shapeRetention: number;
  maxVertices: number;
};

export type MaterialSettings = {
  gradientType: GradientType;
  gradientStart: string;
  gradientEnd: string;
  curvatureContrast: number;
  curvatureBias: number;
  gradientBlur: number;
  fresnel: number;
  specular: number;
  bloom: number;
};

export type AppState = {
  running: boolean;
};
