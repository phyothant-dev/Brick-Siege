import { mulberry32, type Layout } from './maps';
import type { BlueprintTower } from './sides';
import type { TowerId } from './types';

/**
 * Attacker mode pits the player against a fortress that is *already* defended.
 * Those towers are laid out here, deterministically, so the same map is always
 * the same puzzle and players can learn and share a solution.
 *
 * The layout is derived from the map's own lane geometry rather than
 * hand-authored, which means it adapts to all six maps for free.
 */

/**
 * Tower mix, ordered by how much lane it can actually cover. Cheap single-target
 * and cheap slows dominate; the expensive splash pieces appear sparingly so the
 * puzzle has recognisable weak joints rather than uniform brick soup.
 */
const MIX: ReadonlyArray<TowerId> = [
  'shooter',
  'freezer',
  'shooter',
  'mortar',
  'shooter',
  'coil',
  'sprayer',
  'shooter',
  'cluster',
  'freezer',
  'mortar',
  'sniper',
  'shooter',
  'sprayer',
  'coil',
  'shooter',
];

/**
 * How many towers the defender gets, as a fraction of the map's buildable studs.
 * Enough to feel like a real defence, sparse enough that the attacker can find
 * and break a route.
 */
const DENSITY = 0.085;

/** Offsets tried around a lane cell, nearest ring first. */
const RING: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
  [2, 0],
  [-2, 0],
  [0, 2],
  [0, -2],
];

/**
 * Build the defender's pre-placed towers for a layout.
 *
 * Sites are chosen adjacent to lane cells (best coverage per tower) and visited
 * in a seeded shuffle, so the same map always yields the same defence while no
 * two maps defend themselves identically.
 */
export function buildBlueprint(
  layout: Layout,
  grid: number,
  keep: ReadonlyArray<readonly [number, number]>,
  seed: number,
): BlueprintTower[] {
  const lane = new Set<string>();
  for (const l of layout.lanes) {
    for (const [x, y] of l.cells) lane.add(`${x},${y}`);
  }
  const keepKeys = new Set(keep.map(([x, y]) => `${x},${y}`));

  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < grid && y < grid;

  // Candidate sites: every non-lane, non-keep stud touching a lane.
  const candidates: Array<[number, number]> = [];
  for (const key of lane) {
    const [lx, ly] = key.split(',').map(Number);
    for (const [dx, dy] of RING) {
      const x = lx + dx;
      const y = ly + dy;
      const k = `${x},${y}`;
      if (!inside(x, y) || lane.has(k) || keepKeys.has(k)) continue;
      candidates.push([x, y]);
    }
  }

  // Dedupe, then shuffle deterministically.
  const unique = [...new Map(candidates.map((c) => [`${c[0]},${c[1]}`, c])).values()];
  const rng = mulberry32(seed ^ 0xb1e5);
  for (let i = unique.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [unique[i], unique[j]] = [unique[j], unique[i]];
  }

  const buildable = grid * grid - lane.size - keepKeys.size;
  const count = Math.max(4, Math.round(buildable * DENSITY));
  const towers: BlueprintTower[] = [];

  for (const [gx, gy] of unique) {
    if (towers.length >= count) break;
    const type = MIX[towers.length % MIX.length];
    towers.push({ type, gx, gy, tier: 1 });
  }

  return towers;
}