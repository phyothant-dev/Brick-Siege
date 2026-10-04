/**
 * Map layouts.
 *
 * Every map is a 14x14 board with the keep in the middle, but the lane that
 * feeds it is generated at runtime from a seed, so the same map archetype
 * plays differently each time. Generation is a weighted randomised DFS from a
 * spawn cell on the rim to a gate approach next to the keep: a DFS always
 * yields a connected, non-repeating, orthogonally-adjacent run of cells, so a
 * broken lane is impossible by construction rather than by luck.
 *
 * Archetypes differ by how much they reward going straight versus turning,
 * which changes the whole feel of a map: spiral and rings run long and open,
 * maze and zigzag kink constantly and create tight kill boxes.
 */

export type MapId = 'spiral' | 'crossfire' | 'serpent' | 'rings' | 'maze' | 'plus';

export interface MapArchetype {
  id: MapId;
  name: string;
  blurb: string;
  /** Relative chance of continuing straight rather than turning. */
  straight: number;
  minLen: number;
  maxLen: number;
  /** Board tint for the lane on this map. */
  tint: number;
  /**
   * `random` lanes are walked by the seeded DFS in `attempt()`.
   * `plus` is authored: four hand-placed arms rotated into a '+'.
   */
  kind: 'random' | 'plus';
  /**
   * Fixed seed. Every map is a known, hand-tuned layout that always generates
   * the same lane, so players can learn a map and share tactics.
   */
  seed: number;
}

export const ARCHETYPES: Record<MapId, MapArchetype> = {
  spiral: {
    id: 'spiral',
    name: 'SPIRAL',
    blurb: 'Long sweeping lanes that curl around the keep.',
    straight: 0.86,
    minLen: 58,
    maxLen: 120,
    tint: 0x2b2f3a,
    kind: 'random',
    seed: 1001,
  },
  crossfire: {
    id: 'crossfire',
    name: 'CROSSFIRE',
    blurb: 'Arms shoot in from every side and meet at the gate.',
    straight: 0.62,
    minLen: 48,
    maxLen: 110,
    tint: 0x2f3340,
    kind: 'random',
    seed: 1003,
  },
  serpent: {
    id: 'serpent',
    name: 'SERPENT',
    blurb: 'Saw-tooth runs. Tight switchbacks punish slow guns.',
    straight: 0.5,
    minLen: 52,
    maxLen: 116,
    tint: 0x332b2f,
    kind: 'random',
    seed: 1001,
  },
  rings: {
    id: 'rings',
    name: 'RINGS',
    blurb: 'Concentric circuits. Every tower covers two approaches.',
    straight: 0.78,
    minLen: 54,
    maxLen: 118,
    tint: 0x28333a,
    kind: 'random',
    seed: 1001,
  },
  maze: {
    id: 'maze',
    name: 'MAZE',
    blurb: 'Organic switchbacks with no two runs alike.',
    straight: 0.34,
    minLen: 56,
    maxLen: 112,
    tint: 0x2a3330,
    kind: 'random',
    seed: 1000,
  },
  plus: {
    id: 'plus',
    name: 'FOUR PATHS',
    blurb: 'Four roads cross at the fortress. Hold every arm, or break in from any.',
    straight: 0.7,
    minLen: 14,
    maxLen: 14,
    tint: 0x2e2a34,
    kind: 'plus',
    seed: 2001,
  },
};

export const MAP_ORDER: MapId[] = ['spiral', 'crossfire', 'serpent', 'rings', 'maze', 'plus'];

/**
 * The '+' map is authored, not random: one arm is hand-placed and the other
 * three are exact 90-degree rotations of it. That guarantees four lanes of
 * identical length and identical buildable space, so no side of the board is
 * harder to defend than another — which is the whole point of the map.
 */
const PLUS_ARM: ReadonlyArray<readonly [number, number]> = [
  [6, 0],
  [6, 1],
  [6, 2],
  [6, 3],
  [5, 3],
  [4, 3],
  [4, 4],
  [3, 4],
  [2, 4],
  [2, 5],
  [3, 5],
  [4, 5],
  [5, 5],
  [6, 5],
];

/** Rotate a cell a quarter turn clockwise around the board centre. */
function rotateCW(x: number, y: number, grid: number): [number, number] {
  const max = grid - 1;
  return [max - y, x];
}

function plusLayout(
  spec: MapArchetype,
  _seed: number,
  grid: number,
  keep: ReadonlyArray<readonly [number, number]>,
): Layout {
  const lanes: Lane[] = [];
  let arm = PLUS_ARM;

  for (let quarter = 0; quarter < 4; quarter++) {
    const cells = arm.map(([x, y]) => [x, y] as [number, number]);
    const approach = cells[cells.length - 1];

    // The keep cell this arm delivers into.
    let target = keep[0];
    for (const [kx, ky] of keep) {
      if (Math.abs(kx - approach[0]) + Math.abs(ky - approach[1]) === 1) {
        target = [kx, ky];
        break;
      }
    }

    const dx = approach[0] - target[0];
    const dy = approach[1] - target[1];
    const len = Math.hypot(dx, dy) || 1;

    lanes.push({
      cells,
      gateCell: target,
      gateApproach: [approach[0], approach[1]],
      gateFacing: { x: dx / len, z: dy / len },
    });

    arm = arm.map(([x, y]) => rotateCW(x, y, grid));
  }

  // Lane order: 0 north, 1 east, 2 south, 3 west.
  return {
    archetype: spec,
    lanes,
    cells: lanes.flatMap((l) => [...l.cells]),
    gateCell: lanes[0].gateCell,
    gateApproach: lanes[0].gateApproach,
    gateFacing: lanes[0].gateFacing,
  };
}

/**
 * One attack route: an ordered spawn->fortress chain, plus how it meets the
 * keep. Most maps have exactly one lane; FOUR PATHS has four.
 */
export interface Lane {
  /** Ordered cells from the spawn gate to the cell beside the keep. */
  cells: ReadonlyArray<readonly [number, number]>;
  /** Keep cell the lane finally enters. */
  gateCell: readonly [number, number];
  /** Lane cell immediately outside the gate. */
  gateApproach: readonly [number, number];
  /** Unit vector from the keep outwards towards the lane. */
  gateFacing: { x: number; z: number };
}

export interface Layout {
  archetype: MapArchetype;
  /**
   * Every lane on the map. Kept separate from `cells` because units need to
   * know *which* route they are walking, while tile painting and buildability
   * only need the union.
   */
  lanes: ReadonlyArray<Lane>;
  /** Flattened union of every lane's cells, for tile painting and lookup. */
  cells: ReadonlyArray<readonly [number, number]>;
  /** Shorthand for the primary lane (lanes[0]). */
  gateCell: readonly [number, number];
  gateApproach: readonly [number, number];
  gateFacing: { x: number; z: number };
}

/** Small, fast, seedable PRNG so a seed reproduces a lane exactly. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function attempt(
  grid: number,
  keep: ReadonlyArray<readonly [number, number]>,
  spec: MapArchetype,
  rng: () => number,
): Layout | null {
  const blocked = new Set(keep.map(([x, y]) => `${x},${y}`));

  // Spawn on the rim, avoiding corners so the mouth is not hidden by scenery.
  const along = 1 + Math.floor(rng() * (grid - 2));
  const side = Math.floor(rng() * 4);
  let spawn: [number, number];
  if (side === 0) spawn = [along, 0];
  else if (side === 1) spawn = [along, grid - 1];
  else if (side === 2) spawn = [0, along];
  else spawn = [grid - 1, along];

  const key = (x: number, y: number): string => `${x},${y}`;

  // Any lane cell touching the keep will do, so the gate can end up on any
  // face. Aiming at one exact cell instead makes the search backtrack
  // exponentially; stopping at the first keep-adjacent cell terminates fast.
  const isGate = (x: number, y: number): boolean =>
    keep.some(([kx, ky]) => Math.abs(kx - x) + Math.abs(ky - y) === 1);

  // Weighted self-avoiding walk with backtracking. `straight` decides how
  // readily the walk keeps its heading, which is what separates a spiral from
  // a maze.
  const path: Array<[number, number]> = [[spawn[0], spawn[1]]];
  const onPath = new Set<string>([key(spawn[0], spawn[1])]);
  let dirIndex = Math.floor(rng() * 4);
  let gate: readonly [number, number] | null = null;
  let guard = 0;

  while (path.length > 0) {
    const [cx, cy] = path[path.length - 1];
    if (isGate(cx, cy)) {
      gate = [cx, cy];
      break;
    }
    if (++guard > 20_000) return null;

    const options: Array<{ x: number; y: number; w: number }> = [];
    for (let d = 0; d < 4; d++) {
      const [dx, dy] = DIRS[d];
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= grid || ny >= grid) continue;
      if (blocked.has(key(nx, ny)) || onPath.has(key(nx, ny))) continue;
      const w = d === dirIndex ? spec.straight : 1;
      options.push({ x: nx, y: ny, w });
    }

    if (!options.length) {
      path.pop();
      onPath.delete(key(cx, cy));
      const prev = path[path.length - 1];
      if (prev) {
        dirIndex = DIRS.findIndex(([dx, dy]) => prev[0] + dx === cx && prev[1] + dy === cy);
        if (dirIndex < 0) dirIndex = 0;
      }
      continue;
    }

    let total = 0;
    for (const o of options) total += o.w;
    let roll = rng() * total;
    let chosen = options[options.length - 1];
    for (const o of options) {
      roll -= o.w;
      if (roll <= 0) {
        chosen = o;
        break;
      }
    }
    dirIndex = DIRS.findIndex(([dx, dy]) => cx + dx === chosen.x && cy + dy === chosen.y);
    path.push([chosen.x, chosen.y]);
    onPath.add(key(chosen.x, chosen.y));
  }

  if (!gate) return null;
  const cells = path as ReadonlyArray<readonly [number, number]>;
  if (cells.length < spec.minLen || cells.length > spec.maxLen) return null;

  const approach = cells[cells.length - 1];
  // The keep cell this approach belongs to.
  let target = keep[0];
  for (const [kx, ky] of keep) {
    if (Math.abs(kx - approach[0]) + Math.abs(ky - approach[1]) === 1) {
      target = [kx, ky];
      break;
    }
  }
  const dx = approach[0] - target[0];
  const dy = approach[1] - target[1];
  const len = Math.hypot(dx, dy) || 1;

  return {
    archetype: spec,
    lanes: [{ cells, gateCell: target, gateApproach: [approach[0], approach[1]], gateFacing: { x: dx / len, z: dy / len } }],
    cells,
    gateCell: target,
    gateApproach: [approach[0], approach[1]],
    gateFacing: { x: dx / len, z: dy / len },
  };
}

/**
 * Build a valid layout for an archetype. Retries with fresh randomness until
 * the lane lands in the archetype's length window, so callers always get a
 * playable map or an explicit failure — never a broken lane.
 */
export function generateLayout(
  archetype: MapId,
  seed: number,
  grid: number,
  keep: ReadonlyArray<readonly [number, number]>,
): Layout {
  const spec = ARCHETYPES[archetype];
  // FOUR PATHS is built by hand rather than walked, so that its four lanes are
  // guaranteed to form a clean '+' instead of four unrelated snakes.
  if (spec.kind === 'plus') return plusLayout(spec, seed, grid, keep);

  for (let i = 0; i < 60; i++) {
    const layout = attempt(grid, keep, spec, mulberry32(seed + i * 7919));
    if (layout) return layout;
  }
  // Relax the window rather than give up; a long or short lane is still
  // playable, a missing lane is not.
  for (let i = 0; i < 60; i++) {
    const relaxed = { ...spec, minLen: 30, maxLen: grid * grid };
    const layout = attempt(grid, keep, relaxed, mulberry32(seed + i * 104729));
    if (layout) return layout;
  }
  throw new Error(`could not generate a lane for map "${archetype}"`);
}

/** Buildable stud count, used to sanity-check a generated map. */
export function buildableCount(
  layout: Layout,
  grid: number,
  keep: ReadonlyArray<readonly [number, number]>,
): number {
  const taken = new Set(layout.cells.map(([x, y]) => `${x},${y}`));
  for (const [x, y] of keep) taken.add(`${x},${y}`);
  return grid * grid - taken.size;
}