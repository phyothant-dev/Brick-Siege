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
  at(brace, y);
  root.add(brace);
  pulse.push(brace);

  const riser = mesh(brick(3, 3, false), spec.accent);
  at(riser, y + PLATE_H);
  root.add(riser);

  const head = new THREE.Group();
  head.position.y = y + PLATE_H + BRICK_H;
  root.add(head);

  const receiver = mesh(brick(3, 3, false), LEGO.darkBluishGray);
  at(receiver, 0);
  head.add(receiver);

  // Long barrel lying along +Z, sized in studs like every other turret.
  const barrelY = BRICK_H * 0.55;
  const barrel = mesh(cylinderZ(0.55, 7), LEGO.black);
  at(barrel, barrelY, 0, 0.42);
  head.add(barrel);

  const shroud = mesh(cylinderZ(0.9, 2), spec.accent);
  at(shroud, barrelY, 0, 0.16);
  head.add(shroud);

  const muzzleRing = mesh(ring(0.9, 0.3), LEGO.darkBluishGray);
  muzzleRing.rotation.x = Math.PI / 2;
  muzzleRing.position.set(0, barrelY, 0.85);
  head.add(muzzleRing);
  pulse.push(muzzleRing);

  const scope = mesh(cylinderZ(0.7, 2.6), LEGO.transLightBlue);
  at(scope, BRICK_H * 1.35, 0, 0.12);
  head.add(scope);

  const scopeEye = mesh(roundBrick(1.2, BRICK_H * 0.5), LEGO.darkBluishGray);
  at(scopeEye, BRICK_H * 1.35, 0, -0.22);
  head.add(scopeEye);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, barrelY, 0.95);
  head.add(muzzle);

  return {
    root,
    head,
    muzzle,
    headY: head.position.y,
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
  const breech = mesh(brick(4, 3, false), LEGO.darkBluishGray);
  at(breech, BRICK_H * 0.3);
  head.add(breech);

  // Three short tubes in a fan: the cluster silhouette. Offsets are world
  // units (a tile is 1.0), so the barrels sit side by side, not tiles apart.
  const tubes: THREE.Object3D[] = [];
  for (let i = 0; i < 3; i++) {
    const pivot = new THREE.Group();
    pivot.position.set((i - 1) * 0.22, BRICK_H * 0.7, 0.08);
    pivot.rotation.set(-0.45, (i - 1) * 0.16, 0);
    const tube = mesh(cylinderZ(0.8, 3.2), i === 1 ? LEGO.white : spec.accent);
    at(tube, 0, 0, 0.2);
    pivot.add(tube);
    const tip = mesh(ring(0.95, 0.28), LEGO.darkBluishGray);
    tip.rotation.x = Math.PI / 2;
    at(tip, 0, 0, 0.4);
    pivot.add(tip);
    head.add(pivot);
    tubes.push(pivot);
    pulse.push(tip);
  }
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

/** ACID RAIN: a bubbling vat that lobs globs of burning goop. */
function buildAcid(tier: number): TowerModel {
  const spec = TOWERS.acid;
  const root = new THREE.Group();
  const pulse: THREE.Object3D[] = [];
  const pad = buildPad(spec, tier);
  root.add(pad);

  let y = PLATE_H;
  for (let i = 0; i < (tier === 1 ? 1 : 2); i++) {
    const col = mesh(brick(6, 6, false), i === 0 ? GREY : LEGO.darkGreen);
    at(col, y);
    col.receiveShadow = true;
    root.add(col);
    y += BRICK_H;
  }

  const vat = mesh(post(2.4, 2.2), LEGO.brightGreen, { opacity: 0.82, transparent: true });
  at(vat, y);
  root.add(vat);

  const band = mesh(ring(2.7, 0.4), LEGO.darkGreen);
  at(band, y + BRICK_H);
  band.rotation.x = Math.PI / 2;
  root.add(band);

  const lid = mesh(roundBrick(4.6, BRICK_H), LEGO.flatGray);
  at(lid, y + BRICK_H * 2.2);
  root.add(lid);

  const pivot = new THREE.Group();
  pivot.position.y = y + BRICK_H * 2.6;
  root.add(pivot);

  const head = new THREE.Group();
  head.position.y = BRICK_H * 0.4;
  head.rotation.x = -0.6;
  pivot.add(head);

  const tube = mesh(cylinderZ(1.3, 4), DARK);
  at(tube, 0, 0, 0.35);
  head.add(tube);

  const mouth = mesh(ring(1.6, 0.4), LEGO.brightGreen);
  mouth.rotation.x = Math.PI / 2;
  at(mouth, 0, 0, 0.62);
  head.add(mouth);
  pulse.push(mouth);

  const glob = mesh(sphere(1.5), LEGO.brightGreen, {
    opacity: 0.6,
    transparent: true,
    emissive: LEGO.brightGreen,
  });
  at(glob, 0, 0, 0.72);
  head.add(glob);
  pulse.push(glob);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, 0.82);
  head.add(muzzle);

  return { root, head: pivot, muzzle, headY: y + BRICK_H * 2.6, pulse };
}

/** RAIL GUN: a long charged barrel that skewers a whole line of enemies. */
function buildRail(tier: number): TowerModel {
  const spec = TOWERS.rail;
  const root = new THREE.Group();
  const pulse: THREE.Object3D[] = [];
  const pad = buildPad(spec, tier);
  root.add(pad);

  let y = PLATE_H;
  for (let i = 0; i < tier + 1; i++) {
    const col = mesh(brick(3, 3, false), i % 2 ? LEGO.black : DARK);
    at(col, y);
    col.receiveShadow = true;
    root.add(col);
    y += BRICK_H;
  }

  const head = new THREE.Group();
  head.position.y = y;

  const breech = mesh(brick(4, 3, false), spec.accent);
  at(breech, BRICK_H * 0.3);
  head.add(breech);

  const spine = mesh(brick(2, 7, false), LEGO.black);
  at(spine, BRICK_H * 0.5, 0, 0.45);
  head.add(spine);

  for (const side of [-1, 1]) {
    const railBar = mesh(brick(1, 8, false), spec.accent);
    railBar.position.set(side * 0.16, BRICK_H * 0.62, 0.5);
    head.add(railBar);
  }

  const glow = mesh(sphere(1.4), LEGO.brightYellow, { emissive: LEGO.yellow });
  at(glow, BRICK_H * 0.5, 0, -0.05);
  head.add(glow);
  pulse.push(glow);

  const muzzleRing = mesh(ring(1.4, 0.4), LEGO.darkBluishGray);
  muzzleRing.rotation.x = Math.PI / 2;
  muzzleRing.position.set(0, BRICK_H * 0.6, 0.95);
  head.add(muzzleRing);
  pulse.push(muzzleRing);

  if (tier >= 3) {
    const crest = mesh(brick(6, 2, false), LEGO.yellow);
    at(crest, BRICK_H * 1.1, 0, -0.05);
    head.add(crest);
  }

  root.add(head);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, BRICK_H * 0.6, 1.02);
  head.add(muzzle);

  return { root, head, muzzle, headY: y, pulse };
}

/** BUCKSHOT: a squat salvo gun that empties a fan of rounds at close range. */
function buildBuckshot(tier: number): TowerModel {
  const spec = TOWERS.buckshot;
  const root = new THREE.Group();
  const pulse: THREE.Object3D[] = [];
  const pad = buildPad(spec, tier);
  root.add(pad);

  let y = PLATE_H;
  const col = mesh(roundBrick(5, BRICK_H), GREY);
  at(col, y);
  col.receiveShadow = true;
  root.add(col);
  y += BRICK_H;

  const head = new THREE.Group();
  head.position.y = y;

  const housing = mesh(brick(5, 4, false), spec.accent);
  at(housing, BRICK_H * 0.4);
  head.add(housing);

  const barrels = tier >= 3 ? 4 : 3;
  const barrelY = BRICK_H * 0.7;
  for (let i = 0; i < barrels; i++) {
    const off = (i - (barrels - 1) / 2) * 0.2;
    const tube = mesh(cylinderZ(0.7, 3.5), i % 2 ? LEGO.flatGray : LEGO.black);
    at(tube, barrelY, off, 0.45);
    head.add(tube);
  }

  const mouth = mesh(ring(1.9, 0.4), LEGO.black);
  mouth.rotation.x = Math.PI / 2;
  mouth.position.set(0, barrelY, 0.68);
  head.add(mouth);
  pulse.push(mouth);

  const stock = mesh(brick(3, 3, false), LEGO.redBrown);
  at(stock, BRICK_H * 0.4, 0, -0.35);
  head.add(stock);

  root.add(head);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, barrelY, 0.78);
  head.add(muzzle);

  return { root, head, muzzle, headY: y, pulse };
}

/** DEEP FREEZE: a crystal spire that locks a single target in place. */
function buildGlacier(tier: number): TowerModel {
  const spec = TOWERS.glacier;
  const root = new THREE.Group();
  const pulse: THREE.Object3D[] = [];
  const pad = buildPad(spec, tier);
  root.add(pad);

  let y = PLATE_H;
  for (let i = 0; i < (tier === 1 ? 1 : 2); i++) {
    const col = mesh(brick(5, 5, false), i === 0 ? GREY : LEGO.white);
    at(col, y);
    col.receiveShadow = true;
    root.add(col);
    y += BRICK_H;
  }

  const head = new THREE.Group();
  head.position.y = y;

  const base = mesh(roundBrick(4, BRICK_H * 1.2), LEGO.transIce, { opacity: 0.8, transparent: true });
  at(base, BRICK_H * 0.3);
  head.add(base);

  const spireH = 2.4 + tier * 0.6;
  const spire = mesh(cone(2.2, spireH), LEGO.transIce, {
    opacity: 0.72,
    transparent: true,
    emissive: LEGO.sandBlue,
  });
  at(spire, BRICK_H * 1.2);
  head.add(spire);

  const core = mesh(sphere(1.6), LEGO.transIce, {
    opacity: 0.7,
    transparent: true,
    emissive: LEGO.sandBlue,
  });
  at(core, BRICK_H * 1.2 + 0.14);
  head.add(core);
  pulse.push(core);

  const lens = mesh(ring(1.5, 0.45), LEGO.transLightBlue);
  at(lens, BRICK_H * 1.4, 0, 0.6);
  lens.rotation.x = Math.PI / 2;
  head.add(lens);
  pulse.push(lens);

  root.add(head);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, BRICK_H * 1.4, 0.8);
  head.add(muzzle);

  return { root, head, muzzle, headY: y, pulse };
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
  acid: buildAcid,
  rail: buildRail,
  buckshot: buildBuckshot,
  glacier: buildGlacier,
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
  acid: 2.7,
  rail: 2.7,
  buckshot: 2.1,
  glacier: 3.0,
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
