import * as THREE from 'three';
import {
  BUILD_TIME,
  COMBINE_RANGE,
  BUILD_TIME_FIRST,
  EARLY_BONUS_PER_SEC,
  FORTRESS_MAX_HP,
  gxToWorld,
  gyToWorld,
  isBuildable,
  isInsideBoard,
} from './core/constants';
import { ENEMIES } from './core/enemies';
import { emit, sfx } from './core/events';
import { FORTRESS_CELLS, GRID, LANES, PATH_CELLS, currentMap, currentSeed, setMap } from './core/constants';
import { ARCHETYPES, type MapId } from './core/maps';
import { pathLength, samplePath } from './core/path';
import type { PathSample } from './core/path';
import { GameState } from './core/state';
import { TOWERS, tierSpec } from './core/towers';
import type { Enemy, EnemyId, EnemySpec, GamePhase, Tower, TowerId } from './core/types';
import { TOTAL_WAVES } from './core/waves';

/** Reused scratch sample so the siege loop allocates nothing per frame. */
const SIEGE_SAMPLE: PathSample = { x: 0, z: 0, dx: 1, dz: 0 };
import { Combat, type TowerRuntime } from './logic/combat';
import { buildBlueprint } from './core/blueprint';

/** Scenario towers are free, so the balance only has to cover them. */
const SCENARIO_FUNDS = 100_000;
import {
  ATTACKER_COST,
  ATTACKER_INCOME,
  ATTACKER_ORDER,
  ATTACKER_SIEGE_TOWER_MULT,
  ATTACKER_TIME_LIMIT,
  ATTACKER_START_GOLD,
  DEPLOY_ZONE,
  ATTACKER_TIER_BONUS,
  ATTACKER_TOWER_BOUNTY,
  loadSide,
  saveSide,
  type BlueprintTower,
  type Side,
} from './core/sides';
import { Board } from './scene/board';
import { THEMES, isThemeId } from './scene/themes';
import type { ThemeId } from './scene/themes';

/** localStorage key for the saved background theme. */
const THEME_KEY = 'bricks.theme';
import { EnemyView } from './scene/enemyView';
import { Fx } from './scene/fx';
import { PlacementPreview } from './scene/preview';
import { Stage } from './scene/stage';
import { createTowerModel, type TowerModel } from './scene/towerView';

const lane = { x: 0, z: 0, dx: 1, dz: 0 };

/**
 * Wires the simulation to the scene: owns tower/enemy views, placement,
 * selection, wave flow and win/lose. Rendering never leaks in from here.
 */
export class Game {
  readonly stage: Stage;
  readonly board = new Board();

  /** Background theme, persisted between sessions. */
  private themeId: ThemeId = 'forest';

  get theme(): ThemeId {
    return this.themeId;
  }

  /**
   * Restyle the background. Only the terrain, sky and scatter props change:
   * the baseplate, lane and fortress are untouched so gameplay is unaffected.
   */
  applyTheme(id: ThemeId): void {
    const theme = THEMES[id];
    if (!theme) return;
    this.themeId = id;
    this.board.setTheme(theme);
    this.stage?.setSky(theme.sky);
    try {
      localStorage.setItem(THEME_KEY, id);
    } catch {
      /* storage unavailable (private mode); theme still applies for this session */
    }
  }

  /** Restore a previously saved theme, if any. */
  private loadTheme(): ThemeId {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (isThemeId(saved)) return saved;
    } catch {
      /* ignore */
    }
    return 'forest';
  }
  readonly fx = new Fx();
  readonly preview = new PlacementPreview();

  state: GameState;
  phase: GamePhase = 'menu';
  private combat: Combat;

  private towerViews = new Map<number, TowerModel>();
  private popScale = new Map<number, number>();
  private towerRoots = new Map<number, THREE.Group>();
  private lastSiegeSfx = 0;
  private enemyViews = new Map<number, EnemyView>();

  selected: Tower | null = null;
  placing: TowerId | null = null;
  combining = false;
  hoverCell: { gx: number; gy: number } | null = null;

  /** Seconds into the current wave; drives spawn scheduling. */
  private waveClock = 0;
  private buildClock = BUILD_TIME_FIRST;
  private time = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.stage = new Stage(canvas);
    this.applyTheme(this.loadTheme());
    this.stage.scene.add(this.board.group);
    this.stage.scene.add(this.fx.group);
    this.stage.scene.add(this.preview.group);

    this.state = new GameState(FORTRESS_MAX_HP);
    this.deploying = null;
    this.deployCount = 0;
    if (this.side === 'attacker') {
      // The fortress is already defended. This is the puzzle the player breaks.
      // These towers are part of the scenario rather than something the player
      // paid for, so the balance is irrelevant while they go up: tower price
      // climbs as you build, so a summed-up outlay would underfund the later
      // ones and silently drop them.
      this.state.gold = SCENARIO_FUNDS;
      for (const t of this.blueprint()) {
        const tower = this.state.build(t.type, t.gx, t.gy);
        if (tower) this.attachTower(tower);
      }
      this.state.gold = ATTACKER_START_GOLD;
      this.incomeClock = 0;
      this.attackClock = ATTACKER_TIME_LIMIT;
    }
    this.combat = new Combat(
      this.state,
      this.fx,
      (uid) => this.enemyViews.get(uid),
      (uid) => this.runtimeFor(uid),
    );

    this.state.stats.startTime = performance.now();
    emit('phase:changed');
    emit('hud:changed');
  }

  // ------------------------------------------------------------------- flow

  begin(): void {
    // The attacker deploys on their own clock, so there is no build phase and
    // no wave timer to count down.
    if (this.side === 'attacker') {
      this.phase = 'wave';
      this.incomeClock = 0;
      this.state.stats.startTime = performance.now();
      emit('game:started');
      emit('phase:changed');
      emit('hud:changed');
      return;
    }
    this.phase = 'building';
    this.buildClock = BUILD_TIME_FIRST;
    this.state.stats.startTime = performance.now();
    emit('game:started');
    emit('phase:changed');
    emit('hud:changed');
  }

  /**
   * Switch map archetype and rebuild the lane, then start a fresh run on it.
   * Used by the map picker on the title screen.
   */
  chooseMap(id: MapId): void {
    setMap(id);
    this.board.rebuild();
    this.restart();
    this.phase = 'menu';
    emit('phase:changed');
  }

  restart(): void {
    // Remember whether a run is under way: picking a side or a map from the
    // menu also calls restart(), and that must not start the clock early.
    const inRun = this.phase !== 'menu' && this.state.stats.startTime > 0;

    for (const view of this.enemyViews.values()) view.dispose();
    this.enemyViews.clear();
    for (const root of this.towerRoots.values()) root.removeFromParent();
    this.towerViews.clear();
    this.towerRoots.clear();
    this.fx.reset();

    this.state = new GameState(FORTRESS_MAX_HP);
    this.deploying = null;
    this.deployCount = 0;
    if (this.side === 'attacker') {
      // The fortress is already defended. This is the puzzle the player breaks.
      // These towers are part of the scenario rather than something the player
      // paid for, so the balance is irrelevant while they go up: tower price
      // climbs as you build, so a summed-up outlay would underfund the later
      // ones and silently drop them.
      this.state.gold = SCENARIO_FUNDS;
      for (const t of this.blueprint()) {
        const tower = this.state.build(t.type, t.gx, t.gy);
        if (tower) this.attachTower(tower);
      }
      this.state.gold = ATTACKER_START_GOLD;
      this.incomeClock = 0;
      this.attackClock = ATTACKER_TIME_LIMIT;
    }
    this.combat = new Combat(
      this.state,
      this.fx,
      (uid) => this.enemyViews.get(uid),
      (uid) => this.runtimeFor(uid),
    );

    this.selected = null;
    this.placing = null;
    this.combining = false;
    this.hoverCell = null;
    this.preview.hide();
    this.board.hideHighlight();
    this.board.hideDeployZone();
    this.board.setDeployArrows(this.side === 'attacker');
    this.waveClock = 0;
    this.buildClock = BUILD_TIME_FIRST;
    this.time = 0;

    this.stage.rig.target.set(0, 0, 0.4);
    this.stage.rig.distance = 22;
    this.stage.rig.yaw = 0;

    // The attacker has no build phase (there is no wave timer to wait out), but
    // a fresh board is only live once the run has actually been started.
    this.phase =
      this.phase === 'menu' ? 'menu' : inRun && this.side === 'attacker' ? 'wave' : 'building';
    // A mid-run restart drops straight back into play, so re-stamp the start
    // time: a fresh GameState has none, which would leave the attacker's clock
    // and income switched off with no menu to restart them from.
    if (inRun) this.state.stats.startTime = performance.now();
    emit('game:started');
    emit('phase:changed');
    emit('hud:changed');
  }

  setPaused(paused: boolean): void {
    if (paused && (this.phase === 'building' || this.phase === 'wave')) {
      this.resumePhase = this.phase;
      this.phase = 'paused';
    } else if (!paused && this.phase === 'paused') {
      this.phase = this.resumePhase;
    } else {
      return;
    }
    emit('phase:changed');
  }

  private resumePhase: GamePhase = 'building';

  setSpeed(speed: number): void {
    this.state.speed = speed;
    emit('hud:changed');
  }

  // ------------------------------------------------------------------ build

  armPlacing(type: TowerId | null): void {
    // The attacker has no towers to place.
    if (this.side === 'attacker') type = null;
    this.placing = type;
    this.combining = false;
    this.selected = null;
    this.preview.setType(type);
    this.preview.show();
    if (!type) {
      this.preview.hide();
      this.board.hideHighlight();
      this.fx.hideRange();
    }
    emit('placing:changed');
    emit('selection:changed');
  }

  select(tower: Tower | null): void {
    this.selected = tower;
    this.placing = null;
    this.combining = false;
    this.preview.hide();
    if (tower) {
      this.fx.showRange(
        gxToWorld(tower.gx),
        gyToWorld(tower.gy),
        tierSpec(tower.type, tower.tier).range,
        true,
      );
    } else {
      this.fx.hideRange();
    }
    emit('selection:changed');
  }

  /** Which side the player is playing. Persisted like the theme. */
  side: Side = loadSide();
  /** Attacker: the unit armed for deployment. */
  deploying: EnemyId | null = null;
  /** Attacker: how many units have been sent in this run. */
  deployCount = 0;
  /** Passive brick income, attacker side only. */
  private incomeClock = 0;
  /** Seconds left on the assault clock, attacker side only. */
  private attackClock = ATTACKER_TIME_LIMIT;

  /** True once the player has actually pressed start. */
  private get runStarted(): boolean {
    return this.state.stats.startTime > 0;
  }

  /** Seconds left on the assault clock, for the HUD. */
  get assaultTimeLeft(): number {
    return Math.max(0, this.attackClock);
  }
  private blueprintCache: { map: MapId; towers: BlueprintTower[] } | null = null;

  /** Attacker: step to the next creature in the palette. */
  cycleDeploying(): void {
    const i = this.deploying ? ATTACKER_ORDER.indexOf(this.deploying) : -1;
    this.armDeploying(ATTACKER_ORDER[(i + 1) % ATTACKER_ORDER.length]);
  }

  /** Attacker: arm (or disarm) a creature for deployment. */
  armDeploying(type: EnemyId | null): void {
    this.deploying = this.deploying === type ? null : type;
    this.placing = null;
    this.selected = null;
    if (this.deploying) {
      // Light up the four gate zones so it is obvious where units may enter.
      this.board.showDeployZone(this.deployCells());
    } else {
      this.board.hideDeployZone();
    }
    emit('placing:changed');
    emit('hud:changed');
  }

  /** The tiles the attacker may drop a unit onto: the first stretch of each lane. */
  deployCells(): Array<[number, number]> {
    return LANES.flatMap((lane) => lane.cells.slice(0, DEPLOY_ZONE).map((c) => [c[0], c[1]] as [number, number]));
  }

  /** The defender's pre-placed towers for the current map (cached per map). */
  blueprint(): BlueprintTower[] {
    const id = currentMap().id;
    if (this.blueprintCache?.map === id) return this.blueprintCache.towers;
    const primary = LANES[0];
    const towers = buildBlueprint(
      {
        archetype: ARCHETYPES[id],
        lanes: LANES,
        cells: PATH_CELLS,
        gateCell: primary.gateCell,
        gateApproach: primary.gateApproach,
        gateFacing: primary.gateFacing,
      },
      GRID,
      FORTRESS_CELLS,
      currentSeed(),
    );
    this.blueprintCache = { map: id, towers };
    return towers;
  }

  setSide(side: Side): void {
    if (this.side === side) return;
    this.side = side;
    saveSide(side);
    this.deploying = null;
    this.board.hideDeployZone();
    emit('side:changed', side);
    this.restart();
  }

  /** Pick the lane a grid cell belongs to, or -1 if it is not on any lane. */
  laneAt(gx: number, gy: number): number {
    return LANES.findIndex((lane) => lane.cells.some(([x, y]) => x === gx && y === gy));
  }

  /**
   * The lane whose entrance zone covers this cell, or -1. Attacker units enter
   * at the gate and march the whole lane.
   */
  deployLaneAt(gx: number, gy: number): number {
    return LANES.findIndex((lane) =>
      lane.cells.slice(0, DEPLOY_ZONE).some(([x, y]) => x === gx && y === gy),
    );
  }

  /**
   * Attacker side: drop a unit onto a lane tile. It marches from wherever it
   * was placed to the fortress, so the player chooses both the unit and how far
   * into the defended zone it starts.
   */
  tryDeploy(gx: number, gy: number): void {
    if (this.side !== 'attacker' || !this.deploying) return;
    const lane = this.deployLaneAt(gx, gy);
    if (lane < 0) {
      this.preview.setValid(false);
      this.state.toast('DEPLOY AT A LANE GATE', 'bad');
      sfx('deny');
      return;
    }
    const cost = ATTACKER_COST[this.deploying];
    if (this.state.gold < cost) {
      this.state.toast('NOT ENOUGH BRICKS', 'bad');
      sfx('deny');
      return;
    }
    // Progress of the tapped tile along its lane.
    const cells = LANES[lane].cells;
    const index = cells.findIndex(([x, y]) => x === gx && y === gy);
    const unit = this.state.spawn(this.deploying, 1, lane);
    unit.dist = Math.max(0, index);
    this.state.spend(cost);
    this.deployCount += 1;
    sfx('build');
    this.board.showDeployZone(this.deployCells());
    emit('hud:changed');
  }

  private runtimeFor(uid: number): TowerRuntime | undefined {
    const view = this.towerViews.get(uid);
    if (!view) return undefined;
    const tower = this.state.towers.find((t) => t.uid === uid);
    if (!tower) return undefined;
    return {
      x: gxToWorld(tower.gx),
      z: gyToWorld(tower.gy),
      headY: view.headY,
      head: view.head,
      muzzle: view.muzzle,
      view,
    };
  }

  /** Click on a stud while a build option is armed. */
  tryBuild(gx: number, gy: number): void {
    if (!this.placing) return;
    const tower = this.state.build(this.placing, gx, gy);
    if (!tower) {
      this.preview.setValid(false);
      sfx('deny');
      return;
    }
    this.attachTower(tower);
    sfx('build');
    this.select(tower);
    this.preview.hide();
    emit('placing:changed');
  }

  /** Click on a stud with nothing armed: select, combine, or start a build. */
  clickCell(gx: number, gy: number): void {
    const existing = this.state.towerAt(gx, gy);

    if (this.combining && this.selected) {
      if (existing && existing !== this.selected) {
        const merged = this.state.combine(this.selected, existing);
        if (merged) {
          this.detachTower(existing);
          this.rebuildTower(merged);
          sfx('merge');
        } else {
          sfx('deny');
        }
      }
      this.combining = false;
      emit('selection:changed');
      emit('placing:changed');
      return;
    }

    // Attacker: an armed unit drops onto the tapped lane tile.
    if (this.side === 'attacker' && this.deploying) {
      this.tryDeploy(gx, gy);
      return;
    }

    if (this.placing) {
      this.tryBuild(gx, gy);
      return;
    }

    if (existing) {
      this.select(existing);
    } else {
      this.select(null);
    }
  }

  startCombining(): void {
    if (!this.selected) return;
    if (!this.state.findCombinePartner(this.selected)) {
      this.state.toast('NO MATCHING PARTNER IN RANGE', 'bad');
      sfx('deny');
      return;
    }
    this.combining = true;
    this.state.toast('PICK A MATCHING TOWER', 'info');
    emit('placing:changed');
  }

  cancelCombining(): void {
    this.combining = false;
    emit('placing:changed');
  }

  sellSelected(): void {
    const tower = this.selected;
    if (!tower) return;
    this.detachTower(tower);
    this.state.sell(tower);
    this.select(null);
    sfx('sell');
  }

  /** Arrow-key nudge for keyboard users; falls back to a no-op. */
  cyclePlacing(): void {
    const order: TowerId[] = ['shooter', 'mortar', 'freezer', 'coil', 'sprayer'];
    if (!this.placing) {
      this.armPlacing(order[0]);
      return;
    }
    const i = order.indexOf(this.placing);
    this.armPlacing(i === order.length - 1 ? null : order[i + 1]);
  }

  // ------------------------------------------------------------- view sync

  private attachTower(tower: Tower): void {
    const model = createTowerModel(tower.type, tower.tier);
    model.root.position.set(gxToWorld(tower.gx), 0, gyToWorld(tower.gy));
    model.head && (model.head.rotation.y = tower.angle);
    this.stage.scene.add(model.root);
    this.towerViews.set(tower.uid, model);
    this.towerRoots.set(tower.uid, model.root);

    // Snap-in pop.
    const root = model.root;
    root.scale.setScalar(0.01);
    this.fx.ring(
      new THREE.Vector3(root.position.x, 0.02, root.position.z),
      TOWERS[tower.type].accent,
      0.2,
      1.1,
      0.35,
    );
    this.popScale.set(tower.uid, 0);
  }

  private detachTower(tower: Tower): void {
    const root = this.towerRoots.get(tower.uid);
    if (root) {
      this.fx.ring(
        new THREE.Vector3(root.position.x, 0.02, root.position.z),
        0x9aa0a6,
        0.9,
        0.15,
        0.25,
      );
      root.removeFromParent();
    }
    this.towerViews.delete(tower.uid);
    this.towerRoots.delete(tower.uid);
    this.popScale.delete(tower.uid);
    if (this.selected?.uid === tower.uid) this.selected = null;
  }

  /** Rebuild a tower's model after it was combined into a higher tier. */
  private rebuildTower(tower: Tower): void {
    const keepSelected = this.selected?.uid === tower.uid;
    this.detachTower(tower);
    this.attachTower(tower);
    this.towerViews.get(tower.uid) &&
      (this.towerViews.get(tower.uid)!.head!.rotation.y = tower.angle);
    if (keepSelected) this.selected = tower;
  }

  // ----------------------------------------------------------------- hover

  setHover(gx: number, gy: number): void {
    if (!isInsideBoard(gx, gy)) {
      this.hoverCell = null;
      this.board.hideHighlight();
      this.fx.hideRange();
      return;
    }
    this.hoverCell = { gx, gy };
    const tower = this.state.towerAt(gx, gy);

    // 1. A build option is armed.
    if (this.placing) {
      const free = isBuildable(gx, gy) && this.state.canAfford(this.placing);
      this.board.showCell(gx, gy, free);
      this.preview.moveTo(gxToWorld(gx), gyToWorld(gy));
      this.preview.setValid(free);
      this.fx.showRange(gxToWorld(gx), gyToWorld(gy), tierSpec(this.placing, 1).range, free);
      return;
    }

    // 2. Combining: glow the cell only when it is a legal partner.
    if (this.combining && this.selected) {
      const anchor = this.selected;
      const valid =
        tower !== null &&
        tower !== anchor &&
        tower.type === anchor.type &&
        tower.tier === anchor.tier &&
        Math.abs(tower.gx - anchor.gx) + Math.abs(tower.gy - anchor.gy) <= COMBINE_RANGE;
      this.board.showCell(gx, gy, valid);
      if (tower) {
        this.fx.showRange(
          gxToWorld(tower.gx),
          gyToWorld(tower.gy),
          tierSpec(tower.type, tower.tier).range,
          valid,
        );
      }
      return;
    }

    // 3. Hovering a built tower: show its coverage.
    if (tower) {
      this.board.showCell(gx, gy, true);
      this.fx.showRange(
        gxToWorld(tower.gx),
        gyToWorld(tower.gy),
        tierSpec(tower.type, tower.tier).range,
        true,
      );
      return;
    }

    this.board.showCell(gx, gy, isBuildable(gx, gy));
    this.fx.hideRange();
  }

  clearHover(): void {
    this.hoverCell = null;
    this.board.hideHighlight();
    if (!this.selected) this.fx.hideRange();
  }

  // ------------------------------------------------------------------ waves

  /** Player pressed "start wave" — skip the countdown, get paid for it. */
  callWaveEarly(): void {
    if (this.phase !== 'building' || this.state.wave >= TOTAL_WAVES) return;
    const bonus = Math.floor(Math.max(0, this.buildClock) * EARLY_BONUS_PER_SEC);
    if (bonus > 0) {
      this.state.addGold(bonus);
      this.state.toast(`EARLY CALL  +${bonus} BRICKS`, 'gold');
    }
    this.buildClock = 0;
    this.launchWave();
  }

  private launchWave(): void {
    this.state.beginWave();
    this.phase = 'wave';
    this.waveClock = 0;
    emit('phase:changed');
    emit('hud:changed');
  }

  /** Attacker: bricks trickle in so the player is never stuck with nothing. */
  private updateIncome(dt: number): void {
    if (!this.runStarted) return;
    if (this.side !== 'attacker' || this.phase !== 'wave') return;
    this.incomeClock += dt;
    if (this.incomeClock >= 1) {
      const whole = Math.floor(this.incomeClock);
      this.incomeClock -= whole;
      this.state.gold += ATTACKER_INCOME * whole;
      emit('hud:changed');
    }
  }

  /** Attacker: the assault clock. Running it out loses the run. */
  private updateAssault(dt: number): void {
    if (!this.runStarted) return;
    if (this.side !== 'attacker' || this.phase !== 'wave') return;
    // No hud:changed here: tick() reads assaultTimeLeft every frame already.
    this.attackClock -= dt;
    if (this.attackClock > 0) return;
    this.attackClock = 0;
    this.state.stats.endTime = performance.now();
    this.phase = 'lost';
    this.state.toast('THE FORTRESS HELD', 'bad');
    sfx('lose');
    emit('game:over', { won: false });
    emit('phase:changed');
    emit('hud:changed');
  }

  private updateWave(dt: number): void {
    // Attacker mode has no wave schedule: the player deploys on their own time
    // and earns bricks passively.
    if (this.side === 'attacker') return;

    if (this.phase === 'building') {
      this.buildClock -= dt;
      if (this.buildClock <= 0) this.launchWave();
      return;
    }
    if (this.phase !== 'wave') return;

    this.waveClock += dt;
    this.state.releaseSpawns(this.waveClock);

    if (this.state.queueRemaining === 0 && this.state.enemies.length === 0) {
      this.state.finishWave();
      this.buildClock = BUILD_TIME;
      this.phase = this.state.wave >= TOTAL_WAVES ? 'won' : 'building';
      if (this.phase === 'won') {
        this.state.stats.endTime = performance.now();
        sfx('win');
        emit('game:over', { won: true });
      }
    }
  }

  // ---------------------------------------------------------------- enemies

  private updateEnemies(dt: number): void {
    const enemies = this.state.enemies;

    for (let i = enemies.length - 1; i >= 0; i--) {
      const enemy = enemies[i];
      if (!enemy.alive) {
        this.killView(enemy);
        enemies.splice(i, 1);
        continue;
      }

      enemy.dist += enemy.speed * enemy.slowFactor * dt;
      // Per-lane: on a four-lane map each arm can be a different length, so a
      // unit must reach the end of *its own* lane to breach.
      if (enemy.dist >= pathLength(enemy.lane)) {
        this.state.leakEnemy(enemy);
        this.killView(enemy, true);
        if (this.state.fortressHp <= 0) {
          this.state.stats.endTime = performance.now();
          // The fortress falling is the defender's loss and the attacker's win.
          const attackerWon = this.side === 'attacker';
          this.phase = attackerWon ? 'won' : 'lost';
          sfx(attackerWon ? 'win' : 'lose');
          emit('game:over', { won: attackerWon });
          emit('phase:changed');
        }
        continue;
      }
      this.syncEnemyView(enemy);
    }
  }

  /**
   * Enemies that shoot at towers. Damage lands when the shot is fired and the
   * projectile is purely visual feedback, which keeps targeting cheap and the
   * impact readable.
   */
  private updateSiege(dt: number): void {
    const enemies = this.state.enemies;
    if (!enemies.length || !this.state.towers.length) return;

    for (const enemy of enemies) {
      const spec = ENEMIES[enemy.type];
      if (!spec.attackRange) continue;
      enemy.attackCd -= dt;

      const p = samplePath(enemy.dist, enemy.lane, SIEGE_SAMPLE);
      const ex = p.x;
      const ez = p.z;

      // Nearest tower in range.
      let target: Tower | null = null;
      let best = spec.attackRange;
      for (const tower of this.state.towers) {
        const d = Math.hypot(gxToWorld(tower.gx) - ex, gyToWorld(tower.gy) - ez);
        if (d < best) {
          best = d;
          target = tower;
        }
      }
      if (!target) continue;

      enemy.aimAngle = Math.atan2(
        gxToWorld(target.gx) - ex,
        gyToWorld(target.gy) - ez,
      );

      if (enemy.attackCd > 0) continue;
      enemy.attackCd = spec.attackCooldown ?? 1;

      const from = new THREE.Vector3(ex, 0.55, ez);
      this.spawnEnemyShot(spec, from, target);
    }
  }

  private spawnEnemyShot(
    spec: EnemySpec,
    from: THREE.Vector3,
    target: Tower,
  ): void {
    const to = new THREE.Vector3(gxToWorld(target.gx), 0.35, gyToWorld(target.gy));
    this.fx.enemyShot(from, to, spec.attackStyle ?? 'bullet', spec.accent, 0.28);
    this.fx.muzzleBurst(from, to.clone().sub(from).normalize(), spec.accent, 3);

    // Siege fire is constant, so the sound is throttled to stay readable.
    const now = performance.now();
    if (now - this.lastSiegeSfx > 140) {
      this.lastSiegeSfx = now;
      sfx(spec.attackStyle === 'rocket' ? 'explode' : 'shoot', 1.15);
    }

    let dmg = spec.attackDamage ?? 0;
    const splash = spec.attackSplash ?? 0;

    if (this.side === 'attacker') dmg = Math.round(dmg * ATTACKER_SIEGE_TOWER_MULT);

    if (splash > 0) {
      // Splash: everything within the blast radius takes the hit.
      const sx = gxToWorld(target.gx);
      const sz = gyToWorld(target.gy);
      for (const t of [...this.state.towers]) {
        if (Math.hypot(gxToWorld(t.gx) - sx, gyToWorld(t.gy) - sz) <= splash) {
          this.damageTower(t, dmg);
        }
      }
      this.fx.ring(new THREE.Vector3(sx, 0.1, sz), 0xff8a3d, 0.2, splash, 0.35);
    } else {
      this.damageTower(target, dmg);
    }
  }

  private damageTower(tower: Tower, amount: number): void {
    tower.hp -= amount;
    tower.hitFlash = 0.25;

    if (tower.hp > 0) {
      // Small spark so the player can see which tower is under fire.
      const p = new THREE.Vector3(gxToWorld(tower.gx), 0.4, gyToWorld(tower.gy));
      this.fx.muzzleBurst(p, new THREE.Vector3(0, 1, 0), 0xff5a3c, 4);
      this.fx.ring(p, 0xff5a3c, 0.15, 0.5, 0.22);
      emit('hud:changed');
      return;
    }

    // Destroyed: the bricks come apart and the cell is free again.
    const i = this.state.towers.indexOf(tower);
    if (i >= 0) this.state.towers.splice(i, 1);
    const root = this.towerRoots.get(tower.uid);
    if (root) {
      this.fx.shatter(
        new THREE.Vector3(root.position.x, 0.25, root.position.z),
        tower.type === 'coil' ? 0x8a8f98 : 0xd0011b,
        0xf2cd37,
        1.4,
      );
      root.removeFromParent();
    }
    this.towerViews.delete(tower.uid);
    this.towerRoots.delete(tower.uid);
    this.popScale.delete(tower.uid);
    if (this.selected?.uid === tower.uid) this.selected = null;
    if (this.side === 'attacker') {
      const bounty = ATTACKER_TOWER_BOUNTY + (tower.tier >= 3 ? ATTACKER_TIER_BONUS : 0);
      this.state.addGold(bounty);
      this.state.toast(`${TOWERS[tower.type].name} DESTROYED  +${bounty}`, 'gold');
    } else {
      this.state.toast(`${TOWERS[tower.type].name} DESTROYED`, 'bad');
    }
    this.fx.muzzleBurst(
      new THREE.Vector3(gxToWorld(tower.gx), 0.3, gyToWorld(tower.gy)),
      new THREE.Vector3(0, 1, 0),
      0xff8a3d,
      12,
    );
    sfx('explode', 0.8);
    emit('hud:changed');
    emit('selection:changed');
  }

  private syncEnemyView(enemy: Enemy): void {
    let view = this.enemyViews.get(enemy.uid);
    if (!view) {
      view = new EnemyView(enemy.type);
      view.root.userData['uid'] = enemy.uid;
      this.enemyViews.set(enemy.uid, view);
      this.stage.scene.add(view.root);
    }
  }

  private killView(enemy: Enemy, leaked = false): void {
    const view = this.enemyViews.get(enemy.uid);
    if (!view) return;
    if (!leaked) {
      const p = new THREE.Vector3(view.root.position.x, 0.2, view.root.position.z);
      this.fx.shatter(p, enemy.type === 'ghost' ? 0xb6d7e8 : 0xffffff, 0x4b9f4a, 1);
    }
    view.dispose();
    this.enemyViews.delete(enemy.uid);
  }

  // ------------------------------------------------------------------ frame

  /** One simulation + presentation step. `dt` is already scaled by speed. */
  step(dt: number): void {
    this.time += dt;

    if (this.phase === 'building' || this.phase === 'wave') {
      this.updateWave(dt);
      this.updateIncome(dt);
      this.updateAssault(dt);
      this.combat.tickEnemies(dt);
      this.combat.update(dt);
      this.updateEnemies(dt);
      this.updateSiege(dt);
    }

    this.fx.update(dt);
    this.board.pulseGate(this.time);
    this.board.setFortressHealth(this.state.fortressHp, this.state.fortressMaxHp);

    // Tower entrance pops.
    for (const [uid, k] of this.popScale) {
      const next = k + dt * 5.5;
      const root = this.towerRoots.get(uid);
      if (root) {
        const s = Math.min(1, next);
        const overshoot = 1 + Math.sin(Math.min(1, next) * Math.PI) * 0.12;
        root.scale.setScalar(s * overshoot);
      }
      if (next >= 1.05) {
        root?.scale.setScalar(1);
        this.popScale.delete(uid);
      } else {
        this.popScale.set(uid, next);
      }
    }

    // Hull bars. Always visible so damage is readable at a glance.
    for (const tower of this.state.towers) {
      const view = this.towerViews.get(tower.uid);
      const bar = view?.hullBar;
      if (!bar) continue;
      const ratio = Math.max(0.02, Math.min(1, tower.hp / tower.maxHp));
      const fill = bar.userData['fill'] as THREE.Sprite;
      const width = bar.userData['width'] as number;
      fill.scale.set(width * ratio, 0.13, 1);
      fill.position.x = -(width * (1 - ratio)) / 2;
      const mat = fill.material as THREE.SpriteMaterial;
      mat.color.setHex(ratio > 0.55 ? 0x4b9f4a : ratio > 0.25 ? 0xf2cd37 : 0xd0011b);
      bar.visible = true;
    }

    // Keep matrices current so muzzle positions are exact.
    for (const root of this.towerRoots.values()) root.updateMatrixWorld(true);
    for (const view of this.enemyViews.values()) view.root.updateMatrixWorld(true);

    // Present enemy views.
    const camQuat = this.stage.camera.quaternion;
    for (const enemy of this.state.enemies) {
      const view = this.enemyViews.get(enemy.uid);
      if (!view) continue;
      samplePath(enemy.dist, enemy.lane, lane);
      view.update(
        dt,
        lane.x,
        lane.z,
        Math.atan2(lane.dx, lane.dz),
        enemy.hp / enemy.maxHp,
        1 - enemy.slowFactor,
        enemy.poisonTimer > 0,
        enemy.hitFlash,
        camQuat,
      );
    }
  }

  /** Idle animation for the menu state so the board never looks frozen. */
  idle(dt: number): void {
    this.time += dt;
    this.fx.update(dt);
    this.board.pulseGate(this.time);
    for (const view of this.enemyViews.values()) view.root.updateMatrixWorld(true);
  }

  get isPlaying(): boolean {
    return this.phase === 'building' || this.phase === 'wave';
  }

  get timeRemaining(): number {
    return this.phase === 'building' ? Math.max(0, this.buildClock) : 0;
  }
}
