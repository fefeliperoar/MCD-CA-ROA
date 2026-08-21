import type { BufferGeometry } from 'three';

export type GeometryTopology = {
  adjacency: number[][];
  edges: Array<[number, number]>;
};

export function buildTopology(geometry: BufferGeometry): GeometryTopology {
  const position = geometry.getAttribute('position');
  const vertexCount = position.count;
  const adjacencySets = Array.from({ length: vertexCount }, () => new Set<number>());
  const edgeSet = new Set<string>();

  const index = geometry.index;
  if (index) {
    const indices = index.array;
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];
      connect(a, b, adjacencySets, edgeSet);
      connect(b, c, adjacencySets, edgeSet);
      connect(c, a, adjacencySets, edgeSet);
    }
  } else {
    for (let i = 0; i < vertexCount; i += 3) {
      const a = i;
      const b = i + 1;
      const c = i + 2;
      if (c >= vertexCount) {
        break;
      }
      connect(a, b, adjacencySets, edgeSet);
      connect(b, c, adjacencySets, edgeSet);
      connect(c, a, adjacencySets, edgeSet);
    }
  }

  const edges = Array.from(edgeSet, (key): [number, number] => {
    const [a, b] = key.split('_').map((v) => Number.parseInt(v, 10));
    return [a, b];
  });
  const adjacency = adjacencySets.map((set) => Array.from(set));
  return { adjacency, edges };
}

function connect(a: number, b: number, adjacencySets: Set<number>[], edgeSet: Set<string>): void {
  adjacencySets[a].add(b);
  adjacencySets[b].add(a);
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  edgeSet.add(`${low}_${high}`);
}
