import { BufferGeometry, CylinderGeometry, MathUtils, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BaseShape } from '../types';

const tempCenter = new Vector3();

function createBaseGeometry(shape: BaseShape, subdivision: number): BufferGeometry {
  const t = MathUtils.clamp((subdivision - 1) / 99, 0, 1);
  switch (shape) {
    case 'sphere':
      return new SphereGeometry(
        1.15,
        Math.round(MathUtils.lerp(24, 120, t)),
        Math.round(MathUtils.lerp(14, 72, t)),
      );
    case 'torus':
      return new TorusGeometry(
        1,
        0.36,
        Math.round(MathUtils.lerp(12, 64, t)),
        Math.round(MathUtils.lerp(48, 220, t)),
      );
    case 'cylinder':
      return new CylinderGeometry(
        1,
        1,
        1.8,
        Math.round(MathUtils.lerp(12, 96, t)),
        Math.round(MathUtils.lerp(1, 40, t)),
      );
    default:
      return new SphereGeometry(1.15, 48, 32);
  }
}

export function buildShapeGeometry(shape: BaseShape, subdivision = 35): BufferGeometry {
  const rawGeometry = createBaseGeometry(shape, subdivision);
  rawGeometry.computeBoundingBox();
  if (rawGeometry.boundingBox) {
    rawGeometry.boundingBox.getCenter(tempCenter);
    rawGeometry.translate(-tempCenter.x, -tempCenter.y, -tempCenter.z);
  }

  rawGeometry.computeBoundingSphere();
  const radius = rawGeometry.boundingSphere?.radius ?? 1;
  const scale = radius > 1e-6 ? 1.15 / radius : 1;
  rawGeometry.scale(scale, scale, scale);

  // Remove seam-preserving attributes from primitive generators so shared vertices can be welded.
  if (rawGeometry.getAttribute('uv')) {
    rawGeometry.deleteAttribute('uv');
  }
  if (rawGeometry.getAttribute('normal')) {
    rawGeometry.deleteAttribute('normal');
  }

  const welded = mergeVertices(rawGeometry, 1e-6);
  rawGeometry.dispose();
  welded.computeVertexNormals();
  welded.computeBoundingSphere();
  return welded;
}
