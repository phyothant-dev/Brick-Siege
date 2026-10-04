import { Vector3 } from 'three';
import type { Group, Object3D } from 'three';
import { ENEMIES } from '../core/enemies';
import { sfx } from '../core/events';
import { laneProgress, samplePath } from '../core/path';
import type { GameState } from '../core/state';
import { TOWERS, tierSpec } from '../core/towers';
import type { ElementId, Enemy, Tier, Tower, TowerTierSpec } from '../core/types';
import type { EnemyView } from '../scene/enemyView';
import { Fx } from '../scene/fx';
import type { TowerModel } from '../scene/towerView';

/** Everything the simulation needs to know about a tower's world placement. */
export interface TowerRuntime {
  x: number;
  z: number;
  headY: number;
  /** Yaw-following turret group; null for towers with no aiming direction. */
  head: Group | null;
  muzzle: Object3D | null;
  view: TowerModel;
}

const CHAIN_RANGE = 2.3;
const AIM_TOLERANCE = 0.12;

const lane = { x: 0, z: 0, dx: 1, dz: 0 };
const laneB = { x: 0, z: 0, dx: 1, dz: 0 };
const DOWN = new Vector3(0, -1, 0);

const SHOT_COLOR: Record<ElementId, number> = {
  physical: 0xffcf00,
  ice: 0xa5e9ff,
  lightning: 0xffcf00,
  poison: 0x4b9f4a,
};

const scratch = new Vector3();

/**
 * Targeting, aiming, firing and damage resolution. Deliberately ignorant of
 * the DOM and of rendering setup — it only talks to Fx and EnemyView.
 */
export class Combat {
  constructor(
    private readonly state: GameState,
    private readonly fx: Fx,
    private readonly viewOf: (uid: number) => EnemyView | undefined,
    private readonly runtimeOf: (uid: number) => TowerRuntime | undefined,
  ) {}

  update(dt: number): void {
    for (const tower of this.state.towers) {
      const rt = this.runtimeOf(tower.uid);
      if (rt) this.stepTower(tower, rt, dt);
    }
  }

  // ------------------------------------------------------------------ towers

  /**
   * Effective stats for a tower: its own tier stats plus every BEACON aura
   * covering it. Buffs are additive on damage and multiplicative on fire rate,
   * then capped so stacked beacons cannot trivialise a wave.
   */
  effectiveSpec(tower: Tower): TowerTierSpec {
    const base = tierSpec(tower.type, tower.tier);
    let dmg = 0;
    let haste = 1;
    for (const src of this.state.towers) {
      if (src === tower || src.type !== 'support') continue;
      const s = tierSpec(src.type, src.tier);
      if (s.buffRadius <= 0) continue;
      // Euclidean, so the boosted set matches the circular aura the player can
      // actually see on the ground.
      const dx = src.gx - tower.gx;
      const dy = src.gy - tower.gy;
      if (Math.hypot(dx, dy) > s.buffRadius) continue;
      dmg += s.buffDamage;
      haste *= 1 - s.buffHaste;
    }
    if (dmg === 0 && haste === 1) return base;
    return {
      ...base,
      damage: base.damage * (1 + Math.min(dmg, 0.8)),
      cooldown: base.cooldown * Math.max(0.4, haste),
    };
  }

  private stepTower(tower: Tower, rt: TowerRuntime, dt: number): void {
    // Support towers project an aura and never fire.
    if (tower.type === 'support') {
      tower.cd = 0;
      return;
    }
    const spec = this.effectiveSpec(tower);
    tower.cd = Math.max(0, tower.cd - dt);

    if (tower.flash > 0) {
      tower.flash = Math.max(0, tower.flash - dt * 5);
      const scale = 1 + tower.flash * 0.16;
      for (const part of rt.view.pulse) part.scale.setScalar(scale);
    }

    const target = this.pickTarget(rt, spec);
    if (!target) return;

    const aim = this.aimPoint(target, spec);
    const desired = Math.atan2(aim.x - rt.x, aim.z - rt.z);

    let off = 0;
    if (rt.head) {
      let delta = desired - tower.angle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      const step = Math.min(Math.abs(delta), dt * 8) * Math.sign(delta);
      tower.angle += step;
      rt.head.rotation.y = tower.angle;
      off = Math.abs(delta);
    }

    if (tower.cd > 0 || off > AIM_TOLERANCE) return;

    tower.cd = spec.cooldown;
    tower.flash = 1;
    this.state.stats.shotsFired += 1;

    const element = TOWERS[tower.type].element;
    if (element === 'lightning') this.fireCoil(rt, target, spec, element, tower.tier);
    else this.fireProjectile(rt, target, aim, spec, element, tower.tier);
  }

  /** Highest-progress enemy inside range wins. */
  pickTarget(rt: TowerRuntime, spec: TowerTierSpec): Enemy | null {
    let best: Enemy | null = null;
    let bestDist = -Infinity;
    const r2 = spec.range * spec.range;

    for (const enemy of this.state.enemies) {
      if (!enemy.alive) continue;
      samplePath(enemy.dist, enemy.lane, lane);
      const dx = lane.x - rt.x;
      const dz = lane.z - rt.z;
      if (dx * dx + dz * dz > r2) continue;
      // Compare *progress along each unit's own lane*, not raw distance. On a
      // four-lane map the arms have different lengths, and raw distance would
      // make a unit 10 tiles along a short arm look further along than one 80
      // tiles along a long arm — so towers would ignore the real threat.
      const progress = laneProgress(enemy.dist, enemy.lane);
      if (progress > bestDist) {
        bestDist = progress;
        best = enemy;
      }
    }
    return best;
  }

  /** Where the target will be when the projectile arrives. */
  private aimPoint(enemy: Enemy, spec: TowerTierSpec): { x: number; z: number } {
    const view = this.viewOf(enemy.uid);
    const speed = enemy.speed * enemy.slowFactor;
    // Lobbed shells land where the enemy is now; flat shots lead a little.
    const lead = spec.splash > 0.6 ? 0 : Math.min(0.8, (spec.range / spec.cooldown) * 0.3);

    samplePath(enemy.dist + speed * lead, enemy.lane, lane);
    if (!view) return { x: lane.x, z: lane.z };
    return {
      x: lane.x * 0.4 + view.root.position.x * 0.6,
      z: lane.z * 0.4 + view.root.position.z * 0.6,
    };
  }

  // ------------------------------------------------------------------ firing

  private muzzleWorld(rt: TowerRuntime): Vector3 {
    if (rt.muzzle) return rt.muzzle.getWorldPosition(scratch);
    return scratch.set(rt.x, rt.headY, rt.z);
  }

  private fireProjectile(
    rt: TowerRuntime,
    target: Enemy,
    aim: { x: number; z: number },
    spec: TowerTierSpec,
    element: ElementId,
    tier: Tier,
  ): void {
    const color = SHOT_COLOR[element];
    const origin = this.muzzleWorld(rt).clone();
    const lobbed = spec.splash > 0.6;
    const burst = Math.max(1, spec.burst);

    for (let i = 0; i < burst; i++) {
      const dest = new Vector3(aim.x, 0.3, aim.z);
      if (i > 0) {
        // Fan the salvo across the lane so it reads as a multi-barrel burst.
        const spread = (i - (burst - 1) / 2) * 0.75;
        dest.x += -aim.z * spread;
        dest.z += aim.x * spread;
      }

      const tracks = i === 0 && !lobbed;
      const trackedView = tracks ? (this.viewOf(target.uid) ?? null) : null;
      this.fx.launch(origin, trackedView, dest, {
        color,
        speed: lobbed ? 9 : 17,
        arc: lobbed ? 1.15 : 0,
        onImpact: (event) => {
          if (lobbed) {
            this.applySplash(event.position, spec.splash, spec.damage, element, spec);
            this.fx.ring(event.position, color, 0.3, spec.splash * 2.4, 0.34);
            sfx('explode', 1 + (spec.burst - 1) * 0.08);
          } else if (target.alive) {
            this.hit(target, spec.damage, element, spec);
          } else {
            this.applySplash(event.position, 0.45, spec.damage, element, spec);
          }
          this.fx.muzzleBurst(event.position, DOWN, color, lobbed ? 8 : 4);
        },
      });
    }

    this.fx.muzzleBurst(origin, DOWN, color, 4);
    // Pitch climbs a little per tier so a combined board sounds stronger.
    const tierPitch = 1 + (tier - 1) * 0.12;
    if (lobbed) sfx('mortar', tierPitch);
    else if (element === 'ice') sfx('freeze', tierPitch);
    else if (element === 'poison') sfx('spray', tierPitch);
    else sfx('shoot', tierPitch);
  }

  /** Instant hit that arcs between nearby enemies. */
  private fireCoil(
    rt: TowerRuntime,
    target: Enemy,
    spec: TowerTierSpec,
    element: ElementId,
    tier: Tier,
  ): void {
    const color = SHOT_COLOR[element];
    const origin = this.muzzleWorld(rt).clone();

    const order: Enemy[] = [target];
    let current = target;
    for (let jump = 0; jump < spec.chain; jump++) {
      const next = this.nearestOther(current, order);
      if (!next) break;
      order.push(next);
      current = next;
    }

    let from = origin;
    order.forEach((enemy, index) => {
      const view = this.viewOf(enemy.uid);
      const to = new Vector3(
        view ? view.root.position.x : from.x,
        (view ? view.root.position.y : 0) + 0.45,
        view ? view.root.position.z : from.z,
      );
      this.fx.bolt(Fx.jag(from, to, 7, 0.16), color, 0.22);
      this.hit(enemy, spec.damage * Math.pow(spec.chainFalloff, index), element);
      this.fx.muzzleBurst(to, DOWN, color, 3);
      from = to;
    });
    sfx('zap', 1 + (tier - 1) * 0.12);
  }

  private nearestOther(from: Enemy, exclude: Enemy[]): Enemy | null {
    samplePath(from.dist, from.lane, lane);
    let best: Enemy | null = null;
    let bestD = CHAIN_RANGE * CHAIN_RANGE;

    for (const enemy of this.state.enemies) {
      if (!enemy.alive || exclude.includes(enemy)) continue;
      samplePath(enemy.dist, enemy.lane, laneB);
      const d = (laneB.x - lane.x) ** 2 + (laneB.z - lane.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = enemy;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ damage

  /** Damage scaled by the enemy's resistance to that element. */
  typed(enemy: Enemy, amount: number, element: ElementId): number {
    return amount * ENEMIES[enemy.type].resistance[element];
  }

  /** One direct hit plus any rider effects (slow, poison). */
  hit(enemy: Enemy, baseDamage: number, element: ElementId, spec?: TowerTierSpec): boolean {
    if (!enemy.alive) return false;
    const killed = this.state.damageEnemy(enemy, this.typed(enemy, baseDamage, element));
    if (spec) {
      if (spec.slow > 0) this.state.applySlow(enemy, 1 - spec.slow, spec.slowTime);
      if (spec.poisonDps > 0) this.state.applyPoison(enemy, spec.poisonDps, spec.poisonTime);
    }
    return killed;
  }

  /** Area damage around a point with linear falloff toward the edge. */
  applySplash(
    at: { x: number; z: number },
    radius: number,
    damage: number,
    element: ElementId,
    spec?: TowerTierSpec,
  ): void {
    const r2 = radius * radius;
    for (const enemy of this.state.enemies) {
      if (!enemy.alive) continue;
      samplePath(enemy.dist, enemy.lane, lane);
      const view = this.viewOf(enemy.uid);
      const px = view ? view.root.position.x : lane.x;
      const pz = view ? view.root.position.z : lane.z;
      const d2 = (px - at.x) ** 2 + (pz - at.z) ** 2;
      if (d2 > r2) continue;
      const falloff = 1 - 0.45 * (Math.sqrt(d2) / radius);
      this.hit(enemy, damage * falloff, element, spec);
    }
  }

  /** Damage-over-time, slow decay and hit-flash timers. */
  tickEnemies(dt: number): void {
    for (const enemy of this.state.enemies) {
      if (!enemy.alive) continue;
      if (enemy.slowTimer > 0) {
        enemy.slowTimer -= dt;
        if (enemy.slowTimer <= 0) enemy.slowFactor = 1;
      }
      if (enemy.poisonTimer > 0) {
        enemy.poisonTimer -= dt;
        this.state.damageEnemy(enemy, enemy.poisonDps * dt);
        if (enemy.poisonTimer <= 0) enemy.poisonDps = 0;
      }
      if (enemy.hitFlash > 0) enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
    }
  }
}