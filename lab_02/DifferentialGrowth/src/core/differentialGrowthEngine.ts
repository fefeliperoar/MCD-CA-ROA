import { BufferAttribute, BufferGeometry, DynamicDrawUsage, MathUtils, Vector3 } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GrowthSettings } from '../types';
import { buildTopology, type GeometryTopology } from './geometryTopology';
import { SeededRng } from './seededRng';

const tempAverage = new Vector3();
const tempEdge = new Vector3();

export type DifferentialGrowthSnapshot = {
  geometry: BufferGeometry;
  basePositions: Float32Array;
  variation: Float32Array;
  rngState: number;
};

export class DifferentialGrowthEngine {
  private geometry: BufferGeometry;
  private topology: GeometryTopology;
  private positionAttr: BufferAttribute;
  private normalAttr: BufferAttribute;
  private curvatureAttr: BufferAttribute;
  private displacementAttr: BufferAttribute;
  private variationAttr: BufferAttribute;
  private readonly settings: GrowthSettings;
  private basePositions: Float32Array;
  private curvatureWork: Float32Array;
  private deltaWork: Float32Array;
  private smoothWork: Float32Array;
  private rng: SeededRng;
  private gradientBlur: number;

  constructor(geometry: BufferGeometry, settings: GrowthSettings, seed: number) {
    this.geometry = geometry;
    this.settings = settings;
    this.positionAttr = this.geometry.getAttribute('position') as BufferAttribute;
    this.normalAttr = this.geometry.getAttribute('normal') as BufferAttribute;
    this.curvatureAttr = new BufferAttribute(new Float32Array(this.positionAttr.count), 1);
    this.displacementAttr = new BufferAttribute(new Float32Array(this.positionAttr.count), 1);
    this.variationAttr = new BufferAttribute(new Float32Array(this.positionAttr.count), 1);
    this.topology = { adjacency: [], edges: [] };
    this.basePositions = new Float32Array();
    this.curvatureWork = new Float32Array();
    this.deltaWork = new Float32Array();
    this.smoothWork = new Float32Array();
    this.rng = new SeededRng(seed);
    this.gradientBlur = 0.35;
    this.setGeometry(geometry);
  }

  getGeometry(): BufferGeometry {
    return this.geometry;
  }

  setGeometry(geometry: BufferGeometry): void {
    this.geometry = geometry;
    this.geometry.computeVertexNormals();
    this.positionAttr = this.geometry.getAttribute('position') as BufferAttribute;
    this.normalAttr = this.geometry.getAttribute('normal') as BufferAttribute;
    this.positionAttr.setUsage(DynamicDrawUsage);
    this.normalAttr.setUsage(DynamicDrawUsage);

    this.curvatureAttr = new BufferAttribute(new Float32Array(this.positionAttr.count), 1);
    this.curvatureAttr.setUsage(DynamicDrawUsage);
    this.displacementAttr = new BufferAttribute(new Float32Array(this.positionAttr.count), 1);
    this.displacementAttr.setUsage(DynamicDrawUsage);
    this.variationAttr = new BufferAttribute(new Float32Array(this.positionAttr.count), 1);
    this.variationAttr.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('aCurvature', this.curvatureAttr);
    this.geometry.setAttribute('aDisplacement', this.displacementAttr);
    this.geometry.setAttribute('aVariation', this.variationAttr);

    this.topology = buildTopology(this.geometry);
    this.basePositions = Float32Array.from(this.positionAttr.array as ArrayLike<number>);
    this.initializeSeedVariation();
    this.curvatureWork = new Float32Array(this.positionAttr.count);
    this.deltaWork = new Float32Array(this.positionAttr.count * 3);
    this.smoothWork = new Float32Array(this.positionAttr.count * 3);
    this.updateCurvatureAttribute();
  }

  setGrowthSettings(settings: GrowthSettings): void {
    this.settings.growthStep = settings.growthStep;
    this.settings.targetEdgeLength = settings.targetEdgeLength;
    this.settings.splitThreshold = settings.splitThreshold;
    this.settings.repulsion = settings.repulsion;
    this.settings.smoothing = settings.smoothing;
    this.settings.shapeRetention = settings.shapeRetention;
    this.settings.maxVertices = settings.maxVertices;
  }

  reseed(seed: number): void {
    this.rng = new SeededRng(seed);
  }

  setGradientBlur(strength: number): void {
    this.gradientBlur = MathUtils.clamp(strength, 0, 1);
    this.updateCurvatureAttribute();
  }

  getPositionSnapshot(): Float32Array {
    return Float32Array.from(this.positionAttr.array as Float32Array);
  }

  exportSnapshot(): DifferentialGrowthSnapshot {
    return {
      geometry: this.geometry.clone(),
      basePositions: Float32Array.from(this.basePositions),
      variation: Float32Array.from(this.variationAttr.array as ArrayLike<number>),
      rngState: this.rng.getState(),
    };
  }

  importSnapshot(snapshot: DifferentialGrowthSnapshot): void {
    this.setGeometry(snapshot.geometry.clone());

    const vertexCount = this.positionAttr.count;
    if (snapshot.variation.length === vertexCount) {
      (this.variationAttr.array as Float32Array).set(snapshot.variation);
      this.variationAttr.needsUpdate = true;
    }
    const positionLength = vertexCount * 3;
    if (snapshot.basePositions.length === positionLength) {
      this.basePositions = Float32Array.from(snapshot.basePositions);
    }
    this.rng.setState(snapshot.rngState);
    this.updateCurvatureAttribute();
  }

  applyFinalSmoothingFromSnapshot(sourcePositions: Float32Array, strength: number): void {
    const positionArray = this.positionAttr.array as Float32Array;
    if (sourcePositions.length !== positionArray.length) {
      return;
    }

    positionArray.set(sourcePositions);
    this.positionAttr.needsUpdate = true;

    const clampedStrength = MathUtils.clamp(strength, 0, 1);
    if (clampedStrength > 0) {
      const iterations = Math.max(1, Math.round(1 + clampedStrength * 10));
      const amount = MathUtils.clamp(0.03 + clampedStrength * 0.42, 0, 0.45);
      this.applySurfaceSmoothing(iterations, amount);
    }

    this.geometry.computeVertexNormals();
    this.normalAttr.needsUpdate = true;
    this.updateCurvatureAttribute();
  }

  resetToBase(): void {
    const positionArray = this.positionAttr.array as Float32Array;
    positionArray.set(this.basePositions);
    this.positionAttr.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.normalAttr.needsUpdate = true;
    this.updateCurvatureAttribute();
  }

  step(deltaSeconds: number, growthSpeed: number, seedInfluence = 0.35): void {
    const safeDt = Math.min(Math.max(deltaSeconds, 0), 1 / 20);
    if (safeDt <= 0) {
      return;
    }

    const subSteps = Math.max(1, Math.round(growthSpeed * 2));
    const scaledDt = safeDt * growthSpeed / subSteps;
    for (let i = 0; i < subSteps; i += 1) {
      // Differential growth loop: subdivide -> grow/repulse -> relax.
      let splitPasses = 0;
      while (splitPasses < 2 && this.maybeSplitLongEdges()) {
        splitPasses += 1;
      }
      this.integrate(scaledDt, seedInfluence);
      this.applySurfaceSmoothing(
        Math.max(1, Math.round(1 + this.settings.smoothing * 3)),
        MathUtils.clamp(this.settings.smoothing * 0.34, 0, 0.42),
      );
      this.geometry.computeVertexNormals();
      this.normalAttr.needsUpdate = true;
      this.updateCurvatureAttribute();
      this.maybeSplitLongEdges();
    }
  }

  private integrate(dt: number, seedInfluence: number): void {
    const positionArray = this.positionAttr.array as Float32Array;
    const normalArray = this.normalAttr.array as Float32Array;
    const variationArray = this.variationAttr.array as Float32Array;
    const adjacency = this.topology.adjacency;
    const edges = this.topology.edges;
    const vertexCount = this.positionAttr.count;
    const influence = MathUtils.clamp(seedInfluence, 0, 1);
    const dynamicNoiseAmplitude = 0.06 * influence;
    const staticVariationAmplitude = 0.9 * influence;

    this.deltaWork.fill(0);

    let maxCurvature = 0;
    for (let i = 0; i < vertexCount; i += 1) {
      const neighbors = adjacency[i];
      if (!neighbors || neighbors.length === 0) {
        this.curvatureWork[i] = 0;
        continue;
      }

      let avgX = 0;
      let avgY = 0;
      let avgZ = 0;
      for (let j = 0; j < neighbors.length; j += 1) {
        const ni = neighbors[j] * 3;
        avgX += positionArray[ni];
        avgY += positionArray[ni + 1];
        avgZ += positionArray[ni + 2];
      }
      const inv = 1 / neighbors.length;
      avgX *= inv;
      avgY *= inv;
      avgZ *= inv;

      const index = i * 3;
      const lapX = avgX - positionArray[index];
      const lapY = avgY - positionArray[index + 1];
      const lapZ = avgZ - positionArray[index + 2];
      const nx = normalArray[index];
      const ny = normalArray[index + 1];
      const nz = normalArray[index + 2];
      const curvature = Math.abs(lapX * nx + lapY * ny + lapZ * nz);
      this.curvatureWork[i] = curvature;
      if (curvature > maxCurvature) {
        maxCurvature = curvature;
      }
    }
    const invCurvature = maxCurvature > 1e-7 ? 1 / maxCurvature : 1;

    const growthBase = this.settings.growthStep * dt;
    for (let i = 0; i < vertexCount; i += 1) {
      const index = i * 3;
      const curvatureFactor = this.curvatureWork[i] * invCurvature;
      const noise = this.rng.signed() * dynamicNoiseAmplitude;
      const variation = variationArray[i] ?? 0;
      const seededScale = Math.max(0.12, 1 + variation * staticVariationAmplitude);
      const growth = Math.max(
        0,
        growthBase * (0.6 + curvatureFactor * 0.95 + noise) * seededScale,
      );
      this.deltaWork[index] += normalArray[index] * growth;
      this.deltaWork[index + 1] += normalArray[index + 1] * growth;
      this.deltaWork[index + 2] += normalArray[index + 2] * growth;
    }

    this.applySpatialRepulsion(dt);

    const edgeStrength = 0.52;
    for (let i = 0; i < edges.length; i += 1) {
      const [a, b] = edges[i];
      const ia = a * 3;
      const ib = b * 3;
      const ax = positionArray[ia];
      const ay = positionArray[ia + 1];
      const az = positionArray[ia + 2];
      const bx = positionArray[ib];
      const by = positionArray[ib + 1];
      const bz = positionArray[ib + 2];
      tempEdge.set(bx - ax, by - ay, bz - az);
      const length = tempEdge.length();
      if (length <= 1e-7) {
        continue;
      }
      tempEdge.multiplyScalar(1 / length);

      const edgeTarget = this.settings.targetEdgeLength;
      const correction = (length - edgeTarget) * edgeStrength * dt;

      this.deltaWork[ia] += tempEdge.x * correction;
      this.deltaWork[ia + 1] += tempEdge.y * correction;
      this.deltaWork[ia + 2] += tempEdge.z * correction;
      this.deltaWork[ib] -= tempEdge.x * correction;
      this.deltaWork[ib + 1] -= tempEdge.y * correction;
      this.deltaWork[ib + 2] -= tempEdge.z * correction;
    }

    const smoothingStrength = this.settings.smoothing * 0.26 * dt;
    for (let i = 0; i < vertexCount; i += 1) {
      const neighbors = adjacency[i];
      if (!neighbors || neighbors.length === 0) {
        continue;
      }
      tempAverage.set(0, 0, 0);
      for (let j = 0; j < neighbors.length; j += 1) {
        const ni = neighbors[j] * 3;
        tempAverage.x += positionArray[ni];
        tempAverage.y += positionArray[ni + 1];
        tempAverage.z += positionArray[ni + 2];
      }
      tempAverage.multiplyScalar(1 / neighbors.length);

      const index = i * 3;
      this.deltaWork[index] += (tempAverage.x - positionArray[index]) * smoothingStrength;
      this.deltaWork[index + 1] += (tempAverage.y - positionArray[index + 1]) * smoothingStrength;
      this.deltaWork[index + 2] += (tempAverage.z - positionArray[index + 2]) * smoothingStrength;
    }

    const retentionStrength = this.settings.shapeRetention * 0.18 * dt;
    if (retentionStrength > 0) {
      for (let i = 0; i < positionArray.length; i += 1) {
        this.deltaWork[i] += (this.basePositions[i] - positionArray[i]) * retentionStrength;
      }
    }

    const maxDisplacement = this.settings.targetEdgeLength * 0.24;
    for (let i = 0; i < vertexCount; i += 1) {
      const index = i * 3;
      const dx = this.deltaWork[index];
      const dy = this.deltaWork[index + 1];
      const dz = this.deltaWork[index + 2];
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (length > maxDisplacement && length > 1e-8) {
        const scale = maxDisplacement / length;
        positionArray[index] += dx * scale;
        positionArray[index + 1] += dy * scale;
        positionArray[index + 2] += dz * scale;
      } else {
        positionArray[index] += dx;
        positionArray[index + 1] += dy;
        positionArray[index + 2] += dz;
      }
    }
    this.positionAttr.needsUpdate = true;
  }

  private applySpatialRepulsion(dt: number): void {
    const repulsionFactor = this.settings.repulsion;
    if (repulsionFactor <= 0) {
      return;
    }

    const radius = this.settings.targetEdgeLength * this.settings.splitThreshold * 1.35;
    if (radius <= 1e-7) {
      return;
    }
    const radiusSq = radius * radius;
    const positionArray = this.positionAttr.array as Float32Array;
    const vertexCount = this.positionAttr.count;
    const cellSize = radius;
    const invCell = 1 / cellSize;
    const grid = new Map<string, number[]>();

    for (let i = 0; i < vertexCount; i += 1) {
      const index = i * 3;
      const cx = Math.floor(positionArray[index] * invCell);
      const cy = Math.floor(positionArray[index + 1] * invCell);
      const cz = Math.floor(positionArray[index + 2] * invCell);
      const key = `${cx}|${cy}|${cz}`;
      const bucket = grid.get(key);
      if (bucket) {
        bucket.push(i);
      } else {
        grid.set(key, [i]);
      }
    }

    const strength = repulsionFactor * dt * 0.03;
    for (let i = 0; i < vertexCount; i += 1) {
      const ia = i * 3;
      const px = positionArray[ia];
      const py = positionArray[ia + 1];
      const pz = positionArray[ia + 2];
      const cx = Math.floor(px * invCell);
      const cy = Math.floor(py * invCell);
      const cz = Math.floor(pz * invCell);

      for (let ox = -1; ox <= 1; ox += 1) {
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let oz = -1; oz <= 1; oz += 1) {
            const key = `${cx + ox}|${cy + oy}|${cz + oz}`;
            const bucket = grid.get(key);
            if (!bucket) {
              continue;
            }

            for (let bi = 0; bi < bucket.length; bi += 1) {
              const j = bucket[bi];
              if (j <= i) {
                continue;
              }
              const ib = j * 3;
              const dx = px - positionArray[ib];
              const dy = py - positionArray[ib + 1];
              const dz = pz - positionArray[ib + 2];
              const distSq = dx * dx + dy * dy + dz * dz;
              if (distSq >= radiusSq || distSq <= 1e-12) {
                continue;
              }
              const dist = Math.sqrt(distSq);
              const invDist = 1 / dist;
              const falloff = 1 - dist / radius;
              const force = (strength * falloff) / (distSq + 1e-6);
              const fx = dx * invDist * force;
              const fy = dy * invDist * force;
              const fz = dz * invDist * force;

              this.deltaWork[ia] += fx;
              this.deltaWork[ia + 1] += fy;
              this.deltaWork[ia + 2] += fz;
              this.deltaWork[ib] -= fx;
              this.deltaWork[ib + 1] -= fy;
              this.deltaWork[ib + 2] -= fz;
            }
          }
        }
      }
    }
  }

  private applySurfaceSmoothing(iterations: number, amount: number): void {
    if (iterations <= 0 || amount <= 0) {
      return;
    }

    const positionArray = this.positionAttr.array as Float32Array;
    const adjacency = this.topology.adjacency;
    const vertexCount = this.positionAttr.count;
    const blend = MathUtils.clamp(amount, 0, 0.45);

    for (let iter = 0; iter < iterations; iter += 1) {
      for (let i = 0; i < vertexCount; i += 1) {
        const neighbors = adjacency[i];
        const index = i * 3;
        if (!neighbors || neighbors.length === 0) {
          this.smoothWork[index] = positionArray[index];
          this.smoothWork[index + 1] = positionArray[index + 1];
          this.smoothWork[index + 2] = positionArray[index + 2];
          continue;
        }

        let avgX = 0;
        let avgY = 0;
        let avgZ = 0;
        for (let j = 0; j < neighbors.length; j += 1) {
          const ni = neighbors[j] * 3;
          avgX += positionArray[ni];
          avgY += positionArray[ni + 1];
          avgZ += positionArray[ni + 2];
        }
        const inv = 1 / neighbors.length;
        avgX *= inv;
        avgY *= inv;
        avgZ *= inv;
        const oneMinus = 1 - blend;
        this.smoothWork[index] = positionArray[index] * oneMinus + avgX * blend;
        this.smoothWork[index + 1] = positionArray[index + 1] * oneMinus + avgY * blend;
        this.smoothWork[index + 2] = positionArray[index + 2] * oneMinus + avgZ * blend;
      }

      positionArray.set(this.smoothWork);
    }

    this.positionAttr.needsUpdate = true;
  }

  private maybeSplitLongEdges(): boolean {
    const vertexCount = this.positionAttr.count;
    if (vertexCount >= this.settings.maxVertices) {
      return false;
    }

    // Full split pass can roughly quadruple vertices before merge.
    if (vertexCount * 4 > this.settings.maxVertices) {
      return false;
    }

    const splitLength = this.settings.targetEdgeLength * this.settings.splitThreshold;
    if (splitLength <= 0) {
      return false;
    }

    const positionArray = this.positionAttr.array as Float32Array;
    let longestEdge = 0;
    for (let i = 0; i < this.topology.edges.length; i += 1) {
      const [a, b] = this.topology.edges[i];
      const ai = a * 3;
      const bi = b * 3;
      const dx = positionArray[ai] - positionArray[bi];
      const dy = positionArray[ai + 1] - positionArray[bi + 1];
      const dz = positionArray[ai + 2] - positionArray[bi + 2];
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (length > longestEdge) {
        longestEdge = length;
      }
    }

    if (longestEdge <= splitLength) {
      return false;
    }

    this.subdivideGeometryOnce();
    return true;
  }

  private subdivideGeometryOnce(): void {
    const sourceClone = this.geometry.clone();
    sourceClone.setAttribute('aBasePos', new BufferAttribute(Float32Array.from(this.basePositions), 3));
    const source = sourceClone.index ? sourceClone.toNonIndexed() : sourceClone;

    const srcPos = source.getAttribute('position') as BufferAttribute;
    const srcBase = source.getAttribute('aBasePos') as BufferAttribute;
    const srcVariation = source.getAttribute('aVariation') as BufferAttribute;
    const triCount = Math.floor(srcPos.count / 3);
    const nextVertexCount = triCount * 12;

    const nextPos = new Float32Array(nextVertexCount * 3);
    const nextBase = new Float32Array(nextVertexCount * 3);
    const nextVariation = new Float32Array(nextVertexCount);

    let writeVertex = 0;

    const write = (
      px: number,
      py: number,
      pz: number,
      bx: number,
      by: number,
      bz: number,
      variation: number,
    ): void => {
      const pIndex = writeVertex * 3;
      nextPos[pIndex] = px;
      nextPos[pIndex + 1] = py;
      nextPos[pIndex + 2] = pz;
      nextBase[pIndex] = bx;
      nextBase[pIndex + 1] = by;
      nextBase[pIndex + 2] = bz;
      nextVariation[writeVertex] = variation;
      writeVertex += 1;
    };

    for (let tri = 0; tri < triCount; tri += 1) {
      const i0 = tri * 3;
      const i1 = i0 + 1;
      const i2 = i0 + 2;

      const p0x = srcPos.getX(i0);
      const p0y = srcPos.getY(i0);
      const p0z = srcPos.getZ(i0);
      const p1x = srcPos.getX(i1);
      const p1y = srcPos.getY(i1);
      const p1z = srcPos.getZ(i1);
      const p2x = srcPos.getX(i2);
      const p2y = srcPos.getY(i2);
      const p2z = srcPos.getZ(i2);

      const v0 = srcVariation.getX(i0);
      const v1 = srcVariation.getX(i1);
      const v2 = srcVariation.getX(i2);

      const b0x = srcBase.getX(i0);
      const b0y = srcBase.getY(i0);
      const b0z = srcBase.getZ(i0);
      const b1x = srcBase.getX(i1);
      const b1y = srcBase.getY(i1);
      const b1z = srcBase.getZ(i1);
      const b2x = srcBase.getX(i2);
      const b2y = srcBase.getY(i2);
      const b2z = srcBase.getZ(i2);

      const p01x = (p0x + p1x) * 0.5;
      const p01y = (p0y + p1y) * 0.5;
      const p01z = (p0z + p1z) * 0.5;
      const p12x = (p1x + p2x) * 0.5;
      const p12y = (p1y + p2y) * 0.5;
      const p12z = (p1z + p2z) * 0.5;
      const p20x = (p2x + p0x) * 0.5;
      const p20y = (p2y + p0y) * 0.5;
      const p20z = (p2z + p0z) * 0.5;

      const v01 = (v0 + v1) * 0.5;
      const v12 = (v1 + v2) * 0.5;
      const v20 = (v2 + v0) * 0.5;

      const b01x = (b0x + b1x) * 0.5;
      const b01y = (b0y + b1y) * 0.5;
      const b01z = (b0z + b1z) * 0.5;
      const b12x = (b1x + b2x) * 0.5;
      const b12y = (b1y + b2y) * 0.5;
      const b12z = (b1z + b2z) * 0.5;
      const b20x = (b2x + b0x) * 0.5;
      const b20y = (b2y + b0y) * 0.5;
      const b20z = (b2z + b0z) * 0.5;

      // Subdivide one triangle into 4 and carry base/variation attributes through interpolation.
      write(p0x, p0y, p0z, b0x, b0y, b0z, v0);
      write(p01x, p01y, p01z, b01x, b01y, b01z, v01);
      write(p20x, p20y, p20z, b20x, b20y, b20z, v20);

      write(p1x, p1y, p1z, b1x, b1y, b1z, v1);
      write(p12x, p12y, p12z, b12x, b12y, b12z, v12);
      write(p01x, p01y, p01z, b01x, b01y, b01z, v01);

      write(p2x, p2y, p2z, b2x, b2y, b2z, v2);
      write(p20x, p20y, p20z, b20x, b20y, b20z, v20);
      write(p12x, p12y, p12z, b12x, b12y, b12z, v12);

      write(p01x, p01y, p01z, b01x, b01y, b01z, v01);
      write(p12x, p12y, p12z, b12x, b12y, b12z, v12);
      write(p20x, p20y, p20z, b20x, b20y, b20z, v20);
    }

    const subdivided = new BufferGeometry();
    subdivided.setAttribute('position', new BufferAttribute(nextPos, 3));
    subdivided.setAttribute('aBasePos', new BufferAttribute(nextBase, 3));
    subdivided.setAttribute('aVariation', new BufferAttribute(nextVariation, 1));
    const merged = mergeVertices(subdivided, 1e-6);
    merged.computeVertexNormals();

    const mergedBaseAttr = merged.getAttribute('aBasePos') as BufferAttribute | undefined;
    const mergedVariationAttr = merged.getAttribute('aVariation') as BufferAttribute | undefined;
    const baseArray = mergedBaseAttr
      ? Float32Array.from(mergedBaseAttr.array as ArrayLike<number>)
      : Float32Array.from((merged.getAttribute('position') as BufferAttribute).array as ArrayLike<number>);
    const variationArray = mergedVariationAttr
      ? Float32Array.from(mergedVariationAttr.array as ArrayLike<number>)
      : new Float32Array((merged.getAttribute('position') as BufferAttribute).count);
    merged.deleteAttribute('aBasePos');
    merged.deleteAttribute('aVariation');

    this.setGeometry(merged);
    (this.variationAttr.array as Float32Array).set(variationArray);
    this.variationAttr.needsUpdate = true;
    this.basePositions = baseArray;
    this.updateCurvatureAttribute();

    source.dispose();
    if (source !== sourceClone) {
      sourceClone.dispose();
    }
    subdivided.dispose();
  }

  private updateCurvatureAttribute(): void {
    const positionArray = this.positionAttr.array as Float32Array;
    const normalArray = this.normalAttr.array as Float32Array;
    const curvatureArray = this.curvatureAttr.array as Float32Array;
    const displacementArray = this.displacementAttr.array as Float32Array;
    const adjacency = this.topology.adjacency;
    let minCurvature = Number.POSITIVE_INFINITY;
    let maxCurvature = Number.NEGATIVE_INFINITY;
    let maxDisplacement = 0;

    for (let i = 0; i < curvatureArray.length; i += 1) {
      const neighbors = adjacency[i];
      if (!neighbors || neighbors.length === 0) {
        curvatureArray[i] = 0;
        minCurvature = Math.min(minCurvature, 0);
        maxCurvature = Math.max(maxCurvature, 0);
        continue;
      }

      let avgX = 0;
      let avgY = 0;
      let avgZ = 0;
      for (let j = 0; j < neighbors.length; j += 1) {
        const ni = neighbors[j] * 3;
        avgX += positionArray[ni];
        avgY += positionArray[ni + 1];
        avgZ += positionArray[ni + 2];
      }
      const inv = 1 / neighbors.length;
      avgX *= inv;
      avgY *= inv;
      avgZ *= inv;

      const index = i * 3;
      const lapX = avgX - positionArray[index];
      const lapY = avgY - positionArray[index + 1];
      const lapZ = avgZ - positionArray[index + 2];
      const nx = normalArray[index];
      const ny = normalArray[index + 1];
      const nz = normalArray[index + 2];
      const curvature = Math.abs(lapX * nx + lapY * ny + lapZ * nz);
      curvatureArray[i] = curvature;
      if (curvature < minCurvature) {
        minCurvature = curvature;
      }
      if (curvature > maxCurvature) {
        maxCurvature = curvature;
      }
    }

    const span = Math.max(maxCurvature - minCurvature, 1e-6);
    const invSpan = 1 / span;
    for (let i = 0; i < curvatureArray.length; i += 1) {
      curvatureArray[i] = MathUtils.clamp((curvatureArray[i] - minCurvature) * invSpan, 0, 1);
    }

    this.blurScalarField(curvatureArray);
    this.renormalizeScalarField(curvatureArray);

    for (let i = 0; i < curvatureArray.length; i += 1) {
      const index = i * 3;
      const dx = positionArray[index] - this.basePositions[index];
      const dy = positionArray[index + 1] - this.basePositions[index + 1];
      const dz = positionArray[index + 2] - this.basePositions[index + 2];
      const displacement = Math.sqrt(dx * dx + dy * dy + dz * dz);
      displacementArray[i] = displacement;
      if (displacement > maxDisplacement) {
        maxDisplacement = displacement;
      }
    }
    if (maxDisplacement > 1e-8) {
      const invMaxDisplacement = 1 / maxDisplacement;
      for (let i = 0; i < displacementArray.length; i += 1) {
        displacementArray[i] = MathUtils.clamp(displacementArray[i] * invMaxDisplacement, 0, 1);
      }
    } else {
      displacementArray.fill(0);
    }
    this.blurScalarField(displacementArray);
    this.renormalizeScalarField(displacementArray);

    this.curvatureAttr.needsUpdate = true;
    this.displacementAttr.needsUpdate = true;
  }

  private initializeSeedVariation(): void {
    const variationArray = this.variationAttr.array as Float32Array;
    for (let i = 0; i < variationArray.length; i += 1) {
      variationArray[i] = this.rng.signed();
    }
    this.variationAttr.needsUpdate = true;
  }

  private blurScalarField(values: Float32Array): void {
    const amount = MathUtils.clamp(this.gradientBlur * 0.42, 0, 0.42);
    if (amount <= 0) {
      return;
    }
    const passes = Math.max(1, Math.round(1 + this.gradientBlur * 5));
    const work = this.curvatureWork;
    const adjacency = this.topology.adjacency;

    for (let pass = 0; pass < passes; pass += 1) {
      for (let i = 0; i < values.length; i += 1) {
        const neighbors = adjacency[i];
        if (!neighbors || neighbors.length === 0) {
          work[i] = values[i];
          continue;
        }
        let sum = 0;
        for (let j = 0; j < neighbors.length; j += 1) {
          sum += values[neighbors[j]];
        }
        const average = sum / neighbors.length;
        work[i] = MathUtils.lerp(values[i], average, amount);
      }
      values.set(work);
    }
  }

  private renormalizeScalarField(values: Float32Array): void {
    let minValue = Number.POSITIVE_INFINITY;
    let maxValue = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < values.length; i += 1) {
      const value = values[i];
      if (value < minValue) {
        minValue = value;
      }
      if (value > maxValue) {
        maxValue = value;
      }
    }
    const span = Math.max(maxValue - minValue, 1e-6);
    const invSpan = 1 / span;
    for (let i = 0; i < values.length; i += 1) {
      values[i] = MathUtils.clamp((values[i] - minValue) * invSpan, 0, 1);
    }
  }
}
