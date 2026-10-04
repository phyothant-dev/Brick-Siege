import * as THREE from 'three';

/**
 * Cached LEGO-plastic materials. Every brick in the game shares these, so the
 * whole scene stays on a handful of shader programs.
 */

export interface PlasticOptions {
  transparent?: boolean;
  opacity?: number;
  emissive?: number;
  emissiveIntensity?: number;
  metalness?: number;
  roughness?: number;
  flatShading?: boolean;
}

const cache = new Map<string, THREE.MeshStandardMaterial>();

export function plastic(color: number, opts: PlasticOptions = {}): THREE.MeshStandardMaterial {
  const key = [
    color,
    opts.transparent ? 1 : 0,
    opts.opacity ?? 1,
    opts.emissive ?? 0,
    opts.emissiveIntensity ?? 1,
    opts.metalness ?? 0,
    opts.roughness ?? 0.34,
    opts.flatShading ? 1 : 0,
  ].join('|');

  const hit = cache.get(key);
  if (hit) return hit;

  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.34,
    metalness: opts.metalness ?? 0,
    flatShading: opts.flatShading ?? false,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    emissive: new THREE.Color(opts.emissive ?? 0x000000),
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    depthWrite: opts.transparent ? (opts.opacity ?? 1) > 0.9 : true,
  });

  cache.set(key, mat);
  return mat;
}

/** Adds a touch of self-illumination to sell glowing elements. */
export function glow(color: number, intensity = 0.9): THREE.MeshStandardMaterial {
  return plastic(color, { emissive: color, emissiveIntensity: intensity, roughness: 0.2 });
}

/** Translucent shell for ghosts, slime and previews. */
export function translucent(color: number, opacity = 0.55): THREE.MeshStandardMaterial {
  return plastic(color, {
    transparent: true,
    opacity,
    roughness: 0.1,
    emissive: color,
    emissiveIntensity: 0.25,
  });
}

export function disposeMaterials(): void {
  for (const m of cache.values()) m.dispose();
  cache.clear();
}