import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  BOARD,
  BRICK_H,
  FORTRESS_CENTER,
  GATE_FACING,
  LANES,
  GRID,
  HALF,
  LEGO,
  PALETTE,
  PITCH,
  PLATE_H,
  STUDS_PER_TILE,
  STUD_H,
  STUD_R,
  gxToWorld,
  gyToWorld,
  isPathCell,
} from '../core/constants';
import { laneCount, pathPoints } from '../core/path';
import { DEPLOY_ZONE } from '../core/sides';
import { brick, cone, plate, roundBrick, slopeBrick } from './builder';
import { THEMES } from './themes';
import type { BoardTheme } from './themes';
import { plastic } from './materials';

/** Half the width of the keep's curtain wall, in world units. */
const WALL_HALF = (16 * PITCH) / 2;

/** Long brick with a stud row, used for the baseplate kerb. */
function kerbGeometry(studs: number, thickness: number): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(studs * PITCH, BRICK_H, thickness);
  body.translate(0, BRICK_H / 2, 0);

  const studGeo = new THREE.CylinderGeometry(STUD_R, STUD_R * 0.9, STUD_H, 8);
  studGeo.translate(0, BRICK_H + STUD_H / 2, 0);

  const count = Math.max(2, Math.round(studs));
  const parts: THREE.BufferGeometry[] = [body];
  for (let i = 0; i < count; i++) {
    const s = studGeo.clone();
    s.translate((i - (count - 1) / 2) * PITCH, 0, 0);
    parts.push(s);
  }
  studGeo.dispose();

  const merged = mergeGeometries(parts, false) ?? body;
  if (merged !== body) parts.forEach((p) => p.dispose());
  return merged;
}

/**
 * The playfield: a giant LEGO baseplate, the enemy lane, the spawn gate, the
 * fortress you defend, and surrounding scenery. Everything is procedural.
 */
/** Free every geometry and material under a subtree we are about to drop. */
function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) mat.dispose();
  });
}

/**
 * One scattered prop: where it sits on the terrain and how it is posed.
 */
interface Scatter {
  x: number;
  z: number;
  scale: number;
  rot: number;
}

/**
 * Stamp many copies of a prop and collapse them into a single mesh per
 * material.
 *
 * Individually, a dense forest is several hundred little meshes and several
 * hundred draw calls, which is most of the frame budget for decoration that is
 * barely moving. Merged by material it collapses to two or three calls, so the
 * scenery can be as thick as the theme wants without costing framerate.
 */
function stampProp(make: () => THREE.Group, spots: Scatter[]): THREE.Group {
  const out = new THREE.Group();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const spot = new THREE.Matrix4();
  const rel = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);

  for (const s of spots) {
    const g = make();
    quat.setFromAxisAngle(up, s.rot);
    spot.compose(pos.set(s.x, -0.5, s.z), quat, scl.set(s.scale, s.scale, s.scale));
    g.updateMatrixWorld(true);
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!(mesh as THREE.Mesh).isMesh) return;
      const mat = mesh.material as THREE.Material;
      rel.copy(spot).multiply(mesh.matrixWorld);
      const geo = mesh.geometry.clone().applyMatrix4(rel);
      const bucket = byMat.get(mat);
      if (bucket) bucket.push(geo);
      else byMat.set(mat, [geo]);
    });
  }

  for (const [mat, parts] of byMat) {
    const merged = parts.length > 1 ? mergeGeometries(parts, false) : null;
    if (merged) {
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      out.add(m);
      parts.forEach((p) => p.dispose());
    } else {
      // Mixed attributes that cannot be merged: keep them separate rather than
      // lose the prop.
      for (const p of parts) {
        const m = new THREE.Mesh(p, mat);
        m.castShadow = true;
        m.receiveShadow = true;
        out.add(m);
      }
    }
  }
  return out;
}

/**
 * Deterministic PRNG. Scenery is rebuilt whenever the map or theme changes, so
 * the scatter has to come out identical every time or the landscape would
 * visibly reshuffle under the player.
 */
function makeRng(seed: number): () => number {
  let a = (Math.imul(seed | 0, 0x9e3779b1) ^ 0x85ebca6b) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Scattered prop positions, gathered into loose clumps.
 *
 * Spreading props evenly around an annulus reads as a set of concentric circles
 * from the play camera: the eye picks out the shared radius rather than the
 * individual trees, so a "dense" forest ends up looking like a ring. Woodland
 * actually grows in clumps with gaps between them, so this scatters a handful
 * of clump centres over the same area and fills each one out, thinning towards
 * its rim. Neighbouring clumps then merge into each other and the gaps read as
 * clearings instead of as rings.
 */
function scatterClumps(count: number, rInner: number, rOuter: number, seed = 0): Scatter[] {
  const rand = makeRng(seed + 101);
  // A clump may spill a little past its own band, but never onto the baseplate.
  const floor = rInner * 0.9;
  const clumps = Math.max(3, Math.round(Math.sqrt(count) * 0.9));
  const centres: { x: number; z: number; spread: number }[] = [];
  for (let i = 0; i < clumps; i++) {
    const a = rand() * Math.PI * 2;
    // Area-uniform radius (sqrt) so density stays even instead of crowding the rim.
    const r = Math.sqrt(rInner * rInner + rand() * (rOuter * rOuter - rInner * rInner));
    centres.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, spread: 1.2 + rand() * 2.2 });
  }
  const out: Scatter[] = [];
  for (let i = 0; i < count; i++) {
    const c = centres[i % clumps];
    const d = Math.sqrt(rand()) * c.spread;
    const a = rand() * Math.PI * 2;
    let x = c.x + Math.cos(a) * d;
    let z = c.z + Math.sin(a) * d;
    const r = Math.hypot(x, z) || 1;
    if (r < floor) {
      x = (x / r) * floor;
      z = (z / r) * floor;
    }
    out.push({ x, z, scale: 0.62 + rand() * 0.68, rot: rand() * Math.PI * 2 });
  }
  return out;
}

export class Board {
  readonly group = new THREE.Group();
  readonly highlight = new THREE.Group();
  readonly deployZone = new THREE.Group();
  private readonly deployArrowGroup = new THREE.Group();
  /** Emissive lava material, if the active theme has lava. */
  lavaMat: THREE.MeshStandardMaterial | null = null;
  /**
   * Which props the current theme actually built, one entry per stamped band.
   * Recorded because every element is procedurally merged into shared
   * BufferGeometry, so the finished scenery cannot be identified by geometry
   * type from the outside.
   */
  sceneryKinds: string[] = [];
  /** How many instances of each prop kind the current theme placed. */
  sceneryCounts: Record<string, number> = {};

  private banner!: THREE.Mesh;
  private gateGlows: THREE.MeshStandardMaterial[] = [];
  private fortressMat: THREE.MeshStandardMaterial;
  private hoverTileMat!: THREE.MeshStandardMaterial;
  private deployMat!: THREE.MeshBasicMaterial;
  private deployMarkers: THREE.Mesh[] = [];
  private deployArrows: THREE.Group[] = [];
  private deployArrowTips: THREE.Object3D[] = [];
  private deployArrowMat!: THREE.MeshBasicMaterial;
  private deployArrowHot = false;
  /** Remembered across rebuilds so switching map does not drop the arrows. */
  private deployArrowsVisible = false;
  private hoverStudMat!: THREE.MeshStandardMaterial;
  private lastHp = -1;

  /**
   * Parts that depend on the generated lane. Held so `rebuild()` can replace
   * them when the player switches map without recreating the whole scene.
   */
  private studField: THREE.InstancedMesh | null = null;
  private laneParts: THREE.Object3D[] = [];

  /** Terrain plane material, recoloured when the theme changes. */
  private groundMat!: THREE.MeshStandardMaterial;
  /** Distant terrain: two ridge rings plus a far backdrop, recoloured by theme. */
  private horizon!: THREE.Group;
  private horizonMat!: THREE.MeshBasicMaterial;
  private horizonAltMat!: THREE.MeshBasicMaterial;
  private horizonFar!: THREE.MeshBasicMaterial;
  /** Current background theme; the scenery group is rebuilt when it changes. */
  private theme: BoardTheme = THEMES.forest;
  private scenery: THREE.Group | null = null;

  constructor() {
    this.fortressMat = plastic(PALETTE.fortressWall);
    this.buildGround();
    this.buildStudField();
    this.buildFrame();
    this.buildGate();
    this.buildFortress();
    this.buildScenery(this.theme);
    this.buildHighlight();
    this.buildDeployZone();
    this.buildDeployArrows();
  }

  /**
   * Rebuild every lane-dependent part. Called when the player picks a new map
   * or re-rolls the lane.
   */
  rebuild(): void {
    for (const part of this.laneParts) {
      this.group.remove(part);
      disposeTree(part);
    }
    this.laneParts = [];

    if (this.studField) {
      this.group.remove(this.studField);
      this.studField.geometry.dispose();
      this.studField.dispose();
      this.studField = null;
    }

    this.buildStudField();
    this.buildGate();
    this.buildFortress();
    // The arrows mark the gates, so unlike the scenery they are lane-dependent
    // and have to be rebuilt whenever the map changes the lane layout.
    this.buildDeployArrows();
    this.lastHp = -1;
  }

  // ------------------------------------------------------------------ ground

  private buildGround(): void {
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160),
      plastic(PALETTE.ground, { roughness: 0.95 }),
    );
    this.groundMat = grass.material as THREE.MeshStandardMaterial;

    // Distant terrain, so the world does not end at the edge of the scatter.
    const horizon = new THREE.Group();
    const mkRidge = (dist: number, height: number, color: number, count: number, seed: number) => {
      const mat = new THREE.MeshBasicMaterial({ color, fog: true });
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + seed;
        const r = dist + ((i * 7) % 5) * 2.5;
        const h = height * (0.65 + ((i * 13) % 7) / 10);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(h * 1.9, h, 5), mat);
        cone.position.set(Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r);
        cone.rotation.y = i * 0.7;
        horizon.add(cone);
      }
      return mat;
    };
    this.horizonMat = mkRidge(46, 15, PALETTE.ground, 16, 0.4);
    this.horizonAltMat = mkRidge(66, 26, 0xd6dade, 13, 1.1);
    // Distant terrain is far outside the shadow camera, so keep it out of the
    // shadow pass entirely.
    horizon.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
        o.frustumCulled = true;
      }
    });

    // A far backdrop disc so the sky never meets the ground plane abruptly.
    const far = new THREE.Mesh(
      new THREE.CylinderGeometry(150, 150, 2, 48, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x8fc0f2, side: THREE.BackSide, fog: false }),
    );
    far.position.y = -1.6;
    horizon.add(far);
    this.horizonFar = far.material as THREE.MeshBasicMaterial;
    this.horizon = horizon;
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.62;
    grass.receiveShadow = true;
    this.group.add(grass);
    this.group.add(this.horizon);

    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD + 1.1, 0.26, BOARD + 1.1),
      plastic(LEGO.darkBluishGray, { roughness: 0.55 }),
    );
    rim.position.y = -0.57;
    rim.receiveShadow = true;
    this.group.add(rim);

    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD + 0.4, 0.62, BOARD + 0.4),
      plastic(PALETTE.baseplateAlt, { roughness: 0.45 }),
    );
    slab.position.y = -0.31;
    slab.receiveShadow = true;
    slab.castShadow = true;
    this.group.add(slab);
  }

  /**
   * One InstancedMesh carries every stud on the baseplate (GRID² of them).
   * Tinting the studs is what turns the lane into a dark road with no extra
   * draw calls.
   */
  private buildStudField(): void {
    const perSide = GRID * STUDS_PER_TILE;
    const count = perSide * perSide;

    const geo = new THREE.CylinderGeometry(STUD_R, STUD_R * 0.9, STUD_H, 10, 1, false);
    geo.translate(0, STUD_H / 2, 0);

    const mesh = new THREE.InstancedMesh(geo, plastic(0xffffff, { roughness: 0.32 }), count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'stud-field';

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const plateA = new THREE.Color(PALETTE.baseplate);
    const plateB = new THREE.Color(0xd6dade);
    const roadA = new THREE.Color(PALETTE.road);
    const roadB = new THREE.Color(0x83898e);
    const off = (STUDS_PER_TILE - 1) / 2;

    let i = 0;
    for (let gx = 0; gx < GRID; gx++) {
      for (let gy = 0; gy < GRID; gy++) {
        const wx = gxToWorld(gx);
        const wz = gyToWorld(gy);
        const onPath = isPathCell(gx, gy);
        if (onPath) color.copy((gx + gy) % 3 === 0 ? roadB : roadA);
        else color.copy((gx + gy) % 2 === 0 ? plateA : plateB);

        for (let sx = 0; sx < STUDS_PER_TILE; sx++) {
          for (let sy = 0; sy < STUDS_PER_TILE; sy++) {
            dummy.position.set(wx + (sx - off) * PITCH, 0, wz + (sy - off) * PITCH);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
            mesh.setColorAt(i, color);
            i++;
          }
        }
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
    this.studField = mesh;
  }

  /** A one-brick kerb framing the baseplate, with corner posts. */
  private buildFrame(): void {
    const frame = new THREE.Group();
    const span = BOARD + 0.25;
    const studs = GRID + 1;

    const makeRun = (color: number, rotY: number, px: number, pz: number) => {
      const mesh = new THREE.Mesh(kerbGeometry(studs, 0.55), plastic(color));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.rotation.y = rotY;
      mesh.position.set(px, 0, pz);
      return mesh;
    };

    frame.add(makeRun(PALETTE.roadEdge, 0, 0, -span / 2));
    frame.add(makeRun(PALETTE.roadEdge, 0, 0, span / 2));
    frame.add(makeRun(PALETTE.roadEdge, Math.PI / 2, -span / 2, 0));
    frame.add(makeRun(PALETTE.roadEdge, Math.PI / 2, span / 2, 0));

    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const px = sx * (span / 2);
      const pz = sz * (span / 2);

      const post = new THREE.Mesh(kerbGeometry(3, 3), plastic(sx * sz > 0 ? LEGO.red : LEGO.blue));
      post.castShadow = true;
      post.receiveShadow = true;
      post.position.set(px, 0, pz);
      frame.add(post);

      const cap = new THREE.Mesh(cone(3.4, 3), plastic(LEGO.yellow));
      cap.castShadow = true;
      cap.position.set(px, BRICK_H + PITCH * 1.5, pz);
      frame.add(cap);
    }

    this.group.add(frame);
  }

  // -------------------------------------------------------------------- gate

  /**
   * Spawn gate. Local +Z is the lane direction, so the mouth faces world +X
   * after a 90 degree yaw.
   */
  private buildGate(): void {
    this.gateGlows = [];
    // One gate per lane. Most maps have one; FOUR PATHS has four, one on each
    // side of the board.
    for (let lane = 0; lane < laneCount(); lane++) this.buildLaneGate(lane);
  }

  private buildLaneGate(lane: number): void {
    const pts = pathPoints(lane);
    const start = pts[0];
    const next = pts[1] ?? pts[0];

    // Direction of travel into the board, from the lane's own first segment.
    // The old code hardcoded a +X yaw, which only lined up by luck on maps
    // whose lane happened to start by heading east.
    const dx = next.x - start.x;
    const dz = next.z - start.z;
    const dLen = Math.hypot(dx, dz) || 1;
    const inX = dx / dLen;
    const inZ = dz / dLen;

    const gate = new THREE.Group();

    const wallMat = plastic(LEGO.redBrown);
    const trimMat = plastic(LEGO.darkBluishGray);
    const flank = 4.6 * PITCH;

    for (const side of [-1, 1]) {
      const tower = new THREE.Group();

      const shaft = new THREE.Mesh(brick(4, 4, false), wallMat);
      shaft.castShadow = true;
      shaft.receiveShadow = true;
      tower.add(shaft);

      const band = new THREE.Mesh(brick(4, 4, false), trimMat);
      band.castShadow = true;
      band.position.y = BRICK_H;
      tower.add(band);

      const shaft2 = new THREE.Mesh(brick(4, 4, false), wallMat);
      shaft2.castShadow = true;
      shaft2.receiveShadow = true;
      shaft2.position.y = BRICK_H * 2;
      tower.add(shaft2);

      const roof = new THREE.Mesh(cone(4.2, 4), plastic(LEGO.black));
      roof.castShadow = true;
      roof.position.y = BRICK_H * 3 + PITCH * 2;
      tower.add(roof);

      const flag = new THREE.Mesh(plate(3, 3), plastic(LEGO.brightRed));
      flag.castShadow = true;
      flag.position.y = BRICK_H * 3 + PITCH * 4.4;
      tower.add(flag);

      tower.position.set(side * flank, 0, 0);
      gate.add(tower);
    }

    const lintel = new THREE.Mesh(brick(9, 3, false), wallMat);
    lintel.castShadow = true;
    lintel.receiveShadow = true;
    lintel.position.y = BRICK_H * 3;
    gate.add(lintel);

    const sign = new THREE.Mesh(brick(7, 2, false), plastic(LEGO.brightYellow));
    sign.castShadow = true;
    sign.position.set(0, BRICK_H * 4, 0);
    gate.add(sign);

    const portal = new THREE.Mesh(
      new THREE.PlaneGeometry(flank * 2 - 0.3, BRICK_H * 3),
      plastic(0x1a0708, { emissive: LEGO.red, emissiveIntensity: 0.9, roughness: 0.7 }),
    );
    portal.position.set(0, BRICK_H * 1.5, -0.01);
    gate.add(portal);
    this.gateGlows.push(portal.material as THREE.MeshStandardMaterial);

    // Sit the gate just outside its spawn cell, facing down the lane.
    gate.position.set(start.x - inX * 0.72, 0, start.z - inZ * 0.72);
    gate.rotation.y = Math.atan2(inX, inZ);
    this.group.add(gate);
    this.laneParts.push(gate);
  }

  // --------------------------------------------------------------- fortress

  private buildFortress(): void {
    const f = new THREE.Group();
    const wall = this.fortressMat;
    const trim = plastic(PALETTE.fortressTrim);

    // Wider foundation course. A keep that starts with a plinth one brick
    // proud of the walls reads as seated on the baseplate rather than
    // hovering over it, and gives the castle a believable base.
    const plinth = new THREE.Mesh(brick(19, 19, false), plastic(PALETTE.baseplateAlt));
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    f.add(plinth);

    const plinthCap = new THREE.Mesh(brick(17, 17, false), trim);
    plinthCap.castShadow = true;
    plinthCap.receiveShadow = true;
    plinthCap.position.y = BRICK_H;
    f.add(plinthCap);

    // Everything above the two-course foundation, lifted clear of it.
    const upper = new THREE.Group();
    upper.position.y = BRICK_H * 2;
    f.add(upper);

    const curtain = new THREE.Mesh(brick(16, 16, false), wall);
    curtain.castShadow = true;
    curtain.receiveShadow = true;
    upper.add(curtain);

    const band = new THREE.Mesh(brick(16, 16, false), trim);
    band.castShadow = true;
    band.receiveShadow = true;
    band.position.y = BRICK_H;
    upper.add(band);

    // Crenellations around the top lip.
    const merlon = brick(2, 2, false);
    const s = 0.94;
    for (const sz of [-1, 1]) {
      for (let i = -1; i <= 1; i++) {
        const m = new THREE.Mesh(merlon, trim);
        m.castShadow = true;
        m.position.set(i * 0.6, BRICK_H * 2, sz * s);
        upper.add(m);
      }
    }
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        const m = new THREE.Mesh(merlon, trim);
        m.castShadow = true;
        m.position.set(sx * s, BRICK_H * 2, (i - 0.5) * 1.15);
        upper.add(m);
      }
    }

    // Corner keeps.
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const keep = new THREE.Group();

      const shaft = new THREE.Mesh(roundBrick(8, BRICK_H * 2), wall);
      shaft.castShadow = true;
      shaft.receiveShadow = true;
      keep.add(shaft);

      const hoop = new THREE.Mesh(roundBrick(8, BRICK_H * 0.5), trim);
      hoop.castShadow = true;
      hoop.position.y = BRICK_H * 1.5;
      keep.add(hoop);

      const roof = new THREE.Mesh(cone(4.6, 5), plastic(sx > 0 ? LEGO.red : LEGO.blue));
      roof.castShadow = true;
      roof.position.y = BRICK_H * 2 + PITCH * 2.5;
      keep.add(roof);

      const finial = new THREE.Mesh(roundBrick(2, BRICK_H), plastic(LEGO.yellow));
      finial.castShadow = true;
      finial.position.y = BRICK_H * 2 + PITCH * 5;
      keep.add(finial);

      keep.position.set(sx * 1.28, BRICK_H * 2, sz * 1.28);
      upper.add(keep);
    }

    // Gatehouse. Its local +Z is the outward face, so rotating it by the gate
    // direction points the arch at whichever side the lane actually arrives
    // from, rather than assuming it is always the south side.
    const gateHouse = new THREE.Group();
    gateHouse.name = 'gatehouse';

    const arch = new THREE.Mesh(brick(8, 3), plastic(LEGO.flatGray));
    arch.castShadow = true;
    arch.receiveShadow = true;
    gateHouse.add(arch);

    const archCap = new THREE.Mesh(brick(8, 3), trim);
    archCap.castShadow = true;
    archCap.position.y = BRICK_H;
    gateHouse.add(archCap);

    for (const side of [-1, 1]) {
      const slope = new THREE.Mesh(slopeBrick(3, 3), plastic(LEGO.flatGray));
      slope.castShadow = true;
      slope.position.set(side * 0.16, BRICK_H * 2, 0);
      slope.rotation.y = side > 0 ? Math.PI : 0;
      gateHouse.add(slope);
    }

    // Recessed dark opening, ringed by bright studs so it reads as a doorway
    // rather than a smudge at gameplay distance.
    const MOUTH_W = 0.46;
    const MOUTH_H = 0.42;
    const surround = new THREE.Mesh(
      new THREE.PlaneGeometry(MOUTH_W + 0.14, MOUTH_H + 0.14),
      plastic(LEGO.yellow, { emissive: LEGO.brightYellow, emissiveIntensity: 0.25 }),
    );
    surround.position.set(0, BRICK_H * 0.52, 0.199);
    gateHouse.add(surround);

    const mouth = new THREE.Mesh(
      new THREE.PlaneGeometry(MOUTH_W, MOUTH_H),
      plastic(0x0d0906, { emissive: LEGO.darkGreen, emissiveIntensity: 1.5, roughness: 0.85 }),
    );
    mouth.position.set(0, BRICK_H * 0.52, 0.203);
    gateHouse.add(mouth);

    for (let i = -1; i <= 1; i++) {
      const bar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.016, 0.016, MOUTH_H, 6),
        plastic(LEGO.black),
      );
      bar.position.set(i * 0.14, BRICK_H * 0.52, 0.209);
      gateHouse.add(bar);
    }
    const lintelBar = new THREE.Mesh(
      new THREE.BoxGeometry(MOUTH_W, 0.026, 0.026),
      plastic(LEGO.black),
    );
    lintelBar.position.set(0, BRICK_H * 0.52 + MOUTH_H / 2 - 0.03, 0.209);
    gateHouse.add(lintelBar);

    // Local +Z should point away from the keep, towards the incoming lane.
    gateHouse.rotation.y = Math.atan2(GATE_FACING.x, GATE_FACING.z);
    gateHouse.position.set(GATE_FACING.x * WALL_HALF, 0, GATE_FACING.z * WALL_HALF);
    upper.add(gateHouse);

    // A four-lane map is attacked from four sides, so give it an arch per face.
    for (const lane of LANES) {
      const { x, z } = lane.gateFacing;
      if (x === GATE_FACING.x && z === GATE_FACING.z) continue;
      const extra = gateHouse.clone(true);
      extra.position.set(x * WALL_HALF, 0, z * WALL_HALF);
      extra.rotation.y = Math.atan2(x, z);
      upper.add(extra);
    }

    // Banner on a pole.
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.013, 0.013, 0.46, 8),
      plastic(LEGO.flatGray),
    );
    pole.position.set(-0.6, BRICK_H * 2 + 0.23, -0.6);
    upper.add(pole);

    this.banner = new THREE.Mesh(plate(4, 3), plastic(LEGO.brightRed));
    this.banner.castShadow = true;
    this.banner.position.set(-0.45, BRICK_H * 2 + 0.34, -0.6);
    upper.add(this.banner);

    f.position.set(FORTRESS_CENTER.x, STUD_H, FORTRESS_CENTER.z);
    f.name = 'fortress';
    this.group.add(f);
    this.laneParts.push(f);
  }

  // ----------------------------------------------------------------- scenery

  /**
   * Restyle everything outside the baseplate. The baseplate, lane and fortress
   * are never touched, so a theme cannot change how a map plays.
   */
  setTheme(theme: BoardTheme): void {
    this.theme = theme;
    this.groundMat.color.setHex(theme.ground);
    this.horizonMat.color.setHex(theme.horizon);
    this.horizonAltMat.color.setHex(theme.horizonAlt);
    if (this.horizonFar) this.horizonFar.color.setHex(theme.sky);

    // Drop the previous scatter and rebuild it for the new theme.
    if (this.scenery) {
      this.group.remove(this.scenery);
      disposeTree(this.scenery);
      this.scenery = null;
    }
    this.buildScenery(theme);
  }

  private buildScenery(theme: BoardTheme): void {
    const decor = new THREE.Group();
    this.sceneryKinds.length = 0;
    this.sceneryCounts = {};
    // Lava belongs to the volcano theme only; without this the previous theme's
    // material stayed referenced after its volcano was disposed.
    this.lavaMat = null;
    const count = (kind: string, n: number): void => {
      this.sceneryCounts[kind] = (this.sceneryCounts[kind] ?? 0) + n;
    };
    /** Stamp a band of one prop kind and record that we did. */
    const bandOf = (kind: string, make: () => THREE.Group, spots: Scatter[]): void => {
      if (!spots.length) return;
      decor.add(stampProp(make, spots));
      this.sceneryKinds.push(kind);
      count(kind, spots.length);
    };
    const leaf = plastic(theme.foliage, { roughness: 0.62 });
    const leafDark = plastic(theme.foliageAlt, { roughness: 0.62 });
    const trunk = plastic(theme.wood, { roughness: 0.72 });

    const addShadows = (o: THREE.Object3D): void => {
      o.traverse((m) => {
        if ((m as THREE.Mesh).isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
    };

    /** Broadleaf tree: brick trunk with a stacked, blocky canopy. */
    const broadleaf = (): THREE.Group => {
      const t = new THREE.Group();
      const t1 = new THREE.Mesh(brick(2, 2, false), trunk);
      t1.position.y = BRICK_H / 2;
      t.add(t1);
      const t2 = new THREE.Mesh(brick(2, 2, false), trunk);
      t2.position.y = BRICK_H * 1.5;
      t.add(t2);
      const c1 = new THREE.Mesh(brick(6, 6, false), leaf);
      c1.position.y = BRICK_H * 2.5;
      t.add(c1);
      const c2 = new THREE.Mesh(brick(4, 4, false), leafDark);
      c2.position.y = BRICK_H * 3.5;
      t.add(c2);
      const c3 = new THREE.Mesh(cone(3.2, 2), leaf);
      c3.position.y = BRICK_H * 4.4;
      t.add(c3);
      return t;
    };

    /** Pine: bare trunk under three stacked cones. */
    const pine = (): THREE.Group => {
      const t = new THREE.Group();
      const tr = new THREE.Mesh(brick(2, 2, false), trunk);
      tr.position.y = BRICK_H / 2;
      t.add(tr);
      const tiers: [number, number, number][] = [
        [4.6, 0, BRICK_H * 1.2],
        [3.6, 1, BRICK_H * 2.4],
        [2.4, 2, BRICK_H * 3.6],
      ];
      for (const [r, i, y] of tiers) {
        const c = new THREE.Mesh(cone(r, 2), i % 2 ? leafDark : leaf);
        c.position.y = y;
        t.add(c);
      }
      return t;
    };

    /** Cactus: stacked round bricks with two arms. */
    const cactus = (): THREE.Group => {
      const t = new THREE.Group();
      const body = new THREE.Mesh(roundBrick(3, BRICK_H * 2), leaf);
      body.position.y = BRICK_H;
      t.add(body);
      const cap = new THREE.Mesh(roundBrick(3.4, BRICK_H * 0.5), leaf);
      cap.position.y = BRICK_H * 2.2;
      t.add(cap);
      for (const [y, out] of [
        [BRICK_H * 0.9, 1],
        [BRICK_H * 1.6, -1],
      ] as [number, number][]) {
        const arm = new THREE.Mesh(roundBrick(1.8, BRICK_H * 0.9), leaf);
        arm.position.set(out * 2.1 * PITCH, y, 0);
        t.add(arm);
        const elbow = new THREE.Mesh(roundBrick(1.8, BRICK_H * 0.7), leaf);
        elbow.position.set(out * 2.9 * PITCH, y + BRICK_H * 0.45, 0);
        t.add(elbow);
      }
      return t;
    };

    /** Burnt tree: bare, angular, no foliage. */
    const burnt = (): THREE.Group => {
      const t = new THREE.Group();
      const tr = new THREE.Mesh(brick(2, 2, false), trunk);
      tr.position.y = BRICK_H * 1.5;
      t.add(tr);
      for (const [rot, len, tilt] of [
        [0.7, 2.2, 0.5],
        [2.4, 1.9, -0.6],
        [4.1, 2.4, 0.4],
      ] as [number, number, number][]) {
        const limb = new THREE.Mesh(brick(1.4, 1.4, false), trunk);
        limb.position.set(
          Math.cos(rot) * 2.2 * PITCH,
          BRICK_H * (2.6 + len / 4),
          Math.sin(rot) * 2.2 * PITCH
        );
        limb.rotation.set(tilt, rot, 0);
        t.add(limb);
      }
      return t;
    };

    // ------------------------------------------------------------- landmarks
    // Hero set dressing. Built at a larger scale than the scatter so the theme
    // reads instantly, and kept off the playfield.

    /** Stepped pyramid: three shrinking plates with a capstone. */
    const pyramid = (): THREE.Group => {
      const g = new THREE.Group();
      const sand = plastic(theme.horizonAlt, { roughness: 0.86 });
      const sandLit = plastic(LEGO.tan, { roughness: 0.82 });
      const tiers: [number, number][] = [
        [10, 0],
        [7, 1],
        [4, 2],
        [2, 3],
      ];
      for (const [studs, i] of tiers) {
        const m = new THREE.Mesh(i % 2 ? plate(studs, studs) : brick(studs, studs, false), i % 2 ? sandLit : sand);
        m.position.y = i * PITCH * 0.62;
        g.add(m);
      }
      // Shaded face, so it does not read as a plain stack from every angle.
      const face = new THREE.Mesh(slopeBrick(10, 10), sand);
      face.position.set(0, PITCH * 0.3, PITCH * 2.6);
      g.add(face);
      return g;
    };

    /** Sphinx: low blocky body, headdress, and a squared muzzle. */
    const sphinx = (): THREE.Group => {
      const g = new THREE.Group();
      const stone = plastic(theme.horizonAlt, { roughness: 0.88 });
      const stoneLit = plastic(LEGO.tan, { roughness: 0.84 });
      const body = new THREE.Mesh(brick(7, 11, false), stone);
      body.position.y = PITCH * 0.35;
      g.add(body);
      const haunch = new THREE.Mesh(brick(5, 4, false), stone);
      haunch.position.set(0, PITCH * 0.95, -PITCH * 2.4);
      g.add(haunch);
      const chest = new THREE.Mesh(brick(4, 3, false), stoneLit);
      chest.position.set(0, PITCH * 0.9, PITCH * 2.6);
      g.add(chest);
      const head = new THREE.Mesh(brick(3, 3, false), stoneLit);
      head.position.y = PITCH * 1.5;
      head.position.z = PITCH * 2.9;
      g.add(head);
      // Nemes headdress: a wider block either side of the face.
      for (const side of [-1, 1]) {
        const flap = new THREE.Mesh(brick(1, 3, false), stone);
        flap.position.set(side * PITCH * 1.6, PITCH * 1.35, PITCH * 2.9);
        g.add(flap);
      }
      const muzzle = new THREE.Mesh(brick(2, 2, false), stoneLit);
      muzzle.position.set(0, PITCH * 1.35, PITCH * 4.2);
      g.add(muzzle);
      return g;
    };

    /** Iceberg: stacked angular white blocks with a pale blue waterline. */
    const iceberg = (): THREE.Group => {
      const g = new THREE.Group();
      const ice = plastic(LEGO.white, { roughness: 0.34, metalness: 0.05 });
      const iceBlue = plastic(LEGO.lightBluishGray, { roughness: 0.4 });
      const blocks: [number, number, number, number][] = [
        [8, 1.6, 0, 0],
        [6, 1.4, 0.6, 0.4],
        [4, 1.2, -0.4, 0.7],
        [2, 1.0, 0.2, 1.0],
      ];
      for (const [studs, h, dx, dz] of blocks) {
        const m = new THREE.Mesh(brick(studs, studs, false), studs % 4 === 0 ? iceBlue : ice);
        m.position.set(dx * PITCH, h * PITCH * 0.5 + (dz > 0 ? PITCH * 0.2 : 0), dz * PITCH);
        m.rotation.y = dz * 0.6;
        g.add(m);
      }
      return g;
    };

    /** Volcano: dark cone with a glowing crater and a lava spill. */
    const volcano = (): THREE.Group => {
      const g = new THREE.Group();
      const rock = plastic(theme.wood, { roughness: 0.95 });
      const dark = plastic(LEGO.black, { roughness: 0.9 });
      const lava = new THREE.MeshStandardMaterial({
        color: theme.glow ?? 0xff5a1f,
        emissive: new THREE.Color(theme.glow ?? 0xff5a1f),
        emissiveIntensity: 1.9,
        roughness: 0.42,
      });
      this.lavaMat = lava;

      const coneMesh = new THREE.Mesh(cone(7, 7), rock);
      coneMesh.position.y = PITCH * 3.5;
      g.add(coneMesh);
      // Skirt of cooled rock around the base.
      const skirt = new THREE.Mesh(cone(9, 1.6), dark);
      skirt.position.y = PITCH * 0.8;
      g.add(skirt);
      // Crater: a bright ring of lava at the tip.
      const crater = new THREE.Mesh(new THREE.TorusGeometry(PITCH * 1.5, PITCH * 0.42, 8, 18), lava);
      crater.rotation.x = Math.PI / 2;
      crater.position.y = PITCH * 6.5;
      g.add(crater);
      // Lava spill running down one flank.
      const spill = new THREE.Mesh(brick(2, 5, false), lava);
      spill.position.set(PITCH * 2.2, PITCH * 2.4, PITCH * 1.2);
      spill.rotation.set(0.32, 0.5, 0.16);
      g.add(spill);
      return g;
    };

    /** Mossy boulder, for the forest. */
    const boulder = (): THREE.Group => {
      const g = new THREE.Group();
      const stone = plastic(theme.wood, { roughness: 0.92 });
      const moss = plastic(theme.foliageAlt, { roughness: 0.8 });
      const a = new THREE.Mesh(slopeBrick(5, 4), stone);
      a.position.y = PITCH * 0.4;
      const b2 = new THREE.Mesh(brick(3, 3, false), stone);
      b2.position.set(PITCH * 0.8, PITCH * 0.35, PITCH * 0.6);
      b2.rotation.y = 0.6;
      const cap = new THREE.Mesh(plate(3, 3), moss);
      cap.position.set(0, PITCH * 0.85, 0);
      g.add(a, b2, cap);
      return g;
    };

    /** Cut tree stump with rings on top. */
    const stump = (): THREE.Group => {
      const g = new THREE.Group();
      const bark = plastic(theme.wood, { roughness: 0.88 });
      const rings = plastic(LEGO.tan, { roughness: 0.8 });
      const body = new THREE.Mesh(roundBrick(5, PITCH * 0.9), bark);
      body.position.y = PITCH * 0.45;
      const top = new THREE.Mesh(roundBrick(4.2, PITCH * 0.18), rings);
      top.position.y = PITCH * 0.98;
      g.add(body, top);
      return g;
    };

    // -------------------------------------------------------- extra dressing
    // Per-theme set pieces the scatter prop alone cannot carry.

    /** Palm: leaning trunk under a crown of angled fronds. */
    const palm = (): THREE.Group => {
      const g = new THREE.Group();
      const bark = plastic(theme.wood, { roughness: 0.8 });
      for (let i = 0; i < 5; i++) {
        const seg = new THREE.Mesh(roundBrick(1.5 - i * 0.12, BRICK_H * 1.5), bark);
        seg.position.set(i * PITCH * 0.16, i * BRICK_H * 1.5, 0);
        seg.rotation.z = -0.12;
        g.add(seg);
      }
      const top = new THREE.Vector3(4 * PITCH * 0.16, 5 * BRICK_H * 1.5, 0);
      const frond = plastic(theme.foliage, { roughness: 0.7 });
      for (let i = 0; i < 7; i++) {
        const f = new THREE.Mesh(brick(4, 2, false), frond);
        const a = (i / 7) * Math.PI * 2;
        f.position.set(top.x + Math.cos(a) * PITCH * 1.6, top.y + PITCH * 0.4, Math.sin(a) * PITCH * 1.6);
        f.rotation.set(0, -a, -0.5);
        g.add(f);
      }
      return g;
    };

    /** Obelisk: tall tapered stone with a pyramidion cap. */
    const obelisk = (): THREE.Group => {
      const g = new THREE.Group();
      const stone = plastic(theme.horizonAlt, { roughness: 0.9 });
      const cap = plastic(LEGO.tan, { roughness: 0.86 });
      for (let i = 0; i < 4; i++) {
        const m = new THREE.Mesh(brick(2 - i * 0.25, 2 - i * 0.25, false), i % 2 ? cap : stone);
        m.position.y = i * PITCH * 1.5;
        g.add(m);
      }
      const tip = new THREE.Mesh(cone(1, 1.4), cap);
      tip.position.y = 4 * PITCH * 1.5;
      g.add(tip);
      return g;
    };

    /** Igloo: stepped dome with a low entrance tunnel. */
    const igloo = (): THREE.Group => {
      const g = new THREE.Group();
      const snow = plastic(LEGO.white, { roughness: 0.58 });
      const shade = plastic(LEGO.lightBluishGray, { roughness: 0.5 });
      for (let i = 0; i < 3; i++) {
        const r = 5 - i * 1.5;
        const d = new THREE.Mesh(new THREE.SphereGeometry(r * PITCH, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), i % 2 ? shade : snow);
        d.position.y = i * PITCH * 0.9;
        d.scale.y = 0.62;
        g.add(d);
      }
      const tunnel = new THREE.Mesh(roundBrick(3, PITCH * 1.6), shade);
      tunnel.position.set(0, 0, 4 * PITCH);
      g.add(tunnel);
      const door = new THREE.Mesh(brick(2, 1, false), plastic(0x2b3a4a, { roughness: 0.7 }));
      door.position.set(0, 0, 5.2 * PITCH);
      g.add(door);
      return g;
    };

    /** Polar bear: blocky body, head, muzzle and four legs. */
    const polarBear = (): THREE.Group => {
      const g = new THREE.Group();
      const fur = plastic(LEGO.white, { roughness: 0.72 });
      const shade = plastic(LEGO.lightBluishGray, { roughness: 0.66 });
      const nose = plastic(0x2b2b30, { roughness: 0.5 });
      const body = new THREE.Mesh(brick(7, 4, false), fur);
      body.position.y = BRICK_H * 2.1;
      g.add(body);
      const rump = new THREE.Mesh(cone(2.2, 2), fur);
      rump.rotation.z = Math.PI / 2;
      rump.position.set(-3.6 * PITCH, BRICK_H * 2.4, 0);
      g.add(rump);
      const head = new THREE.Mesh(brick(3, 3, false), shade);
      head.position.set(4 * PITCH, BRICK_H * 3.1, 0);
      g.add(head);
      const muzzle = new THREE.Mesh(brick(2, 2, false), fur);
      muzzle.position.set(5.4 * PITCH, BRICK_H * 2.7, 0);
      g.add(muzzle);
      const snout = new THREE.Mesh(brick(1, 1, false), nose);
      snout.position.set(6.3 * PITCH, BRICK_H * 2.75, 0);
      g.add(snout);
      for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(roundBrick(1, BRICK_H * 0.5), fur);
        ear.position.set(3.4 * PITCH, BRICK_H * 4.1, side * 1.2 * PITCH);
        g.add(ear);
        const eye = new THREE.Mesh(brick(0.5, 0.5, false), nose);
        eye.position.set(5 * PITCH, BRICK_H * 3.5, side * 1.1 * PITCH);
        g.add(eye);
      }
      for (const dx of [2.2, -2.2]) {
        for (const dz of [1.4, -1.4]) {
          const leg = new THREE.Mesh(brick(1.6, 1.6, false), shade);
          leg.position.set(dx * PITCH, BRICK_H * 0.9, dz * PITCH);
          g.add(leg);
        }
      }
      return g;
    };

    /** Ice spire: a lean column of stacked shards. */
    const iceSpire = (): THREE.Group => {
      const g = new THREE.Group();
      const ice = plastic(LEGO.white, { roughness: 0.34 });
      const blue = plastic(LEGO.lightBluishGray, { roughness: 0.42 });
      let y = 0;
      for (let i = 0; i < 4; i++) {
        const w = 2.4 - i * 0.45;
        const h = PITCH * (1.4 - i * 0.15);
        const shard = new THREE.Mesh(i % 2 ? brick(w, w, false) : cone(w * 0.6, 1.2), i % 2 ? ice : blue);
        shard.position.set((i % 2 ? 1 : -1) * PITCH * 0.2, y, (i % 3 ? 1 : -1) * PITCH * 0.2);
        g.add(shard);
        y += h;
      }
      return g;
    };

    /** Obsidian: jagged black shards, the volcanic counterpart to ice. */
    const obsidian = (): THREE.Group => {
      const g = new THREE.Group();
      const black = plastic(LEGO.black, { roughness: 0.36 });
      const dark = plastic(0x1a1512, { roughness: 0.5 });
      for (let i = 0; i < 3; i++) {
        const shard = new THREE.Mesh(cone(1.1 - i * 0.22, 2.6 - i * 0.4), i % 2 ? dark : black);
        shard.position.set((i - 1) * PITCH * 0.9, (2.6 - i * 0.4) * PITCH * 0.5, (i % 2 ? 1 : -1) * PITCH * 0.5);
        shard.rotation.z = (i - 1) * 0.22;
        g.add(shard);
      }
      return g;
    };

    /** Fallen log with a couple of mossy knots. */
    const fallenLog = (): THREE.Group => {
      const g = new THREE.Group();
      const bark = plastic(theme.wood, { roughness: 0.9 });
      const moss = plastic(theme.foliageAlt, { roughness: 0.82 });
      const trunk = new THREE.Mesh(roundBrick(7, PITCH), bark);
      trunk.rotation.z = Math.PI / 2;
      trunk.position.y = PITCH * 0.5;
      g.add(trunk);
      for (const dx of [-1.6, 0.9]) {
        const knot = new THREE.Mesh(plate(2, 2), moss);
        knot.position.set(dx * PITCH, PITCH * 0.95, 0);
        g.add(knot);
      }
      return g;
    };

    /** Undergrowth clump: grass blades and a couple of mushrooms. */
    const undergrowth = (): THREE.Group => {
      const g = new THREE.Group();
      const blade = plastic(theme.foliage, { roughness: 0.8 });
      const cap = plastic(theme.scatter, { roughness: 0.7 });
      for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(cone(0.5, 1 + (i % 2) * 0.6), blade);
        b.position.set((i - 1.5) * 0.5 * PITCH, PITCH * 0.4, (i % 2) * PITCH * 0.4);
        b.rotation.z = (i - 1.5) * 0.24;
        g.add(b);
      }
      const shroom = new THREE.Mesh(cone(0.55, 0.7), cap);
      shroom.position.set(PITCH * 0.7, PITCH * 0.35, -PITCH * 0.3);
      g.add(shroom);
      return g;
    };

    const landmarkMakers: Record<string, () => THREE.Group> = {
      pyramid,
      sphinx,
      iceberg,
      volcano,
      boulder,
      stump,
    };

    const bush = (x: number, z: number, color: number): THREE.Mesh => {
      const b = new THREE.Mesh(brick(4, 4, false), plastic(color, { roughness: 0.72 }));
      b.position.set(x, -0.5, z);
      // Ground cover casts no shadow: at this camera distance the shadow is
      // invisible but costs a full extra draw call in the shadow pass.
      b.castShadow = false;
      b.receiveShadow = true;
      return b;
    };

    const rock = (x: number, z: number, color: number, i: number): THREE.Group => {
      const g = new THREE.Group();
      const a = new THREE.Mesh(slopeBrick(4, 3), plastic(color, { roughness: 0.9 }));
      a.position.y = 0.1;
      const b2 = new THREE.Mesh(brick(3, 2, false), plastic(color, { roughness: 0.9 }));
      b2.position.set(0.7, 0.05, 0.5);
      b2.rotation.y = 0.7 + i;
      g.add(a, b2);
      g.position.set(x, -0.5, z);
      g.rotation.y = i * 1.7;
      // Rocks only receive; they sit flat on the terrain.
      g.traverse((m) => {
        if ((m as THREE.Mesh).isMesh) m.receiveShadow = true;
      });
      return g;
    };

    const pile = new THREE.Group();
    const pileColors = [LEGO.red, LEGO.blue, LEGO.yellow, LEGO.green, LEGO.white];
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(
        i % 2 ? plate(4, 4) : brick(4, 4, false),
        plastic(pileColors[i], { roughness: 0.42 }),
      );
      b.position.set(((i % 3) - 1) * 0.4, i * PITCH * 0.4, ((i % 2) - 0.5) * 0.5);
      b.rotation.y = i * 0.6;
      pile.add(b);
    }
    addShadows(pile);

    // ------------------------------------------------------------- scatter
    // Dense themed bands around the baseplate. Everything is merged per
    // material, so the playfield sits inside a proper landscape rather than a
    // ring of nine props.
    const ring = HALF + 3.2;
    // Start right at the plate kerb and pack all the way out to the ridges, so
    // the landscape reads as continuous ground cover rather than props dotted
    // on an empty plain.
    // Far enough out that even the widest prop at max scale cannot reach over
    // the plate edge (a broadleaf canopy is ~1.3 units across).
    const NEAR = HALF + 1.4;
    const FAR = HALF + 27;

    // Each call scatters one prop type. Ranges deliberately overlap so the
    // types interleave instead of stacking into visible depth bands.
    const band = (count: number, r0: number, r1: number, seed: number): Scatter[] =>
      scatterClumps(count, r0, r1, seed);

    if (theme.terrain === 'grass') {
      // Forest: packed in three depth bands so the near ground is thick with
      // trees and the far ground still closes the horizon.
      bandOf('broadleaf', broadleaf, band(92, NEAR, HALF + 14, 0.4));
      bandOf('pine', pine, band(52, HALF + 7, HALF + 22, 1.9));
      bandOf('broadleaf', broadleaf, band(38, HALF + 13, FAR, 3.3));
      bandOf('fallenLog', fallenLog, band(12, NEAR + 1, HALF + 18, 2.2));
      bandOf('undergrowth', undergrowth, band(36, NEAR - 0.5, HALF + 21, 5.1));
    } else if (theme.terrain === 'sand') {
      bandOf('cactus', cactus, band(60, NEAR, HALF + 14, 0.7));
      bandOf('cactus', cactus, band(36, HALF + 9, FAR, 2.8));
      bandOf('palm', palm, band(18, NEAR + 0.8, HALF + 21, 1.3));
      bandOf('obelisk', obelisk, band(8, HALF + 5, HALF + 25, 4.6));
    } else if (theme.terrain === 'snow') {
      bandOf('pine', pine, band(68, NEAR, HALF + 14, 0.9));
      bandOf('pine', pine, band(40, HALF + 9, FAR, 3.7));
      bandOf('iceSpire', iceSpire, band(26, NEAR, HALF + 23, 2.4));
    } else {
      bandOf('burnt', burnt, band(62, NEAR, HALF + 14, 1.1));
      bandOf('burnt', burnt, band(38, HALF + 9, FAR, 4.2));
      bandOf('obsidian', obsidian, band(30, NEAR, HALF + 21, 2.9));
    }

    // Arctic gets its fauna where the player will actually see it.
    if (theme.terrain === 'snow') {
      for (const [x, z, s2, rot] of [
        [ring * 1.16, ring * 0.42, 1.05, 2.4],
        [-ring * 1.22, -ring * 0.5, 0.9, 0.7],
        [ring * 0.5, -ring * 1.2, 0.82, 4.1],
      ] as [number, number, number, number][]) {
        const bear = polarBear();
        bear.position.set(x, -0.5, z);
        bear.scale.setScalar(s2);
        bear.rotation.y = rot;
        addShadows(bear);
        decor.add(bear);
        this.sceneryKinds.push('polarBear');
        count('polarBear', 1);
      }
      const ig = igloo();
      ig.position.set(-ring * 0.86, -0.5, ring * 1.06);
      ig.scale.setScalar(1.1);
      addShadows(ig);
      decor.add(ig);
      this.sceneryKinds.push('igloo');
      count('igloo', 1);
    }

    decor.add(bush(-ring * 0.45, ring * 1.05, theme.scatter));
    decor.add(bush(ring * 0.5, -ring * 1.02, theme.scatter));
    decor.add(bush(-ring * 1.02, ring * 0.25, theme.scatter));
    decor.add(bush(ring * 0.62, ring * 0.52, theme.foliageAlt));

    // Rocks anchor the scene and vary the silhouette per theme.
    decor.add(rock(-ring * 0.72, -ring * 0.62, theme.wood, 1));
    decor.add(rock(ring * 0.66, -ring * 0.5, theme.wood, 2));
    decor.add(rock(-ring * 0.2, -ring * 1.2, theme.wood, 3));

    pile.position.set(ring * 0.4, -0.5, ring * 1.08);
    decor.add(pile);

    // Hero props sit at fixed spots well clear of the baseplate.
    const landmarkSpots: [number, number, number, number][] = [
      [-ring * 1.34, ring * 0.62, 1.15, 0.5],
      [ring * 1.28, -ring * 0.72, 0.95, 2.1],
      [-ring * 0.55, ring * 1.32, 0.8, 1.1],
      [ring * 0.95, ring * 1.18, 0.7, 3.4],
    ];
    theme.landmarks.forEach((kind, i) => {
      const make = landmarkMakers[kind];
      if (!make) return;
      const [x, z, scale, rot] = landmarkSpots[i % landmarkSpots.length];
      const o = make();
      o.position.set(x, -0.5, z);
      o.scale.setScalar(scale);
      o.rotation.y = rot;
      addShadows(o);
      decor.add(o);
      this.sceneryKinds.push(kind);
      count(kind, 1);
    });

    // Themed ground cover on the terrain plane.
    decor.add(...this.groundCover(theme));

    this.group.add(decor);
    this.scenery = decor;
  }


  /**
   * Scatter for the terrain around the baseplate: grass tufts, sand ripples,
   * snow drifts or glowing lava cracks, depending on the theme. Deterministic
   * so a theme looks the same every time it is rebuilt.
   */
  private groundCover(theme: BoardTheme): THREE.Object3D[] {
    const R = HALF + 2.6;
    const inner = HALF + 1.5;

    // Ground cover is flat, so it needs far less clumping than the props, but it
    // goes through the same scatter so it stops reading as a perfect spiral.
    const spots = (count: number, spread: number, seed = 0): Scatter[] =>
      scatterClumps(count, inner, inner + spread, seed + 40);

    const out: THREE.Object3D[] = [];

    if (theme.terrain === 'grass') {
      const blade = plastic(theme.foliage, { roughness: 0.78 });
      const bladeDark = plastic(theme.foliageAlt, { roughness: 0.78 });
      const tuft = (): THREE.Group => {
        const g = new THREE.Group();
        for (let k = 0; k < 3; k++) {
          const b = new THREE.Mesh(cone(0.55, 1.1 + (k % 2) * 0.5), k % 2 ? bladeDark : blade);
          b.position.set((k - 1) * 0.45, PITCH * 0.35, (k % 2) * 0.3);
          b.rotation.z = (k - 1) * 0.22;
          g.add(b);
        }
        return g;
      };
      out.push(stampProp(tuft, spots(80, 15)));
    } else if (theme.terrain === 'sand') {
      const sand = plastic(theme.horizonAlt, { roughness: 0.95 });
      const sandLit = plastic(LEGO.tan, { roughness: 0.92 });
      const ripple = (): THREE.Group => {
        const g = new THREE.Group();
        for (let k = 0; k < 2; k++) {
          const rip = new THREE.Mesh(brick(9 - k * 3, 2, false), k % 2 ? sand : sandLit);
          rip.position.set(0, 0, (k - 0.5) * 1.6);
          rip.scale.set(1 - k * 0.25, 0.34, 1);
          g.add(rip);
        }
        return g;
      };
      out.push(stampProp(ripple, spots(74, 17)));
    } else if (theme.terrain === 'snow') {
      const snow = plastic(LEGO.white, { roughness: 0.62 });
      const ice = plastic(LEGO.lightBluishGray, { roughness: 0.5 });
      const drift = (): THREE.Group => {
        const g = new THREE.Group();
        const a = new THREE.Mesh(new THREE.SphereGeometry(PITCH * 1.5, 10, 6), snow);
        a.scale.set(1, 0.3, 0.8);
        a.position.y = PITCH * 0.1;
        const b2 = new THREE.Mesh(new THREE.SphereGeometry(PITCH * 0.9, 8, 5), ice);
        b2.scale.set(1, 0.32, 1);
        b2.position.set(PITCH * 1.1, PITCH * 0.06, PITCH * 0.5);
        g.add(a, b2);
        return g;
      };
      out.push(stampProp(drift, spots(74, 15)));
    } else {
      const lava = new THREE.MeshStandardMaterial({
        color: theme.glow ?? 0xff5a1f,
        emissive: new THREE.Color(theme.glow ?? 0xff5a1f),
        emissiveIntensity: 1.5,
        roughness: 0.5,
      });
      const rock = plastic(theme.wood, { roughness: 0.95 });
      this.lavaMat = this.lavaMat ?? lava;
      const crack = (): THREE.Group => {
        const g = new THREE.Group();
        const a = new THREE.Mesh(brick(7, 1, false), rock);
        a.scale.y = 0.22;
        const b2 = new THREE.Mesh(brick(5, 1, false), lava);
        b2.position.set(1.4, 0.06, 0.9);
        b2.rotation.y = 0.5;
        b2.scale.y = 0.22;
        g.add(a, b2);
        return g;
      };
      out.push(stampProp(crack, spots(64, 17)));
      // Molten pools, so the ground reads as hot rather than just decorated.
      const pool = (): THREE.Group => {
        const g = new THREE.Group();
        const m = new THREE.Mesh(new THREE.CircleGeometry(PITCH * 4.2, 16), lava);
        m.rotation.x = -Math.PI / 2;
        g.add(m);
        return g;
      };
      const pools: Scatter[] = [
        { x: -R * 0.85, z: R * 0.78, scale: 1, rot: 0 },
        { x: R * 0.92, z: -R * 0.6, scale: 0.7, rot: 0 },
        { x: R * 0.15, z: R * 1.15, scale: 0.55, rot: 0 },
        { x: -R * 1.1, z: -R * 0.35, scale: 0.62, rot: 0 },
      ];
      out.push(stampProp(pool, pools));
    }

    return out;
  }

  // -------------------------------------------------------------- highlight

  private buildHighlight(): void {
    this.hoverTileMat = plastic(LEGO.brightYellow, {
      transparent: true,
      opacity: 0.4,
      emissive: LEGO.yellow,
      emissiveIntensity: 0.5,
      roughness: 0.3,
    });
    this.hoverStudMat = plastic(LEGO.brightYellow, {
      transparent: true,
      opacity: 0.8,
      emissive: LEGO.yellow,
      emissiveIntensity: 0.7,
      roughness: 0.3,
    });

    const tile = new THREE.Mesh(plate(8, 8, false), this.hoverTileMat);
    tile.renderOrder = 3;
    this.highlight.add(tile);

    const studGeo = new THREE.CylinderGeometry(STUD_R * 0.94, STUD_R * 0.86, STUD_H * 1.1, 10);
    const studs = new THREE.InstancedMesh(studGeo, this.hoverStudMat, 64);
    const dummy = new THREE.Object3D();
    let i = 0;
    for (let sx = 0; sx < 8; sx++) {
      for (let sz = 0; sz < 8; sz++) {
        dummy.position.set((sx - 3.5) * PITCH, PLATE_H + STUD_H / 2, (sz - 3.5) * PITCH);
        dummy.updateMatrix();
        studs.setMatrixAt(i++, dummy.matrix);
      }
    }
    studs.instanceMatrix.needsUpdate = true;
    studs.renderOrder = 4;
    this.highlight.add(studs);

    this.highlight.visible = false;
    this.group.add(this.highlight);
  }

  showCell(gx: number, gy: number, ok: boolean): void {
    this.highlight.visible = true;
    this.highlight.position.set(gxToWorld(gx), 0.002, gyToWorld(gy));
    const color = ok ? LEGO.brightYellow : LEGO.brightRed;
    this.hoverTileMat.color.setHex(color);
    this.hoverTileMat.emissive.setHex(color);
    this.hoverStudMat.color.setHex(color);
    this.hoverStudMat.emissive.setHex(color);
  }

  hideHighlight(): void {
    this.highlight.visible = false;
  }

  // -------------------------------------------------------- attacker deploy zone

  private buildDeployZone(): void {
    this.deployMat = new THREE.MeshBasicMaterial({
      color: 0x35e0ff,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    const geo = new THREE.RingGeometry(PITCH * 0.34, PITCH * 0.46, 20);
    geo.rotateX(-Math.PI / 2);
    // Pooled up front: at most four lanes times the deploy zone.
    this.deployMarkers = Array.from({ length: 16 }, () => {
      const m = new THREE.Mesh(geo, this.deployMat);
      m.renderOrder = 3;
      this.deployZone.add(m);
      return m;
    });
    this.deployZone.visible = false;
    this.group.add(this.deployZone);
  }

  /**
   * Floating down-arrows over each gate.
   *
   * The rings only appear once a unit is armed, which left a first-time attacker
   * with nothing on screen telling them where the entrances even were. The
   * arrows are therefore up for the whole attacker turn, and bob faster and
   * brighter the moment a unit is selected.
   */
  private buildDeployArrows(): void {
    for (const arrow of this.deployArrows) {
      this.deployArrowGroup.remove(arrow);
      disposeTree(arrow);
    }
    this.deployArrows = [];
    this.deployArrowTips = [];

    this.deployArrowMat = new THREE.MeshBasicMaterial({
      color: 0x35e0ff,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x35e0ff,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });

    // cone() points up, so flip a copy: arrowheads here have to point down.
    const head = cone(3.2, 2.8).clone();
    head.rotateX(Math.PI);
    const stem = roundBrick(1.5, 0.3);
    const halo = new THREE.RingGeometry(PITCH * 0.36, PITCH * 0.46, 20);
    halo.rotateX(-Math.PI / 2);

    for (let lane = 0; lane < laneCount(); lane++) {
      // Sit over the middle of the lane's deploy zone, not the whole lane.
      const cell = LANES[lane].cells[Math.floor(DEPLOY_ZONE / 2)];
      if (!cell) continue;

      const root = new THREE.Group();
      root.position.set(gxToWorld(cell[0]), 0, gyToWorld(cell[1]));

      const ring = new THREE.Mesh(halo, haloMat);
      ring.position.y = PLATE_H + 0.03;
      ring.renderOrder = 3;

      const tip = new THREE.Group();
      tip.position.y = PLATE_H + 1.8;
      const headMesh = new THREE.Mesh(head, this.deployArrowMat);
      headMesh.position.y = -0.16;
      const stemMesh = new THREE.Mesh(stem, this.deployArrowMat);
      stemMesh.position.y = 0.26;
      headMesh.renderOrder = 4;
      stemMesh.renderOrder = 4;
      tip.add(headMesh, stemMesh);
      tip.userData['baseY'] = tip.position.y;

      root.add(ring, tip);
      this.deployArrows.push(root);
      this.deployArrowTips.push(tip);
      this.deployArrowGroup.add(root);
    }

    this.deployArrowGroup.visible = this.deployArrowsVisible;
    if (!this.deployArrowGroup.parent) this.group.add(this.deployArrowGroup);
  }

  /** Show or hide the gate arrows. On for the whole attacker turn. */
  setDeployArrows(visible: boolean): void {
    this.deployArrowsVisible = visible;
    this.deployArrowGroup.visible = visible && this.deployArrows.length > 0;
  }

  /** Ring the tiles an attacker may drop a unit onto. */
  showDeployZone(cells: ReadonlyArray<readonly [number, number]>): void {
    this.deployArrowHot = true;
    this.deployMarkers.forEach((m, i) => {
      const cell = cells[i];
      m.visible = Boolean(cell);
      if (cell) m.position.set(gxToWorld(cell[0]), PLATE_H + 0.02, gyToWorld(cell[1]));
    });
    this.deployZone.visible = cells.length > 0;
  }

  hideDeployZone(): void {
    this.deployZone.visible = false;
    this.deployArrowHot = false;
  }

  /** Banner colour and wall brightness react to fortress health. */
  setFortressHealth(hp: number, maxHp: number): void {
    if (hp === this.lastHp) return;
    this.lastHp = hp;
    const ratio = Math.max(0, hp / maxHp);

    this.banner.material =
      ratio > 0.6 ? plastic(LEGO.brightRed) : ratio > 0.3 ? plastic(LEGO.orange) : plastic(LEGO.red);

    this.fortressMat.color.setHex(PALETTE.fortressWall).multiplyScalar(1 - ratio * 0.4);
  }

  pulseGate(t: number): void {
    // Phase each gate slightly so a four-lane map shimmers rather than
    // throbbing in unison.
    for (let i = 0; i < this.gateGlows.length; i++) {
      this.gateGlows[i].emissiveIntensity = 0.7 + Math.sin(t * 2.6 + i * 1.7) * 0.35;
    }

    // Gate arrows: a lazy idle bob normally, a quicker one while a unit is armed.
    const rate = this.deployArrowHot ? 5.2 : 2.6;
    const bob = this.deployArrowHot ? 0.18 : 0.1;
    for (let i = 0; i < this.deployArrowTips.length; i++) {
      const tip = this.deployArrowTips[i];
      const base = tip.userData['baseY'] as number;
      tip.position.y = base + Math.sin(t * rate + i * 1.4) * bob;
    }
    this.deployArrowMat.opacity = this.deployArrowHot ? 0.95 : 0.6;
  }
}