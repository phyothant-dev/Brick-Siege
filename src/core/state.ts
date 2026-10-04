import {
  COMBINE_RANGE,
  COST_SCALE_MAX,
  COST_SCALE_STEP,
  START_BRICKS,
  isBuildable,
} from './constants';
import { ENEMIES, waveHpScale, waveSpeedScale } from './enemies';
import { emit, sfx } from './events';
import { activeLaneCount } from './constants';
import { TOWERS, towerMaxHp } from './towers';
import type { Enemy, EnemyId, Tier, Toast, Tower, TowerId } from './types';
import { WAVES } from './waves';

export interface SpawnRequest {
  type: EnemyId;
  at: number;
  /** Lane this spawn enters on. */
  lane: number;
}

export interface RunStats {
  built: number;
  combined: number;
  kills: number;
  leaked: number;
  goldEarned: number;
  goldSpent: number;
  shotsFired: number;
  startTime: number;
  endTime: number | null;
}

let nextUid = 1;

export class GameState {
  gold = START_BRICKS;
  fortressHp = 0;
  fortressMaxHp = 0;

  wave = 0;
  waveRunning = false;
  buildTimer = 0;
  speed = 1;

  towers: Tower[] = [];
  enemies: Enemy[] = [];
  toasts: Toast[] = [];

  /** Pending spawns for the wave currently in flight. */
  private queue: SpawnRequest[] = [];
  /** Enemies still to be killed for wave-clear detection. */
  waveAlive = 0;
  /** Round-robin cursor so successive spawns use successive lanes. */
  laneCursor = 0;

  stats: RunStats = {
    built: 0,
    combined: 0,
    kills: 0,
    leaked: 0,
    goldEarned: 0,
    goldSpent: 0,
    shotsFired: 0,
    startTime: 0,
    endTime: null,
  };

  constructor(fortressMaxHp: number) {
    this.fortressMaxHp = fortressMaxHp;
    this.fortressHp = fortressMaxHp;
  }

  // ---------------------------------------------------------------- economy

  towerCost(type: TowerId): number {
    const built = this.stats.built;
    const scale = Math.min(1 + COST_SCALE_STEP * built, COST_SCALE_MAX);
    return Math.round(TOWERS[type].cost * scale);
  }

  canAfford(type: TowerId): boolean {
    return this.gold >= this.towerCost(type);
  }

  addGold(amount: number): void {
    this.gold += amount;
    this.stats.goldEarned += amount;
    emit('hud:changed');
  }

  spend(amount: number): boolean {
    if (this.gold < amount) return false;
    this.gold -= amount;
    this.stats.goldSpent += amount;
    emit('hud:changed');
    return true;
  }

  // ---------------------------------------------------------------- towers

  towerAt(gx: number, gy: number): Tower | null {
    return this.towers.find((t) => t.gx === gx && t.gy === gy) ?? null;
  }

  build(type: TowerId, gx: number, gy: number): Tower | null {
    if (!isBuildable(gx, gy) || this.towerAt(gx, gy)) return null;
    const cost = this.towerCost(type);
    if (!this.spend(cost)) {
      this.toast('NOT ENOUGH BRICKS', 'bad');
      return null;
    }

    const tower: Tower = {
      uid: nextUid++,
      type,
      tier: 1,
      gx,
      gy,
      hp: towerMaxHp(type, 1),
      maxHp: towerMaxHp(type, 1),
      hitFlash: 0,
      cd: 0,
      angle: -Math.PI / 2,
      flash: 0,
      kills: 0,
      damage: 0,
      invested: cost,
    };
    this.towers.push(tower);
    this.stats.built += 1;
    emit('hud:changed');
    return tower;
  }

  sell(tower: Tower): void {
    const refund = Math.floor(tower.invested * 0.6);
    const i = this.towers.indexOf(tower);
    if (i >= 0) this.towers.splice(i, 1);
    this.addGold(refund);
    this.toast(`+${refund} BRICKS`, 'gold');
  }

  /** Tiers up when another matching tower sits within COMBINE_RANGE. */
  combine(a: Tower, b: Tower): Tower | null {
    if (a === b) return null;
    if (a.type !== b.type || a.tier !== b.tier || a.tier >= 3) return null;
    const d = Math.abs(a.gx - b.gx) + Math.abs(a.gy - b.gy);
    if (d > COMBINE_RANGE) return null;

    a.tier = (a.tier + 1) as Tier;
    // A newly combined tower arrives at full health for its new tier.
    a.maxHp = towerMaxHp(a.type, a.tier);
    a.hp = a.maxHp;
    a.hitFlash = 0;
    a.invested += b.invested;
    a.cd = Math.min(a.cd, 0.15);
    a.kills += b.kills;
    a.damage += b.damage;
    const i = this.towers.indexOf(b);
    if (i >= 0) this.towers.splice(i, 1);
    this.stats.combined += 1;
    this.toast(`COMBINED -> ${TOWERS[a.type].name} MK${'I'.repeat(a.tier)}`, 'gold');
    emit('hud:changed');
    emit('selection:changed');
    return a;
  }

  /** True when `a` has a legal combination partner on the board. */
  findCombinePartner(a: Tower): Tower | null {
    if (a.tier >= 3) return null;
    for (const t of this.towers) {
      if (t === a || t.type !== a.type || t.tier !== a.tier) continue;
      const d = Math.abs(a.gx - t.gx) + Math.abs(a.gy - t.gy);
      if (d <= COMBINE_RANGE) return t;
    }
    return null;
  }

  // ---------------------------------------------------------------- enemies

  spawn(type: EnemyId, waveIndex: number, lane = 0): Enemy {
    // Guard against a caller passing a lane that no longer exists (e.g. after
    // switching maps mid-wave); clamping beats indexing undefined.
    lane = Math.max(0, Math.min(lane, activeLaneCount() - 1));
    const spec = ENEMIES[type];
    const maxHp = Math.round(spec.hp * waveHpScale(waveIndex));
    const enemy: Enemy = {
      uid: nextUid++,
      type,
      dist: 0,
      lane,
      hp: maxHp,
      maxHp,
      speed: spec.speed * waveSpeedScale(waveIndex),
      slowFactor: 1,
      slowTimer: 0,
      poisonTimer: 0,
      poisonDps: 0,
      alive: true,
      hitFlash: 0,
      phase: Math.random() * Math.PI * 2,
      attackCd: 0,
      aimAngle: 0,
    };
    this.enemies.push(enemy);
    this.waveAlive += 1;
    return enemy;
  }

  damageEnemy(enemy: Enemy, amount: number, source?: Tower): boolean {
    if (!enemy.alive || amount <= 0) return false;
    enemy.hp -= amount;
    enemy.hitFlash = 0.12;
    if (source) source.damage += amount;
    if (enemy.hp <= 0) {
      enemy.hp = 0;
      enemy.alive = false;
      const spec = ENEMIES[enemy.type];
      this.addGold(spec.reward);
      this.stats.kills += 1;
      this.waveAlive -= 1;
      if (source) source.kills += 1;
      // Bosses are heavy, so let them thud out lower.
      sfx('pop', enemy.type === 'overlord' ? 0.5 : enemy.type === 'demon' ? 0.72 : 1);
      return true;
    }
    return false;
  }

  applySlow(enemy: Enemy, factor: number, duration: number): void {
    // Strongest recent slow wins; shorter remaining times refresh.
    if (factor <= enemy.slowFactor && enemy.slowTimer > 0) return;
    enemy.slowFactor = factor;
    enemy.slowTimer = Math.max(enemy.slowTimer, duration);
  }

  applyPoison(enemy: Enemy, dps: number, duration: number): void {
    enemy.poisonDps = Math.max(enemy.poisonDps, dps);
    enemy.poisonTimer = Math.max(enemy.poisonTimer, duration);
  }

  leakEnemy(enemy: Enemy): void {
    const spec = ENEMIES[enemy.type];
    this.fortressHp = Math.max(0, this.fortressHp - spec.leak);
    this.stats.leaked += 1;
    this.enemies.splice(this.enemies.indexOf(enemy), 1);
    sfx('hit');
    emit('shake', spec.leak);
    emit('hud:changed');
  }

  // ---------------------------------------------------------------- waves

  currentWave() {
    return WAVES[Math.min(this.wave, WAVES.length - 1)];
  }

  beginWave(): void {
    if (this.wave >= WAVES.length) return;
    this.wave += 1;
    sfx(this.currentWave().groups.some((g) => g.type === 'overlord') ? 'boss' : 'wave');
    this.waveRunning = true;
    this.queue = [];
    const wave = this.currentWave();
    let t = 0;
    const laneCount = Math.max(1, activeLaneCount());
    for (const group of wave.groups) {
      t += group.delay;
      for (let i = 0; i < group.count; i++) {
        // Spread traffic across every lane so a multi-lane map cannot be
        // defended by walling up one arm. On single-lane maps this is 0.
        this.queue.push({ type: group.type, at: t, lane: this.laneCursor++ % laneCount });
        t += group.gap;
      }
    }
    emit('phase:changed');
    emit('hud:changed');
  }

  /** Pulls due spawns out of the queue. Returns how many were released. */
  releaseSpawns(elapsed: number): number {
    let released = 0;
    while (this.queue.length && this.queue[0].at <= elapsed) {
      const req = this.queue.shift()!;
      this.spawn(req.type, this.wave, req.lane);
      released += 1;
    }
    return released;
  }

  get queueRemaining(): number {
    return this.queue.length;
  }

  finishWave(): void {
    this.waveRunning = false;
    this.addGold(this.currentWave().reward);
    this.toast(`WAVE ${this.wave} CLEARED  +${this.currentWave().reward}`, 'gold');
    if (this.wave >= WAVES.length) emit('game:over', { won: true });
    else emit('phase:changed');
    emit('hud:changed');
  }

  // ---------------------------------------------------------------- toasts

  toast(text: string, tone: Toast['tone'] = 'info'): void {
    this.toasts.push({ text, tone, life: 2.4 });
    emit('toast', { text, tone });
  }
}