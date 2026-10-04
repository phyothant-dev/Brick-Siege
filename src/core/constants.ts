import { ARCHETYPES, MAP_ORDER, generateLayout } from './maps';
import type { Lane, Layout, MapArchetype, MapId } from './maps';
import type { ElementId } from './types';

/** Grid is GRID x GRID studs, 1 world unit per stud. */
export const GRID = 14;
export const TILE = 1;
export const BOARD = GRID * TILE;
/** Half-extent of the board in world units (board spans -HALF .. +HALF). */
export const HALF = BOARD / 2;

/** Convert a grid column to a world X centre. */
export function gxToWorld(gx: number): number {
  return (gx + 0.5) * TILE - HALF;
}

/** Convert a grid row to a world Z centre. Rows increase toward the camera. */
export function gyToWorld(gy: number): number {
  return (gy + 0.5) * TILE - HALF;
}

export function worldToGx(x: number): number {
  return Math.floor((x + HALF) / TILE);
}

export function worldToGy(z: number): number {
  return Math.floor((z + HALF) / TILE);
}

/**
 * The keep owns the four centre cells. It is derived from GRID so the fortress
 * is always dead centre, whatever the board size.
 */
export const FORTRESS_CELLS: ReadonlyArray<readonly [number, number]> = (() => {
  const lo = Math.floor((GRID - 2) / 2);
  return [
    [lo, lo],
    [lo + 1, lo],
    [lo, lo + 1],
    [lo + 1, lo + 1],
  ];
})();

// ------------------------------------------------------------------ map lane

/**
 * The lane is generated rather than hard-coded (see ./maps.ts). Each map has a
 * fixed seed, so a map always looks the same and players can learn it. This
 * module owns the *active* layout and keeps exporting plain values, so nothing
 * downstream had to learn that the map is runtime state.
 */
const DEFAULT_MAP: MapId = 'spiral';
let activeSeed = ARCHETYPES[DEFAULT_MAP].seed;
let layout: Layout = generateLayout(DEFAULT_MAP, activeSeed, GRID, FORTRESS_CELLS);

export let PATH_CELLS: ReadonlyArray<readonly [number, number]> = layout.cells;
export let PATH_KEYS: Set<string> = pathKeySet(layout.cells);
/**
 * Every lane on the current map, in order. Most maps have exactly one; FOUR
 * PATHS has four, all converging on the same fortress. Lane 0 is the primary.
 */
export let LANES: ReadonlyArray<Lane> = layout.lanes;
export let GATE_FACING: { x: number; z: number } = layout.gateFacing;
export let GATE_APPROACH: readonly [number, number] = layout.gateApproach;
export let FORTRESS_GATE = { x: 0, z: 0 };

/** Bumped on every layout change so derived caches (lane metrics) invalidate. */
export let LAYOUT_VERSION = 0;

/** How many lanes the active map has. Always at least 1. */
export function activeLaneCount(): number {
  return LANES.length || 1;
}

function pathKeySet(cells: ReadonlyArray<readonly [number, number]>): Set<string> {
  return new Set(cells.map(([x, y]) => `${x},${y}`));
}

/** World-space threshold of the keep gate, where enemies are delivered. */
function gateWorld(layout: Layout): { x: number; z: number } {
  return {
    x: (gxToWorld(layout.gateApproach[0]) + gxToWorld(layout.gateCell[0])) / 2,
    z: (gyToWorld(layout.gateApproach[1]) + gyToWorld(layout.gateCell[1])) / 2,
  };
}

/**
 * Lane sanity checks. A broken lane is unplayable and a silent off-by-one
 * would only show up as units walking through walls, so fail loudly.
 *
 * Each lane is checked independently, then cross-checked against its siblings:
 * lanes may not share cells (two units would spawn on top of each other) and
 * every lane must terminate beside the keep.
 */
function validateLayout(next: Layout): void {
  if (!next.lanes.length) throw new Error('layout has no lanes');
  const acrossLanes = new Set<string>();

  next.lanes.forEach((lane, laneIndex) => {
    const tag = `lane ${laneIndex}`;
    const seen = new Set<string>();
    for (let i = 0; i < lane.cells.length; i++) {
      const [x, y] = lane.cells[i];
      const k = `${x},${y}`;
      if (seen.has(k)) throw new Error(`${tag} revisits cell ${k}`);
      if (!isInsideBoard(x, y)) throw new Error(`${tag} leaves the board at ${k}`);
      if (isFortressCellRaw(x, y)) throw new Error(`${tag} runs through the keep at ${k}`);
      if (acrossLanes.has(k)) throw new Error(`${tag} overlaps another lane at ${k}`);
      seen.add(k);
      acrossLanes.add(k);
      if (i > 0) {
        const [ax, ay] = lane.cells[i - 1];
        if (Math.abs(ax - x) + Math.abs(ay - y) !== 1) {
          throw new Error(`${tag} jump between ${ax},${ay} and ${x},${y}`);
        }
      }
    }
    const last = lane.cells[lane.cells.length - 1];
    const adj = Math.abs(last[0] - lane.gateCell[0]) + Math.abs(last[1] - lane.gateCell[1]);
    if (adj !== 1) throw new Error(`${tag} ends at ${last}, not beside the keep gate`);
  });
}

function applyLayout(next: Layout, seed: number): void {
  validateLayout(next);
  layout = next;
  activeSeed = seed;
  PATH_CELLS = next.cells;
  PATH_KEYS = pathKeySet(next.cells);
  LANES = next.lanes;
  GATE_FACING = next.gateFacing;
  GATE_APPROACH = next.gateApproach;
  FORTRESS_GATE = gateWorld(next);
  LAYOUT_VERSION++;
}

/** Switch to a map. Each archetype has a fixed seed, so its lane is stable. */
export function setMap(id: MapId, seed?: number): void {
  const s = seed ?? ARCHETYPES[id].seed;
  applyLayout(generateLayout(id, s, GRID, FORTRESS_CELLS), s);
}

export function currentMap(): MapArchetype {
  return layout.archetype;
}

export function currentSeed(): number {
  return activeSeed;
}

// Prime the derived values for the first layout.
{
  const w = gateWorld(layout);
  FORTRESS_GATE.x = w.x;
  FORTRESS_GATE.z = w.z;
}

/** World-space centre of the keep. */
export const FORTRESS_CENTER = {
  x: (gxToWorld(FORTRESS_CELLS[0][0]) + gxToWorld(FORTRESS_CELLS[1][0])) / 2,
  z: (gyToWorld(FORTRESS_CELLS[0][1]) + gyToWorld(FORTRESS_CELLS[3][1])) / 2,
};

export { ARCHETYPES, MAP_ORDER };
export type { MapId, MapArchetype, Layout, Lane };

function isFortressCellRaw(gx: number, gy: number): boolean {
  return FORTRESS_CELLS.some(([x, y]) => x === gx && y === gy);
}

export const FORTRESS_KEYS = new Set(FORTRESS_CELLS.map(([x, y]) => `${x},${y}`));

export function isPathCell(gx: number, gy: number): boolean {
  return PATH_KEYS.has(`${gx},${gy}`);
}

export function isFortressCell(gx: number, gy: number): boolean {
  return FORTRESS_KEYS.has(`${gx},${gy}`);
}

export function isInsideBoard(gx: number, gy: number): boolean {
  return gx >= 0 && gy >= 0 && gx < GRID && gy < GRID;
}

/** Build sites = any stud that is neither lane nor fortress. */
export function isBuildable(gx: number, gy: number): boolean {
  return isInsideBoard(gx, gy) && !isPathCell(gx, gy) && !isFortressCell(gx, gy);
}

/** LEGO official colours (LEGO® colour ids, 1990s-2020s system). */
export const LEGO = {
  red: 0xc4281c,
  brightRed: 0xd0011b,
  blue: 0x0055bf,
  mediumBlue: 0x5a93db,
  darkBlue: 0x0a3463,
  sandBlue: 0x5c94fc,
  yellow: 0xf2cd37,
  brightYellow: 0xffcf00,
  orange: 0xfe8a18,
  green: 0x237841,
  brightGreen: 0x4b9f4a,
  darkGreen: 0x184632,
  redBrown: 0x582a12,
  tan: 0xd9bb7b,
  white: 0xf4f4f4,
  lightBluishGray: 0xa0a5a9,
  darkBluishGray: 0x6c6e68,
  black: 0x1b2a34,
  flatGray: 0x7f7f7f,
  magenta: 0x923978,
  transClear: 0xf5f2ec,
  transIce: 0xa5e9ff,
  transLightBlue: 0xb6d7e8,
} as const;

export const ELEMENT_COLOR: Record<ElementId, number> = {
  physical: LEGO.brightYellow,
  ice: LEGO.transIce,
  lightning: LEGO.brightYellow,
  poison: LEGO.brightGreen,
};

export const ELEMENT_LABEL: Record<ElementId, string> = {
  physical: 'PHYSICAL',
  ice: 'ICE',
  lightning: 'LIGHTNING',
  poison: 'POISON',
};

/** Real LEGO proportions: 8mm stud pitch, 9.6mm brick, 3.2mm plate. */
export const STUDS_PER_TILE = 8;
/** Distance between stud centres. */
export const PITCH = TILE / STUDS_PER_TILE;
export const BRICK_H = PITCH * 1.2;
export const PLATE_H = PITCH * 0.4;
export const STUD_R = PITCH * 0.32;
export const STUD_H = PITCH * 0.22;
/** Visible seam between adjacent bricks. */
export const BRICK_GAP = PITCH * 0.05;

export const FORTRESS_MAX_HP = 20;

export const START_GOLD = 320;
export const START_BRICKS = 260;

/** Seconds of build time granted before wave 1, and between waves. */
export const BUILD_TIME_FIRST = 30;
export const BUILD_TIME = 18;

/** Gold awarded per second of unused build time when a wave is started early. */
export const EARLY_BONUS_PER_SEC = 3;

/** Towers cost slightly more each time you build one, to stop infinite spam. */
export const COST_SCALE_STEP = 0.09;
export const COST_SCALE_MAX = 1.6;

/** Fraction of bricks refunded when a tower is sold. */
export const SELL_REFUND = 0.6;

/** Two towers must be within this many tiles (manhattan) to be combined. */
export const COMBINE_RANGE = 3;

/** Fortress shakes for this long after a leak. */
export const LEAK_SHAKE = 0.45;

/** Render scale for the whole scene relative to a 1280x720 design size. */
export const DESIGN_W = 1280;
export const DESIGN_H = 720;

export const PALETTE = {
  baseplate: 0xf4f3ee,
  baseplateAlt: LEGO.flatGray,
  // Path reads as gray road blocks on a light baseplate.
  road: 0x9aa0a6,
  roadEdge: 0x6b7176,
  gate: LEGO.redBrown,
  fortressWall: LEGO.lightBluishGray,
  fortressTrim: LEGO.red,
  ground: 0xe9e7e0,
} as const;