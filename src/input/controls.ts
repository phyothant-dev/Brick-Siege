import { audio } from '../audio/audio';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { TowerId } from '../core/types';
import { GRID, worldToGx, worldToGy } from '../core/constants';
import { ATTACKER_KEYS } from '../core/sides';
import type { Game } from '../game';

const GROUND = new Plane(new Vector3(0, 1, 0), 0);
const DRAG_THRESHOLD = 6;

const PAN_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

const HOTKEYS: Record<string, TowerId> = {
  Digit1: 'shooter',
  Digit2: 'mortar',
  Digit3: 'freezer',
  Digit4: 'coil',
  Digit5: 'sprayer',
  Digit6: 'sniper',
  Digit7: 'cluster',
  Digit8: 'support',
};

/** Pointer, keyboard and touch handling for camera and grid interaction. */
export class Controls {
  private raycaster = new Raycaster();
  private pointer = new Vector2();
  private hit = new Vector3();

  /** Live touch/mouse position plus the drag origin used for the threshold. */
  private active = new Map<number, { x: number; y: number; ox: number; oy: number; button: number }>();
  private dragButton: number | null = null;
  private dragged = false;
  private last = { x: 0, y: 0 };
  private pinchDist = 0;
  /** Angle between the two touch points, so a twist can turn the camera. */
  private pinchAngle: number | null = null;
  /** Vertical midpoint of the two touch points, for the two-finger pitch drag. */
  private pinchMidY = 0;

  private keys = new Set<string>();
  private enabled = true;

  /** Injected after construction so input does not depend on the Ui class. */
  pauseToggle: (() => void) | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly game: Game,
  ) {
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.keys.clear());
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.keys.clear();
  }

  // ------------------------------------------------------------------ mouse

  private updatePointer(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /** Projects the pointer onto the board plane. Returns null when it misses. */
  private cellAt(e: PointerEvent): { gx: number; gy: number } | null {
    this.updatePointer(e);
    this.raycaster.setFromCamera(this.pointer, this.game.stage.camera);
    const hit = this.raycaster.ray.intersectPlane(GROUND, this.hit);
    if (!hit) return null;
    const gx = worldToGx(hit.x);
    const gy = worldToGy(hit.z);
    if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) return null;
    return { gx, gy };
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.active.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      ox: e.clientX,
      oy: e.clientY,
      button: e.button,
    });
    this.last = { x: e.clientX, y: e.clientY };
    this.dragged = false;

    if (e.pointerType === 'touch' && this.active.size === 2) {
      this.dragButton = 3;
      this.pinchDist = this.touchDistance();
      this.pinchAngle = this.touchAngle();
      this.pinchMidY = this.touchMidY();
      this.canvas.classList.add('is-panning');
      return;
    }

    if (e.button === 1) this.dragButton = 1;
    else if (e.button === 2) this.dragButton = 2;
    else if (e.pointerType === 'touch') this.dragButton = 1;
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.enabled) return;

    const cell = this.cellAt(e);
    if (cell) this.game.setHover(cell.gx, cell.gy);
    else this.game.clearHover();

    const tracked = this.active.get(e.pointerId);
    if (!tracked) return;

    // Keep the live touch position fresh. Two-finger twist and pitch read the
    // stored points, so leaving them at their pointerdown values would freeze
    // both gestures.
    tracked.x = e.clientX;
    tracked.y = e.clientY;

    const dx = e.clientX - this.last.x;
    const dy = e.clientY - this.last.y;
    this.last = { x: e.clientX, y: e.clientY };

    // Measure against the drag origin, not the live position.
    if (Math.hypot(e.clientX - tracked.ox, e.clientY - tracked.oy) > DRAG_THRESHOLD) {
      this.dragged = true;
    }

    if (this.dragButton === 3 && this.active.size === 2) {
      // Two fingers: pinch to zoom, twist to turn, drag up/down to change pitch.
      const d = this.touchDistance();
      if (this.pinchDist > 0 && Math.abs(this.pinchDist - d) > 0.5) {
        this.game.stage.zoomBy((this.pinchDist - d) * 2.2);
      }
      this.pinchDist = d;

      const angle = this.touchAngle();
      if (angle !== null && this.pinchAngle !== null) {
        let delta = angle - this.pinchAngle;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        this.game.stage.orbitAngle(delta);
      }
      this.pinchAngle = angle;

      const midY = this.touchMidY();
      this.game.stage.orbitPitch((this.pinchMidY - midY) * 0.004);
      this.pinchMidY = midY;
      return;
    }

    if (!this.dragged) return;

    if (this.dragButton === 2) {
      this.game.stage.orbitBy(dx, dy);
    } else if (this.dragButton === 1) {
      this.game.stage.panBy(-dx * 0.016, -dy * 0.016);
      this.canvas.classList.add('is-panning');
    }
  };

  /** Angle between the two active touch points, or null if not exactly two. */
  private touchAngle(): number | null {
    const pts = [...this.active.values()];
    if (pts.length !== 2) return null;
    return Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
  }

  private touchMidY(): number {
    const pts = [...this.active.values()];
    if (!pts.length) return 0;
    return pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
  }

  private onUp = (e: PointerEvent): void => {
    const tracked = this.active.get(e.pointerId);
    this.active.delete(e.pointerId);
    if (this.active.size < 2) {
      this.pinchAngle = null;
      this.pinchDist = 0;
    }
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (this.active.size === 0) {
      this.dragButton = null;
      this.canvas.classList.remove('is-panning');
    }

    if (!this.enabled || !tracked || this.dragged) return;
    if (e.button === 2) return;

    const cell = this.cellAt(e);
    if (!cell) return;
    if (this.game.combining && e.pointerType === 'touch') return;
    this.game.clickCell(cell.gx, cell.gy);
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    e.preventDefault();
    this.game.stage.zoomBy(e.deltaY);
  };

  private touchDistance(): number {
    const pts = [...this.active.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  // ---------------------------------------------------------------- keyboard

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement) return;
    this.keys.add(e.code);

    if (!this.enabled) return;

    // On the attacker side the number row arms creatures instead of towers.
    const unit = this.game.side === 'attacker' ? ATTACKER_KEYS[e.code] : undefined;
    if (unit) {
      e.preventDefault();
      this.game.armDeploying(unit);
      return;
    }
    const hotkey = HOTKEYS[e.code];
    if (hotkey) {
      e.preventDefault();
      this.game.armPlacing(this.game.placing === hotkey ? null : hotkey);
      return;
    }

    switch (e.code) {
      case 'Escape':
        e.preventDefault();
        if (this.game.combining) this.game.cancelCombining();
        else if (this.game.deploying) this.game.armDeploying(null);
        else if (this.game.placing) this.game.armPlacing(null);
        else if (this.game.selected) this.game.select(null);
        else this.pauseToggle?.();
        break;
      case 'KeyP':
        e.preventDefault();
        this.pauseToggle?.();
        break;
      case 'Space':
        e.preventDefault();
        if (this.game.phase === 'building') this.game.callWaveEarly();
        else if (this.game.phase === 'menu') this.game.begin();
        break;
      case 'KeyH':
        document.getElementById('codex')?.classList.toggle('hidden');
        break;
      case 'KeyM': {
        audio.unlock();
        const on = audio.toggle();
        document.getElementById('btn-sound')?.classList.toggle('is-off', !on);
        break;
      }
      case 'KeyX': {
        const next = this.game.state.speed === 1 ? 2 : 1;
        this.game.setSpeed(next);
        const btn = document.getElementById('btn-speed');
        if (btn) btn.textContent = `${next}\u00d7`;
        break;
      }
      case 'KeyC':
        if (this.game.selected) this.game.startCombining();
        break;
      case 'Delete':
      case 'Backspace':
        if (this.game.selected) {
          e.preventDefault();
          this.game.sellSelected();
        }
        break;
      case 'KeyQ':
        if (this.game.side === 'attacker') this.game.cycleDeploying();
        else this.game.cyclePlacing();
        break;
      case 'KeyR':
        if (e.shiftKey) this.game.restart();
        break;
      default:
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  /** Camera panning from held keys. */
  update(dt: number): void {
    if (!this.enabled) return;
    let dx = 0;
    let dz = 0;
    for (const code of this.keys) {
      const dir = PAN_KEYS[code];
      if (!dir) continue;
      dx += dir[0];
      dz += dir[1];
    }
    if (dx === 0 && dz === 0) return;
    const len = Math.hypot(dx, dz) || 1;
    const speed = (10 + this.game.stage.rig.distance * 0.55) * dt;
    this.game.stage.panBy((dx / len) * speed, (dz / len) * speed);
  }

  /** Reflects UI state on the canvas cursor. */
  syncCursor(): void {
    this.canvas.classList.toggle('is-placing', this.game.placing !== null);
    this.canvas.classList.toggle('is-combining', this.game.combining);
  }
}