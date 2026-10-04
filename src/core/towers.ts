import type { ElementId, TowerId, TowerSpec, TowerTierSpec, Tier } from './types';
import { LEGO } from './constants';

const NEUTRAL: TowerTierSpec = {
  range: 3.2,
  cooldown: 1,
  damage: 10,
  splash: 0,
  slow: 0,
  slowTime: 0,
  poisonDps: 0,
  poisonTime: 0,
  chain: 0,
  chainFalloff: 0.7,
  burst: 1,
  buffDamage: 0,
  buffHaste: 0,
  buffRadius: 0,
};

function tier(over: Partial<TowerTierSpec>): TowerTierSpec {
  return { ...NEUTRAL, ...over };
}

/**
 * Towers only reach tier 2 and 3 by combining two matching towers. Values are
 * tuned so a combined tower is worth roughly 1.7x a tier 1 — combining buys
 * efficiency and board space, not a free damage spike.
 */
export const TOWERS: Record<TowerId, TowerSpec> = {
  shooter: {
    id: 'shooter',
    name: 'BRICK SHOOTER',
    element: 'physical',
    cost: 60,
    hotkey: '1',
    accent: LEGO.brightRed,
    blurb: 'Rapid single-target blaster. Cheap, reliable, hates nothing.',
    tiers: [
      tier({ range: 3.2, cooldown: 0.6, damage: 8.5 }),
      tier({ range: 3.6, cooldown: 0.55, damage: 13.5 }),
      tier({ range: 4.1, cooldown: 0.5, damage: 20 }),
    ],
  },
  mortar: {
    id: 'mortar',
    name: 'MORTAR',
    element: 'physical',
    cost: 110,
    hotkey: '2',
    accent: LEGO.darkBlue,
    blurb: 'Lobs a brick shell that bursts on impact. Slow to reload.',
    tiers: [
      tier({ range: 3.4, cooldown: 1.9, damage: 26, splash: 1.1 }),
      tier({ range: 3.8, cooldown: 1.75, damage: 40, splash: 1.35 }),
      tier({ range: 4.3, cooldown: 1.6, damage: 58, splash: 1.6, burst: 2 }),
    ],
  },
  freezer: {
    id: 'freezer',
    name: 'FREEZER',
    element: 'ice',
    cost: 95,
    hotkey: '3',
    accent: LEGO.sandBlue,
    blurb: 'Frost shells that chill and slow. Low damage, huge control.',
    tiers: [
      tier({ range: 2.9, cooldown: 1.0, damage: 7, slow: 0.35, slowTime: 1.6 }),
      tier({ range: 3.3, cooldown: 0.9, damage: 11, slow: 0.45, slowTime: 2.0 }),
      tier({ range: 3.7, cooldown: 0.8, damage: 16, slow: 0.55, slowTime: 2.4 }),
    ],
  },
  coil: {
    id: 'coil',
    name: 'TESLA COIL',
    element: 'lightning',
    cost: 130,
    hotkey: '4',
    accent: LEGO.brightYellow,
    blurb: 'Arcs to nearby enemies. No travel time, hits everything it touches.',
    tiers: [
      tier({ range: 3.0, cooldown: 1.15, damage: 11, chain: 1, chainFalloff: 0.7 }),
      tier({ range: 3.4, cooldown: 1.0, damage: 17, chain: 2, chainFalloff: 0.7 }),
      tier({ range: 3.8, cooldown: 0.9, damage: 24, chain: 3, chainFalloff: 0.75 }),
    ],
  },
  sprayer: {
    id: 'sprayer',
    name: 'SPRAYER',
    element: 'poison',
    cost: 100,
    hotkey: '5',
    accent: LEGO.brightGreen,
    blurb: 'Paints enemies in toxic green paint. Damage over time stacks.',
    tiers: [
      tier({ range: 2.7, cooldown: 1.3, damage: 3, poisonDps: 6, poisonTime: 3.0 }),
      tier({ range: 3.1, cooldown: 1.15, damage: 5, poisonDps: 10, poisonTime: 3.5 }),
      tier({ range: 3.5, cooldown: 1.0, damage: 7, poisonDps: 16, poisonTime: 4.0 }),
    ],
  },
  sniper: {
    id: 'sniper',
    name: 'LONG SHOT',
    element: 'physical',
    cost: 95,
    hotkey: '6',
    accent: LEGO.black,
    blurb: 'Huge range, brutal single hit, slow to reload. Punishes anything that walks a long way.',
    tiers: [
      tier({ range: 6.4, cooldown: 2.3, damage: 44 }),
      tier({ range: 7, cooldown: 2.1, damage: 72 }),
      tier({ range: 7.6, cooldown: 1.9, damage: 108 }),
    ],
  },
  cluster: {
    id: 'cluster',
    name: 'CLUSTER',
    element: 'ice',
    cost: 85,
    hotkey: '7',
    accent: LEGO.transIce,
    blurb: 'Short-range scatter that chills a whole pack. Weak alone, brutal in a crowd.',
    tiers: [
      tier({ range: 3.5, cooldown: 1.4, damage: 12, splash: 1.3, slow: 0.3, slowTime: 1.4 }),
      tier({ range: 3.8, cooldown: 1.3, damage: 19, splash: 1.5, slow: 0.35, slowTime: 1.6 }),
      tier({ range: 4.2, cooldown: 1.2, damage: 28, splash: 1.7, slow: 0.4, slowTime: 1.8 }),
    ],
  },
  support: {
    id: 'support',
    name: 'BEACON',
    element: 'lightning',
    cost: 70,
    hotkey: '8',
    accent: LEGO.brightYellow,
    blurb: 'Deals no damage. Projects a field that makes nearby towers hit harder and fire faster.',
    tiers: [
      tier({ range: 0, cooldown: 1, damage: 0, buffDamage: 0.18, buffHaste: 0.12, buffRadius: 2.6 }),
      tier({ range: 0, cooldown: 1, damage: 0, buffDamage: 0.28, buffHaste: 0.18, buffRadius: 3 }),
      tier({ range: 0, cooldown: 1, damage: 0, buffDamage: 0.4, buffHaste: 0.25, buffRadius: 3.4 }),
    ],
  },
};

export const TOWER_ORDER: TowerId[] = [
  'shooter',
  'mortar',
  'freezer',
  'coil',
  'sprayer',
  'sniper',
  'cluster',
  'support',
];

export const MAX_TIER: Tier = 3;

/**
 * Tower durability. Tier 3 is far sturdier, so a combined tower is a real
 * investment rather than a target.
 */
export function towerMaxHp(type: TowerId, tierIndex: Tier): number {
  const base: Record<TowerId, number> = {
    shooter: 100,
    mortar: 85,
    freezer: 110,
    sniper: 70,
    cluster: 95,
    support: 120,
    coil: 80,
    sprayer: 95,
  };
  return Math.round(base[type] * (1 + 0.6 * (tierIndex - 1)));
}

export function tierSpec(type: TowerId, tierIndex: Tier): TowerTierSpec {
  return TOWERS[type].tiers[tierIndex - 1];
}

/** Theoretical damage per second against a neutral (1.0x) target. */
export function towerDps(type: TowerId, tierIndex: Tier): number {
  const s = tierSpec(type, tierIndex);
  const direct = (s.damage * s.burst) / s.cooldown;
  const dot = (s.poisonDps * s.poisonTime) / s.cooldown;
  return direct + dot;
}

/** Rough single-target throughput including the ice slow's contribution. */
export function describeTower(type: TowerId, tierIndex: Tier): string {
  const s = tierSpec(type, tierIndex);
  const bits: string[] = [];
  bits.push(`${Math.round((s.damage * s.burst * 10) / 10)} dmg`);
  if (s.splash > 0) bits.push(`${s.splash.toFixed(2)} blast`);
  if (s.slow > 0) bits.push(`-${Math.round(s.slow * 100)}% speed`);
  if (s.poisonDps > 0) bits.push(`${s.poisonDps} dot`);
  if (s.chain > 0) bits.push(`${s.chain + 1} chain`);
  return bits.join(' / ');
}

export function elementLabel(e: ElementId): string {
  return e === 'lightning' ? 'LIGHTNING' : e.toUpperCase();
}