import type { Wave } from './types';

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
  { reward: 90, groups: [g('zombie', 8, 1.2), g('skeleton', 11, 0.5, 3)] },
  { reward: 100, groups: [g('ghost', 9, 0.9), g('slime', 12, 0.5, 2)] },
  { reward: 150, groups: [g('demon', 2, 4.5), g('slime', 10, 0.5, 2)] },
  { reward: 110, groups: [g('zombie', 13, 0.9)] },
  { reward: 115, groups: [g('ghost', 13, 0.75), g('skeleton', 8, 0.5, 4)] },
  { reward: 120, groups: [g('skeleton', 17, 0.42), g('slime', 10, 0.5, 3)] },
  { reward: 130, groups: [g('zombie', 11, 1.0), g('ghost', 11, 0.8, 3)] },
  { reward: 170, groups: [g('demon', 4, 3.2), g('archer', 5, 1.1), g('slime', 14, 0.45, 2)] },
  { reward: 140, groups: [g('zombie', 17, 0.75)] },
  { reward: 150, groups: [g('ghost', 15, 0.6), g('skeleton', 15, 0.42, 3)] },
  { reward: 200, groups: [g('demon', 6, 2.4), g('gunner', 5, 0.9), g('skeleton', 10, 0.45, 3)] },
  { reward: 160, groups: [g('zombie', 15, 0.7), g('ghost', 15, 0.65, 3)] },
  { reward: 320, groups: [g('overlord', 1, 1, 0), g('demon', 6, 2.2, 6)] },
  { reward: 180, groups: [g('skeleton', 21, 0.35), g('slime', 16, 0.4, 3)] },
  { reward: 190, groups: [g('zombie', 19, 0.6), g('ghost', 17, 0.55, 3)] },
  { reward: 240, groups: [g('demon', 8, 1.9), g('skeleton', 17, 0.4, 3)] },
  {
    reward: 220,
    groups: [g('zombie', 21, 0.5), g('ghost', 19, 0.5, 3), g('archer', 7, 0.8, 6)],
  },
  {
    reward: 600,
    groups: [
      g('overlord', 2, 18, 0),
      g('demon', 11, 1.5, 4),
      g('zombie', 12, 0.7, 10),
      g('gunner', 8, 0.7, 14),
      g('launcher', 4, 2.4, 18),
    ],
  },
];

export const TOTAL_WAVES = WAVES.length;