import { animate } from 'animejs';
import type { JSAnimation } from 'animejs';
import 'animejs/adapters/three';
import type * as THREE from 'three';
import type { Board } from './board';

const prefersReduced = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Anime.js layer for the 3D scenery: a slow idle on the hero landmarks plus a
 * flicker on the volcano lava. Everything here is decorative — the simulation
 * never reads it, so it is safe to drop under reduced-motion or on low-end
 * devices. Rebuilt whenever the board restyles its scenery (theme switch).
 */
export class Ambient {
  private running: JSAnimation[] = [];

  /** Rebind to the board's current scenery and (re)start the idle loops. */
  refresh(board: Board): void {
    this.stop();
    if (prefersReduced()) return;
    this.breathe(board.landmarks);
    this.flickerLava(board);
  }

  stop(): void {
    for (const a of this.running) a.cancel();
    this.running.length = 0;
  }

  /** Gentle bob + sway so the landmarks read as alive rather than static props. */
  private breathe(landmarks: THREE.Object3D[]): void {
    landmarks.forEach((mark, i) => {
      const baseY = mark.position.y;
      const baseDeg = (mark.rotation.y * 180) / Math.PI;
      const lift = 0.05 + (i % 3) * 0.03;
      this.running.push(
        animate(mark, {
          y: [baseY, baseY + lift],
          rotateY: [baseDeg - 1.6, baseDeg + 1.6],
          duration: 5200 + (i % 4) * 460,
          delay: i * 130,
          loop: true,
          alternate: true,
          ease: 'inOutSine',
        }),
      );
    });
  }

  /** Volcano themes get a breathing glow on the shared lava material. */
  private flickerLava(board: Board): void {
    const mat = board.lavaMat as (THREE.Material & { emissiveIntensity?: number }) | null;
    if (!mat || typeof mat.emissiveIntensity !== 'number') return;
    const base = mat.emissiveIntensity;
    this.running.push(
      animate(mat, {
        emissiveIntensity: [base, base * 1.9],
        duration: 1200,
        loop: true,
        alternate: true,
        ease: 'inOutSine',
      }),
    );
  }
}
