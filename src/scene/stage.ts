import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { BOARD, HALF } from '../core/constants';

export interface CameraRig {
  /** Point on the ground plane the camera orbits. */
  target: THREE.Vector3;
  distance: number;
  pitch: number;
  yaw: number;
}

const SKY = 0x8fc0f2;

/**
 * Owns the renderer, camera, lighting and post-free presentation. Game code
 * only ever talks to `scene`.
 */
export type Quality = 'high' | 'medium' | 'low';

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly rig: CameraRig = {
    target: new THREE.Vector3(0, 0, 0.4),
    distance: 22,
    pitch: 0.86,
    yaw: 0,
  };

  readonly minDistance = 9;
  readonly maxDistance = 42;
  readonly panLimit = HALF + 5.5;

  private shakeAmount = 0;
  private quality: Quality = 'high';
  /** Guards against stacking concurrent measurement passes. */
  private tuning = false;
  /** Called once auto-tuning settles, so the UI can report the chosen tier. */
  onQualityChange: ((q: Quality, fps: number) => void) | null = null;
  private shakeTime = 0;
  private sun!: THREE.DirectionalLight;
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 34, 78);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 220);
    this.applyCamera();

    this.buildLights();
    this.buildEnvironment();
    this.resize();
  }

  private buildLights(): void {
    const hemi = new THREE.HemisphereLight(0xdff1ff, 0x5d7a4a, 0.85);
    this.scene.add(hemi);

    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
    this.sun.position.set(9, 15, 8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = BOARD * 0.85;
    const cam = this.sun.shadow.camera;
    cam.left = -s;
    cam.right = s;
    cam.top = s;
    cam.bottom = -s;
    cam.near = 1;
    cam.far = 48;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.022;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    const rim = new THREE.DirectionalLight(0xbcd8ff, 0.7);
    rim.position.set(-11, 8, -10);
    this.scene.add(rim);

    const bounce = new THREE.DirectionalLight(0xffe8c4, 0.28);
    bounce.position.set(0, -6, 4);
    this.scene.add(bounce);
  }

  private buildEnvironment(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    const env = pmrem.fromScene(new RoomEnvironment(), 0.06);
    this.scene.environment = env.texture;
    this.scene.environmentIntensity = 0.32;
    pmrem.dispose();
  }

  /**
   * Render quality tiers. Phones and low-power GPUs get fewer pixels and no
   * shadow pass, which is where most of the frame cost lives on this scene.
   */
  setQuality(level: Quality): void {
    this.quality = level;
    const dpr = window.devicePixelRatio || 1;
    const isMobile = /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent) || window.innerWidth < 900;
    const cap = isMobile
      ? (level === 'high' ? 1.5 : level === 'medium' ? 1.25 : 1)
      : (level === 'high' ? 2 : level === 'medium' ? 1.25 : 1);
    this.renderer.setPixelRatio(Math.min(dpr, cap, isMobile ? 1.75 : 2));
    this.renderer.shadowMap.enabled = level !== 'low';
    if (level !== 'low') {
      const size = level === 'high' ? 2048 : 1024;
      if (this.sun.shadow.mapSize.x !== size) {
        this.sun.shadow.mapSize.set(size, size);
        // Force the shadow map to be rebuilt at the new resolution.
        this.sun.shadow.map?.dispose();
        this.sun.shadow.map = null;
      }
    }
    this.sun.castShadow = level !== 'low';
    this.renderer.shadowMap.needsUpdate = true;
  }

  /**
   * Watch the frame rate for a moment and drop a tier if the device cannot
   * hold 60. Runs once, shortly after start-up.
   */
  autoTune(): void {
    if (this.tuning) return;
    this.tuning = true;
    let frames = 0;
    const t0 = performance.now();
    const tick = (): void => {
      frames++;
      const elapsed = performance.now() - t0;
      if (elapsed < 1500) {
        requestAnimationFrame(tick);
        return;
      }
      const fps = (frames / elapsed) * 1000;
      if (fps < 40) this.setQuality('low');
      else if (fps < 52) this.setQuality('medium');
      else this.setQuality('high');
      this.tuning = false;
      this.onQualityChange?.(this.quality, Math.round(fps));
    };
    requestAnimationFrame(tick);
  }

  /** Recolour the sky and fog to match a background theme. */
  setSky(color: number): void {
    this.scene.background = new THREE.Color(color);
    if (this.scene.fog) this.scene.fog.color.setHex(color);
  }

  addShake(amount: number): void {
    this.shakeAmount = Math.min(0.9, this.shakeAmount + amount * 0.22);
  }

  /** World-space bounds of a named group. Used by the layout test harness. */
  boundsOf(name: string): { min: [number, number, number]; max: [number, number, number] } | null {
    const target = this.scene.getObjectByName(name);
    if (!target) return null;
    target.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(target);
    return {
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
    };
  }

  panBy(dx: number, dz: number): void {
    // Pan in screen space: forward is the camera's ground projection.
    const cos = Math.cos(this.rig.yaw);
    const sin = Math.sin(this.rig.yaw);
    const fwdX = -sin;
    const fwdZ = -cos;
    const rightX = cos;
    const rightZ = -sin;
    this.rig.target.x += rightX * dx + fwdX * dz;
    this.rig.target.z += rightZ * dx + fwdZ * dz;
    this.clampTarget();
  }

  zoomBy(delta: number): void {
    this.rig.distance = THREE.MathUtils.clamp(
      this.rig.distance * (1 + delta * 0.0016),
      this.minDistance,
      this.maxDistance,
    );
  }

  orbitBy(dx: number, dy: number): void {
    this.orbitAngle((-dx * 0.005 * 180) / Math.PI);
    this.orbitPitch(dy * 0.004);
  }

  /** Turn the camera by a delta in radians. Used by touch twist. */
  orbitAngle(radians: number): void {
    this.rig.yaw = THREE.MathUtils.clamp(this.rig.yaw + radians, -0.7, 0.7);
  }

  /** Raise/lower the camera by a delta in radians. */
  orbitPitch(radians: number): void {
    this.rig.pitch = THREE.MathUtils.clamp(this.rig.pitch + radians, 0.42, 1.32);
  }

  private clampTarget(): void {
    const l = this.panLimit;
    this.rig.target.x = THREE.MathUtils.clamp(this.rig.target.x, -l, l);
    this.rig.target.z = THREE.MathUtils.clamp(this.rig.target.z, -l, l);
    this.rig.target.y = 0;
  }

  private applyCamera(): void {
    const { target, distance, pitch, yaw } = this.rig;
    const h = Math.cos(pitch) * distance;
    const v = Math.sin(pitch) * distance;
    this.camera.position.set(
      target.x + Math.sin(yaw) * h,
      target.y + v,
      target.z + Math.cos(yaw) * h,
    );
    this.camera.lookAt(target.x, target.y + 0.6, target.z);
  }

  /** Called every frame before render. */
  update(dt: number): void {
    if (this.shakeAmount > 0.0005) {
      this.shakeTime += dt * 46;
      const decay = Math.max(0, 1 - dt * 5.5);
      this.shakeAmount *= decay;
    } else {
      this.shakeAmount = 0;
    }

    this.applyCamera();

    if (this.shakeAmount > 0.0005) {
      const a = this.shakeAmount;
      this.camera.position.x += Math.sin(this.shakeTime * 1.7) * a;
      this.camera.position.y += Math.cos(this.shakeTime * 2.3) * a * 0.6;
      this.camera.position.z += Math.sin(this.shakeTime * 3.1) * a * 0.5;
    }

    this.sun.position.set(this.rig.target.x + 9, 15, this.rig.target.z + 8);
    this.sun.target.position.set(this.rig.target.x, 0, this.rig.target.z);
    this.sun.target.updateMatrixWorld();
  }

  resize(): void {
    const vv = (window as any).visualViewport;
    const w = vv ? Math.floor(vv.width) : (this.canvas.clientWidth || window.innerWidth);
    const h = vv ? Math.floor(vv.height) : (this.canvas.clientHeight || window.innerHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}