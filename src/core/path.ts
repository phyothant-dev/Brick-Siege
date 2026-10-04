import { LANES, LAYOUT_VERSION, PATH_CELLS, gxToWorld, gyToWorld } from './constants';

export interface PathPoint {
  x: number;
  z: number;
}

/**
 * One cached lane: the world-space corners of a single spawn->fortress path,
 * plus its cumulative arc-length table.
 */
interface LanePath {
  points: PathPoint[];
  cum: number[];
  length: number;
}

/**
 * Lane metrics are derived from the generated layout, so they are rebuilt
 * whenever the map changes rather than computed once at import time.
 *
 * Maps have one or more lanes (FOUR PATHS has four). Everything is indexed by
 * lane; lane 0 is the primary one, which keeps single-lane maps behaving
 * exactly as they always did.
 */
let version = -1;
let lanes: LanePath[] = [];

function buildLane(cells: ReadonlyArray<readonly [number, number]>): LanePath {
  const points = cells.map(([gx, gy]) => ({ x: gxToWorld(gx), z: gyToWorld(gy) }));
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
  }
  return { points, cum, length: cum[cum.length - 1] || 1 };
}

function sync(): void {
  if (version === LAYOUT_VERSION && lanes.length) return;
  version = LAYOUT_VERSION;
  const sources = LANES.length ? LANES : [{ cells: PATH_CELLS }];
  lanes = sources.map((lane) => buildLane(lane.cells));
}

/** How many lanes the current map has. */
export function laneCount(): number {
  sync();
  return lanes.length;
}

/** World-space corners of a lane, in order. Defaults to the primary lane. */
export function pathPoints(lane = 0): PathPoint[] {
  sync();
  return lanes[lane]?.points ?? lanes[0].points;
}

/** Length of a lane in world units (tiles). Defaults to the primary lane. */
export function pathLength(lane = 0): number {
  sync();
  return lanes[lane]?.length ?? lanes[0].length;
}

/**
 * How far along a lane a unit at `dist` has progressed, as a 0..1 fraction.
 * Tower targeting compares this instead of raw distance so that units on short
 * lanes are not treated as further along than units on long ones.
 */
export function laneProgress(dist: number, lane = 0): number {
  const len = pathLength(lane);
  return len > 0 ? Math.max(0, Math.min(1, dist / len)) : 0;
}

/** Total tiles the lane covers — used for progress readouts. */
export function pathTiles(lane = 0): number {
  return pathLength(lane);
}

export interface PathSample {
  x: number;
  z: number;
  /** Unit vector pointing down the lane at this distance. */
  dx: number;
  dz: number;
}

const SAMPLE: PathSample = { x: 0, z: 0, dx: 1, dz: 0 };

/**
 * Maps a distance along a lane to a world position and heading.
 * Results are written into `out` to avoid allocating in the hot loop.
 */
export function samplePath(dist: number, lane = 0, out: PathSample = SAMPLE): PathSample {
  sync();
  const cache = lanes[lane] ?? lanes[0];
  const d = Math.max(0, Math.min(dist, cache.length));
  const { points, cum } = cache;

  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;

  const a = points[i - 1];
  const b = points[i];
  const segLen = cum[i] - cum[i - 1] || 1;
  const t = (d - cum[i - 1]) / segLen;

  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
  out.dx = (b.x - a.x) / segLen;
  out.dz = (b.z - a.z) / segLen;
  return out;
}

/** Straight-line distance from a lane sample to an arbitrary world point. */
export function laneDistanceTo(pos: PathSample, x: number, z: number): number {
  return Math.hypot(pos.x - x, pos.z - z);
}

/** World position of a lane's spawn gate. */
export function pathStart(lane = 0): PathPoint {
  sync();
  const pts = lanes[lane]?.points ?? lanes[0].points;
  return pts[0];
}