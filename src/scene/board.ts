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
  currentMap,
  gxToWorld,
  gyToWorld,
  isPathCell,
} from '../core/constants';
import { MAP_ORDER } from '../core/maps';
import { laneCount, pathPoints } from '../core/path';
import { DEPLOY_ZONE } from '../core/sides';
import {
  brick,
  cone,
  cylinderZ,
  dome,
  plate,
  post,
  ring as torusRing,
  roundBrick,
  slopeBrick,
  sphere,
} from './builder';
import { THEMES } from './themes';
import type { BoardTheme } from './themes';
import { plastic } from './materials';

/** Half the width of the keep's curtain wall, in world units. */
const WALL_HALF = (16 * PITCH) / 2;

/**
 * How big the scenery outside the baseplate is drawn. The board is fourteen
 * tiles across, so props at their original size look like weeds in a field;
 * scaled up they read as trees, which is what the arena is supposed to sit in.
 */
const PROP_SCALE = 1.5;

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
  /** Height of the prop's base. Defaults to the terrain level. */
  y?: number;
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
      spot.compose(pos.set(s.x, s.y ?? -0.5, s.z), quat, scl.set(s.scale, s.scale, s.scale));
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
    // Three's extrusions are not indexed while its bricks are, and a merge
    // needs every geometry in the bucket to agree about that. Mixed buckets
    // are flattened to non-indexed so the prop survives.
    const mixed =
      parts.length > 1 &&
      parts.some((p) => p.index !== null) &&
      parts.some((p) => p.index === null);
    const list = mixed
      ? parts.map((p) => (p.index !== null ? p.toNonIndexed() : p.clone()))
      : parts;
    const merged = list.length > 1 ? mergeGeometries(list, false) : null;
    if (merged) {
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      out.add(m);
      list.forEach((p) => p.dispose());
    } else {
      // Mixed attributes that cannot be merged: keep them separate rather than
      // lose the prop.
      for (const p of list) {
        const m = new THREE.Mesh(p, mat);
        m.castShadow = true;
        m.receiveShadow = true;
        out.add(m);
      }
    }
    if (mixed) parts.forEach((p) => p.dispose());
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

/**
 * Grow a band of props without moving it. The scatter helpers lay out the
 * positions; this decides how big the things standing there are.
 */
function scaleUp(spots: Scatter[], factor: number): Scatter[] {
  return spots.map((s) => ({ ...s, scale: s.scale * factor }));
}

/**
 * Even, gapless coverage around an annulus.
 *
 * The tree belt that wraps the arena cannot be clumped: clumps leave gaps, and
 * a gap in the belt is a hole in the horizon right where the player is looking.
 * So the belt steps around the circle in fixed angular slices, each slice
 * jittered in both angle and radius. The result is continuous cover that still
 * refuses to read as a perfect ring, because the radius wanders.
 */
function scatterBelt(count: number, rInner: number, rOuter: number, seed = 0): Scatter[] {
  const rand = makeRng(seed + 613);
  const out: Scatter[] = [];
  const step = (Math.PI * 2) / Math.max(1, count);
  for (let i = 0; i < count; i++) {
    const a = (i + (rand() - 0.5) * 0.9) * step;
    const r = rInner + (rOuter - rInner) * rand();
    out.push({
      x: Math.cos(a) * r,
      z: Math.sin(a) * r,
      scale: 0.66 + rand() * 0.72,
      rot: rand() * Math.PI * 2,
    });
  }
  return out;
}

/**
 * Blend two colours. Used for the worn ring of ground around the baseplate,
 * which fades from trodden earth back into the terrain colour.
 */
function mixColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/**
 * A soft radial falloff, painted once and shared by every contact shadow.
 * The shadow map cannot resolve a shadow at the base of a distant tree, so the
 * props also get a painted blob of ambient occlusion under them.
 */
let softBlob: THREE.Texture | null = null;
function softBlobTexture(): THREE.Texture {
  if (softBlob) return softBlob;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  softBlob = tex;
  return tex;
}

/**
 * Every prop in the woods gets a blob of ambient occlusion under it, merged
 * into a single mesh so the whole surround costs one draw call.
 */
function contactShadows(
  groups: { spots: Scatter[]; radius: number }[],
  opacity = 0.32,
): THREE.Mesh | null {
  const parts: THREE.BufferGeometry[] = [];
  for (const { spots, radius } of groups) {
    for (const s of spots) {
      const size = radius * 2 * s.scale;
      const g = new THREE.PlaneGeometry(size, size);
      g.rotateX(-Math.PI / 2);
      g.translate(s.x, (s.y ?? -0.5) + 0.012, s.z);
      parts.push(g);
    }
  }
  if (!parts.length) return null;
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!merged) return null;
  const mat = new THREE.MeshBasicMaterial({
    map: softBlobTexture(),
    color: 0x2b2a1e,
    transparent: true,
    opacity,
    depthWrite: false,
    fog: true,
  });
  const mesh = new THREE.Mesh(merged, mat);
  mesh.renderOrder = 1;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
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
  /**
   * The hero landmark groups of the current theme, refreshed on every rebuild.
   * Exposed so the ambient animation layer can breathe life into them without
   * reaching into the merged scenery.
   */
  readonly landmarks: THREE.Object3D[] = [];

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
    // The terrain sits at the height the scenery stands on, so the forest
    // around the arena is planted in the ground rather than floating over it.
    grass.position.y = -0.5;
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
    this.landmarks.length = 0;
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

    /** Stepped pyramid: four shrinking plates, a shaded face and a gold capstone. */
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
      // Gilded capstone — the detail that makes it read as a pyramid, not a ziggurat.
      const cap = new THREE.Mesh(cone(1.5, 1.2), plastic(LEGO.brightYellow, { roughness: 0.28, metalness: 0.25 }));
      cap.position.y = 3 * PITCH * 0.62 + BRICK_H;
      g.add(cap);
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

    // ------------------------------------------------- the surrounding land
    // Props for the land outside the baseplate: the trees that wrap the
    // arena, the rocks and old ruins in the woods, and the little patches of
    // sand and water that break the treeline up.

    // Stone for the rocks and the old walls. The theme's own wood colour is
    // far too close to the desert's sand, so it is pulled towards grey stone
    // that reads against every ground the board can stand on.
    const rockStone = plastic(mixColor(theme.horizonAlt, 0x8f8a80, 0.75), { roughness: 0.96 });
    const ruinStone = plastic(mixColor(theme.horizonAlt, 0x9c948a, 0.75), { roughness: 0.95 });
    const ruinBrick = plastic(mixColor(theme.wood, 0xa2674a, 0.6), { roughness: 0.92 });

    /** Rock cluster: a few tilted blocks with a cap of moss. */
    const rockCluster = (): THREE.Group => {
      const g = new THREE.Group();
      const stone = rockStone;
      const moss = plastic(theme.foliageAlt, { roughness: 0.85 });
      const a = new THREE.Mesh(slopeBrick(5, 4), stone);
      a.position.y = 0.06;
      const b2 = new THREE.Mesh(brick(3, 3, false), stone);
      b2.position.set(0.7, 0.05, 0.5);
      b2.rotation.y = 0.9;
      const c = new THREE.Mesh(brick(2, 2, false), stone);
      c.position.set(-0.75, 0.04, -0.55);
      c.rotation.y = 2.1;
      const cap = new THREE.Mesh(plate(3, 3, false), moss);
      cap.position.set(0, 0.18, 0);
      g.add(a, b2, c, cap);
      return g;
    };

    /** Ancient brick-built ruin: a crumbling wall, a broken column, rubble. */
    const ancientRuin = (): THREE.Group => {
      const g = new THREE.Group();
      const stone = ruinStone;
      const oldBrick = ruinBrick;
      const moss = plastic(theme.foliageAlt, { roughness: 0.85 });
      // Crumbling wall: stacks of brick with gaps and a broken top course.
      for (let i = 0; i < 8; i++) {
        const h = 1 + ((i * 3) % 3);
        for (let k = 0; k < h; k++) {
          const b = new THREE.Mesh(brick(2, 1, false), (i + k) % 3 === 0 ? stone : oldBrick);
          b.position.set((i - 3.5) * 2 * PITCH, k * BRICK_H, (((i * 7) % 5) - 2) * 0.02);
          b.rotation.y = (((i * 13) % 7) - 3) * 0.012;
          g.add(b);
        }
      }
      // Broken column with a cracked capital.
      for (let k = 0; k < 3; k++) {
        const c = new THREE.Mesh(roundBrick(3, BRICK_H), stone);
        c.position.set(4.6 * PITCH, k * BRICK_H, 1.4 * PITCH);
        g.add(c);
      }
      const capital = new THREE.Mesh(plate(3, 3, false), oldBrick);
      capital.position.set(4.6 * PITCH, 3 * BRICK_H + PLATE_H, 1.4 * PITCH);
      capital.rotation.z = 0.12;
      g.add(capital);
      // Toppled slab and scattered rubble.
      const slab = new THREE.Mesh(brick(5, 2, false), oldBrick);
      slab.position.set(-2.6 * PITCH, BRICK_H * 0.5, 2.2 * PITCH);
      slab.rotation.set(0.08, 0.42, 0.14);
      g.add(slab);
      for (let i = 0; i < 5; i++) {
        const r = new THREE.Mesh(brick(1, 1, false), i % 2 ? stone : oldBrick);
        r.position.set((i - 2) * 1.5 * PITCH, BRICK_H * 0.25, (i % 2 ? 1 : -1) * 2.9 * PITCH);
        r.rotation.y = i * 0.7;
        g.add(r);
      }
      // Moss creeping over the old stone.
      for (const [mx, mz] of [
        [-2.4, 0.3],
        [1.6, -0.5],
        [4.2, 1.1],
        [-5.2, -0.2],
      ] as [number, number][]) {
        const m = new THREE.Mesh(plate(2, 2, false), moss);
        m.position.set(mx * PITCH, BRICK_H * 0.05, mz * PITCH);
        m.rotation.y = mx * 0.3;
        g.add(m);
      }
      return g;
    };

    /**
     * A small patch of other ground out in the woods: a disc of sand, a pool
     * of water and a couple of palms. Deserts get sand and cacti, the arctic
     * gets a melt pool, the volcano gets a molten one.
     */
    const groundPatch = (): THREE.Group => {
      const g = new THREE.Group();
      const kind = theme.surround.patch;
      const sandColor =
        kind === 'spring' ? 0xdfe9ee : kind === 'magma' ? 0x3a322c : kind === 'dune' ? 0xe8cf9c : LEGO.tan;
      const sand = plastic(sandColor, { roughness: 0.96 });
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.35, 0.16, 18), sand);
      disc.position.y = -0.07;
      g.add(disc);

      if (kind === 'magma') {
        const lava = plastic(theme.glow ?? 0xff5a1f, {
          emissive: theme.glow ?? 0xff5a1f,
          emissiveIntensity: 1.7,
          roughness: 0.42,
        });
        const pool = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.08, 16), lava);
        pool.position.y = 0.04;
        g.add(pool);
        const crust = plastic(0x241c18, { roughness: 0.9 });
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          const c = new THREE.Mesh(brick(2, 1, false), crust);
          c.position.set(Math.cos(a) * 1.9 * PITCH, 0.06, Math.sin(a) * 1.9 * PITCH);
          c.rotation.y = a;
          g.add(c);
        }
        return g;
      }

      // Water: a shallow pool with a bright rim, in the theme's own colour.
      const waterColor = kind === 'spring' ? 0x8fd6e8 : kind === 'dune' ? 0x6fb4c9 : 0x2f86c4;
      const water = plastic(waterColor, { roughness: 0.1, metalness: 0.3 });
      if (kind !== 'dune') {
        const pool = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.08, 16), water);
        pool.position.y = 0.05;
        g.add(pool);
      }
      // Reeds and stones around the water.
      const stone = rockStone;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.4;
        const s = new THREE.Mesh(brick(1, 1, false), stone);
        s.position.set(Math.cos(a) * 2.5 * PITCH, 0.04, Math.sin(a) * 2.5 * PITCH);
        s.rotation.y = a;
        g.add(s);
      }
      // Palms lean over the water; cacti stand off to one side.
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.9;
        const p = palm();
        p.position.set(Math.cos(a) * 2.1 * PITCH, 0, Math.sin(a) * 2.1 * PITCH);
        p.scale.setScalar(1.5);
        p.rotation.y = a;
        g.add(p);
      }
      const cactusSpots: [number, number][] = [
        [-2.6, 1.8],
        [2.2, -2.4],
      ];
      for (const [cx, cz] of cactusSpots) {
        const c = cactus();
        c.position.set(cx * PITCH, 0, cz * PITCH);
        c.scale.setScalar(1.3);
        g.add(c);
      }
      return g;
    };

    // Low-poly versions of the trees, for the far woods. The outer ring holds
    // hundreds of them, and nobody looks at a stud from thirty units away.
    const farPine = (): THREE.Group => {
      const t = new THREE.Group();
      t.add(new THREE.Mesh(post(1.4, 2.4), trunk));
      const tiers: [number, number, number][] = [
        [3.6, 1.2, 0],
        [2.7, 2.1, 1],
        [1.7, 3.0, 2],
      ];
      for (const [r, y, i] of tiers) {
        const c = new THREE.Mesh(cone(r, 2.2), i % 2 ? leafDark : leaf);
        c.position.y = y;
        t.add(c);
      }
      return t;
    };

    const farBroadleaf = (): THREE.Group => {
      const t = new THREE.Group();
      t.add(new THREE.Mesh(post(1.3, 3.2), trunk));
      const c1 = new THREE.Mesh(dome(3.2), leaf);
      c1.position.y = 3.3 * PITCH;
      const c2 = new THREE.Mesh(dome(2.2), leafDark);
      c2.position.set(0.5 * PITCH, 4.3 * PITCH, 0.3 * PITCH);
      t.add(c1, c2);
      return t;
    };

    const farPalm = (): THREE.Group => {
      const t = new THREE.Group();
      const frond = plastic(theme.foliage, { roughness: 0.7 });
      const bark = new THREE.Mesh(post(1.1, 7), trunk);
      bark.rotation.z = 0.09;
      t.add(bark);
      for (let i = 0; i < 5; i++) {
        const f = new THREE.Mesh(brick(4, 1, false), frond);
        const a = (i / 5) * Math.PI * 2;
        f.position.set(Math.cos(a) * 1.5 * PITCH, 7 * PITCH, Math.sin(a) * 1.5 * PITCH);
        f.rotation.set(0, -a, -0.5);
        t.add(f);
      }
      return t;
    };

    const farCactus = (): THREE.Group => {
      const t = new THREE.Group();
      const body = new THREE.Mesh(post(1.6, 4.4), leaf);
      t.add(body);
      for (const [y, out] of [
        [1.1, 1],
        [2.4, -1],
      ] as [number, number][]) {
        const arm = new THREE.Mesh(post(1, 1.8), leaf);
        arm.position.set(out * 0.3, y, 0);
        t.add(arm);
      }
      return t;
    };

    const farBurnt = (): THREE.Group => {
      const t = new THREE.Group();
      const tr = new THREE.Mesh(post(1.2, 5.4), trunk);
      t.add(tr);
      for (const [rot, len] of [
        [0.7, 2.2],
        [2.9, 1.7],
      ] as [number, number][]) {
        const limb = new THREE.Mesh(brick(1.4, 1.4, false), trunk);
        limb.position.set(Math.cos(rot) * 1.4 * PITCH, len * PITCH, Math.sin(rot) * 1.4 * PITCH);
        limb.rotation.set(0.4, rot, 0.5);
        t.add(limb);
      }
      return t;
    };

    /** Studded trees for the belt close to the board, cheap ones for the woods. */
    const treeMakers: Record<string, () => THREE.Group> = {
      broadleaf,
      pine,
      palm,
      cactus,
      burnt,
    };
    const farTreeMakers: Record<string, () => THREE.Group> = {
      broadleaf: farBroadleaf,
      pine: farPine,
      palm: farPalm,
      cactus: farCactus,
      burnt: farBurnt,
    };

    /** Giant broadleaf: a towering hero tree that anchors the forest skyline. */
    const bigTree = (): THREE.Group => {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const seg = new THREE.Mesh(brick(2, 2, false), trunk);
        seg.position.y = BRICK_H * (i + 0.5);
        g.add(seg);
      }
      const crown: [number, number, THREE.Material][] = [
        [8, BRICK_H * 3.4, leaf],
        [6, BRICK_H * 4.4, leafDark],
        [4, BRICK_H * 5.4, leaf],
        [2, BRICK_H * 6.4, leafDark],
      ];
      for (const [size, y, mat] of crown) {
        const c = new THREE.Mesh(brick(size, size, false), mat);
        c.position.y = y;
        g.add(c);
      }
      const tip = new THREE.Mesh(cone(2.6, 2.4), leaf);
      tip.position.y = BRICK_H * 7.1;
      g.add(tip);
      return g;
    };

    /** Campfire: a ring of stones around crossed logs with a glowing flame. */
    const campfire = (): THREE.Group => {
      const g = new THREE.Group();
      const stone = plastic(theme.wood, { roughness: 0.95 });
      const log = plastic(LEGO.redBrown, { roughness: 0.85 });
      const flame = plastic(0xff7a1a, { roughness: 0.4, emissive: 0xff4d0f, emissiveIntensity: 1.5 });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const s = new THREE.Mesh(roundBrick(1, BRICK_H * 0.8), stone);
        s.position.set(Math.cos(a) * PITCH * 1.7, 0, Math.sin(a) * PITCH * 1.7);
        s.rotation.y = a;
        g.add(s);
      }
      const l1 = new THREE.Mesh(brick(5, 1, false), log);
      l1.position.y = BRICK_H * 0.7;
      l1.rotation.y = 0.5;
      const l2 = new THREE.Mesh(brick(5, 1, false), log);
      l2.position.y = BRICK_H * 1.2;
      l2.rotation.y = 0.5 + Math.PI / 2.4;
      g.add(l1, l2);
      const glow = new THREE.Mesh(cone(1.4, 1.8), flame);
      glow.position.y = BRICK_H * 0.9;
      g.add(glow);
      return g;
    };

    /** Oasis: a blue pool ringed with a sand lip, palms and reeds. */
    const oasis = (): THREE.Group => {
      const g = new THREE.Group();
      const water = plastic(0x2f8fd0, {
        roughness: 0.14,
        metalness: 0.15,
        transparent: true,
        opacity: 0.88,
      });
      const pool = new THREE.Mesh(new THREE.CircleGeometry(PITCH * 5, 24), water);
      pool.rotation.x = -Math.PI / 2;
      pool.position.y = PITCH * 0.12;
      g.add(pool);
      const lip = new THREE.Mesh(torusRing(5.2, 0.5, 24), plastic(theme.horizonAlt, { roughness: 0.92 }));
      lip.rotation.x = -Math.PI / 2;
      lip.position.y = PITCH * 0.16;
      g.add(lip);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        const p = palm();
        p.position.set(Math.cos(a) * PITCH * 5.4, 0, Math.sin(a) * PITCH * 5.4);
        p.scale.setScalar(0.95);
        p.rotation.y = -a + Math.PI;
        g.add(p);
      }
      const reed = plastic(LEGO.green, { roughness: 0.75 });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 1.1;
        const r = new THREE.Mesh(cone(0.4, 1.4 + (i % 2) * 0.6), reed);
        r.position.set(Math.cos(a) * PITCH * 4.4, PITCH * 0.1, Math.sin(a) * PITCH * 4.4);
        r.rotation.z = (i % 2 ? 1 : -1) * 0.16;
        g.add(r);
      }
      return g;
    };

    /** Ice arch: two frozen columns meeting under a curved lintel. */
    const iceArch = (): THREE.Group => {
      const g = new THREE.Group();
      const ice = plastic(LEGO.white, { roughness: 0.32, metalness: 0.06 });
      const blue = plastic(LEGO.lightBluishGray, { roughness: 0.4 });
      const block = (x: number, y: number, w: number, mat: THREE.Material): void => {
        const m = new THREE.Mesh(brick(w, 3, false), mat);
        m.position.set(x * PITCH, y * PITCH, 0);
        g.add(m);
      };
      for (let i = 0; i < 5; i++) {
        block(-2.6, i, 2, i % 2 ? blue : ice);
        block(2.6, i, 2, i % 2 ? ice : blue);
      }
      block(-1.6, 5, 2, ice);
      block(0, 5.7, 2, blue);
      block(1.6, 5, 2, ice);
      return g;
    };

    /** Obsidian spire: a jagged cluster of glassy black shards. */
    const obsidianSpire = (): THREE.Group => {
      const g = new THREE.Group();
      const black = plastic(LEGO.black, { roughness: 0.3 });
      const dark = plastic(0x1a1512, { roughness: 0.46 });
      const shards: [number, number, number, number][] = [
        [0, 0, 7.5, 1.7],
        [1.5, 0.9, 4.6, 1.15],
        [-1.3, -1.0, 5.4, 1.25],
        [0.7, -1.4, 3.6, 0.95],
      ];
      for (let i = 0; i < shards.length; i++) {
        const [dx, dz, h, r] = shards[i];
        const shard = new THREE.Mesh(cone(r, h), i % 2 ? dark : black);
        shard.position.set(dx * PITCH, 0, dz * PITCH);
        shard.rotation.set(i % 2 ? 0.09 : -0.07, i, i % 2 ? 0.12 : -0.13);
        g.add(shard);
      }
      return g;
    };

    /** Lava pit: a molten pool inside a cracked rock rim. */
    const lavaPit = (): THREE.Group => {
      const g = new THREE.Group();
      const lava = new THREE.MeshStandardMaterial({
        color: theme.glow ?? 0xff5a1f,
        emissive: new THREE.Color(theme.glow ?? 0xff5a1f),
        emissiveIntensity: 1.9,
        roughness: 0.42,
      });
      this.lavaMat = this.lavaMat ?? lava;
      const pit = new THREE.Mesh(new THREE.CircleGeometry(PITCH * 4.6, 20), lava);
      pit.rotation.x = -Math.PI / 2;
      pit.position.y = PITCH * 0.12;
      g.add(pit);
      const rock = plastic(theme.wood, { roughness: 0.96 });
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const r = new THREE.Mesh(slopeBrick(2, 2), rock);
        r.position.set(Math.cos(a) * PITCH * 4.3, 0, Math.sin(a) * PITCH * 4.3);
        r.rotation.y = -a;
        g.add(r);
      }
      return g;
    };

    /** Shared glowing-lava material, kept so the ambient layer can pulse it. */
    const lavaMat = (): THREE.MeshStandardMaterial => {
      const m = new THREE.MeshStandardMaterial({
        color: theme.glow ?? 0xff5a1f,
        emissive: new THREE.Color(theme.glow ?? 0xff5a1f),
        emissiveIntensity: 1.9,
        roughness: 0.42,
      });
      this.lavaMat = this.lavaMat ?? m;
      return m;
    };

    // --------------------------------------------------- more forest dressing

    /** Rock arch: two leaning stone piers under a leafy capstone. */
    const rockArch = (): THREE.Group => {
      const g = new THREE.Group();
      const stone = plastic(theme.wood, { roughness: 0.94 });
      const dark = plastic(LEGO.darkBluishGray, { roughness: 0.95 });
      const moss = plastic(theme.foliageAlt, { roughness: 0.8 });
      for (const side of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const b = new THREE.Mesh(brick(2, 2, false), i % 2 ? stone : dark);
          b.position.set(side * 2.4 * PITCH, BRICK_H * (i + 0.5), 0);
          b.rotation.y = side * i * 0.06;
          const k = 1 - i * 0.07;
          b.scale.set(k, 1, k);
          g.add(b);
        }
      }
      for (const [dx, y] of [[-1.7, 4.1], [0, 4.4], [1.7, 4.1]] as [number, number][]) {
        const b = new THREE.Mesh(brick(2, 3, false), stone);
        b.position.set(dx * PITCH, BRICK_H * y, 0);
        g.add(b);
      }
      const cap = new THREE.Mesh(plate(5, 3), moss);
      cap.position.set(0, BRICK_H * 5.05, 0);
      g.add(cap);
      return g;
    };

    /** Log cabin: stacked walls, a stepped roof, a lit window and a chimney. */
    const logCabin = (): THREE.Group => {
      const g = new THREE.Group();
      const log = plastic(theme.wood, { roughness: 0.82 });
      const logAlt = plastic(LEGO.tan, { roughness: 0.8 });
      const roof = plastic(LEGO.redBrown, { roughness: 0.72 });
      const glow = plastic(0xffcf7a, { roughness: 0.4, emissive: 0xffb347, emissiveIntensity: 0.9 });
      const body = new THREE.Mesh(brick(8, 6, false), log);
      body.position.y = BRICK_H * 2;
      g.add(body);
      for (let i = 0; i < 4; i++) {
        const ln = new THREE.Mesh(brick(8.3, 0.35, false), i % 2 ? logAlt : log);
        ln.position.set(0, BRICK_H * (0.6 + i), PITCH * 3.05);
        g.add(ln);
      }
      for (let i = 0; i < 3; i++) {
        const r = new THREE.Mesh(brick(8 - i * 2.2, 7 - i * 2.2, false), i % 2 ? roof : logAlt);
        r.position.y = BRICK_H * (4 + i);
        g.add(r);
      }
      const door = new THREE.Mesh(brick(2, 1, false), plastic(0x3a2418, { roughness: 0.7 }));
      door.position.set(0, BRICK_H * 1.1, PITCH * 3.1);
      g.add(door);
      const win = new THREE.Mesh(plate(2, 2), glow);
      win.position.set(PITCH * 2.7, BRICK_H * 2.4, PITCH * 3.12);
      win.rotation.x = Math.PI / 2;
      g.add(win);
      const chim = new THREE.Mesh(brick(1.6, 1.6, false), plastic(LEGO.darkBluishGray, { roughness: 0.9 }));
      chim.position.set(PITCH * 2.4, BRICK_H * 5.3, -PITCH * 1.4);
      g.add(chim);
      return g;
    };

    /** Lookout tower: four braced legs, a railed deck and a green roof. */
    const lookoutTower = (): THREE.Group => {
      const g = new THREE.Group();
      const wood = plastic(theme.wood, { roughness: 0.85 });
      const deckMat = plastic(LEGO.redBrown, { roughness: 0.8 });
      const roof = plastic(LEGO.green, { roughness: 0.7 });
      const legH = 7 * PITCH;
      for (const dx of [-1, 1]) {
        for (const dz of [-1, 1]) {
          const leg = new THREE.Mesh(post(0.55, 7), wood);
          leg.position.set(dx * 2.1 * PITCH, 0, dz * 2.1 * PITCH);
          leg.rotation.set(dz * 0.07, 0, -dx * 0.07);
          g.add(leg);
        }
      }
      const deck = new THREE.Mesh(brick(6, 6, false), deckMat);
      deck.position.y = legH;
      g.add(deck);
      for (const [dx, dz] of [[-3, 0], [3, 0], [0, -3], [0, 3]] as [number, number][]) {
        const rail = new THREE.Mesh(plate(6, 1), deckMat);
        rail.position.set(dx * PITCH, legH + BRICK_H, dz * PITCH);
        if (dx) rail.rotation.y = Math.PI / 2;
        g.add(rail);
      }
      const cone1 = new THREE.Mesh(cone(4.6, 3), roof);
      cone1.position.y = legH + BRICK_H;
      g.add(cone1);
      const flag = new THREE.Mesh(plate(2, 2), plastic(LEGO.brightYellow, { roughness: 0.6 }));
      flag.position.set(PITCH * 1.2, legH + BRICK_H * 3.4, 0);
      g.add(flag);
      return g;
    };

    /** Fairy ring: a circle of little toadstools. */
    const mushroomRing = (): THREE.Group => {
      const g = new THREE.Group();
      const stem = plastic(LEGO.tan, { roughness: 0.8 });
      const cap = plastic(LEGO.red, { roughness: 0.6 });
      const dot = plastic(LEGO.white, { roughness: 0.6 });
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const r = (i % 2 ? 1.8 : 2.4) * PITCH;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const hh = (0.9 + (i % 3) * 0.5) * BRICK_H;
        const st = new THREE.Mesh(roundBrick(1, hh), stem);
        st.position.set(x, hh / 2, z);
        g.add(st);
        const cp = new THREE.Mesh(cone(1.7, 1.2), cap);
        cp.position.set(x, hh, z);
        cp.scale.y = 0.68;
        g.add(cp);
        const dt = new THREE.Mesh(roundBrick(0.5, PLATE_H), dot);
        dt.position.set(x, hh + PITCH * 0.5, z);
        g.add(dt);
      }
      return g;
    };

    // --------------------------------------------------- more desert dressing

    /** Teepee: a hide cone with a pole, seams and a dark doorway. */
    const tent = (): THREE.Group => {
      const g = new THREE.Group();
      const cloth = plastic(LEGO.tan, { roughness: 0.82 });
      const cloth2 = plastic(LEGO.red, { roughness: 0.76 });
      const cone1 = new THREE.Mesh(cone(5, 6.4), cloth);
      g.add(cone1);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const seam = new THREE.Mesh(plate(0.5, 6), i % 2 ? cloth2 : cloth);
        seam.position.set(Math.cos(a) * 2.3 * PITCH, 3 * PITCH, Math.sin(a) * 2.3 * PITCH);
        seam.rotation.set(0.5 * Math.cos(a), -a, 0.5 * Math.sin(a));
        g.add(seam);
      }
      const door = new THREE.Mesh(cone(1.6, 2.4), plastic(0x2a1c12, { roughness: 0.72 }));
      door.position.set(0, 0, 2.7 * PITCH);
      door.rotation.x = 0.5;
      g.add(door);
      const pole = new THREE.Mesh(post(0.3, 3), plastic(theme.wood, { roughness: 0.85 }));
      pole.position.set(0, 6.2 * PITCH, 0);
      g.add(pole);
      return g;
    };

    /** Ruins: a broken colonnade on a cracked plinth. */
    const ruins = (): THREE.Group => {
      const g = new THREE.Group();
      const stone = plastic(theme.horizonAlt, { roughness: 0.9 });
      const lit = plastic(LEGO.tan, { roughness: 0.86 });
      const base = new THREE.Mesh(plate(11, 9), stone);
      g.add(base);
      for (let i = 0; i < 4; i++) {
        const h = i % 2 ? 2 : 4;
        const c = new THREE.Mesh(post(0.95, h), i % 2 ? lit : stone);
        c.position.set((i - 1.5) * 2.1 * PITCH, PLATE_H, (i % 2 ? 1 : -1) * 2 * PITCH);
        g.add(c);
      }
      const lint = new THREE.Mesh(brick(8, 2, false), lit);
      lint.position.set(0, PLATE_H + 4 * PITCH, -2 * PITCH);
      g.add(lint);
      const fallen = new THREE.Mesh(cylinderZ(0.95, 6), stone);
      fallen.rotation.y = 0.5;
      fallen.position.set(PITCH * 0.6, PITCH * 0.9, -2.4 * PITCH);
      g.add(fallen);
      const drum = new THREE.Mesh(roundBrick(2, 2 * PITCH), lit);
      drum.position.set(-2.2 * PITCH, 0, -3 * PITCH);
      g.add(drum);
      return g;
    };

    /** Bleached skull: a bit of desert dread. */
    const skull = (): THREE.Group => {
      const g = new THREE.Group();
      const bone = plastic(0xe8e2d0, { roughness: 0.72 });
      const dark = plastic(0x2b2b30, { roughness: 0.5 });
      const head = new THREE.Mesh(brick(3, 4, false), bone);
      head.position.y = BRICK_H;
      g.add(head);
      const muzzle = new THREE.Mesh(brick(2, 2, false), bone);
      muzzle.position.set(0, BRICK_H * 0.8, PITCH * 2.6);
      g.add(muzzle);
      for (const side of [-1, 1]) {
        const horn = new THREE.Mesh(cone(0.7, 2.8), bone);
        horn.position.set(side * 1.8 * PITCH, BRICK_H * 1.7, -PITCH * 0.4);
        horn.rotation.set(-0.5, 0, side * 0.95);
        g.add(horn);
        const eye = new THREE.Mesh(brick(0.8, 0.8, false), dark);
        eye.position.set(side * 0.8 * PITCH, BRICK_H * 1.5, PITCH * 1.7);
        g.add(eye);
      }
      return g;
    };

    /** Well: a stone circle, a little water and a winding bar. */
    const well = (): THREE.Group => {
      const g = new THREE.Group();
      const stone = plastic(theme.horizonAlt, { roughness: 0.92 });
      const wood = plastic(theme.wood, { roughness: 0.85 });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const s = new THREE.Mesh(brick(1.5, 1.5, false), stone);
        s.position.set(Math.cos(a) * 2.1 * PITCH, 0, Math.sin(a) * 2.1 * PITCH);
        s.rotation.y = a;
        g.add(s);
      }
      const water = new THREE.Mesh(new THREE.CircleGeometry(PITCH * 1.9, 16), plastic(0x2f8fd0, { roughness: 0.15, metalness: 0.15 }));
      water.rotation.x = -Math.PI / 2;
      water.position.y = PITCH * 0.25;
      g.add(water);
      for (const side of [-1, 1]) {
        const p = new THREE.Mesh(post(0.4, 3.4), wood);
        p.position.set(side * 1.6 * PITCH, 0, 0);
        g.add(p);
      }
      const axle = new THREE.Mesh(cylinderZ(0.35, 3.6), wood);
      axle.rotation.y = Math.PI / 2;
      axle.position.set(0, 3.4 * PITCH, 0);
      g.add(axle);
      const roof = new THREE.Mesh(cone(2.6, 1.8), plastic(LEGO.redBrown, { roughness: 0.8 }));
      roof.position.set(0, 3.6 * PITCH, 0);
      g.add(roof);
      return g;
    };

    // --------------------------------------------------- more arctic dressing

    /** Snowman: three snowballs, coal face and a scarf. */
    const snowman = (): THREE.Group => {
      const g = new THREE.Group();
      const snow = plastic(LEGO.white, { roughness: 0.6 });
      const coal = plastic(0x2b2b30, { roughness: 0.5 });
      const scarf = plastic(LEGO.red, { roughness: 0.7 });
      const carrot = plastic(LEGO.orange, { roughness: 0.6 });
      const balls: [number, number][] = [[2.4, 0.55], [1.8, 1.55], [1.25, 2.4]];
      for (const [r, y] of balls) {
        const b = new THREE.Mesh(sphere(r), snow);
        b.position.y = y * PITCH * 2.2;
        b.scale.y = 0.92;
        g.add(b);
      }
      const headY = 2.4 * PITCH * 2.2;
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(roundBrick(0.4, PLATE_H), coal);
        eye.position.set(side * 0.28 * PITCH, headY + 0.35 * PITCH, 1.1 * PITCH);
        g.add(eye);
      }
      const nose = new THREE.Mesh(cone(0.4, 1.2), carrot);
      nose.rotation.x = Math.PI / 2;
      nose.position.set(0, headY + 0.15 * PITCH, 1.3 * PITCH);
      g.add(nose);
      const wrap = new THREE.Mesh(roundBrick(1.6, BRICK_H * 0.7), scarf);
      wrap.position.y = 1.55 * PITCH * 2.2 + 1.1 * PITCH;
      g.add(wrap);
      const tail = new THREE.Mesh(brick(0.8, 2, false), scarf);
      tail.position.set(0.5 * PITCH, 1.55 * PITCH * 2.2 + 0.7 * PITCH, 0.9 * PITCH);
      tail.rotation.z = 0.4;
      g.add(tail);
      return g;
    };

    /** Ice cave: a domed shell with a dark mouth and hanging icicles. */
    const iceCave = (): THREE.Group => {
      const g = new THREE.Group();
      const ice = plastic(LEGO.lightBluishGray, { roughness: 0.4 });
      const glow = plastic(LEGO.transIce, { roughness: 0.3, emissive: LEGO.transIce, emissiveIntensity: 0.35 });
      const shell = new THREE.Mesh(dome(6.5), ice);
      shell.scale.set(1, 0.85, 1);
      g.add(shell);
      const mouth = new THREE.Mesh(dome(2.7), plastic(0x10202e, { roughness: 0.82 }));
      mouth.scale.set(1, 0.95, 1);
      mouth.position.set(0, 0.02, 3.4 * PITCH);
      g.add(mouth);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        const ic = new THREE.Mesh(cone(0.5, 1.5), glow);
        ic.rotation.x = Math.PI;
        ic.position.set(Math.cos(a) * 4.4 * PITCH, 1.3, Math.sin(a) * 4.4 * PITCH);
        g.add(ic);
      }
      return g;
    };

    /** Woolly mammoth: shaggy body, curled tusks and a hanging trunk. */
    const mammoth = (): THREE.Group => {
      const g = new THREE.Group();
      const fur = plastic(0x8a6a4a, { roughness: 0.88 });
      const furDark = plastic(0x6b5137, { roughness: 0.88 });
      const tusk = plastic(0xe8e2d0, { roughness: 0.5 });
      const dark = plastic(0x2b2b30, { roughness: 0.5 });
      const body = new THREE.Mesh(brick(8, 5, false), fur);
      body.position.y = BRICK_H * 2.6;
      g.add(body);
      const hump = new THREE.Mesh(cone(3, 3), furDark);
      hump.position.set(-PITCH * 1.2, BRICK_H * 3.4, 0);
      hump.scale.z = 1.5;
      g.add(hump);
      const head = new THREE.Mesh(brick(4, 4, false), furDark);
      head.position.set(PITCH * 4, BRICK_H * 2.8, 0);
      g.add(head);
      const trunk = new THREE.Mesh(cone(0.9, 3.6), fur);
      trunk.rotation.x = Math.PI;
      trunk.position.set(PITCH * 5.4, BRICK_H * 2.2, 0);
      g.add(trunk);
      for (const side of [-1, 1]) {
        const tuskMesh = new THREE.Mesh(cone(0.5, 3), tusk);
        tuskMesh.position.set(PITCH * 5.3, BRICK_H * 1.6, side * 1.1 * PITCH);
        tuskMesh.rotation.set(-0.7, 0, side * 0.9);
        g.add(tuskMesh);
        const ear = new THREE.Mesh(plate(3, 3), furDark);
        ear.position.set(PITCH * 3.2, BRICK_H * 3.2, side * 2.1 * PITCH);
        ear.rotation.y = side * 1.2;
        g.add(ear);
        const eye = new THREE.Mesh(roundBrick(0.4, PLATE_H), dark);
        eye.position.set(PITCH * 5.2, BRICK_H * 3.4, side * 1.1 * PITCH);
        g.add(eye);
      }
      for (const dx of [2.6, -2.6]) {
        for (const dz of [1.5, -1.5]) {
          const leg = new THREE.Mesh(brick(2, 2, false), fur);
          leg.position.set(dx * PITCH, BRICK_H * 1, dz * PITCH);
          g.add(leg);
        }
      }
      return g;
    };

    /** Research hut: a bright cabin with an antenna and a flag. */
    const researchHut = (): THREE.Group => {
      const g = new THREE.Group();
      const wall = plastic(LEGO.orange, { roughness: 0.7 });
      const roof = plastic(LEGO.darkBluishGray, { roughness: 0.7 });
      const trim = plastic(LEGO.white, { roughness: 0.6 });
      const glow = plastic(0xbfe6ff, { roughness: 0.4, emissive: 0x7fc8ef, emissiveIntensity: 0.9 });
      const body = new THREE.Mesh(brick(7, 5, false), wall);
      body.position.y = BRICK_H * 1.8;
      g.add(body);
      const band = new THREE.Mesh(brick(7.3, 5.3, false), trim);
      band.position.y = BRICK_H * 3.3;
      band.scale.y = 0.25;
      g.add(band);
      const r = new THREE.Mesh(brick(7.6, 5.6, false), roof);
      r.position.y = BRICK_H * 3.7;
      r.scale.y = 0.5;
      g.add(r);
      const win = new THREE.Mesh(plate(2, 2), glow);
      win.position.set(0, BRICK_H * 2.2, PITCH * 2.6);
      win.rotation.x = Math.PI / 2;
      g.add(win);
      const mast = new THREE.Mesh(post(0.25, 4), trim);
      mast.position.set(PITCH * 2.4, BRICK_H * 4, -PITCH * 1.6);
      g.add(mast);
      const flag = new THREE.Mesh(plate(2, 1.5), plastic(LEGO.brightRed, { roughness: 0.6 }));
      flag.position.set(PITCH * 3.4, BRICK_H * 4 + 3.4 * PITCH, -PITCH * 1.6);
      g.add(flag);
      return g;
    };

    // --------------------------------------------------- more volcano dressing

    /** Lava river: a winding molten channel through cracked banks. */
    const lavaRiver = (): THREE.Group => {
      const g = new THREE.Group();
      const lava = lavaMat();
      const rock = plastic(theme.wood, { roughness: 0.96 });
      const dark = plastic(0x1a1512, { roughness: 0.7 });
      const path: [number, number, number][] = [
        [-4, -2, 0.4], [-2, -1, -0.3], [0, 0.5, 0.5], [2, 1.2, -0.2], [4, 2, 0.6],
      ];
      for (const [x, z, rot] of path) {
        const seg = new THREE.Mesh(brick(6, 4, false), lava);
        seg.position.set(x * PITCH, PITCH * 0.16, z * PITCH);
        seg.rotation.y = rot;
        g.add(seg);
        const bank = new THREE.Mesh(brick(7, 5.5, false), rock);
        bank.position.set(x * PITCH, 0, z * PITCH);
        bank.rotation.y = rot;
        bank.scale.set(1, 0.22, 1);
        g.add(bank);
      }
      for (let i = 0; i < 6; i++) {
        const a = i;
        const c = new THREE.Mesh(brick(1.4, 1.4, false), dark);
        c.position.set(Math.cos(a * 2) * 4.4 * PITCH, 0, Math.sin(a * 2) * 3.4 * PITCH);
        c.rotation.y = a;
        g.add(c);
      }
      return g;
    };

    /** Smoke vent: a cracked chimney with a rising plume and a hot throat. */
    const smokeVent = (): THREE.Group => {
      const g = new THREE.Group();
      const rock = plastic(theme.wood, { roughness: 0.95 });
      const dark = plastic(0x1a1512, { roughness: 0.8 });
      const lava = lavaMat();
      const plume = plastic(0x6b6560, { roughness: 1, transparent: true, opacity: 0.5 });
      const base = new THREE.Mesh(cone(4.5, 3), rock);
      g.add(base);
      const chimney = new THREE.Mesh(cylinderZ(1.2, 3), dark);
      chimney.rotation.x = Math.PI / 2;
      chimney.position.set(0, 2.4 * PITCH, 0);
      g.add(chimney);
      const throat = new THREE.Mesh(roundBrick(2, BRICK_H), lava);
      throat.position.y = 2.4 * PITCH;
      g.add(throat);
      for (let i = 0; i < 3; i++) {
        const puff = new THREE.Mesh(sphere(2 + i * 0.6), plume);
        puff.position.set(i * 0.4 * PITCH, (4 + i * 2.2) * PITCH, 0);
        puff.scale.set(1, 0.8, 1);
        g.add(puff);
      }
      return g;
    };

    /** Magma boulder: a cracked rock leaking glowing seams. */
    const magmaBoulder = (): THREE.Group => {
      const g = new THREE.Group();
      const rock = plastic(theme.wood, { roughness: 0.96 });
      const dark = plastic(0x1a1512, { roughness: 0.86 });
      const lava = lavaMat();
      const big = new THREE.Mesh(slopeBrick(8, 6), dark);
      big.position.y = PITCH * 0.4;
      g.add(big);
      const chunk = new THREE.Mesh(brick(4, 4, false), rock);
      chunk.position.set(PITCH * 1.4, PITCH * 0.6, PITCH * 1.2);
      chunk.rotation.y = 0.6;
      g.add(chunk);
      for (let i = 0; i < 4; i++) {
        const vein = new THREE.Mesh(brick(0.6, 4 + i, false), lava);
        vein.position.set((i - 1.5) * 0.7 * PITCH, PITCH * (0.6 + i * 0.15), PITCH * 2.2);
        vein.rotation.set(0.4, i * 0.4, 0.1 * i);
        g.add(vein);
      }
      return g;
    };

    /** Charred pines: a stand of blackened trunks with ember tips. */
    const charredPines = (): THREE.Group => {
      const g = new THREE.Group();
      const bark = plastic(0x241d19, { roughness: 0.95 });
      const ember = plastic(theme.glow ?? 0xff5a1f, { roughness: 0.5, emissive: theme.glow ?? 0xff5a1f, emissiveIntensity: 1.4 });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        const x = Math.cos(a) * 2.2 * PITCH;
        const z = Math.sin(a) * 2.2 * PITCH;
        const h = 4 + (i % 2) * 2;
        const trunk = new THREE.Mesh(post(0.6, h), bark);
        trunk.position.set(x, 0, z);
        trunk.rotation.set(((i % 3) - 1) * 0.06, 0, ((i % 2) - 0.5) * 0.08);
        g.add(trunk);
        const tip = new THREE.Mesh(roundBrick(0.9, BRICK_H), ember);
        tip.position.set(x, h * PITCH, z);
        g.add(tip);
      }
      return g;
    };

    /** Hay bales: round straw bales on their sides, one stacked on top. */
    const hayBales = (): THREE.Group => {
      const g = new THREE.Group();
      const hay = plastic(0xd9b36a, { roughness: 0.88 });
      const straw = plastic(0xc29d55, { roughness: 0.9 });
      const R = 2 * PITCH;
      for (const [x, z, rot] of [
        [-1.6, 0.6, 0.2],
        [1.4, -0.8, 1.3],
        [0.2, 1.8, 2.4],
      ] as [number, number, number][]) {
        const bale = new THREE.Mesh(cylinderZ(2, 2.8), hay);
        bale.position.set(x, R, z);
        bale.rotation.y = rot;
        g.add(bale);
      }
      const top = new THREE.Mesh(cylinderZ(1.7, 2.4), straw);
      top.position.set(-1.6, R * 2.85, 0.6);
      top.rotation.y = 1.7;
      g.add(top);
      return g;
    };

    /** Wayside shrine: stone plinth, tiered roof and a small offering niche. */
    const shrine = (): THREE.Group => {
      const g = new THREE.Group();
      const stone = plastic(0x9a958c, { roughness: 0.85 });
      const stoneDark = plastic(0x6e6a63, { roughness: 0.9 });
      const roofMat = plastic(theme.foliageAlt, { roughness: 0.7 });
      const gold = plastic(LEGO.brightYellow, { roughness: 0.5 });
      const plinth = new THREE.Mesh(brick(4, 4, false), stone);
      plinth.position.y = BRICK_H / 2;
      g.add(plinth);
      const body = new THREE.Mesh(brick(3, 3, false), stoneDark);
      body.position.y = BRICK_H * 1.5;
      g.add(body);
      const niche = new THREE.Mesh(roundBrick(1.2, BRICK_H), plastic(LEGO.tan, { roughness: 0.7 }));
      niche.position.set(0, BRICK_H * 1.4, 1.15 * PITCH);
      g.add(niche);
      const roof1 = new THREE.Mesh(slopeBrick(5, 5), roofMat);
      roof1.position.y = BRICK_H * 2.5;
      g.add(roof1);
      const roof2 = new THREE.Mesh(cone(1.4, 2.2), roofMat);
      roof2.position.y = BRICK_H * 3.2;
      g.add(roof2);
      const tip = new THREE.Mesh(roundBrick(0.6, BRICK_H * 0.6), gold);
      tip.position.y = BRICK_H * 5.4;
      g.add(tip);
      return g;
    };

    /** Flag pole: weighted base, tall mast and a hanging plate flag. */
    const flagPole = (): THREE.Group => {
      const g = new THREE.Group();
      const mast = plastic(0x6e6a63, { roughness: 0.75 });
      const cloth = plastic(LEGO.brightRed, { roughness: 0.6 });
      const base = new THREE.Mesh(brick(3, 3, false), mast);
      base.position.y = BRICK_H / 2;
      g.add(base);
      const pole = new THREE.Mesh(post(0.5, 9), mast);
      g.add(pole);
      const flag = new THREE.Mesh(plate(3.4, 2.2), cloth);
      flag.rotation.x = Math.PI / 2;
      flag.position.set(1.85 * PITCH, 9 * PITCH - 1.2 * PITCH, 0);
      g.add(flag);
      return g;
    };

    /** Supply crates: stacked crates with a barrel tipped beside them. */
    const supplyCrates = (): THREE.Group => {
      const g = new THREE.Group();
      const wood = plastic(0x8a6a3a, { roughness: 0.85 });
      const lid = plastic(0x5c452a, { roughness: 0.85 });
      const barrelMat = plastic(0x6b7a5a, { roughness: 0.7 });
      for (const [x, z, rot] of [
        [-1.1, 0.5, 0],
        [0.9, -0.7, 0.4],
        [-0.2, 1.5, 1.1],
      ] as [number, number, number][]) {
        const box = new THREE.Mesh(brick(3, 3, false), wood);
        box.position.set(x, BRICK_H / 2, z);
        box.rotation.y = rot;
        g.add(box);
        const cap = new THREE.Mesh(plate(3, 3), lid);
        cap.position.set(x, BRICK_H + PLATE_H / 2, z);
        cap.rotation.y = rot;
        g.add(cap);
      }
      const stack = new THREE.Mesh(brick(3, 3, false), wood);
      stack.position.set(-1.1, BRICK_H * 1.5, 0.5);
      stack.rotation.y = 0.5;
      g.add(stack);
      const stackCap = new THREE.Mesh(plate(3, 3), lid);
      stackCap.position.set(-1.1, BRICK_H * 2 + PLATE_H / 2, 0.5);
      stackCap.rotation.y = 0.5;
      g.add(stackCap);
      const barrel = new THREE.Mesh(cylinderZ(1.4, 3), barrelMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(1.9, 1.4 * PITCH, 1.2);
      g.add(barrel);
      return g;
    };

    /** Clay pots: a cluster of terracotta jars with one tipped over. */
    const pottery = (): THREE.Group => {
      const g = new THREE.Group();
      const clay = plastic(0xb06a3c, { roughness: 0.82 });
      const clayDark = plastic(0x8a4f2c, { roughness: 0.85 });
      for (const [x, z, h, mat] of [
        [-1.2, 0.4, 2.2, clay],
        [0.9, -0.6, 1.8, clayDark],
        [0.2, 1.3, 1.5, clay],
      ] as [number, number, number, THREE.Material][]) {
        const pot = new THREE.Mesh(roundBrick(2, h * PITCH), mat);
        pot.position.set(x, 0, z);
        g.add(pot);
        const rim = new THREE.Mesh(torusRing(0.9, 0.28), clayDark);
        rim.rotation.x = Math.PI / 2;
        rim.position.set(x, h * PITCH, z);
        g.add(rim);
      }
      const tipped = new THREE.Mesh(roundBrick(1.8, 1.6 * PITCH), clay);
      tipped.rotation.z = Math.PI / 2;
      tipped.position.set(1.8, 0.9 * PITCH, 1.4);
      g.add(tipped);
      return g;
    };

    /** Bone pile: bleached skull, a ribcage arc and scattered scraps. */
    const bonePile = (): THREE.Group => {
      const g = new THREE.Group();
      const bone = plastic(0xe8e2d4, { roughness: 0.8 });
      const boneDark = plastic(0xc9c0ae, { roughness: 0.85 });
      const skull = new THREE.Mesh(sphere(1.5), bone);
      skull.scale.set(1, 0.85, 1.1);
      skull.position.y = BRICK_H * 0.9;
      g.add(skull);
      const jaw = new THREE.Mesh(brick(1.6, 1, false), boneDark);
      jaw.position.set(0, BRICK_H * 0.4, 1.2 * PITCH);
      g.add(jaw);
      for (let i = 0; i < 5; i++) {
        const rib = new THREE.Mesh(torusRing(1.6 + i * 0.1, 0.3), bone);
        rib.position.set(0, BRICK_H * 0.5, -1.4 * PITCH - i * 0.8 * PITCH);
        rib.rotation.x = Math.PI / 2;
        rib.rotation.z = i % 2 ? 0.2 : -0.2;
        g.add(rib);
      }
      for (const [x, z] of [
        [1.6, -0.8],
        [-1.5, 0.9],
        [0.9, 1.6],
      ] as [number, number][]) {
        const scrap = new THREE.Mesh(brick(1, 2.2, false), boneDark);
        scrap.position.set(x, BRICK_H * 0.3, z);
        scrap.rotation.y = x + z;
        g.add(scrap);
      }
      return g;
    };

    // -------------------------------------------------------------- fauna
    // Little critters. Smaller than landmarks so they read as animals.

    /** Deer: slim body, raised neck, antlers and four legs. */
    const deer = (): THREE.Group => {
      const g = new THREE.Group();
      const fur = plastic(theme.wood, { roughness: 0.76 });
      const belly = plastic(LEGO.tan, { roughness: 0.72 });
      const dark = plastic(0x2b2b30, { roughness: 0.5 });
      const body = new THREE.Mesh(brick(6, 3, false), fur);
      body.position.y = BRICK_H * 2.1;
      g.add(body);
      const neck = new THREE.Mesh(brick(2, 2, false), fur);
      neck.position.set(PITCH * 2.6, BRICK_H * 2.9, 0);
      neck.rotation.z = -0.5;
      g.add(neck);
      const head = new THREE.Mesh(brick(2, 3, false), belly);
      head.position.set(PITCH * 3.8, BRICK_H * 3.5, 0);
      g.add(head);
      for (const side of [-1, 1]) {
        const snoutEye = new THREE.Mesh(brick(0.5, 0.5, false), dark);
        snoutEye.position.set(PITCH * 4.5, BRICK_H * 3.7, side * 0.9 * PITCH);
        g.add(snoutEye);
        for (let i = 0; i < 2; i++) {
          const antler = new THREE.Mesh(brick(0.5, 0.5, false), belly);
          antler.position.set(PITCH * (3.6 + i * 0.7), BRICK_H * (4 + i * 0.7), side * 0.9 * PITCH);
          antler.rotation.z = -0.7;
          g.add(antler);
        }
      }
      const tail = new THREE.Mesh(brick(1, 1, false), belly);
      tail.position.set(-PITCH * 3.4, BRICK_H * 2.4, 0);
      g.add(tail);
      for (const dx of [1.9, -1.9]) {
        for (const dz of [0.9, -0.9]) {
          const leg = new THREE.Mesh(brick(1, 1, false), fur);
          leg.position.set(dx * PITCH, BRICK_H * 0.9, dz * PITCH);
          g.add(leg);
        }
      }
      return g;
    };

    /** Rabbit: a rounded body with tall ears and a cotton tail. */
    const rabbit = (): THREE.Group => {
      const g = new THREE.Group();
      const fur = plastic(0xb9b4ad, { roughness: 0.78 });
      const light = plastic(LEGO.white, { roughness: 0.7 });
      const dark = plastic(0x2b2b30, { roughness: 0.5 });
      const body = new THREE.Mesh(sphere(2.3), fur);
      body.scale.set(1.1, 1, 1.4);
      body.position.y = BRICK_H * 1.4;
      g.add(body);
      const head = new THREE.Mesh(sphere(1.5), fur);
      head.position.set(0, BRICK_H * 2.4, 1.6 * PITCH);
      g.add(head);
      for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(brick(0.7, 1.4, false), fur);
        ear.position.set(side * 0.7 * PITCH, BRICK_H * 3.4, 1.5 * PITCH);
        g.add(ear);
        const eye = new THREE.Mesh(roundBrick(0.4, PLATE_H), dark);
        eye.position.set(side * 0.6 * PITCH, BRICK_H * 2.5, 2.5 * PITCH);
        g.add(eye);
      }
      const tail = new THREE.Mesh(sphere(0.9), light);
      tail.position.set(0, BRICK_H * 1.5, -2.1 * PITCH);
      g.add(tail);
      return g;
    };

    /** Fox: sleek orange body, pointy face and a bushy white-tipped tail. */
    const fox = (): THREE.Group => {
      const g = new THREE.Group();
      const fur = plastic(LEGO.orange, { roughness: 0.72 });
      const light = plastic(LEGO.white, { roughness: 0.7 });
      const dark = plastic(0x2b2b30, { roughness: 0.5 });
      const body = new THREE.Mesh(brick(5, 3, false), fur);
      body.position.y = BRICK_H * 1.5;
      g.add(body);
      const head = new THREE.Mesh(cone(1.6, 2.4), fur);
      head.rotation.x = Math.PI / 2;
      head.position.set(0, BRICK_H * 1.8, 2.6 * PITCH);
      g.add(head);
      for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(cone(0.7, 1.4), fur);
        ear.position.set(side * 0.8 * PITCH, BRICK_H * 2.5, 2 * PITCH);
        g.add(ear);
        const eye = new THREE.Mesh(roundBrick(0.4, PLATE_H), dark);
        eye.position.set(side * 0.7 * PITCH, BRICK_H * 2, 3.2 * PITCH);
        g.add(eye);
      }
      const tail = new THREE.Mesh(cone(1.3, 3.4), fur);
      tail.rotation.x = -Math.PI / 2;
      tail.position.set(0, BRICK_H * 1.7, -2.6 * PITCH);
      g.add(tail);
      const tip = new THREE.Mesh(sphere(0.8), light);
      tip.position.set(0, BRICK_H * 1.7, -4.2 * PITCH);
      g.add(tip);
      for (const dx of [1.5, -1.5]) {
        for (const dz of [0.8, -0.8]) {
          const leg = new THREE.Mesh(brick(0.9, 0.9, false), dark);
          leg.position.set(dx * PITCH, BRICK_H * 0.7, dz * PITCH);
          g.add(leg);
        }
      }
      return g;
    };

    /** Owl: perched on a stump post, with big eyes and folded wings. */
    const owl = (): THREE.Group => {
      const g = new THREE.Group();
      const bark = plastic(theme.wood, { roughness: 0.88 });
      const body = plastic(0x7a5c3a, { roughness: 0.8 });
      const face = plastic(0xd8c7a6, { roughness: 0.75 });
      const eyeMat = plastic(LEGO.brightYellow, { roughness: 0.4, emissive: LEGO.yellow, emissiveIntensity: 0.5 });
      const beak = plastic(LEGO.orange, { roughness: 0.6 });
      const perch = new THREE.Mesh(post(0.6, 2.4), bark);
      g.add(perch);
      const chest = new THREE.Mesh(dome(2.2), body);
      chest.position.y = 2.4 * PITCH;
      g.add(chest);
      const disc = new THREE.Mesh(roundBrick(2, PLATE_H), face);
      disc.position.set(0, 2.4 * PITCH + 1.4 * PITCH, 0.6 * PITCH);
      disc.rotation.x = Math.PI / 2;
      g.add(disc);
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(roundBrick(0.7, PLATE_H * 1.4), eyeMat);
        eye.position.set(side * 0.7 * PITCH, 2.4 * PITCH + 1.6 * PITCH, 1 * PITCH);
        g.add(eye);
        const wing = new THREE.Mesh(plate(1.4, 3), body);
        wing.position.set(side * 1.8 * PITCH, 2.4 * PITCH + 0.6 * PITCH, 0);
        wing.rotation.y = side * 0.3;
        g.add(wing);
      }
      const nose = new THREE.Mesh(cone(0.4, 0.9), beak);
      nose.rotation.x = Math.PI / 2;
      nose.position.set(0, 2.4 * PITCH + 1.4 * PITCH, 1.3 * PITCH);
      g.add(nose);
      return g;
    };

    /** Camel: humped body, long neck and a blunt muzzle. */
    const camel = (): THREE.Group => {
      const g = new THREE.Group();
      const hide = plastic(LEGO.tan, { roughness: 0.8 });
      const hideDark = plastic(0xc7a86a, { roughness: 0.78 });
      const dark = plastic(0x2b2b30, { roughness: 0.5 });
      const body = new THREE.Mesh(brick(7, 4, false), hide);
      body.position.y = BRICK_H * 2.6;
      g.add(body);
      for (const dx of [1.4, -1.4]) {
        const hump = new THREE.Mesh(dome(2.4), hideDark);
        hump.position.set(dx * PITCH, BRICK_H * 3.4, 0);
        g.add(hump);
      }
      const neck = new THREE.Mesh(brick(2, 2, false), hide);
      neck.position.set(PITCH * 3.4, BRICK_H * 3.4, 0);
      neck.rotation.z = -0.35;
      g.add(neck);
      const head = new THREE.Mesh(brick(2, 3, false), hideDark);
      head.position.set(PITCH * 4.4, BRICK_H * 4.2, 0);
      g.add(head);
      const muzzle = new THREE.Mesh(brick(1, 1.4, false), hide);
      muzzle.position.set(PITCH * 5.3, BRICK_H * 4, 0);
      g.add(muzzle);
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(roundBrick(0.4, PLATE_H), dark);
        eye.position.set(PITCH * 4.8, BRICK_H * 4.5, side * 0.9 * PITCH);
        g.add(eye);
        const ear = new THREE.Mesh(roundBrick(0.5, PLATE_H), hide);
        ear.position.set(PITCH * 4.2, BRICK_H * 4.7, side * 0.9 * PITCH);
        g.add(ear);
      }
      for (const dx of [2.4, -2.4]) {
        for (const dz of [1.1, -1.1]) {
          const leg = new THREE.Mesh(brick(1.1, 1.1, false), hide);
          leg.position.set(dx * PITCH, BRICK_H * 1.1, dz * PITCH);
          g.add(leg);
        }
      }
      const tail = new THREE.Mesh(brick(0.7, 1.4, false), hideDark);
      tail.position.set(-PITCH * 3.7, BRICK_H * 2.2, 0);
      g.add(tail);
      return g;
    };

    /** Scorpion: segmented body, curved sting and two pincers. */
    const scorpion = (): THREE.Group => {
      const g = new THREE.Group();
      const shell = plastic(0x3a2a1e, { roughness: 0.55 });
      const claw = plastic(LEGO.orange, { roughness: 0.6 });
      const glow = plastic(theme.glow ?? 0xffbf4d, { roughness: 0.5, emissive: theme.glow ?? 0xffbf4d, emissiveIntensity: 0.6 });
      const body = new THREE.Mesh(roundBrick(2.4, BRICK_H * 0.9), shell);
      body.position.y = BRICK_H * 0.7;
      g.add(body);
      const head = new THREE.Mesh(roundBrick(1.6, BRICK_H * 0.8), shell);
      head.position.set(0, BRICK_H * 0.65, 1.6 * PITCH);
      g.add(head);
      let px = 0;
      let pz = -1.4 * PITCH;
      for (let i = 0; i < 4; i++) {
        const seg = new THREE.Mesh(roundBrick(1.4 - i * 0.18, BRICK_H * 0.7), shell);
        pz -= 0.7 * PITCH;
        px += 0.1 * PITCH;
        const y = BRICK_H * (0.7 + i * 0.35);
        seg.position.set(px, y, pz);
        g.add(seg);
      }
      const sting = new THREE.Mesh(cone(0.5, 1.4), glow);
      sting.rotation.x = Math.PI;
      sting.position.set(px, BRICK_H * 0.7 + 4 * 0.35 * BRICK_H + 0.4 * PITCH, pz);
      g.add(sting);
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(brick(1, 2.4, false), shell);
        arm.position.set(side * 1.2 * PITCH, BRICK_H * 0.6, 1.8 * PITCH);
        arm.rotation.y = side * -0.5;
        g.add(arm);
        const pincer = new THREE.Mesh(roundBrick(1.1, BRICK_H * 0.8), claw);
        pincer.position.set(side * 1.8 * PITCH, BRICK_H * 0.6, 3 * PITCH);
        g.add(pincer);
      }
      for (let i = 0; i < 3; i++) {
        for (const side of [-1, 1]) {
          const leg = new THREE.Mesh(brick(0.6, 1.6, false), shell);
          leg.position.set(side * 1.3 * PITCH, BRICK_H * 0.35, (i - 0.5) * 0.9 * PITCH);
          leg.rotation.y = side * 0.9;
          g.add(leg);
        }
      }
      return g;
    };

    /** Lizard: a low body, long tail and a splayed stance. */
    const lizard = (): THREE.Group => {
      const g = new THREE.Group();
      const skin = plastic(0x6f8a3a, { roughness: 0.72 });
      const skin2 = plastic(0x8fa84e, { roughness: 0.7 });
      const dark = plastic(0x2b2b30, { roughness: 0.5 });
      const body = new THREE.Mesh(brick(4, 2, false), skin);
      body.position.y = BRICK_H * 0.9;
      g.add(body);
      const head = new THREE.Mesh(cone(1, 1.8), skin2);
      head.rotation.x = Math.PI / 2;
      head.position.set(0, BRICK_H * 1, 2.4 * PITCH);
      g.add(head);
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(roundBrick(0.4, PLATE_H), dark);
        eye.position.set(side * 0.5 * PITCH, BRICK_H * 1.4, 2 * PITCH);
        g.add(eye);
      }
      const tail = new THREE.Mesh(cone(0.7, 3.6), skin);
      tail.rotation.x = -Math.PI / 2;
      tail.position.set(0, BRICK_H * 0.9, -2.4 * PITCH);
      g.add(tail);
      for (const dx of [1.3, -1.3]) {
        for (const dz of [0.9, -0.9]) {
          const leg = new THREE.Mesh(brick(0.6, 1.4, false), skin2);
          leg.position.set(dx * PITCH, BRICK_H * 0.5, dz * PITCH);
          leg.rotation.y = (dx * dz > 0 ? 1 : -1) * 0.8;
          g.add(leg);
        }
      }
      return g;
    };

    /** Penguin: upright black body, white front, orange beak and feet. */
    const penguin = (): THREE.Group => {
      const g = new THREE.Group();
      const black = plastic(0x22272e, { roughness: 0.6 });
      const white = plastic(LEGO.white, { roughness: 0.6 });
      const beak = plastic(LEGO.orange, { roughness: 0.6 });
      const body = new THREE.Mesh(roundBrick(3, BRICK_H * 3), black);
      g.add(body);
      const belly = new THREE.Mesh(roundBrick(2.2, BRICK_H * 2.4), white);
      belly.position.set(0, 0, 0.5 * PITCH);
      g.add(belly);
      const head = new THREE.Mesh(roundBrick(2.4, BRICK_H * 1.4), black);
      head.position.y = BRICK_H * 3;
      g.add(head);
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(roundBrick(0.4, PLATE_H), white);
        eye.position.set(side * 0.6 * PITCH, BRICK_H * 3.6, 1 * PITCH);
        g.add(eye);
        const wing = new THREE.Mesh(plate(1.2, 3), black);
        wing.position.set(side * 1.5 * PITCH, BRICK_H * 1.6, 0);
        wing.rotation.y = side * 0.35;
        g.add(wing);
        const foot = new THREE.Mesh(brick(1.2, 1.6, false), beak);
        foot.position.set(side * 0.7 * PITCH, 0, 1 * PITCH);
        g.add(foot);
      }
      const nose = new THREE.Mesh(cone(0.5, 1.1), beak);
      nose.rotation.x = Math.PI / 2;
      nose.position.set(0, BRICK_H * 3.4, 1.4 * PITCH);
      g.add(nose);
      return g;
    };

    /** Seal: a smooth blubbery body, whiskers and back flippers. */
    const seal = (): THREE.Group => {
      const g = new THREE.Group();
      const skin = plastic(0x9aa4ad, { roughness: 0.55 });
      const light = plastic(0xc7d0d6, { roughness: 0.55 });
      const dark = plastic(0x2b2b30, { roughness: 0.5 });
      const body = new THREE.Mesh(sphere(2.4), skin);
      body.scale.set(1, 0.8, 1.7);
      body.position.y = BRICK_H * 1.2;
      g.add(body);
      const head = new THREE.Mesh(sphere(1.4), light);
      head.position.set(0, BRICK_H * 1.5, 2.4 * PITCH);
      g.add(head);
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(roundBrick(0.4, PLATE_H), dark);
        eye.position.set(side * 0.6 * PITCH, BRICK_H * 1.7, 3.4 * PITCH);
        g.add(eye);
        const flip = new THREE.Mesh(brick(1, 2.6, false), skin);
        flip.position.set(side * 0.9 * PITCH, BRICK_H * 0.5, -3 * PITCH);
        flip.rotation.set(0.5, 0, side * 0.4);
        g.add(flip);
      }
      const nose = new THREE.Mesh(roundBrick(0.5, PLATE_H), dark);
      nose.position.set(0, BRICK_H * 1.4, 3.7 * PITCH);
      g.add(nose);
      return g;
    };

    /** Arctic fox: white coat with a thick tail and dark nose. */
    const arcticFox = (): THREE.Group => {
      const g = new THREE.Group();
      const fur = plastic(LEGO.white, { roughness: 0.74 });
      const fur2 = plastic(LEGO.lightBluishGray, { roughness: 0.7 });
      const dark = plastic(0x2b2b30, { roughness: 0.5 });
      const body = new THREE.Mesh(brick(5, 3, false), fur);
      body.position.y = BRICK_H * 1.4;
      g.add(body);
      const head = new THREE.Mesh(cone(1.5, 2.2), fur);
      head.rotation.x = Math.PI / 2;
      head.position.set(0, BRICK_H * 1.7, 2.4 * PITCH);
      g.add(head);
      for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(cone(0.7, 1.3), fur2);
        ear.position.set(side * 0.8 * PITCH, BRICK_H * 2.4, 1.9 * PITCH);
        g.add(ear);
      }
      const nose = new THREE.Mesh(roundBrick(0.4, PLATE_H), dark);
      nose.position.set(0, BRICK_H * 1.6, 3.6 * PITCH);
      g.add(nose);
      const tail = new THREE.Mesh(cone(1.4, 3.6), fur2);
      tail.rotation.x = -Math.PI / 2;
      tail.position.set(0, BRICK_H * 1.7, -2.7 * PITCH);
      g.add(tail);
      for (const dx of [1.5, -1.5]) {
        for (const dz of [0.8, -0.8]) {
          const leg = new THREE.Mesh(brick(0.9, 0.9, false), fur2);
          leg.position.set(dx * PITCH, BRICK_H * 0.6, dz * PITCH);
          g.add(leg);
        }
      }
      return g;
    };

    /** Lava slime: a glowing blob that oozes over the rock. */
    const lavaSlime = (): THREE.Group => {
      const g = new THREE.Group();
      const core = plastic(theme.glow ?? 0xff5a1f, { roughness: 0.4, emissive: theme.glow ?? 0xff5a1f, emissiveIntensity: 1.6 });
      const shell = plastic(0x3a2420, { roughness: 0.7, transparent: true, opacity: 0.6 });
      const dark = plastic(0x2b2b30, { roughness: 0.5 });
      const blob = new THREE.Mesh(dome(3), shell);
      blob.scale.set(1, 0.8, 1);
      g.add(blob);
      const glow = new THREE.Mesh(sphere(1.8), core);
      glow.position.y = BRICK_H * 1;
      glow.scale.set(1, 0.8, 1);
      g.add(glow);
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(roundBrick(0.5, PLATE_H), dark);
        eye.position.set(side * 0.7 * PITCH, BRICK_H * 1.4, 2 * PITCH);
        g.add(eye);
      }
      return g;
    };

    /** Fire bat: a black winged shape with glowing eyes. */
    const fireBat = (): THREE.Group => {
      const g = new THREE.Group();
      const body = plastic(0x241d19, { roughness: 0.7 });
      const wing = plastic(0x3a2a24, { roughness: 0.75 });
      const ember = plastic(theme.glow ?? 0xff5a1f, { roughness: 0.4, emissive: theme.glow ?? 0xff5a1f, emissiveIntensity: 1.5 });
      const torso = new THREE.Mesh(roundBrick(1.6, BRICK_H * 1.8), body);
      torso.position.y = BRICK_H * 1.4;
      g.add(torso);
      const head = new THREE.Mesh(roundBrick(1.2, BRICK_H * 1.2), body);
      head.position.set(0, BRICK_H * 2.6, 0.2 * PITCH);
      g.add(head);
      for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(cone(0.5, 1.2), body);
        ear.position.set(side * 0.5 * PITCH, BRICK_H * 3.3, 0.2 * PITCH);
        g.add(ear);
        const eye = new THREE.Mesh(roundBrick(0.35, PLATE_H), ember);
        eye.position.set(side * 0.4 * PITCH, BRICK_H * 2.7, 1 * PITCH);
        g.add(eye);
        const w = new THREE.Mesh(plate(2.6, 3), wing);
        w.position.set(side * 1.6 * PITCH, BRICK_H * 1.6, -0.2 * PITCH);
        w.rotation.set(0.2, side * 0.5, side * 0.9);
        g.add(w);
      }
      return g;
    };

    /** Magma crab: a cracked shell with glowing seams and heavy claws. */
    const magmaCrab = (): THREE.Group => {
      const g = new THREE.Group();
      const shell = plastic(0x2a1c16, { roughness: 0.6 });
      const lava = lavaMat();
      const legs = plastic(0x1a1512, { roughness: 0.7 });
      const body = new THREE.Mesh(dome(3), shell);
      body.scale.set(1.2, 0.6, 1);
      body.position.y = BRICK_H * 0.6;
      g.add(body);
      for (let i = 0; i < 3; i++) {
        const seam = new THREE.Mesh(brick(0.5, 3 - i * 0.6, false), lava);
        seam.position.set((i - 1) * 0.7 * PITCH, BRICK_H * 0.9, 0);
        g.add(seam);
      }
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(brick(1.2, 2.2, false), shell);
        arm.position.set(side * 1.6 * PITCH, BRICK_H * 0.7, 1.6 * PITCH);
        arm.rotation.y = side * -0.6;
        g.add(arm);
        const pincer = new THREE.Mesh(roundBrick(1.3, BRICK_H * 0.9), shell);
        pincer.position.set(side * 2.4 * PITCH, BRICK_H * 0.7, 2.8 * PITCH);
        g.add(pincer);
        const clawGlow = new THREE.Mesh(roundBrick(0.6, PLATE_H), lava);
        clawGlow.position.set(side * 2.9 * PITCH, BRICK_H * 0.7, 3.4 * PITCH);
        g.add(clawGlow);
        for (let i = 0; i < 3; i++) {
          const leg = new THREE.Mesh(brick(0.6, 1.6, false), legs);
          leg.position.set(side * 1.8 * PITCH, BRICK_H * 0.4, (i - 1) * 0.9 * PITCH);
          leg.rotation.set(0, side * 0.7, 0);
          g.add(leg);
        }
        const eye = new THREE.Mesh(roundBrick(0.4, PLATE_H), lava);
        eye.position.set(side * 0.7 * PITCH, BRICK_H * 1.2, 1.4 * PITCH);
        g.add(eye);
      }
      return g;
    };

    /** Butterfly: bright plate wings on a thin body, hovering low. */
    const butterfly = (): THREE.Group => {
      const g = new THREE.Group();
      const body = plastic(0x2b2b30, { roughness: 0.5 });
      const wingA = plastic(LEGO.brightYellow, { roughness: 0.55 });
      const wingB = plastic(LEGO.orange, { roughness: 0.55 });
      const thorax = new THREE.Mesh(post(0.35, 1.2), body);
      thorax.rotation.z = Math.PI / 2;
      thorax.position.y = BRICK_H * 2.2;
      g.add(thorax);
      for (const side of [-1, 1]) {
        const w = new THREE.Mesh(plate(2.2, 1.6), side === 1 ? wingA : wingB);
        w.position.set(side * 1.1 * PITCH, BRICK_H * 2.4, 0);
        w.rotation.z = side * 0.35;
        g.add(w);
        const w2 = new THREE.Mesh(plate(1.6, 1.2), side === 1 ? wingB : wingA);
        w2.position.set(side * 0.9 * PITCH, BRICK_H * 2.1, -PITCH);
        w2.rotation.z = side * 0.5;
        g.add(w2);
      }
      return g;
    };

    /** Goat: stocky body, short horns and a little beard. */
    const goat = (): THREE.Group => {
      const g = new THREE.Group();
      const hide = plastic(0xd8d2c6, { roughness: 0.8 });
      const dark = plastic(0x6e6a63, { roughness: 0.65 });
      const body = new THREE.Mesh(brick(4, 2.4, false), hide);
      body.position.y = BRICK_H * 1.6;
      g.add(body);
      const neck = new THREE.Mesh(brick(1.4, 1.4, false), hide);
      neck.position.set(PITCH * 1.9, BRICK_H * 2.1, 0);
      neck.rotation.z = -0.4;
      g.add(neck);
      const head = new THREE.Mesh(brick(1.6, 1.2, false), hide);
      head.position.set(PITCH * 2.8, BRICK_H * 2.5, 0);
      g.add(head);
      for (const side of [-1, 1]) {
        const horn = new THREE.Mesh(post(0.3, 1), dark);
        horn.position.set(PITCH * 2.5, BRICK_H * 2.9, side * 0.5 * PITCH);
        horn.rotation.z = -0.5;
        g.add(horn);
      }
      const beard = new THREE.Mesh(brick(0.6, 0.6, false), dark);
      beard.position.set(PITCH * 3.1, BRICK_H * 1.9, 0);
      g.add(beard);
      for (const dx of [1.2, -1.2]) {
        for (const dz of [0.7, -0.7]) {
          const leg = new THREE.Mesh(brick(0.7, 0.7, false), dark);
          leg.position.set(dx * PITCH, BRICK_H * 0.5, dz * PITCH);
          g.add(leg);
        }
      }
      return g;
    };

    /** Crow: black bird with spread wings and a sharp beak. */
    const crow = (): THREE.Group => {
      const g = new THREE.Group();
      const black = plastic(0x1e2226, { roughness: 0.55 });
      const beak = plastic(LEGO.orange, { roughness: 0.6 });
      const body = new THREE.Mesh(sphere(1.3), black);
      body.scale.set(1, 0.9, 1.5);
      body.position.y = BRICK_H * 1.1;
      g.add(body);
      const head = new THREE.Mesh(sphere(0.9), black);
      head.position.set(0, BRICK_H * 1.8, 1.4 * PITCH);
      g.add(head);
      const bill = new THREE.Mesh(cone(0.35, 1), beak);
      bill.rotation.x = Math.PI / 2;
      bill.position.set(0, BRICK_H * 1.7, 2.3 * PITCH);
      g.add(bill);
      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(plate(2.6, 1.4), black);
        wing.position.set(side * 1.4 * PITCH, BRICK_H * 1.4, 0);
        wing.rotation.z = side * 0.3;
        g.add(wing);
        const foot = new THREE.Mesh(post(0.25, 0.8), beak);
        foot.position.set(side * 0.5 * PITCH, 0, 0.3 * PITCH);
        g.add(foot);
      }
      const tail = new THREE.Mesh(plate(1.2, 2), black);
      tail.position.set(0, BRICK_H * 1.1, -1.8 * PITCH);
      g.add(tail);
      return g;
    };

    const landmarkMakers: Record<string, () => THREE.Group> = {
      pyramid,
      sphinx,
      obelisk,
      boulder,
      stump,
      bigTree,
      campfire,
      oasis,
      iceberg,
      iceArch,
      igloo,
      polarBear,
      volcano,
      obsidian,
      obsidianSpire,
      lavaPit,
      rockArch,
      logCabin,
      lookoutTower,
      mushroomRing,
      tent,
      ruins,
      skull,
      well,
      snowman,
      iceCave,
      mammoth,
      researchHut,
      lavaRiver,
      smokeVent,
      magmaBoulder,
      charredPines,
      hayBales,
      shrine,
      flagPole,
      supplyCrates,
      pottery,
      bonePile,
    };

    const faunaMakers: Record<string, () => THREE.Group> = {
      polarBear,
      deer,
      rabbit,
      fox,
      owl,
      camel,
      scorpion,
      lizard,
      penguin,
      seal,
      arcticFox,
      lavaSlime,
      fireBat,
      magmaCrab,
      butterfly,
      goat,
      crow,
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
    // Per-map variant: each archetype gets its own scatter layout, landmark
    // arrangement and dressing rotation, so the six maps are not all the same
    // board with a different lane painted on it.
    const variant = Math.max(0, MAP_ORDER.indexOf(currentMap().id));
    // Start right at the plate kerb and pack all the way out to the ridges, so
    // the landscape reads as continuous ground cover rather than props dotted
    // on an empty plain.
    // Far enough out that even the widest prop at max scale cannot reach over
    // the plate edge (a broadleaf canopy is ~1.3 units across).
    const NEAR = HALF + 1.4;
    const FAR = HALF + 27;

    // Each call scatters one prop type. Ranges deliberately overlap so the
    // types interleave instead of stacking into visible depth bands.
    //
    // The scale factor matters as much as the count: a tree that is a sixth
    // of the board's width reads as a sapling, and a forest of saplings is
    // just a plain with specks on it.
    const band = (count: number, r0: number, r1: number, seed: number): Scatter[] =>
      scaleUp(scatterClumps(count, r0, r1, seed + variant * 3.7), PROP_SCALE);

    if (theme.terrain === 'grass') {
      // Forest: packed in three depth bands so the near ground is thick with
      // trees and the far ground still closes the horizon.
      bandOf('broadleaf', broadleaf, band(104, NEAR, HALF + 14, 0.4));
      bandOf('pine', pine, band(60, HALF + 7, HALF + 22, 1.9));
      bandOf('broadleaf', broadleaf, band(44, HALF + 13, FAR, 3.3));
      bandOf('fallenLog', fallenLog, band(16, NEAR + 1, HALF + 18, 2.2));
      bandOf('undergrowth', undergrowth, band(44, NEAR - 0.5, HALF + 21, 5.1));
      bandOf('undergrowth', undergrowth, band(22, HALF + 16, FAR, 6.6));
    } else if (theme.terrain === 'sand') {
      bandOf('cactus', cactus, band(70, NEAR, HALF + 14, 0.7));
      bandOf('cactus', cactus, band(44, HALF + 9, FAR, 2.8));
      bandOf('palm', palm, band(24, NEAR + 0.8, HALF + 21, 1.3));
      bandOf('obelisk', obelisk, band(12, HALF + 5, HALF + 25, 4.6));
      bandOf('palm', palm, band(10, HALF + 15, FAR, 5.2));
    } else if (theme.terrain === 'snow') {
      bandOf('pine', pine, band(78, NEAR, HALF + 14, 0.9));
      bandOf('pine', pine, band(48, HALF + 9, FAR, 3.7));
      bandOf('iceSpire', iceSpire, band(34, NEAR, HALF + 23, 2.4));
      bandOf('pine', pine, band(18, HALF + 18, FAR, 5.5));
    } else {
      bandOf('burnt', burnt, band(72, NEAR, HALF + 14, 1.1));
      bandOf('burnt', burnt, band(46, HALF + 9, FAR, 4.2));
      bandOf('obsidian', obsidian, band(38, NEAR, HALF + 21, 2.9));
      bandOf('burnt', burnt, band(16, HALF + 17, FAR, 6.1));
    }

    // ---------------------------------------------------------- the surround
    // The land outside the baseplate. A belt of trees wraps the arena so the
    // environment closes around it, woodland runs on behind that, and rocks,
    // old ruins and little oasis patches fill the space between.
    const spec = theme.surround;
    const BELT_IN = HALF + 1.6;
    const BELT_OUT = HALF + 6.4;
    const GROVE_OUT = HALF + 15;
    const [primary, secondary] = spec.beltTrees;

    // The belt steps evenly around the arena, with the two tree kinds
    // alternating, so the treeline is continuous instead of patchy.
    const beltSpots = scaleUp(
      scatterBelt(spec.belt, BELT_IN, BELT_OUT, 11 + variant * 1.3),
      PROP_SCALE * 1.15,
    );
    const primarySpots: Scatter[] = [];
    const secondarySpots: Scatter[] = [];
    beltSpots.forEach((s, i) => (i % 2 ? secondarySpots : primarySpots).push(s));
    bandOf(primary, treeMakers[primary], primarySpots);
    bandOf(secondary, treeMakers[secondary], secondarySpots);

    // Woodland behind the belt: clumps of mixed species, thinning with depth.
    const groveA = scaleUp(
      scatterClumps(Math.round(spec.grove * 0.62), BELT_OUT, GROVE_OUT, 21 + variant),
      PROP_SCALE * 1.3,
    );
    const groveB = scaleUp(
      scatterClumps(Math.round(spec.grove * 0.38), BELT_OUT + 2, GROVE_OUT + 2, 33 + variant),
      PROP_SCALE * 1.3,
    );
    bandOf(primary, farTreeMakers[primary], groveA);
    bandOf(secondary, farTreeMakers[secondary], groveB);

    // The outer woods fade out towards the horizon ridges.
    const outer = scaleUp(
      scatterClumps(spec.outskirt, GROVE_OUT, FAR, 44 + variant),
      PROP_SCALE * 1.6,
    );
    bandOf(primary, farTreeMakers[primary], outer);

    // Rocks, old ruins and oasis patches, spread evenly so none of them hide
    // behind another from the play camera.
    const rockSpots = scaleUp(scatterBelt(spec.rocks, HALF + 3, HALF + 20, 55 + variant), PROP_SCALE * 0.9);
    bandOf('rockCluster', rockCluster, rockSpots);
    const ruinSpots = scaleUp(scatterBelt(spec.ruins, HALF + 5, HALF + 19, 66 + variant), PROP_SCALE);
    bandOf('ancientRuin', ancientRuin, ruinSpots);
    const patchSpots = scaleUp(scatterBelt(spec.patches, HALF + 17, FAR - 3, 77 + variant), PROP_SCALE * 0.8);
    bandOf('groundPatch', groundPatch, patchSpots);

    // A worn clearing around the baseplate, fading back into the terrain, so
    // the forest starts at a believable distance instead of growing out of
    // the kerb.
    for (const [r0, r1, tint] of [
      [HALF + 0.9, HALF + 3.4, 1],
      [HALF + 3.4, HALF + 6.2, 0.5],
    ] as [number, number, number][]) {
      const worn = new THREE.Mesh(
        new THREE.RingGeometry(r0, r1, 72, 1),
        plastic(mixColor(spec.floor, theme.ground, tint), { roughness: 0.98 }),
      );
      worn.rotation.x = -Math.PI / 2;
      worn.position.y = -0.494;
      worn.receiveShadow = true;
      decor.add(worn);
    }

    // Ambient occlusion under everything in the woods: the shadow map is too
    // coarse out here to ground a tree, so each prop gets a soft blob of
    // shade as well.
    const ao = contactShadows([
      { spots: primarySpots, radius: 0.95 },
      { spots: secondarySpots, radius: 0.95 },
      { spots: groveA, radius: 0.85 },
      { spots: groveB, radius: 0.85 },
      { spots: outer, radius: 0.8 },
      { spots: rockSpots, radius: 0.85 },
      { spots: ruinSpots, radius: 1.7 },
      { spots: patchSpots, radius: 3.6 },
    ]);
    if (ao) decor.add(ao);

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

    // The hand-placed dressing keeps its radius but swings around the board by
    // the map variant, so no two maps stage the same silhouette in the same place.
    const vrot = variant * (Math.PI / 5);
    const spin = (x: number, z: number): [number, number] => [
      x * Math.cos(vrot) - z * Math.sin(vrot),
      x * Math.sin(vrot) + z * Math.cos(vrot),
    ];

    for (const [bx, bz, col] of [
      [-ring * 0.45, ring * 1.05, theme.scatter],
      [ring * 0.5, -ring * 1.02, theme.scatter],
      [-ring * 1.02, ring * 0.25, theme.scatter],
      [ring * 0.62, ring * 0.52, theme.foliageAlt],
    ] as [number, number, number][]) {
      const [sx, sz] = spin(bx, bz);
      decor.add(bush(sx, sz, col));
    }

    // Rocks anchor the scene and vary the silhouette per theme.
    for (const [rx, rz, i] of [
      [-ring * 0.72, -ring * 0.62, 1],
      [ring * 0.66, -ring * 0.5, 2],
      [-ring * 0.2, -ring * 1.2, 3],
    ] as [number, number, number][]) {
      const [sx, sz] = spin(rx, rz);
      decor.add(rock(sx, sz, theme.wood, i));
    }

    const [pileX, pileZ] = spin(ring * 0.4, ring * 1.08);
    pile.position.set(pileX, -0.5, pileZ);
    decor.add(pile);

    // Hero props sit at fixed spots just clear of the baseplate. Bumped up in
    // scale so they read as landmarks rather than large scatter from the play
    // camera, and pulled a touch closer than the outer scatter so the eye lands
    // on them.
    const landmarkSpots: [number, number, number, number][] = [
      [-ring * 1.12, ring * 0.52, 1.75, 0.5],
      [ring * 1.08, -ring * 0.6, 1.5, 2.1],
      [-ring * 0.46, ring * 1.12, 1.3, 1.1],
      [ring * 0.82, ring * 1.02, 1.12, 3.4],
      [ring * 1.14, ring * 0.48, 1.4, 5.2],
      [-ring * 0.9, -ring * 1.0, 1.22, 0.3],
      [ring * 0.38, ring * 1.16, 1.08, 4.8],
      [-ring * 1.16, -ring * 0.24, 1.16, 1.8],
      [ring * 0.12, -ring * 1.18, 1.05, 2.7],
      [-ring * 0.62, -ring * 1.08, 0.98, 5.8],
      [ring * 0.92, ring * 0.82, 1.02, 0.9],
      [-ring * 1.02, ring * 0.78, 1.1, 3.9],
      // Outer ring: a touch smaller so the near spots stay the heroes.
      [ring * 1.3, -ring * 0.1, 0.9, 1.4],
      [-ring * 1.34, ring * 0.1, 0.95, 4.2],
      [ring * 0.2, ring * 1.32, 0.88, 2.3],
      [-ring * 0.2, -ring * 1.3, 0.92, 5.5],
      [ring * 1.24, ring * 0.86, 0.85, 3.1],
      [-ring * 1.18, -ring * 0.88, 0.87, 0.7],
    ];
    theme.landmarks.forEach((kind, i) => {
      const make = landmarkMakers[kind];
      if (!make) return;
      const [x, z, scale, rot] = landmarkSpots[(i * 5 + variant * 2) % landmarkSpots.length];
      const o = make();
      o.position.set(x, -0.5, z);
      o.scale.setScalar(scale * (0.94 + ((i * 2 + variant) % 4) * 0.04));
      o.rotation.y = rot + variant * 0.7;
      addShadows(o);
      decor.add(o);
      this.landmarks.push(o);
      this.sceneryKinds.push(kind);
      count(kind, 1);
    });
    // Each map also carries one or two extra props from its theme's own
    // roster, placed smaller and further out, so the archetypes differ in
    // content as well as position.
    const extraCount = 1 + (variant % 3);
    for (let k = 0; k < extraCount; k++) {
      const kind = theme.landmarks[(variant * 2 + k * 3) % theme.landmarks.length];
      const make = landmarkMakers[kind];
      if (!make) continue;
      const [x, z, scale, rot] = landmarkSpots[(7 + variant * 3 + k * 4) % landmarkSpots.length];
      const o = make();
      o.position.set(x, -0.5, z);
      o.scale.setScalar(scale * 0.72);
      o.rotation.y = rot + 1.3 + variant * 0.5;
      addShadows(o);
      decor.add(o);
      this.landmarks.push(o);
      this.sceneryKinds.push(kind);
      count(kind, 1);
    }

    // Fauna: smaller animals, closer in so they read at play scale.
    if (theme.fauna?.length) {
      const faunaSpots: [number, number, number, number][] = [
        [ring * 0.8, ring * 0.3, 0.72, 1.2],
        [-ring * 0.7, ring * 0.6, 0.68, 2.4],
        [ring * 0.3, -ring * 0.82, 0.64, 3.8],
        [-ring * 0.88, -ring * 0.62, 0.66, 0.4],
        [ring * 0.58, ring * 0.72, 0.62, 4.6],
        [-ring * 0.38, -ring * 0.92, 0.7, 2.9],
        [ring * 0.95, -ring * 0.35, 0.6, 5.1],
        [-ring * 0.15, ring * 0.95, 0.66, 1.7],
        [ring * 0.05, -ring * 0.98, 0.62, 3.3],
        [-ring * 0.95, ring * 0.15, 0.64, 0.9],
      ];
      theme.fauna.forEach((kind, i) => {
        const make = faunaMakers[kind];
        if (!make) return;
        const base = faunaSpots[(i * 3 + variant * 2) % faunaSpots.length];
        const copies = 2 + ((i + variant) % 2);
        for (let j = 0; j < copies; j++) {
          const [bx, bz, bs, brot] = base;
          const spread = (j - (copies - 1) / 2) * (0.55 * PITCH);
          const o = make();
          o.position.set(bx + spread, -0.5, bz + spread * 0.6);
          o.scale.setScalar(bs * (0.95 + j * 0.06));
          o.rotation.y = brot + variant * 0.9 + j * 1.2;
          addShadows(o);
          decor.add(o);
          this.sceneryKinds.push(kind);
          count(kind, 1);
        }
      });
    }

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
    const variant = Math.max(0, MAP_ORDER.indexOf(currentMap().id));

    // Ground cover is flat, so it needs far less clumping than the props, but it
    // goes through the same scatter so it stops reading as a perfect spiral.
    const spots = (count: number, spread: number, seed = 0): Scatter[] =>
      scatterClumps(count, inner, inner + spread, seed + 40 + variant * 2.9);

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