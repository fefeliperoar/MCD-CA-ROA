import { describe, expect, it } from 'vitest';
import { BufferAttribute } from 'three';
import { DifferentialGrowthEngine } from '../src/core/differentialGrowthEngine';
import { buildShapeGeometry } from '../src/core/meshFactory';
import { MaterialController } from '../src/core/materialController';
import type { GrowthSettings, MaterialSettings } from '../src/types';

const growthSettings: GrowthSettings = {
  growthStep: 0.45,
  targetEdgeLength: 0.12,
  splitThreshold: 1.6,
  repulsion: 0.45,
  smoothing: 0.52,
  shapeRetention: 0.09,
  maxVertices: 50000,
};

const materialSettings: MaterialSettings = {
  gradientType: 'curvature',
  gradientStart: '#9fd8ff',
  gradientEnd: '#2e4fb4',
  curvatureContrast: 1.25,
  curvatureBias: 0,
  gradientBlur: 0.35,
  fresnel: 0.6,
  specular: 0.6,
  bloom: 0,
};

describe('MeshFactory welding', () => {
  it('welds seam vertices for all base shapes', () => {
    const shapes = ['sphere', 'torus', 'cylinder'] as const;
    for (const shape of shapes) {
      const geometry = buildShapeGeometry(shape);
      const position = geometry.getAttribute('position') as BufferAttribute;
      const seen = new Set<string>();
      let duplicates = 0;
      for (let i = 0; i < position.count; i += 1) {
        const key = `${position.getX(i)},${position.getY(i)},${position.getZ(i)}`;
        if (seen.has(key)) {
          duplicates += 1;
        } else {
          seen.add(key);
        }
      }
      expect(duplicates).toBe(0);
      expect(geometry.index).toBeTruthy();
    }
  });
});

describe('DifferentialGrowthEngine growth', () => {
  it('seed influence controls deterministic and seed-specific variation', () => {
    const geometryNoSeedA = buildShapeGeometry('sphere');
    const geometryNoSeedB = buildShapeGeometry('sphere');
    const engineNoSeedA = new DifferentialGrowthEngine(geometryNoSeedA, growthSettings, 111);
    const engineNoSeedB = new DifferentialGrowthEngine(geometryNoSeedB, growthSettings, 999);
    engineNoSeedA.step(0.02, 1, 0);
    engineNoSeedB.step(0.02, 1, 0);

    const noSeedA = (engineNoSeedA.getGeometry().getAttribute('position') as BufferAttribute).array as Float32Array;
    const noSeedB = (engineNoSeedB.getGeometry().getAttribute('position') as BufferAttribute).array as Float32Array;
    let maxNoSeedDelta = 0;
    for (let i = 0; i < noSeedA.length; i += 1) {
      const delta = Math.abs(noSeedA[i] - noSeedB[i]);
      if (delta > maxNoSeedDelta) {
        maxNoSeedDelta = delta;
      }
    }
    expect(maxNoSeedDelta).toBeLessThan(1e-9);

    const geometrySeedA = buildShapeGeometry('sphere');
    const geometrySeedB = buildShapeGeometry('sphere');
    const engineSeedA = new DifferentialGrowthEngine(geometrySeedA, growthSettings, 111);
    const engineSeedB = new DifferentialGrowthEngine(geometrySeedB, growthSettings, 999);
    engineSeedA.step(0.02, 1, 1);
    engineSeedB.step(0.02, 1, 1);

    const seededA = (engineSeedA.getGeometry().getAttribute('position') as BufferAttribute).array as Float32Array;
    const seededB = (engineSeedB.getGeometry().getAttribute('position') as BufferAttribute).array as Float32Array;
    let maxSeededDelta = 0;
    for (let i = 0; i < seededA.length; i += 1) {
      const delta = Math.abs(seededA[i] - seededB[i]);
      if (delta > maxSeededDelta) {
        maxSeededDelta = delta;
      }
    }
    expect(maxSeededDelta).toBeGreaterThan(1e-6);
  });

  it('updates normalized displacement attribute based on distance from base shape', () => {
    const geometry = buildShapeGeometry('sphere');
    const engine = new DifferentialGrowthEngine(geometry, growthSettings, 321);
    engine.step(0.02, 1.1);

    const displacementAttr = engine.getGeometry().getAttribute('aDisplacement') as BufferAttribute;
    const displacement = displacementAttr.array as Float32Array;
    const max = Math.max(...displacement);
    const min = Math.min(...displacement);

    expect(max).toBeLessThanOrEqual(1);
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeGreaterThan(0);
  });

  it('applies reversible final smoothing from a paused snapshot', () => {
    const geometry = buildShapeGeometry('sphere');
    const engine = new DifferentialGrowthEngine(geometry, growthSettings, 654);
    const source = engine.getPositionSnapshot();

    engine.applyFinalSmoothingFromSnapshot(source, 0.85);
    const smoothed = (engine.getGeometry().getAttribute('position') as BufferAttribute).array as Float32Array;

    let maxSmoothedDelta = 0;
    for (let i = 0; i < source.length; i += 1) {
      const delta = Math.abs(smoothed[i] - source[i]);
      if (delta > maxSmoothedDelta) {
        maxSmoothedDelta = delta;
      }
    }
    expect(maxSmoothedDelta).toBeGreaterThan(1e-6);

    engine.applyFinalSmoothingFromSnapshot(source, 0);
    const restored = (engine.getGeometry().getAttribute('position') as BufferAttribute).array as Float32Array;
    let maxRestoreDelta = 0;
    for (let i = 0; i < source.length; i += 1) {
      const delta = Math.abs(restored[i] - source[i]);
      if (delta > maxRestoreDelta) {
        maxRestoreDelta = delta;
      }
    }
    expect(maxRestoreDelta).toBeLessThan(1e-9);
  });

  it('exports and imports snapshots with deterministic continuation', () => {
    const settingsNoSplit: GrowthSettings = {
      ...growthSettings,
      targetEdgeLength: 1,
      splitThreshold: 2,
      maxVertices: 100000,
    };
    const geometry = buildShapeGeometry('sphere');
    const engine = new DifferentialGrowthEngine(geometry, settingsNoSplit, 4242);

    for (let i = 0; i < 3; i += 1) {
      engine.step(0.02, 1.15, 0.45);
    }

    const snapshot = engine.exportSnapshot();
    engine.step(0.02, 1.15, 0.45);
    const forwardA = Float32Array.from(
      ((engine.getGeometry().getAttribute('position') as BufferAttribute).array as Float32Array),
    );

    engine.importSnapshot(snapshot);
    engine.step(0.02, 1.15, 0.45);
    const forwardB = (engine.getGeometry().getAttribute('position') as BufferAttribute).array as Float32Array;

    let maxDelta = 0;
    for (let i = 0; i < forwardA.length; i += 1) {
      const delta = Math.abs(forwardA[i] - forwardB[i]);
      if (delta > maxDelta) {
        maxDelta = delta;
      }
    }
    expect(maxDelta).toBeLessThan(1e-9);

    snapshot.geometry.dispose();
  });
});

describe('DifferentialGrowthEngine adaptive splitting', () => {
  it('subdivides geometry when long edges exceed split threshold and under maxVertices', () => {
    const geometry = buildShapeGeometry('sphere');
    const initialCount = geometry.getAttribute('position').count;
    const engine = new DifferentialGrowthEngine(
      geometry,
      {
        ...growthSettings,
        targetEdgeLength: 0.02,
        splitThreshold: 1.2,
        maxVertices: 100000,
      },
      12,
    );

    engine.step(0.016, 1);
    const nextCount = engine.getGeometry().getAttribute('position').count;
    expect(nextCount).toBeGreaterThan(initialCount);
  });

  it('does not subdivide when maxVertices cap is too low', () => {
    const geometry = buildShapeGeometry('sphere');
    const initialCount = geometry.getAttribute('position').count;
    const engine = new DifferentialGrowthEngine(
      geometry,
      {
        ...growthSettings,
        targetEdgeLength: 0.02,
        splitThreshold: 1.2,
        maxVertices: initialCount + 10,
      },
      16,
    );

    engine.step(0.016, 1);
    const nextCount = engine.getGeometry().getAttribute('position').count;
    expect(nextCount).toBe(initialCount);
  });
});

describe('MaterialController', () => {
  it('switches gradient type to displacement', () => {
    const controller = new MaterialController(materialSettings);
    controller.setMaterialSettings({
      ...materialSettings,
      gradientType: 'displacement',
    });
    expect(controller.material.uniforms.uGradientType.value).toBe(1);
    controller.dispose();
  });
});
