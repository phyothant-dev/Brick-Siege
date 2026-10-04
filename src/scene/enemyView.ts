import * as THREE from 'three';
import { LEGO, PLATE_H } from '../core/constants';
import { ENEMIES } from '../core/enemies';
import type { EnemyId, EnemySpec } from '../core/types';
import { brick, brickGeometry, cone, dome, limbGeometry, plate, post, roundBrick, sphere } from './builder';
import { plastic, translucent } from './materials';

const HEAD_Y = 0.56;
const BAR_W = 0.5;
const BAR_H = 0.075;

function part(
  geo: THREE.BufferGeometry,
  color: number,
  opts: { transparent?: boolean; opacity?: number; emissive?: number; glow?: number } = {},
): THREE.Mesh {
  const mat = opts.transparent
    ? translucent(color, opts.opacity ?? 0.55)
    : plastic(color, { emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.glow ?? 1 });
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

function eyes(parent: THREE.Object3D, y: number, spread: number, color: number, glow = 0): void {
  for (const side of [-1, 1]) {
    const e = part(sphere(0.7), color, glow ? { emissive: color, glow } : {});
    e.position.set(side * spread, y, 0.16);
    e.scale.set(1, 1.25, 0.6);
    e.castShadow = false;
    parent.add(e);
  }
}

// ------------------------------------------------------------------ templates

function buildSlime(spec: EnemySpec): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';

  const shell = part(dome(4), spec.color, { transparent: true, opacity: 0.72 });
  shell.scale.set(1, 0.86, 1);
  body.add(shell);

  const inner = part(sphere(2.6), spec.accent, { transparent: true, opacity: 0.55 });
  inner.position.y = 0.02;
  body.add(inner);

  const cap = part(roundBrick(1.6, PLATE_H), spec.accent, { transparent: true, opacity: 0.6 });
  cap.position.y = 0.34;
  body.add(cap);

  eyes(body, 0.16, 0.11, LEGO.white);
  for (const side of [-1, 1]) {
    const pupil = part(sphere(0.45), LEGO.black);
    pupil.position.set(side * 0.11, 0.16, 0.22);
    pupil.scale.set(1, 1.2, 0.6);
    pupil.castShadow = false;
    body.add(pupil);
  }

  g.add(body);
  return g;
}

function buildSkeleton(spec: EnemySpec): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';

  const legs = new THREE.Group();
  for (const side of [-1, 1]) {
    const leg = part(limbGeometry(0.28, 0.1), spec.color);
    leg.name = side < 0 ? 'legL' : 'legR';
    leg.position.set(side * 0.11, 0.32, 0);
    legs.add(leg);
  }
  g.add(legs);

  const pelvis = part(brick(3, 2, false), spec.color);
  pelvis.position.y = 0.3;
  body.add(pelvis);

  const torso = part(brickGeometry(3, 2, 0.28), spec.color);
  torso.position.y = 0.32;
  body.add(torso);

  for (let i = 0; i < 3; i++) {
    const rib = part(plate(4, 1), spec.accent);
    rib.position.set(0, 0.4 + i * 0.07, 0.13);
    rib.scale.set(1, 1.6, 1);
    body.add(rib);
  }

  for (const side of [-1, 1]) {
    const arm = part(limbGeometry(0.26, 0.08), spec.color);
    arm.name = side < 0 ? 'armL' : 'armR';
    arm.position.set(side * 0.2, 0.56, 0);
    arm.rotation.z = side * 0.2;
    body.add(arm);
  }

  const neck = part(post(0.7, 0.5), spec.color);
  neck.position.y = 0.6;
  body.add(neck);

  const head = part(roundBrick(3.2, 0.19), spec.color);
  head.position.y = HEAD_Y;
  head.name = 'head';
  body.add(head);

  eyes(head, 0.1, 0.075, LEGO.black);
  const jaw = part(brick(2, 2, false), spec.accent);
  jaw.position.set(0, 0.02, 0.11);
  head.add(jaw);

  g.add(body);
  return g;
}

function buildZombie(spec: EnemySpec): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';

  for (const side of [-1, 1]) {
    const leg = part(limbGeometry(0.26, 0.13), spec.accent);
    leg.name = side < 0 ? 'legL' : 'legR';
    leg.position.set(side * 0.12, 0.3, 0);
    g.add(leg);
  }

  const torso = part(brickGeometry(4, 3, 0.32), spec.color);
  torso.position.y = 0.3;
  body.add(torso);

  const belly = part(brick(3, 2, false), spec.accent);
  belly.position.set(0, 0.32, 0.14);
  body.add(belly);

  const neck = part(post(0.8, 0.4), spec.color);
  neck.position.y = 0.62;
  body.add(neck);

  const head = part(brickGeometry(4, 3, 0.22), spec.color);
  head.position.y = HEAD_Y + 0.02;
  head.name = 'head';
  body.add(head);

  for (const side of [-1, 1]) {
    const eye = part(sphere(0.55), LEGO.brightRed, { emissive: LEGO.red, glow: 1.2 });
    eye.position.set(side * 0.09, HEAD_Y + 0.12, 0.17);
    eye.scale.set(1, 1.1, 0.6);
    eye.castShadow = false;
    body.add(eye);
  }

  // Arms held out in front, zombie style.
  for (const side of [-1, 1]) {
    const arm = part(limbGeometry(0.3, 0.11), spec.color);
    arm.name = side < 0 ? 'armL' : 'armR';
    arm.position.set(side * 0.24, 0.56, 0.06);
    arm.rotation.x = -1.15;
    arm.rotation.z = side * 0.25;
    body.add(arm);
  }

  const hat = part(plate(3, 3), spec.accent);
  hat.position.y = HEAD_Y + 0.24;
  hat.rotation.z = 0.3;
  body.add(hat);

  g.add(body);
  return g;
}

function buildGhost(spec: EnemySpec): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';

  const shell = part(sphere(4), spec.color, { transparent: true, opacity: 0.42 });
  shell.scale.set(1, 1.12, 0.86);
  shell.position.y = 0.42;
  body.add(shell);

  const tail = part(cone(3.4, 3.4), spec.color, { transparent: true, opacity: 0.34 });
  tail.position.y = 0.14;
  tail.rotation.x = Math.PI;
  body.add(tail);

  for (let i = 0; i < 3; i++) {
    const wisp = part(cone(0.9, 1.6), spec.accent, { transparent: true, opacity: 0.4 });
    wisp.name = `wisp${i}`;
    wisp.position.set((i - 1) * 0.16, -0.1, 0);
    wisp.rotation.x = Math.PI;
    body.add(wisp);
  }

  eyes(body, 0.5, 0.13, LEGO.black);
  const mouth = part(brickGeometry(2, 1, 0.12), LEGO.black, { transparent: true, opacity: 0.8 });
  mouth.position.set(0, 0.34, 0.2);
  body.add(mouth);

  g.add(body);
  return g;
}

function buildDemon(spec: EnemySpec): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';

  for (const side of [-1, 1]) {
    const leg = part(limbGeometry(0.3, 0.16), spec.accent);
    leg.name = side < 0 ? 'legL' : 'legR';
    leg.position.set(side * 0.15, 0.34, 0);
    g.add(leg);
  }

  const torso = part(brickGeometry(5, 4, 0.38), spec.color);
  torso.position.y = 0.34;
  body.add(torso);

  const chest = part(brick(3, 2, false), spec.accent);
  chest.position.set(0, 0.38, 0.2);
  body.add(chest);

  const neck = part(post(1, 0.4), spec.color);
  neck.position.y = 0.72;
  body.add(neck);

  const head = part(brickGeometry(4, 4, 0.26), spec.color);
  head.position.y = HEAD_Y + 0.14;
  head.name = 'head';
  body.add(head);

  eyes(head, 0.12, 0.1, LEGO.brightYellow, 1.4);

  for (const side of [-1, 1]) {
    const horn = part(cone(0.9, 2.4), spec.accent);
    horn.position.set(side * 0.15, 0.3, 0);
    horn.rotation.z = side * -0.5;
    head.add(horn);
  }

  // Bat wings on the back.
  for (const side of [-1, 1]) {
    const wing = new THREE.Group();
    wing.name = side < 0 ? 'wingL' : 'wingR';
    const membrane = part(plate(1, 7), spec.accent, { transparent: true, opacity: 0.85 });
    membrane.position.set(0, 0, -0.3);
    membrane.rotation.set(Math.PI / 2, 0, 0);
    membrane.scale.set(1, 1, 0.9);
    wing.add(membrane);
    for (let i = 0; i < 3; i++) {
      const rib = part(limbGeometry(0.22, 0.04), spec.accent);
      rib.position.set(0, 0, -0.28 - i * 0.05);
      rib.rotation.set(1.2, 0, 0);
      wing.add(rib);
    }
    wing.position.set(side * 0.28, 0.58, 0);
    body.add(wing);
  }

  for (const side of [-1, 1]) {
    const arm = part(limbGeometry(0.34, 0.14), spec.color);
    arm.name = side < 0 ? 'armL' : 'armR';
    arm.position.set(side * 0.3, 0.66, 0.05);
    arm.rotation.x = -0.6;
    arm.rotation.z = side * 0.4;
    body.add(arm);
  }

  const tail = part(limbGeometry(0.3, 0.07), spec.accent);
  tail.position.set(0, 0.4, -0.24);
  tail.rotation.x = 0.9;
  body.add(tail);

  g.add(body);
  return g;
}

function buildOverlord(spec: EnemySpec): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';

  for (const side of [-1, 1]) {
    const leg = part(limbGeometry(0.34, 0.19), LEGO.black);
    leg.name = side < 0 ? 'legL' : 'legR';
    leg.position.set(side * 0.18, 0.38, 0);
    g.add(leg);
  }

  const torso = part(brickGeometry(6, 4, 0.46), spec.color);
  torso.position.y = 0.38;
  body.add(torso);

  const core = part(sphere(1.6), LEGO.brightYellow, { emissive: LEGO.yellow, glow: 1.6 });
  core.position.set(0, 0.5, 0.22);
  body.add(core);

  const neck = part(post(1.2, 0.4), LEGO.black);
  neck.position.y = 0.84;
  body.add(neck);

  const head = part(brickGeometry(4, 4, 0.3), LEGO.black);
  head.position.y = HEAD_Y + 0.2;
  head.name = 'head';
  body.add(head);

  eyes(head, 0.14, 0.12, spec.color, 1.8);

  const crown = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const spike = part(cone(0.8, 2.2), LEGO.yellow);
    spike.position.set((i - 2) * 0.1, 0.32, (i % 2) * 0.12 - 0.06);
    crown.add(spike);
  }
  head.add(crown);

  for (const side of [-1, 1]) {
    const arm = part(limbGeometry(0.42, 0.17), spec.color);
    arm.name = side < 0 ? 'armL' : 'armR';
    arm.position.set(side * 0.36, 0.78, 0.06);
    arm.rotation.x = -0.5;
    arm.rotation.z = side * 0.45;
    body.add(arm);
  }

  const cape = part(plate(1, 10), LEGO.red, { transparent: true, opacity: 0.8 });
  cape.position.set(0, 0.42, -0.32);
  cape.rotation.set(Math.PI / 2, 0, 0);
  cape.scale.set(1.4, 1.1, 1);
  body.add(cape);

  g.add(body);
  return g;
}

/**
 * Tower attackers. Each carries a visible weapon so the player can read what
 * is shooting at them from across the board.
 */
function buildArcher(spec: EnemySpec): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';

  const legs = part(brick(6, 4, false), 0x3c4a38);
  legs.position.y = 0.3;
  body.add(legs);

  const torso = part(brick(7, 6, false), spec.color);
  torso.position.y = 0.78;
  torso.name = 'torso';
  body.add(torso);

  const head = part(brick(5, 4, false), 0xe8c39a);
  head.position.y = 1.24;
  head.name = 'head';
  body.add(head);
  eyes(head, 0.02, 0.1, 0x1a1a1a);

  // Hood.
  const hood = part(cone(3.2, 3.4), spec.color);
  hood.position.set(0, 1.55, -0.12);
  body.add(hood);

  // Bow: a torus arc plus a string, held forward.
  const bow = new THREE.Group();
  bow.name = 'weapon';
  const limb = part(new THREE.TorusGeometry(0.52, 0.07, 6, 14, Math.PI * 1.1), spec.accent);
  limb.rotation.z = Math.PI * 0.95;
  bow.add(limb);
  const stringGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0.05, -0.5, 0),
    new THREE.Vector3(0.05, 0, 0.24),
    new THREE.Vector3(0.05, 0.5, 0),
  ]);
  bow.add(new THREE.Line(stringGeo, new THREE.LineBasicMaterial({ color: 0xf2f2f2 })));
  bow.position.set(0.42, 0.86, 0.3);
  body.add(bow);

  // Quiver on the back.
  const quiver = part(post(1.1, 1.6), 0x6b4a2a);
  quiver.position.set(-0.28, 1.0, -0.28);
  quiver.rotation.z = 0.3;
  body.add(quiver);

  g.add(body);
  return g;
}

function buildGunner(spec: EnemySpec): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';

  const legs = part(brick(6, 4, false), 0x2b333d);
  legs.position.y = 0.3;
  body.add(legs);

  const torso = part(brick(8, 6, false), spec.color);
  torso.position.y = 0.8;
  torso.name = 'torso';
  body.add(torso);

  const head = part(roundBrick(3, 0.9), 0xd9b58c);
  head.position.y = 1.28;
  head.name = 'head';
  body.add(head);
  eyes(head, 0.1, 0.11, 0x1a1a1a);

  const helmet = part(dome(3.1), spec.accent);
  helmet.position.y = 1.42;
  body.add(helmet);

  // Rifle held across the body.
  const weapon = new THREE.Group();
  weapon.name = 'weapon';
  const barrel = part(post(0.9, 2.6), 0x22262b);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0, 0.5);
  weapon.add(barrel);
  const stock = part(brick(4, 2, false), 0x5a4028);
  stock.position.set(0, -0.06, -0.35);
  weapon.add(stock);
  weapon.position.set(0.34, 0.86, 0.3);
  body.add(weapon);

  const ammoBandolier = part(plate(9, 4), spec.accent);
  ammoBandolier.position.set(0, 0.9, 0.02);
  ammoBandolier.rotation.set(Math.PI / 2, 0, 0.5);
  body.add(ammoBandolier);

  g.add(body);
  return g;
}

function buildLauncher(spec: EnemySpec): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';

  const tracks = part(brick(12, 3, false), 0x2f2b25);
  tracks.position.y = 0.24;
  body.add(tracks);

  const hull = part(brick(10, 5, false), spec.color);
  hull.position.y = 0.72;
  hull.name = 'torso';
  body.add(hull);

  const cab = part(brick(5, 4, false), 0x5d564a);
  cab.position.set(-0.2, 1.14, 0);
  cab.name = 'head';
  body.add(cab);
  eyes(cab, 0.1, 0.12, 0xffb300, 1.2);

  // Tube launcher, angled up.
  const weapon = new THREE.Group();
  weapon.name = 'weapon';
  const tube = part(post(1.5, 3.4), 0x3d4a2f);
  tube.rotation.x = Math.PI / 2.35;
  tube.position.set(0, 0, 0.7);
  weapon.add(tube);
  const muzzle = part(cone(1.5, 1.1), 0x22262b);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0, 0.62, 1.5);
  weapon.add(muzzle);
  weapon.position.set(0.1, 1.02, 0.3);
  body.add(weapon);

  const warhead = part(cone(1.1, 1.6), spec.accent);
  warhead.rotation.z = Math.PI;
  warhead.position.set(-0.36, 1.0, -0.2);
  body.add(warhead);

  g.add(body);
  return g;
}

const TEMPLATES: Record<EnemyId, (spec: EnemySpec) => THREE.Group> = {
  slime: buildSlime,
  skeleton: buildSkeleton,
  zombie: buildZombie,
  ghost: buildGhost,
  demon: buildDemon,
  overlord: buildOverlord,
  archer: buildArcher,
  gunner: buildGunner,
  launcher: buildLauncher,
};

const templates = new Map<EnemyId, THREE.Group>();

function template(type: EnemyId): THREE.Group {
  let t = templates.get(type);
  if (!t) {
    t = TEMPLATES[type](ENEMIES[type]);
    templates.set(type, t);
  }
  return t;
}

// ----------------------------------------------------------------------- view

const barGeo = new THREE.PlaneGeometry(1, 1);
const flashGeo = new THREE.SphereGeometry(1, 12, 8);

export class EnemyView {
  readonly root = new THREE.Group();
  readonly type: EnemyId;
  readonly spec: EnemySpec;

  private model: THREE.Group;
  private body: THREE.Object3D;
  private legs: THREE.Object3D[] = [];
  private arms: THREE.Object3D[] = [];
  private wings: THREE.Object3D[] = [];
  private wisps: THREE.Object3D[] = [];

  private barFill: THREE.Mesh;
  private barFrame: THREE.Group;
  private flash: THREE.Mesh;
  private aura: THREE.Mesh;

  private anim = Math.random() * 10;
  private baseY: number;

  constructor(type: EnemyId) {
    this.type = type;
    this.spec = ENEMIES[type];

    this.model = template(type).clone(true);
    this.body = this.model.getObjectByName('body') ?? this.model;
    this.legs = ['legL', 'legR']
      .map((n) => this.model.getObjectByName(n))
      .filter((o): o is THREE.Object3D => !!o);
    this.arms = ['armL', 'armR']
      .map((n) => this.model.getObjectByName(n))
      .filter((o): o is THREE.Object3D => !!o);
    this.wings = ['wingL', 'wingR']
      .map((n) => this.model.getObjectByName(n))
      .filter((o): o is THREE.Object3D => !!o);
    this.wisps = [0, 1, 2]
      .map((i) => this.model.getObjectByName(`wisp${i}`))
      .filter((o): o is THREE.Object3D => !!o);

    this.root.add(this.model);

    // Status aura: blue when chilled, green when poisoned.
    this.aura = new THREE.Mesh(
      flashGeo,
      new THREE.MeshBasicMaterial({
        color: LEGO.sandBlue,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.aura.visible = false;
    this.root.add(this.aura);

    // Hit flash shell.
    this.flash = new THREE.Mesh(
      flashGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.flash.visible = false;
    this.root.add(this.flash);

    // Floating health bar.
    this.barFrame = new THREE.Group();
    const frame = new THREE.Mesh(
      barGeo,
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.8,
        depthTest: false,
        depthWrite: false,
      }),
    );
    frame.scale.set(BAR_W + 0.05, BAR_H + 0.05, 1);
    frame.renderOrder = 11;
    this.barFrame.add(frame);

    this.barFill = new THREE.Mesh(
      barGeo,
      new THREE.MeshBasicMaterial({
        color: 0x4b9f4a,
        // Must be transparent too: opaque objects render before transparent ones
        // no matter what renderOrder says, which left the black frame on top.
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.barFill.scale.set(BAR_W, BAR_H, 1);
    this.barFill.position.z = 0.02;
    this.barFill.renderOrder = 12;
    this.barFrame.add(this.barFill);
    this.barFrame.renderOrder = 11;
    this.root.add(this.barFrame);

    const s = this.spec.scale;
    this.model.scale.setScalar(s);
    this.baseY = this.type === 'ghost' ? 0.24 * s : 0;

    const barY = (this.type === 'overlord' ? 1.5 : this.type === 'ghost' ? 1.15 : 1.05) * s;
    this.barFrame.position.y = barY;
    this.barFrame.scale.setScalar(Math.max(0.85, s));
    this.barFrame.visible = false;

    this.aura.scale.setScalar(0.45 * s);
    this.flash.scale.setScalar(0.42 * s);
  }

  /** Billboard + animate + reflect status. */
  update(
    dt: number,
    x: number,
    z: number,
    facing: number,
    hpRatio: number,
    slow: number,
    poisoned: boolean,
    hitFlash: number,
    cameraQuat: THREE.Quaternion,
  ): void {
    this.anim += dt;
    this.root.position.set(x, this.baseY, z);
    this.model.rotation.y = facing;

    const gait = this.spec.gait;
    const stride = Math.sin(this.anim * gait);

    switch (this.type) {
      case 'slime': {
        const squash = 1 + Math.sin(this.anim * 6) * 0.12;
        this.body.scale.set(1 / squash, squash, 1 / squash);
        this.body.rotation.z = stride * 0.09;
        break;
      }
      case 'ghost': {
        this.body.position.y = 0.12 + Math.sin(this.anim * 2.2) * 0.1;
        this.body.rotation.y = this.anim * 0.5;
        for (let i = 0; i < this.wisps.length; i++) {
          const w = this.wisps[i];
          w.position.y = -0.1 + Math.sin(this.anim * 3 + i * 2.1) * 0.08;
          w.rotation.z = Math.sin(this.anim * 3 + i) * 0.35;
        }
        break;
      }
      case 'demon':
      case 'overlord': {
        this.legs[0] && (this.legs[0].rotation.x = stride * 0.7);
        this.legs[1] && (this.legs[1].rotation.x = -stride * 0.7);
        this.body.rotation.z = Math.sin(this.anim * 2) * 0.05;
        this.body.position.y = Math.abs(stride) * 0.05;
        for (const w of this.wings) w.rotation.y = Math.sin(this.anim * 6) * 0.45;
        for (let i = 0; i < this.arms.length; i++) {
          this.arms[i].rotation.x = -0.6 + Math.sin(this.anim * 6 + i) * 0.25;
        }
        break;
      }
      case 'zombie': {
        this.legs[0] && (this.legs[0].rotation.x = stride * 0.45);
        this.legs[1] && (this.legs[1].rotation.x = -stride * 0.45);
        this.body.rotation.z = Math.sin(this.anim * 1.6) * 0.11;
        this.body.position.y = Math.abs(Math.sin(this.anim * gait)) * 0.03;
        for (let i = 0; i < this.arms.length; i++) {
          this.arms[i].rotation.x = -1.15 + Math.sin(this.anim * gait + i) * 0.14;
        }
        break;
      }
      default: {
        // Skeleton: quick scurry.
        this.legs[0] && (this.legs[0].rotation.x = stride * 0.85);
        this.legs[1] && (this.legs[1].rotation.x = -stride * 0.85);
        for (let i = 0; i < this.arms.length; i++) {
          this.arms[i].rotation.x = stride * 0.5 * (i === 0 ? 1 : -1);
        }
        this.body.position.y = Math.abs(stride) * 0.05;
        break;
      }
    }

    const s = this.spec.scale;
    if (slow > 0 || poisoned) {
      this.aura.visible = true;
      const auraMat = this.aura.material as THREE.MeshBasicMaterial;
      auraMat.color.setHex(poisoned ? 0x7bd66a : LEGO.sandBlue);
      auraMat.opacity = 0.16 + Math.sin(this.anim * 8) * 0.05;
      this.aura.scale.setScalar((0.45 + Math.sin(this.anim * 5) * 0.04) * s);
    } else {
      this.aura.visible = false;
    }

    if (hitFlash > 0) {
      this.flash.visible = true;
      (this.flash.material as THREE.MeshBasicMaterial).opacity = Math.min(0.85, hitFlash * 6);
      this.flash.scale.setScalar((0.42 + (1 - hitFlash) * 0.25) * s);
    } else {
      this.flash.visible = false;
    }

    // Always visible: the player needs to read remaining health at a glance.
    this.barFrame.visible = true;
    const w = Math.max(0.02, hpRatio);
    this.barFill.scale.set(BAR_W * w, BAR_H, 1);
    this.barFill.position.x = -(BAR_W * (1 - w)) / 2;
    const mat = this.barFill.material as THREE.MeshBasicMaterial;
    mat.color.setHex(hpRatio > 0.55 ? 0x4b9f4a : hpRatio > 0.25 ? 0xf2cd37 : 0xd0011b);

    this.barFrame.quaternion.copy(cameraQuat);
  }

  /** Horizontal radius used for hit tests and splash. */
  get radius(): number {
    return 0.3 * this.spec.scale;
  }

  dispose(): void {
    this.root.removeFromParent();
    (this.aura.material as THREE.Material).dispose();
    (this.flash.material as THREE.Material).dispose();
    (this.barFill.material as THREE.Material).dispose();
  }
}

