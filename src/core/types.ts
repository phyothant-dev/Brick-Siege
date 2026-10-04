/** Damage channels. Every tower deals exactly one element. */
export type ElementId = 'physical' | 'ice' | 'lightning' | 'poison';

export const ELEMENTS: ElementId[] = ['physical', 'ice', 'lightning', 'poison'];

export type TowerId =
  | 'shooter'
  | 'mortar'
  | 'freezer'
  | 'coil'
  | 'sprayer'
  | 'sniper'
  | 'cluster'
  | 'support';

export type EnemyId =
  | 'slime'
  | 'skeleton'
  | 'zombie'
  | 'ghost'
  | 'demon'
  | 'overlord'
  | 'archer'
  | 'gunner'
  | 'launcher';

export type Tier = 1 | 2 | 3;

/** Multiplier applied to incoming damage per element. 0 = immune, 2 = double damage. */
export type ResistanceMap = Record<ElementId, number>;

export interface TowerSpec {
  id: TowerId;
  name: string;
  element: ElementId;
  /** Base cost at tier 1. Higher tiers are only reachable by combining. */
  cost: number;
  hotkey: string;
  accent: number;
  blurb: string;
  /** Per-tier stat curves. Index 0 = tier 1. */
  tiers: TowerTierSpec[];
}

export interface TowerTierSpec {
  range: number;
  /** Seconds between shots. */
  cooldown: number;
  damage: number;
  /** Blast radius in tiles. 0 = single target. */
  splash: number;
  /** Extra slow factor applied on hit (0..1), decays over `slowTime`. */
  slow: number;
  slowTime: number;
  /** Damage-over-time per second and its duration. */
  poisonDps: number;
  poisonTime: number;
  /** Extra enemies hit by chain lightning, and falloff per jump. */
  chain: number;
  chainFalloff: number;
  /** Multiplexed shots per cooldown (mortar fires a burst). */
  burst: number;
  /**
   * Support towers deal no damage. Instead they project an aura that boosts the
   * damage and fire rate of nearby towers. 0 = not a support tower.
   */
  buffDamage: number;
  /** Fraction of fire-rate reduction applied to neighbours inside the aura. */
  buffHaste: number;
  /** Aura radius in tiles. */
  buffRadius: number;
}

export interface Tower {
  uid: number;
  type: TowerId;
  tier: Tier;
  gx: number;
  gy: number;
  /** Towers can be destroyed by enemies that shoot at them. */
  hp: number;
  maxHp: number;
  /** Damage flash timer for the view layer. */
  hitFlash: number;
  /** Seconds until this tower may fire again. */
  cd: number;
  /** Facing angle in radians, smoothed toward the target. */
  angle: number;
  /** Recoil / muzzle animation timer. */
  flash: number;
  kills: number;
  damage: number;
  invested: number;
}

export interface EnemySpec {
  id: EnemyId;
  name: string;
  color: number;
  accent: number;
  hp: number;
  /** Tiles per second. */
  speed: number;
  reward: number;
  /** Fortress damage inflicted when this enemy reaches the end. */
  leak: number;
  resistance: ResistanceMap;
  scale: number;
  /** Visual bob/hop frequency. */
  gait: number;
  blurb: string;
  /** Tiles this enemy can strike towers from. 0 = cannot attack towers. */
  attackRange?: number;
  /** Damage per shot against towers. */
  attackDamage?: number;
  /** Seconds between shots at towers. */
  attackCooldown?: number;
  /** Towers caught in the blast when `attackSplash` > 0. */
  attackSplash?: number;
  /** Projectile look used when firing at towers. */
  attackStyle?: 'arrow' | 'bullet' | 'rocket';
}

export interface Enemy {
  uid: number;
  type: EnemyId;
  /** Distance travelled along its lane in tiles. */
  dist: number;
  /** Which lane this unit is walking. 0 on single-lane maps. */
  lane: number;
  hp: number;
  maxHp: number;
  speed: number;
  slowFactor: number;
  slowTimer: number;
  poisonTimer: number;
  poisonDps: number;
  alive: boolean;
  /** Damage flash timer for the view layer. */
  hitFlash: number;
  /** Distance in tiles to the nearest other enemy ahead, used for spacing. */
  phase: number;
  /** Seconds until this attacker may shoot a tower again. */
  attackCd: number;
  /** Aim angle toward the tower it is shooting, for the view layer. */
  aimAngle: number;
}

export interface WaveGroup {
  type: EnemyId;
  count: number;
  /** Seconds between spawns inside this group. */
  gap: number;
  /** Seconds to wait after the previous group finishes spawning. */
  delay: number;
}

export interface Wave {
  groups: WaveGroup[];
  reward: number;
}

export type GamePhase = 'menu' | 'building' | 'wave' | 'paused' | 'won' | 'lost';

export interface Toast {
  text: string;
  tone: 'gold' | 'bad' | 'info';
  life: number;
}