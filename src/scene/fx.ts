import * as THREE from 'three';
import { LEGO, PITCH } from '../core/constants';
import { EnemyView } from './enemyView';

export interface ImpactEvent {
  /** Where the projectile landed. */
  position: THREE.Vector3;
  /** Target it was tracking, if any. */
  target: EnemyView | null;
}

export interface ProjectileOptions {
  color: number;
  /** World units per second. */
  speed: number;
  /** Lob height in world units. Shells use this, flat shots use 0. */
  arc?: number;
  scale?: number;
  /** Fired once, when the projectile reaches its destination. */
  onImpact: (event: ImpactEvent) => void;
}

type ShotKind = 'bullet' | 'shell' | 'frost' | 'glob';

interface EnemyShot {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  life: number;
  dir: THREE.Vector3;
}

interface Shot {
  active: boolean;
  kind: ShotKind;
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  target: EnemyView | null;
  /** Straight-line travel distance. */
  travel: number;
  speed: number;
  arc: number;
  t: number;
  spin: THREE.Vector3;
  onImpact: (event: ImpactEvent) => void;
}

interface Particle {
  life: number;
  maxLife: number;
  size: number;
  gravity: number;
  vel: THREE.Vector3;
  pos: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
}

interface Ring {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  from: number;
  to: number;
  color: THREE.Color;
}

interface Bolt {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
}

const MAX_PARTICLES = 520;
const MAX_SHOTS = 96;
const MAX_RINGS = 40;
const MAX_BOLTS = 24;

const GEO_FOR_KIND: Record<ShotKind, THREE.BufferGeometry> = {
  bullet: new THREE.BoxGeometry(PITCH * 0.22, PITCH * 0.22, PITCH * 0.7),
  shell: new THREE.IcosahedronGeometry(PITCH * 0.45, 0),
  frost: new THREE.IcosahedronGeometry(PITCH * 0.42, 0),
  glob: new THREE.SphereGeometry(PITCH * 0.36, 8, 6),
};

/**
 * All transient visuals: projectiles, impact rings, lightning arcs and the
 * brick-shatter debris. Pools everything so long waves never allocate.
 */
export class Fx {
  readonly group = new THREE.Group();

  private particles: Particle[] = [];
  private particleMesh: THREE.InstancedMesh;
  private shots: Shot[] = [];
  private rings: Ring[] = [];
  private bolts: Bolt[] = [];

  private rangeRing: THREE.Mesh;
  private rangeFill: THREE.Mesh;
  private dummy = new THREE.Object3D();
  private nextShot = 0;
  private enemyShots: EnemyShot[] = [];
  private nextBolt = 0;
  private particleCursor = 0;
  private scratchColor = new THREE.Color();

  constructor() {
    // --- debris -------------------------------------------------------
    const chip = new THREE.BoxGeometry(PITCH * 0.55, PITCH * 0.3, PITCH * 0.55);
    this.particleMesh = new THREE.InstancedMesh(
      chip,
      new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0 }),
      MAX_PARTICLES,
    );
    this.particleMesh.castShadow = true;
    this.particleMesh.frustumCulled = false;
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.particleMesh);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        life: 0,
        maxLife: 1,
        size: 1,
        gravity: 9,
        vel: new THREE.Vector3(),
        pos: new THREE.Vector3(),
        rot: new THREE.Euler(),
        spin: new THREE.Vector3(),
      });
    }
    this.hideAllParticles();

    // --- projectiles --------------------------------------------------
    for (let i = 0; i < MAX_SHOTS; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x000000,
        roughness: 0.35,
      });
      const mesh = new THREE.Mesh(GEO_FOR_KIND.bullet, mat);
      mesh.visible = false;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.shots.push({
        active: false,
        kind: 'bullet',
        mesh,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        target: null,
        travel: 1,
        speed: 10,
        arc: 0,
        t: 0,
        spin: new THREE.Vector3(),
        onImpact: () => {},
      });
    }

    // --- impact rings -------------------------------------------------
    const ringGeo = new THREE.RingGeometry(0.42, 0.5, 20);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_RINGS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.group.add(mesh);
      this.rings.push({ mesh, life: 0, maxLife: 1, from: 1, to: 2, color: new THREE.Color() });
    }

    // --- lightning bolts ----------------------------------------------
    for (let i = 0; i < MAX_BOLTS; i++) {
      const mesh = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshBasicMaterial({
          color: LEGO.brightYellow,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 4;
      this.group.add(mesh);
      this.bolts.push({ mesh, life: 0, maxLife: 0.2 });
    }

    // --- tower range indicator ----------------------------------------
    const rangeGeo = new THREE.RingGeometry(0.97, 1, 64);
    rangeGeo.rotateX(-Math.PI / 2);
    this.rangeRing = new THREE.Mesh(
      rangeGeo,
      new THREE.MeshBasicMaterial({
        color: LEGO.brightYellow,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.rangeRing.visible = false;
    this.rangeRing.renderOrder = 2;
    this.group.add(this.rangeRing);

    const fillGeo = new THREE.CircleGeometry(1, 48);
    fillGeo.rotateX(-Math.PI / 2);
    this.rangeFill = new THREE.Mesh(
      fillGeo,
      new THREE.MeshBasicMaterial({
        color: LEGO.brightYellow,
        transparent: true,
        opacity: 0.07,
        depthWrite: false,
      }),
    );
    this.rangeFill.visible = false;
    this.rangeFill.renderOrder = 1;
    this.group.add(this.rangeFill);
  }

  // ------------------------------------------------------------------ shots

  launch(from: THREE.Vector3, target: EnemyView | null, worldTarget: THREE.Vector3, opts: ProjectileOptions): void {
    const shot = this.shots[this.nextShot];
    this.nextShot = (this.nextShot + 1) % MAX_SHOTS;

    shot.active = true;
    shot.kind =
      opts.arc && opts.arc > 0.05
        ? 'shell'
        : opts.color === LEGO.transIce
          ? 'frost'
          : opts.color === LEGO.brightGreen
            ? 'glob'
            : 'bullet';

    const geoKind = shot.kind;
    const mat = shot.mesh.material as THREE.MeshStandardMaterial;
    mat.color.setHex(opts.color);
    mat.emissive.setHex(opts.color);
    mat.emissiveIntensity = shot.kind === 'bullet' ? 0.15 : 0.45;

    const s = opts.scale ?? 1;
    shot.mesh.scale.setScalar(s);
    shot.mesh.visible = true;

    shot.from.copy(from);
    shot.to.copy(worldTarget);
    shot.target = target;
    shot.speed = opts.speed;
    shot.arc = opts.arc ?? 0;
    shot.travel = Math.max(0.001, shot.from.distanceTo(shot.to));
    shot.t = 0;
    shot.spin.set(2 + Math.random() * 4, 1.5 + Math.random() * 3, 2 + Math.random() * 4);
    shot.onImpact = opts.onImpact;
    shot.mesh.geometry = GEO_FOR_KIND[geoKind];
    shot.mesh.position.copy(from);
  }

  // --------------------------------------------------------------- particles

  private spawnParticle(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    color: number,
    size: number,
    life: number,
    gravity = 9,
  ): void {
    let p: Particle | null = null;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const slot = this.particles[(this.particleCursor + i) % MAX_PARTICLES];
      if (slot.life <= 0) {
        p = slot;
        this.particleCursor = (this.particleCursor + i + 1) % MAX_PARTICLES;
        break;
      }
    }
    if (!p) return;
    p.life = life;
    p.maxLife = life;
    p.size = size;
    p.gravity = gravity;
    p.pos.set(x, y, z);
    p.vel.set(vx, vy, vz);
    p.rot.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
    p.spin.set(
      (Math.random() - 0.5) * 14,
      (Math.random() - 0.5) * 14,
      (Math.random() - 0.5) * 14,
    );
    this.particleMesh.setColorAt(this.particles.indexOf(p), this.scratchColor.setHex(color));
  }

  private hideAllParticles(): void {
    this.dummy.scale.setScalar(0);
    this.dummy.position.set(0, -999, 0);
    this.dummy.updateMatrix();
    for (let i = 0; i < MAX_PARTICLES; i++) this.particleMesh.setMatrixAt(i, this.dummy.matrix);
    this.particleMesh.instanceMatrix.needsUpdate = true;
  }

  /** Small burst of chips, e.g. when a tower fires. */
  /**
   * Enemy fire at towers. Purely visual: damage is applied when the shot is
   * fired, so this only has to read clearly at a glance.
   */
  enemyShot(
    from: THREE.Vector3,
    to: THREE.Vector3,
    style: 'arrow' | 'bullet' | 'rocket',
    color: number,
    life: number,
  ): void {
    const geo =
      style === 'arrow'
        ? new THREE.ConeGeometry(0.07, 0.6, 5)
        : style === 'rocket'
          ? new THREE.ConeGeometry(0.15, 0.7, 6)
          : new THREE.SphereGeometry(0.09, 6, 5);

    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color, transparent: style === 'bullet', opacity: 0.95 }),
    );
    this.group.add(mesh);

    const dir = to.clone().sub(from);
    dir.normalize();
    mesh.position.copy(from);
    // Cones point +Y, so aim them down the flight path.
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    if (style === 'rocket') mesh.scale.setScalar(1.5);

    this.enemyShots.push({ mesh, from: from.clone(), to: to.clone(), t: 0, life, dir });
    // Hard cap so a long wave cannot flood the scene.
    while (this.enemyShots.length > 48) {
      const old = this.enemyShots.shift();
      if (old) {
        old.mesh.geometry.dispose();
        (old.mesh.material as THREE.Material).dispose();
        this.group.remove(old.mesh);
      }
    }
  }

  muzzleBurst(pos: THREE.Vector3, dir: THREE.Vector3, color: number, count = 5): void {
    for (let i = 0; i < count; i++) {
      this.spawnParticle(
        pos.x,
        pos.y,
        pos.z,
        dir.x * 2 + (Math.random() - 0.5) * 2.4,
        dir.y * 2 + Math.random() * 2,
        dir.z * 2 + (Math.random() - 0.5) * 2.4,
        color,
        0.35 + Math.random() * 0.3,
        0.28 + Math.random() * 0.2,
        6,
      );
    }
  }

  /** Chunky LEGO debris when an enemy is destroyed. */
  shatter(pos: THREE.Vector3, color: number, accent: number, scale: number): void {
    const n = Math.round(6 + scale * 4);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 1.6 + Math.random() * 3.4;
      this.spawnParticle(
        pos.x,
        pos.y + 0.1 + Math.random() * 0.3,
        pos.z,
        Math.cos(a) * speed,
        2.4 + Math.random() * 3.2,
        Math.sin(a) * speed,
        i % 3 === 0 ? accent : color,
        (0.4 + Math.random() * 0.45) * scale,
        0.65 + Math.random() * 0.5,
        11,
      );
    }
    this.ring(pos, color, 0.25 * scale, 1.15 * scale, 0.34);
  }

  /** Flat expanding ring on the ground. */
  ring(pos: THREE.Vector3, color: number, from: number, to: number, life: number): void {
    const slot = this.rings.find((r) => r.life <= 0) ?? this.rings[0];
    slot.life = life;
    slot.maxLife = life;
    slot.from = from;
    slot.to = to;
    slot.color.setHex(color);
    slot.mesh.position.set(pos.x, Math.max(0.02, pos.y), pos.z);
    slot.mesh.scale.setScalar(from);
    slot.mesh.visible = true;
    (slot.mesh.material as THREE.MeshBasicMaterial).color.copy(slot.color);
    (slot.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8;
  }

  /** Jagged lightning arc through a list of world points. */
  bolt(points: THREE.Vector3[], color: number, life = 0.2): void {
    const slot = this.bolts[this.nextBolt];
    this.nextBolt = (this.nextBolt + 1) % MAX_BOLTS;

    const curve = new THREE.CatmullRomCurve3(points);
    const geo = new THREE.TubeGeometry(curve, Math.max(6, points.length * 4), 0.028, 4, false);
    slot.mesh.geometry.dispose();
    slot.mesh.geometry = geo;
    (slot.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    (slot.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
    slot.life = life;
    slot.maxLife = life;
    slot.mesh.visible = true;
  }

  /** Adds jitter to a straight segment so bolts look electric. */
  static jag(a: THREE.Vector3, b: THREE.Vector3, segments: number, amp: number): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      pts.push(
        new THREE.Vector3(
          a.x + (b.x - a.x) * t + (Math.random() - 0.5) * amp,
          a.y + (b.y - a.y) * t + (Math.random() - 0.5) * amp,
          a.z + (b.z - a.z) * t + (Math.random() - 0.5) * amp,
        ),
      );
    }
    return pts;
  }

  // ---------------------------------------------------------- range display

  showRange(x: number, z: number, radius: number, ok = true): void {
    const color = ok ? LEGO.brightYellow : LEGO.brightRed;
    this.rangeRing.visible = true;
    this.rangeFill.visible = true;
    this.rangeRing.position.set(x, 0.03, z);
    this.rangeFill.position.set(x, 0.02, z);
    this.rangeRing.scale.setScalar(radius);
    this.rangeFill.scale.setScalar(radius);
    (this.rangeRing.material as THREE.MeshBasicMaterial).color.setHex(color);
    (this.rangeFill.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  hideRange(): void {
    this.rangeRing.visible = false;
    this.rangeFill.visible = false;
  }

  // ----------------------------------------------------------------- update

  update(dt: number): void {
    // Enemy shots: straight-line travel to the tower that was already hit.
    for (let i = this.enemyShots.length - 1; i >= 0; i--) {
      const s = this.enemyShots[i];
      s.t += dt;
      const k = Math.min(1, s.t / s.life);
      s.mesh.position.lerpVectors(s.from, s.to, k);
      if (k >= 1) {
        s.mesh.geometry.dispose();
        (s.mesh.material as THREE.Material).dispose();
        this.group.remove(s.mesh);
        this.enemyShots.splice(i, 1);
      }
    }

    // Shots.
    for (const shot of this.shots) {
      if (!shot.active) continue;

      if (shot.target) {
        shot.target.root.getWorldPosition(shot.to);
        shot.to.y += 0.4 * shot.target.spec.scale;
      }

      shot.travel = Math.max(0.001, shot.from.distanceTo(shot.to));
      shot.t += (shot.speed * dt) / shot.travel;

      if (shot.t >= 1) {
        shot.active = false;
        shot.mesh.visible = false;
        shot.onImpact({ position: shot.to, target: shot.target });
        continue;
      }

      shot.mesh.position.lerpVectors(shot.from, shot.to, shot.t);
      if (shot.arc > 0) shot.mesh.position.y += Math.sin(shot.t * Math.PI) * shot.arc;
      shot.mesh.rotation.x += shot.spin.x * dt;
      shot.mesh.rotation.y += shot.spin.y * dt;
      shot.mesh.rotation.z += shot.spin.z * dt;
    }

    // Particles.
    let anyParticle = false;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.life <= 0) continue;
      anyParticle = true;
      p.life -= dt;
      if (p.life <= 0) {
        this.dummy.scale.setScalar(0);
        this.dummy.position.set(0, -999, 0);
        this.dummy.updateMatrix();
        this.particleMesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.05) {
        p.pos.y = 0.05;
        p.vel.y = Math.abs(p.vel.y) * 0.32;
        p.vel.x *= 0.7;
        p.vel.z *= 0.7;
      }
      p.rot.x += p.spin.x * dt;
      p.rot.y += p.spin.y * dt;
      p.rot.z += p.spin.z * dt;

      const fade = Math.min(1, p.life / (p.maxLife * 0.45));
      this.dummy.position.copy(p.pos);
      this.dummy.rotation.copy(p.rot);
      this.dummy.scale.setScalar(p.size * fade);
      this.dummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, this.dummy.matrix);
    }
    if (anyParticle) this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;

    // Rings.
    for (const slot of this.rings) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      const mat = slot.mesh.material as THREE.MeshBasicMaterial;
      if (slot.life <= 0) {
        slot.mesh.visible = false;
        mat.opacity = 0;
        continue;
      }
      const k = 1 - slot.life / slot.maxLife;
      slot.mesh.scale.setScalar(slot.from + (slot.to - slot.from) * k);
      mat.opacity = (1 - k) * 0.8;
    }

    // Bolts.
    for (const slot of this.bolts) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      const mat = slot.mesh.material as THREE.MeshBasicMaterial;
      if (slot.life <= 0) {
        slot.mesh.visible = false;
        mat.opacity = 0;
        continue;
      }
      mat.opacity = Math.min(1, slot.life / slot.maxLife) * 1.4;
      slot.mesh.scale.setScalar(0.85 + Math.random() * 0.3);
    }
  }

  reset(): void {
    for (const s of this.enemyShots) {
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
      this.group.remove(s.mesh);
    }
    this.enemyShots.length = 0;

    for (const shot of this.shots) {
      shot.active = false;
      shot.mesh.visible = false;
    }
    for (const p of this.particles) p.life = 0;
    this.hideAllParticles();
    for (const slot of this.rings) {
      slot.life = 0;
      slot.mesh.visible = false;
    }
    for (const slot of this.bolts) {
      slot.life = 0;
      slot.mesh.visible = false;
    }
    this.hideRange();
  }
}
