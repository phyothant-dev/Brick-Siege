import { LEGO } from './constants';
import type { EnemyId, EnemySpec } from './types';

/**
 * Weakness table. Slimes shrug off bricks but melt to ice and lightning,
 * skeletons shatter under blunt force but ignore slime spray entirely, and
 * so on. Read the codex overlay in-game for the cheat sheet.
 */
export const ENEMIES: Record<EnemyId, EnemySpec> = {
  slime: {
    id: 'slime',
    name: 'STUD SLIME',
    color: LEGO.brightGreen,
    accent: LEGO.darkGreen,
    hp: 42,
    speed: 1.05,
    reward: 9,
    leak: 1,
    scale: 0.88,
    gait: 3.4,
    resistance: { physical: 0.35, ice: 1.7, lightning: 1.6, poison: 1.0 },
    blurb: 'Jiggly. Barely notices bricks, dissolves in cold water.',
  },
  skeleton: {
    id: 'skeleton',
    name: 'BONE BUILDER',
    color: LEGO.white,
    accent: LEGO.flatGray,
    hp: 34,
    speed: 1.55,
    reward: 11,
    leak: 1,
    scale: 0.84,
    gait: 7.5,
    resistance: { physical: 1.8, ice: 0.6, lightning: 1.0, poison: 0 },
    blurb: 'Fast little pile of bones. Shatters under blunt force, immune to poison.',
  },
  zombie: {
    id: 'zombie',
    name: 'CRUMBLE ZOMBIE',
    color: LEGO.darkGreen,
    accent: LEGO.redBrown,
    hp: 98,
    speed: 0.72,
    reward: 16,
    leak: 2,
    scale: 1.06,
    gait: 2.4,
    resistance: { physical: 0.45, ice: 2.0, lightning: 0.9, poison: 0 },
    blurb: 'Slow brick lump. Takes double from ice and nothing from poison.',
  },
  ghost: {
    id: 'ghost',
    name: 'GHOST BRICK',
    color: LEGO.transLightBlue,
    accent: LEGO.white,
    hp: 58,
    speed: 1.38,
    reward: 18,
    leak: 1,
    scale: 0.95,
    gait: 2.1,
    resistance: { physical: 0, ice: 1.1, lightning: 1.3, poison: 1.0 },
    blurb: 'Phases straight through anything physical. Needs magic.',
  },
  demon: {
    id: 'demon',
    name: 'BRICK DEMON',
    color: LEGO.red,
    accent: LEGO.black,
    hp: 215,
    speed: 0.62,
    reward: 36,
    leak: 3,
    scale: 1.28,
    gait: 2.0,
    resistance: { physical: 0.55, ice: 2.0, lightning: 1.2, poison: 0.9 },
    blurb: 'Heavy bruiser. Shrugs off force, melts the second you frost him.',
  },
  overlord: {
    id: 'overlord',
    name: 'THE OVERLORD',
    color: LEGO.magenta,
    accent: LEGO.black,
    hp: 1500,
    speed: 0.48,
    reward: 240,
    leak: 10,
    scale: 2.0,
    gait: 1.5,
    resistance: { physical: 0.6, ice: 1.6, lightning: 1.1, poison: 0.9 },
    blurb: 'Boss. Built from every set you ever owned. Bring ice.',
  },

  archer: {
    id: 'archer',
    name: 'BOW BRICK',
    color: 0x2f6d3f,
    accent: 0xd9c07a,
    hp: 46,
    speed: 1.85,
    reward: 9,
    leak: 1,
    scale: 0.95,
    gait: 2.4,
    resistance: { physical: 1, ice: 1, lightning: 1.15, poison: 1 },
    attackRange: 3.4,
    attackDamage: 5,
    attackCooldown: 1.5,
    attackSplash: 0,
    attackStyle: 'arrow',
    blurb: 'Looses arrows at your towers from three tiles out. Kill it before it settles in.',
  },
  gunner: {
    id: 'gunner',
    name: 'GUN BRICK',
    color: 0x35404d,
    accent: 0xb8862f,
    hp: 78,
    speed: 1.5,
    reward: 14,
    leak: 1,
    scale: 1.02,
    gait: 2.1,
    resistance: { physical: 0.85, ice: 1, lightning: 1.2, poison: 0.9 },
    attackRange: 4.2,
    attackDamage: 4,
    attackCooldown: 0.55,
    attackSplash: 0,
    attackStyle: 'bullet',
    blurb: 'Fires fast, light rounds. Weak per shot, but it never stops shooting.',
  },
  launcher: {
    id: 'launcher',
    name: 'ROCKET BRICK',
    color: 0x4a4335,
    accent: 0x8d3b2f,
    hp: 165,
    speed: 1.05,
    reward: 26,
    leak: 2,
    scale: 1.18,
    gait: 1.5,
    resistance: { physical: 1.15, ice: 0.85, lightning: 1, poison: 1.1 },
    attackRange: 6,
    attackDamage: 26,
    attackCooldown: 3.2,
    attackSplash: 1.5,
    attackStyle: 'rocket',
    blurb: 'Lobs rockets that splash. Slow and heavy, but it deletes clusters of towers.',
  },
};

export const ENEMY_ORDER: EnemyId[] = [
  'slime',
  'skeleton',
  'zombie',
  'ghost',
  'demon',
  'overlord',
  'archer',
  'gunner',
  'launcher',
];

/** Wave index (1-based) at which each enemy type starts appearing. */
export const UNLOCK_WAVE: Record<EnemyId, number> = {
  slime: 1,
  skeleton: 2,
  zombie: 5,
  ghost: 7,
  demon: 10,
  overlord: 20,
  archer: 9,
  gunner: 13,
  launcher: 17,
};

/** Enemy health grows every wave so late waves stay threatening. */
export function waveHpScale(wave: number): number {
  return 1 + 0.085 * (wave - 1);
}

/** Slight speed creep, capped so nothing outruns the whole lane. */
export function waveSpeedScale(wave: number): number {
  return 1 + 0.012 * Math.min(wave - 1, 12);
}

export function resistanceLabel(value: number): { text: string; cls: string } {
  if (value === 0) return { text: 'IMMUNE', cls: 'chip-immune' };
  if (value >= 1.6) return { text: 'WEAK', cls: 'chip-weak' };
  if (value <= 0.6) return { text: 'RESIST', cls: 'chip-bad' };
  return { text: 'NORMAL', cls: 'chip-good' };
}