import * as THREE from 'three';
import { BRICK_H, LEGO, PLATE_H } from '../core/constants';
import { TOWERS } from '../core/towers';
import type { TowerId, TowerSpec } from '../core/types';
import {
  brick,
  cone,
  cylinderZ,
  dome,
  plate,
  post,
  ring,
  roundBrick,
  sphere,
  studPeg,
} from './builder';
import { plastic, translucent } from './materials';

export interface TowerModel {
  root: THREE.Group;
  /** Rotating turret group; null for towers with no aiming direction. */
  head: THREE.Group | null;
  /** World-local point projectiles spawn from. */
  muzzle: THREE.Object3D | null;
  /** Height of the turret pivot, used to aim effects. */
  headY: number;
  /** Rings/plates that pulse when the tower fires. */
  pulse: THREE.Object3D[];
  /** Camera-facing hull bar; set by createTowerModel. */
  hullBar?: THREE.Group;
  /** Support towers only: aura radius in tiles, 0 for weapons. */
  auraRadius?: number;
  /** Support towers only: the visible aura ring. */
  auraMesh?: THREE.Mesh;
}

const GREY = LEGO.lightBluishGray;
const DARK = LEGO.darkBluishGray;

function mesh(
  geo: THREE.BufferGeometry,
  color: number,
  opts: { emissive?: number; opacity?: number; transparent?: boolean } = {},
): THREE.Mesh {
  const m = new THREE.Mesh(
    geo,
    opts.transparent
      ? translucent(color, opts.opacity ?? 0.55)
      : plastic(color, { emissive: opts.emissive ?? 0x000000, roughness: 0.34 }),
  );
  m.castShadow = true;
  m.receiveShadow = false;
  return m;
}

function at(m: THREE.Object3D, y: number, x = 0, z = 0): THREE.Object3D {
  m.position.set(x, y, z);
  return m;
}

/** Level pips on the front of the base plate. */
function tierPips(tier: number, color: number): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < tier; i++) {
    const pip = mesh(roundBrick(1.2, PLATE_H * 1.6), color, { emissive: color });
    at(pip, PLATE_H, (i - (tier - 1) / 2) * 0.1, 0.3);
    g.add(pip);
  }
  return g;
}

/** Shared build pad. Deliberately smaller than a cell so adjacent
 *  towers are separated by a visible gutter instead of touching. */
function buildPad(spec: TowerSpec, tier: number): THREE.Group {
  const g = new THREE.Group();
  const plateMesh = mesh(plate(7, 7), DARK);
  plateMesh.receiveShadow = true;
  g.add(plateMesh);

  const trim = mesh(brick(5, 5, false), spec.accent);
  at(trim, PLATE_H);
  g.add(trim);

  g.add(tierPips(tier, spec.accent));
  return g;
}

// --------------------------------------------------------------------- models

function buildShooter(tier: number): TowerModel {
  const spec = TOWERS.shooter;
  const root = new THREE.Group();
  const pulse: THREE.Object3D[] = [];

  const pad = buildPad(spec, tier);
  root.add(pad);

  let y = PLATE_H;
  const columnH = tier === 1 ? 1 : tier === 2 ? 2 : 3;
  for (let i = 0; i < columnH; i++) {
    const col = mesh(brick(i === 0 ? 6 : 4, i === 0 ? 6 : 4, false), i === 0 ? GREY : LEGO.white);
    at(col, y);
    col.receiveShadow = true;
    root.add(col);
    y += BRICK_H;
  }

  const collar = mesh(ring(2.6, 0.5), LEGO.flatGray);
  at(collar, y - BRICK_H * 0.4);
  collar.rotation.x = Math.PI / 2;
  root.add(collar);
  pulse.push(collar);

  // Turret head.
  const head = new THREE.Group();
  head.position.y = y;

  const housing = mesh(roundBrick(4, BRICK_H * 1.4), spec.accent);
  at(housing, -BRICK_H * 0.3);
  head.add(housing);

  const breech = mesh(brick(4, 4, false), LEGO.darkBluishGray);
  at(breech, BRICK_H * 0.8);
  head.add(breech);

  const barrels = tier === 1 ? 1 : 2;
  for (let i = 0; i < barrels; i++) {
    const off = barrels === 1 ? 0 : (i - 0.5) * 0.16;
    const tube = mesh(cylinderZ(0.85, 4.5), DARK);
    at(tube, BRICK_H * 1.05, off, 0.2);
    head.add(tube);

    const tip = mesh(studPeg(), LEGO.black);
    at(tip, BRICK_H * 1.05, off, 0.44);
    head.add(tip);
  }

  if (tier >= 2) {
    for (const side of [-1, 1]) {
      const shield = mesh(plate(2, 5), LEGO.red);
      at(shield, BRICK_H * 0.5, side * 0.2, 0);
      shield.rotation.y = Math.PI / 2;
      head.add(shield);
    }
  }
  if (tier >= 3) {
    const crest = mesh(brick(6, 2, false), LEGO.yellow);
    at(crest, BRICK_H * 1.6, 0, -0.06);
    head.add(crest);
    const muzzleRing = mesh(ring(1.5, 0.35), LEGO.yellow);
    at(muzzleRing, BRICK_H * 1.05, 0, 0.3);
    head.add(muzzleRing);
    pulse.push(muzzleRing);
  }

  root.add(head);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, BRICK_H * 1.05, 0.5);
  head.add(muzzle);

  return { root, head, muzzle, headY: y, pulse };
}

function buildMortar(tier: number): TowerModel {
  const spec = TOWERS.mortar;
  const root = new THREE.Group();
  const pulse: THREE.Object3D[] = [];

  const pad = buildPad(spec, tier);
  root.add(pad);

  let y = PLATE_H;
  const columnH = tier === 1 ? 1 : tier === 2 ? 2 : 3;
  for (let i = 0; i < columnH; i++) {
    const col = mesh(brick(i === 0 ? 6 : 4, i === 0 ? 6 : 4, false), i === 0 ? GREY : LEGO.darkBlue);
    at(col, y);
    col.receiveShadow = true;
    root.add(col);
    y += BRICK_H;
  }

  const pivot = new THREE.Group();
  pivot.position.y = y;
  root.add(pivot);

  const yoke = mesh(brick(5, 4, false), LEGO.darkBluishGray);
  at(yoke, 0);
  pivot.add(yoke);

  const head = new THREE.Group();
  head.position.y = BRICK_H;
  head.rotation.x = -0.72;
  pivot.add(head);

  const tubes = tier === 3 ? 2 : 1;
  const muzzleZ = 0.32;
  for (let i = 0; i < tubes; i++) {
    const off = tubes === 1 ? 0 : (i - 0.5) * 0.22;
    const tube = mesh(cylinderZ(1.8, 5), spec.accent);
    at(tube, 0, off, 0);
    head.add(tube);

    const ring0 = mesh(ring(2.1, 0.45), LEGO.black);
    at(ring0, 0, off, muzzleZ - 0.02);
    head.add(ring0);
    pulse.push(ring0);

    const cap = mesh(roundBrick(4, BRICK_H), LEGO.flatGray);
    at(cap, -BRICK_H, off, -0.2);
    head.add(cap);
  }

  if (tier >= 2) {
    const brace = mesh(brick(2, 4, false), LEGO.red);
    at(brace, BRICK_H * 0.6, 0, -0.22);
    pivot.add(brace);
  }
  if (tier >= 3) {
    const crown = mesh(ring(3, 0.5), LEGO.yellow);
    at(crown, BRICK_H * 0.2);
    crown.rotation.x = Math.PI / 2;
    pivot.add(crown);
    pulse.push(crown);
  }

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, muzzleZ + 0.1);
  head.add(muzzle);

  return { root, head: pivot, muzzle, headY: y + BRICK_H, pulse };
}

function buildFreezer(tier: number): TowerModel {
  const spec = TOWERS.freezer;
  const root = new THREE.Group();
  const pulse: THREE.Object3D[] = [];

  const pad = buildPad(spec, tier);
  root.add(pad);

  let y = PLATE_H;
  const columnH = tier === 1 ? 1 : tier === 2 ? 2 : 3;
  for (let i = 0; i < columnH; i++) {
    const col = mesh(brick(6, 6, false), i === 0 ? GREY : LEGO.white);
    at(col, y);
    col.receiveShadow = true;
    root.add(col);
    y += BRICK_H;
  }

  // Frost tank.
  const tank = mesh(post(2.1, 3), LEGO.sandBlue, { opacity: 0.75, transparent: true });
  at(tank, y);
  root.add(tank);

  const tankCap = mesh(roundBrick(4.4, BRICK_H), LEGO.white);
  at(tankCap, y + BRICK_H * 3);
  root.add(tankCap);

  const head = new THREE.Group();
  head.position.y = y + BRICK_H * 3 + BRICK_H;
  root.add(head);

  const housing = mesh(brick(4, 4, false), spec.accent);
  at(housing, 0);
  head.add(housing);

  const nozzle = mesh(cone(1.6, 2.4), LEGO.sandBlue);
  at(nozzle, BRICK_H, 0, 0.16);
  nozzle.rotation.x = Math.PI / 2;
  head.add(nozzle);

  const emitter = mesh(sphere(1.5), LEGO.transIce, {
    opacity: 0.7,
    transparent: true,
    emissive: LEGO.sandBlue,
  });
  at(emitter, BRICK_H * 1.4, 0, 0.24);
  head.add(emitter);
  pulse.push(emitter);

  // Frost shell grows with tier.
  const shellR = tier === 1 ? 3 : tier === 2 ? 3.8 : 4.6;
  const shell = mesh(dome(shellR), LEGO.transIce, { opacity: 0.16, transparent: true });
  at(shell, PLATE_H);
  shell.castShadow = false;
  root.add(shell);

  const base = mesh(post(2.4, 1), LEGO.white);
  at(base, PLATE_H + BRICK_H * (columnH + 1));
  root.add(base);
  pulse.push(base);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, BRICK_H * 1.4, 0.3);
  head.add(muzzle);

  return { root, head, muzzle, headY: y, pulse };
}

function buildCoil(tier: number): TowerModel {
  const spec = TOWERS.coil;
  const root = new THREE.Group();
  const pulse: THREE.Object3D[] = [];

  const pad = buildPad(spec, tier);
  root.add(pad);

  let y = PLATE_H;
  const columnH = tier === 1 ? 1 : tier === 2 ? 2 : 3;
  for (let i = 0; i < columnH; i++) {
    const col = mesh(brick(i === 0 ? 6 : 4, i === 0 ? 6 : 4, false), i === 0 ? GREY : DARK);
    at(col, y);
    col.receiveShadow = true;
    root.add(col);
    y += BRICK_H;
  }

  // Stacked insulators, narrowing upward.
  const rings = 2 + tier;
  for (let i = 0; i < rings; i++) {
    const r = 2.6 - i * (0.45 / tier);
    const disc = mesh(roundBrick(r * 2.2, PLATE_H * 1.8), LEGO.white);
    at(disc, y);
    root.add(disc);
    y += PLATE_H * 1.8;
  }

  const spine = mesh(post(0.7, 2 + tier), DARK);
  at(spine, y);
  root.add(spine);
  y += (2 + tier) * 0.125;

  const head = new THREE.Group();
  head.position.y = y;
  root.add(head);

  const torus = mesh(ring(2.4, 0.55), spec.accent);
  torus.rotation.x = Math.PI / 2;
  head.add(torus);
  pulse.push(torus);

  const torus2 = mesh(ring(1.5, 0.45), LEGO.white);
  at(torus2, BRICK_H, 0, 0);
  torus2.rotation.x = Math.PI / 2;
  head.add(torus2);

  const orb = mesh(sphere(1.7), LEGO.brightYellow, { emissive: LEGO.yellow });
  at(orb, BRICK_H);
  head.add(orb);
  pulse.push(orb);

  if (tier >= 3) {
    for (const side of [-1, 1]) {
      const fin = mesh(plate(2, 6), LEGO.black);
      at(fin, BRICK_H * 0.5, side * 0.28, 0);
      fin.rotation.set(Math.PI / 2, 0, 0);
      head.add(fin);
    }
  }

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, BRICK_H, 0);
  head.add(muzzle);

  return { root, head, muzzle, headY: y, pulse };
}

function buildSprayer(tier: number): TowerModel {
  const spec = TOWERS.sprayer;
  const root = new THREE.Group();
  const pulse: THREE.Object3D[] = [];

  const pad = buildPad(spec, tier);
  root.add(pad);

  let y = PLATE_H;
  const columnH = tier === 1 ? 1 : tier === 2 ? 2 : 3;
  for (let i = 0; i < columnH; i++) {
    const col = mesh(brick(i === 0 ? 6 : 4, i === 0 ? 6 : 4, false), i === 0 ? GREY : LEGO.darkGreen);
    at(col, y);
    col.receiveShadow = true;
    root.add(col);
    y += BRICK_H;
  }

  const tank = mesh(post(2.4, 2.4), LEGO.brightGreen);
  at(tank, y);
  root.add(tank);

  const strap = mesh(ring(2.7, 0.4), LEGO.black);
  at(strap, y + BRICK_H);
  strap.rotation.x = Math.PI / 2;
  root.add(strap);

  const head = new THREE.Group();
  head.position.y = y + BRICK_H * 2.4;
  root.add(head);

  const housing = mesh(brick(4, 4, false), spec.accent);
  at(housing, 0);
  head.add(housing);

  const fanHub = mesh(post(1.2, 1), DARK);
  at(fanHub, BRICK_H);
  head.add(fanHub);

  const blades = 3 + tier;
  const fan = new THREE.Group();
  fan.position.y = BRICK_H * 1.2;
  for (let i = 0; i < blades; i++) {
    const holder = new THREE.Group();
    holder.rotation.y = (i / blades) * Math.PI * 2;
    const blade = mesh(plate(1, 4), LEGO.yellow);
    blade.position.set(0, 0, 0.2);
    blade.rotation.set(Math.PI / 2, 0, 0.38);
    holder.add(blade);
    fan.add(holder);
  }
  head.add(fan);
  pulse.push(fan);

  const cowl = mesh(post(2.6, 1.4), LEGO.brightGreen);
  at(cowl, BRICK_H * 1.2, 0, -0.02);
  cowl.scale.set(1, 1, 0.7);
  head.add(cowl);

  const nozzle = mesh(cone(1.2, 2), DARK);
  at(nozzle, BRICK_H * 0.6, 0, 0.26);
  nozzle.rotation.x = Math.PI / 2;
  head.add(nozzle);

  const mist = mesh(sphere(1.4), LEGO.brightGreen, {
    opacity: 0.35,
    transparent: true,
    emissive: LEGO.brightGreen,
  });
  at(mist, BRICK_H * 0.6, 0, 0.34);
  head.add(mist);
  pulse.push(mist);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, BRICK_H * 0.6, 0.42);
  head.add(muzzle);

  return { root, head, muzzle, headY: y, pulse };
}


/** LONG SHOT: a tall, braced rifle on a narrow column. */
function buildSniper(tier: number): TowerModel {
  const spec = TOWERS.sniper;
  const root = new THREE.Group();
  const pulse: THREE.Object3D[] = [];
  const pad = buildPad(spec, tier);
  root.add(pad);

  let y = PLATE_H;
  // A slim pillar reads as "long" next to the squat shooter column.
  for (let i = 0; i < tier + 1; i++) {
    const col = mesh(brick(2, 2, false), i % 2 ? LEGO.black : LEGO.darkBluishGray);
    at(col, y);
    col.receiveShadow = true;
    root.add(col);
    y += BRICK_H;
  }

  const brace = mesh(plate(4, 4), LEGO.flatGray);
  at(brace, y - BRICK_H * 0.5);
  root.add(brace);
  pulse.push(brace);

  const head = new THREE.Group();
  head.position.y = y;
  const receiver = mesh(brick(3, 3, false), spec.accent);
  at(receiver, BRICK_H * 0.4);
  head.add(receiver);
  // Long barrel.
  const barrel = mesh(brick(2, 6, false), LEGO.black);
  barrel.position.set(0, BRICK_H * 0.5, 2.4);
  head.add(barrel);
  const muzzleRing = mesh(ring(1.5, 0.4), LEGO.darkBluishGray);
  muzzleRing.rotation.x = Math.PI / 2;
  muzzleRing.position.set(0, BRICK_H * 0.5, 5.4);
  head.add(muzzleRing);
  pulse.push(muzzleRing);
  const scope = mesh(roundBrick(1.6, BRICK_H * 0.5), LEGO.transLightBlue);
  at(scope, BRICK_H * 1.1);
  head.add(scope);
  root.add(head);

  return {
    root,
    head,
    muzzle: muzzleRing,
    headY: y,
    pulse,
    auraRadius: 0,
  };
}

/** CLUSTER: a splayed mortar rack that fires a fan of shots. */
function buildCluster(tier: number): TowerModel {
  const spec = TOWERS.cluster;
  const root = new THREE.Group();
  const pulse: THREE.Object3D[] = [];
  const pad = buildPad(spec, tier);
  root.add(pad);

  let y = PLATE_H;
  const base = mesh(roundBrick(5, BRICK_H), LEGO.transIce);
  at(base, y + BRICK_H * 0.5);
  base.receiveShadow = true;
  root.add(base);
  y += BRICK_H;

  const collar = mesh(ring(3, 0.5), spec.accent);
  at(collar, y - BRICK_H * 0.2);
  collar.rotation.x = Math.PI / 2;
  root.add(collar);
  pulse.push(collar);

  const head = new THREE.Group();
  head.position.y = y;
  // Three short tubes in a fan: the cluster silhouette.
  const tubes: THREE.Object3D[] = [];
  for (let i = 0; i < 3; i++) {
    const tube = mesh(roundBrick(1.7, BRICK_H * 1.2), i === 1 ? LEGO.white : spec.accent);
    tube.position.set((i - 1) * 1.5, BRICK_H * 0.6, 1.2);
    tube.rotation.x = (i - 1) * 0.16;
    head.add(tube);
    tubes.push(tube);
  }
  const breech = mesh(brick(4, 3, false), LEGO.darkBluishGray);
  at(breech, -BRICK_H * 0.1);
  head.add(breech);
  pulse.push(...tubes);
  root.add(head);

  return {
    root,
    head,
    muzzle: tubes[1],
    headY: y,
    pulse,
    auraRadius: 0,
  };
}

/** BEACON: a support pylon. No barrel, it just projects a field. */
function buildSupport(tier: number): TowerModel {
  const spec = TOWERS.support;
  const root = new THREE.Group();
  const pulse: THREE.Object3D[] = [];
  const pad = buildPad(spec, tier);
  root.add(pad);

  let y = PLATE_H;
  const mast = mesh(brick(3, 3, false), LEGO.darkBluishGray);
  at(mast, y + BRICK_H * 0.5);
  mast.receiveShadow = true;
  root.add(mast);
  y += BRICK_H;

  // A glowing core that brightens with tier.
  const core = mesh(roundBrick(3, BRICK_H * 1.1), spec.accent);
  at(core, y + BRICK_H * 0.55);
  root.add(core);
  y += BRICK_H;

  const cage = mesh(ring(3.2, 0.5), LEGO.white);
  at(cage, y - BRICK_H * 0.3);
  cage.rotation.x = Math.PI / 2;
  root.add(cage);
  pulse.push(core, cage);

  // Antenna spikes mark it as a support rather than a weapon.
  for (let i = 0; i < 3; i++) {
    const spike = mesh(cone(0.7, 2), LEGO.white);
    spike.position.set(Math.cos((i / 3) * Math.PI * 2) * 2.2, y + BRICK_H * 0.4,
      Math.sin((i / 3) * Math.PI * 2) * 2.2);
    root.add(spike);
    pulse.push(spike);
  }

  const tip = mesh(sphere(1.1), LEGO.white);
  at(tip, y + BRICK_H * 0.8);
  root.add(tip);

  // buffRadius is measured in TILES, and one tile is one world unit (TILE=1),
  // so the ring radius is used directly. Multiplying by PITCH (studs per tile)
  // would shrink the aura 8x.
  const radius = TOWERS.support.tiers[tier - 1].buffRadius;
  const aura = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.22, radius, 56),
    new THREE.MeshBasicMaterial({
      color: spec.accent,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  aura.rotation.x = -Math.PI / 2;
  aura.position.y = PLATE_H * 0.4;
  root.add(aura);

  return {
    root,
    head: null,
    muzzle: null,
    headY: y,
    pulse,
    auraRadius: radius,
    auraMesh: aura,
  };
}

const BUILDERS: Record<TowerId, (tier: number) => TowerModel> = {
  shooter: buildShooter,
  mortar: buildMortar,
  freezer: buildFreezer,
  coil: buildCoil,
  sprayer: buildSprayer,
  sniper: buildSniper,
  cluster: buildCluster,
  support: buildSupport,
};

/**
 * Sprites always face the camera, so the hull bar reads correctly from any
 * orbit angle without per-frame billboarding code.
 */
function createHullBar(width: number, height: number): THREE.Group {
  const g = new THREE.Group();

  const back = new THREE.Sprite(
    new THREE.SpriteMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false,
    }),
  );
  back.scale.set(width + 0.06, height + 0.06, 1);
  back.renderOrder = 11;
  g.add(back);

  const fill = new THREE.Sprite(
    new THREE.SpriteMaterial({
      color: 0x4b9f4a,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
    }),
  );
  fill.scale.set(width, height, 1);
  fill.renderOrder = 12;
  g.add(fill);

  g.userData['back'] = back;
  g.userData['fill'] = fill;
  g.userData['width'] = width;
  return g;
}

/** Height of each tower type, so the bar floats just above the model. */
const BAR_HEIGHT: Record<TowerId, number> = {
  shooter: 2.1,
  mortar: 1.9,
  freezer: 2.2,
  coil: 2.5,
  sprayer: 2.0,
  sniper: 2.6,
  cluster: 1.8,
  support: 2.9,
};

export function createTowerModel(type: TowerId, tier: number): TowerModel {
  const model = BUILDERS[type](tier);
  const w = 0.62 + 0.1 * (tier - 1);
  const bar = createHullBar(w, 0.13);
  bar.position.y = BAR_HEIGHT[type] + 0.22 * (tier - 1);
  model.root.add(bar);
  model.hullBar = bar;
  return model;
}
