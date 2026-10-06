import type { EnemyId, TowerId } from './types';

export type Side = 'defender' | 'attacker';

export const SIDE_KEY = 'bricks.side';

export const SIDES: ReadonlyArray<Side> = ['defender', 'attacker'];

export interface SideInfo {
  id: Side;
  name: string;
  blurb: string;
}

export const SIDE_INFO: Record<Side, SideInfo> = {
  defender: {
    id: 'defender',
    name: 'DEFENDER',
    blurb: 'Build towers, survive every wave. Twenty-five waves, one fortress.',
  },
  attacker: {
    id: 'attacker',
    name: 'ATTACKER',
    blurb: 'Spend bricks to deploy units and break the fortress. Its towers are already built.',
  },
};

/**
 * Bricks per second the attacker regenerates. Deliberately small: the attacker's
 * real money is the tower bounty, so the clock funds the opening push and every
 * brick after that has to be taken off the defence.
 */
export const ATTACKER_INCOME = 10;

/**
 * Bricks the attacker starts with: enough for a first push, not enough to buy
 * the army outright. The opening has to come off the defence, not the clock.
 */
export const ATTACKER_START_GOLD = 200;

/**
 * Seconds the attacker gets to break the fortress. The defender has a wave
 * clock, so the attacker gets an equally visible one; run it out and the keep
 * holds. Generous enough that a thoughtful player has room to experiment, tight
 * enough that dawdling loses.
 */
export const ATTACKER_TIME_LIMIT = 300;

/**
 * How many tiles from each lane's entrance the attacker may deploy on. Units
 * have to walk the lane and fight through the defence, otherwise dropping one
 * next to the fortress would skip the whole puzzle.
 */
export const DEPLOY_ZONE = 3;

/** Bricks granted the instant an attacker-side tower is destroyed. */
export const ATTACKER_TOWER_BOUNTY = 45;

/**
 * Siege fire does triple damage to towers on the attacker side. Without it the
 * defence out-DPSes any army the player can afford and the mode is unwinnable;
 * it also reads correctly, since siege units are the anti-tower specialists.
 */
export const ATTACKER_SIEGE_TOWER_MULT = 3;

/** Extra bricks awarded for destroying a tier-3 tower. */
export const ATTACKER_TIER_BONUS = 25;

/**
 * Deploy cost per unit, in bricks. Roughly tracks durability and leak damage so
 * the roster stays in the same ballpark, with the siege units priced for the
 * fact that they attack towers instead of the fortress.
 */
export const ATTACKER_COST: Record<EnemyId, number> = {
  slime: 20,
  skeleton: 35,
  zombie: 45,
  ghost: 55,
  demon: 80,
  overlord: 150,
  archer: 70,
  gunner: 85,
  launcher: 110,
};

/** Units the attacker may deploy, cheapest first, for the palette UI. */
export const ATTACKER_ORDER: ReadonlyArray<EnemyId> = [
  'slime',
  'skeleton',
  'zombie',
  'archer',
  'ghost',
  'gunner',
  'demon',
  'launcher',
  'overlord',
];

/** Digit1-Digit9 -> creature, matching the order shown on the palette. */
export const ATTACKER_KEYS: Record<string, EnemyId> = Object.fromEntries(
  ATTACKER_ORDER.map((id, i) => [`Digit${i + 1}`, id]),
);

/** Menu copy per side, so the start button never promises the wrong objective. */
export const SIDE_CTA: Record<Side, string> = {
  defender: 'BUILD FORTRESS',
  attacker: 'START ASSAULT',
};

export interface BlueprintTower {
  type: TowerId;
  gx: number;
  gy: number;
  tier: number;
}

export function loadSide(): Side {
  try {
    const raw = localStorage.getItem(SIDE_KEY);
    return raw === 'attacker' ? 'attacker' : 'defender';
  } catch {
    return 'defender';
  }
}

export function saveSide(side: Side): void {
  try {
    localStorage.setItem(SIDE_KEY, side);
  } catch {
    /* private mode: play on without remembering */
  }
}