import type { EnemyId, Wave } from './types';

const g = (type: Wave['groups'][number]['type'], count: number, gap: number, delay = 0) => ({
  type,
  count,
  gap,
  delay,
});

/**
 * 25 hand-tuned waves. Later waves deliberately mix resistances so no single
 * element can clear everything — you have to swap bricks mid-run.
 */
export const WAVES: Wave[] = [
  { reward: 40, groups: [g('slime', 8, 0.95)] },
  { reward: 45, groups: [g('slime', 9, 0.8), g('skeleton', 5, 0.7, 3)] },
  { reward: 50, groups: [g('skeleton', 11, 0.6)] },
  { reward: 55, groups: [g('slime', 8, 0.7), g('skeleton', 9, 0.6, 4)] },
  { reward: 70, groups: [g('zombie', 6, 1.5), g('slime', 8, 0.6, 2)] },
  { reward: 75, groups: [g('skeleton', 13, 0.5), g('slime', 8, 0.6, 3)] },
  { reward: 85, groups: [g('ghost', 7, 1.1), g('slime', 6, 0.7, 2)] },
  { reward: 90, groups: [g('zombie', 8, 1.2), g('wisp', 6, 0.5, 2), g('skeleton', 11, 0.5, 4)] },
  { reward: 100, groups: [g('ghost', 9, 0.9), g('slime', 12, 0.5, 2)] },
  { reward: 150, groups: [g('demon', 2, 4.5), g('slime', 10, 0.5, 2)] },
  { reward: 120, groups: [g('zombie', 13, 0.9), g('brute', 3, 2.4, 1)] },
  { reward: 125, groups: [g('ghost', 13, 0.75), g('wisp', 8, 0.45, 2), g('skeleton', 8, 0.5, 5)] },
  { reward: 120, groups: [g('skeleton', 17, 0.42), g('slime', 10, 0.5, 3)] },
  { reward: 135, groups: [g('zombie', 11, 1.0), g('ghost', 11, 0.8, 3), g('brute', 2, 3.0, 1)] },
  {
    reward: 175,
    groups: [g('demon', 4, 3.2), g('archer', 5, 1.1), g('golem', 2, 4.0, 3), g('slime', 14, 0.45, 2)],
  },
  { reward: 145, groups: [g('zombie', 17, 0.75), g('catapult', 3, 2.6, 1)] },
  { reward: 155, groups: [g('ghost', 15, 0.6), g('wisp', 10, 0.4, 2), g('skeleton', 15, 0.42, 4)] },
  {
    reward: 205,
    groups: [g('demon', 6, 2.4), g('gunner', 5, 0.9), g('catapult', 2, 2.6, 4), g('skeleton', 10, 0.45, 3)],
  },
  { reward: 165, groups: [g('zombie', 15, 0.7), g('golem', 2, 4.5, 2), g('ghost', 15, 0.65, 4)] },
  { reward: 330, groups: [g('overlord', 1, 1, 0), g('brute', 3, 2.4, 4), g('demon', 6, 2.2, 8)] },
  { reward: 180, groups: [g('skeleton', 21, 0.35), g('slime', 16, 0.4, 3)] },
  { reward: 195, groups: [g('zombie', 19, 0.6), g('wisp', 12, 0.35, 2), g('ghost', 17, 0.55, 4)] },
  { reward: 250, groups: [g('demon', 8, 1.9), g('golem', 3, 3.6, 3), g('skeleton', 17, 0.4, 5)] },
  {
    reward: 230,
    groups: [
      g('zombie', 21, 0.5),
      g('catapult', 4, 2.2, 1),
      g('ghost', 19, 0.5, 3),
      g('wisp', 12, 0.35, 5),
      g('archer', 7, 0.8, 8),
    ],
  },
  {
    reward: 650,
    groups: [
      g('overlord', 2, 18, 0),
      g('golem', 3, 4.5, 2),
      g('brute', 6, 1.8, 4),
      g('demon', 11, 1.5, 6),
      g('catapult', 6, 1.6, 10),
      g('zombie', 12, 0.7, 12),
      g('gunner', 8, 0.7, 16),
    ],
  },
];

export const TOTAL_WAVES = WAVES.length;

/**
 * Wave index (1-based) at which each enemy type first appears, derived from the
 * wave list itself. The codex quotes these numbers, so they have to agree with
 * the campaign that actually spawns.
 */
export const UNLOCK_WAVE: Record<EnemyId, number> = (() => {
  const first: Record<EnemyId, number> = {
    slime: Number.MAX_SAFE_INTEGER,
    skeleton: Number.MAX_SAFE_INTEGER,
    zombie: Number.MAX_SAFE_INTEGER,
    ghost: Number.MAX_SAFE_INTEGER,
    demon: Number.MAX_SAFE_INTEGER,
    overlord: Number.MAX_SAFE_INTEGER,
    archer: Number.MAX_SAFE_INTEGER,
    gunner: Number.MAX_SAFE_INTEGER,
    brute: Number.MAX_SAFE_INTEGER,
    wisp: Number.MAX_SAFE_INTEGER,
    golem: Number.MAX_SAFE_INTEGER,
    catapult: Number.MAX_SAFE_INTEGER,
  };
  WAVES.forEach((wave, i) => {
    for (const group of wave.groups) {
      first[group.type] = Math.min(first[group.type], i + 1);
    }
  });
  return first;
})();