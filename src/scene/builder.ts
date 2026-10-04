import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BRICK_GAP, BRICK_H, PITCH, PLATE_H, STUD_H, STUD_R } from '../core/constants';

/**
 * Procedural LEGO element factory. Everything in the game — baseplate, towers,
 * fortress, enemies — is assembled from these primitives, so there is not a
 * single external model or texture file.
 *
 * Geometries are cached per signature and returned centred on X/Z with their
 * base sitting on y = 0, which makes stacking bricks trivial.
 */

const geoCache = new Map<string, THREE.BufferGeometry>();

function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let geo = geoCache.get(key);
  if (!geo) {
    geo = make();
    geo.computeBoundingBox();
    geoCache.set(key, geo);
  }
  return geo;
}

function studGeometry(): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(STUD_R, STUD_R * 0.94, STUD_H, 12, 1, false);
}

function boxGeometry(w: number, h: number, d: number, y = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, y + h / 2, 0);
  return g;
}

/**
 * A rectangular brick. `studsX`/`studsZ` are stud counts, `height` is a world
 * height — use BRICK_H for a brick and PLATE_H for a plate.
 */
export function brickGeometry(studsX: number, studsZ: number, height: number, studs = true): THREE.BufferGeometry {
  const key = `b|${studsX}|${studsZ}|${height.toFixed(4)}|${studs ? 1 : 0}`;
  return cached(key, () => {
    const w = studsX * PITCH - BRICK_GAP;
    const d = studsZ * PITCH - BRICK_GAP;
    const parts: THREE.BufferGeometry[] = [boxGeometry(w, height, d)];
    if (studs) {
      const stud = studGeometry();
      for (let i = 0; i < studsX; i++) {
        for (let j = 0; j < studsZ; j++) {
          const s = stud.clone();
          s.translate(
            (i + 0.5) * PITCH - (studsX * PITCH) / 2,
            height + STUD_H / 2,
            (j + 0.5) * PITCH - (studsZ * PITCH) / 2,
          );
          parts.push(s);
        }
      }
    }
    const merged = mergeGeometries(parts, false)!;
    parts.forEach((p) => p.dispose());
    return merged;
  });
}

/** Convenience wrappers using real LEGO element heights. */
export function brick(studsX: number, studsZ: number, studs = true): THREE.BufferGeometry {
  return brickGeometry(studsX, studsZ, BRICK_H, studs);
}

export function plate(studsX: number, studsZ: number, studs = true): THREE.BufferGeometry {
  return brickGeometry(studsX, studsZ, PLATE_H, studs);
}

export function roundBrick(diameterStuds: number, height = BRICK_H): THREE.BufferGeometry {
  const key = `r|${diameterStuds}|${height.toFixed(4)}`;
  return cached(key, () => {
    const r = (diameterStuds * PITCH) / 2 - BRICK_GAP / 2;
    const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(r, r, height, 20)];
    parts[0].translate(0, height / 2, 0);
    const stud = studGeometry();
    const s = stud.clone();
    s.translate(0, height + STUD_H / 2, 0);
    parts.push(s);
    const merged = mergeGeometries(parts, false)!;
    parts.forEach((p) => p.dispose());
    return merged;
  });
}

export function cone(radiusStuds: number, heightStuds: number): THREE.BufferGeometry {
  const key = `c|${radiusStuds}|${heightStuds}`;
  return cached(key, () => {
    const g = new THREE.ConeGeometry(radiusStuds * PITCH, heightStuds * PITCH, 16);
    g.translate(0, (heightStuds * PITCH) / 2, 0);
    return g;
  });
}

export function sphere(radiusStuds: number): THREE.BufferGeometry {
  return cached(`s|${radiusStuds}`, () =>
    new THREE.SphereGeometry(radiusStuds * PITCH, 16, 12),
  );
}

/** 45-degree slope brick, rising along +X. */
export function slopeBrick(studsX: number, studsZ: number): THREE.BufferGeometry {
  const key = `sl|${studsX}|${studsZ}`;
  return cached(key, () => {
    const w = studsX * PITCH - BRICK_GAP;
    const d = studsZ * PITCH - BRICK_GAP;
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0);
    shape.lineTo(w / 2, 0);
    shape.lineTo(-w / 2, w);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
    geo.translate(0, 0, -d / 2);
    geo.computeVertexNormals();
    return geo;
  });
}

/** Inverse slope: a wedge that fills the corner of a roof line. */
export function slopeInverted(studsX: number, studsZ: number): THREE.BufferGeometry {
  const key = `sli|${studsX}|${studsZ}`;
  return cached(key, () => {
    const w = studsX * PITCH - BRICK_GAP;
    const d = studsZ * PITCH - BRICK_GAP;
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0);
    shape.lineTo(w / 2, 0);
    shape.lineTo(-w / 2, w);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
    geo.rotateY(Math.PI / 2);
    geo.scale(-1, 1, 1);
    geo.translate(0, 0, d / 2);
    geo.computeVertexNormals();
    return geo;
  });
}

/** A stud sticking out of a wall (used for barrel tips and horns). */
export function studPeg(): THREE.BufferGeometry {
  return cached('peg', () => {
    const g = new THREE.CylinderGeometry(STUD_R * 0.8, STUD_R * 0.8, PITCH * 0.9, 10);
    g.rotateZ(Math.PI / 2);
    return g;
  });
}

/** Simple minifig-style leg/limb block with rounded proportions. */
export function limbGeometry(len: number, thick: number): THREE.BufferGeometry {
  return cached(`l|${len.toFixed(3)}|${thick.toFixed(3)}`, () => {
    const g = new THREE.CapsuleGeometry(thick / 2, Math.max(0.001, len - thick), 4, 10);
    g.translate(0, -len / 2, 0);
    return g;
  });
}

/** Cylinder aligned to +Z, centred on the origin. Used for barrels and limbs. */
export function cylinderZ(radiusStuds: number, lengthStuds: number, segments = 14): THREE.BufferGeometry {
  return cached(`cz|${radiusStuds}|${lengthStuds}|${segments}`, () => {
    const g = new THREE.CylinderGeometry(radiusStuds * PITCH, radiusStuds * PITCH, lengthStuds * PITCH, segments);
    g.rotateX(Math.PI / 2);
    return g;
  });
}

/** Cylinder aligned to +Y, sitting on y = 0. */
export function post(radiusStuds: number, heightStuds: number, segments = 14): THREE.BufferGeometry {
  return cached(`cy|${radiusStuds}|${heightStuds}|${segments}`, () => {
    const g = new THREE.CylinderGeometry(radiusStuds * PITCH, radiusStuds * PITCH, heightStuds * PITCH, segments);
    g.translate(0, (heightStuds * PITCH) / 2, 0);
    return g;
  });
}

export function ring(radiusStuds: number, tubeStuds: number, segments = 20): THREE.BufferGeometry {
  return cached(`t|${radiusStuds}|${tubeStuds}|${segments}`, () => {
    return new THREE.TorusGeometry(radiusStuds * PITCH, tubeStuds * PITCH, 8, segments);
  });
}

/** Half-dome shell, open at the bottom. Frost domes and slime bodies. */
export function dome(radiusStuds: number): THREE.BufferGeometry {
  return cached(`d|${radiusStuds}`, () =>
    new THREE.SphereGeometry(radiusStuds * PITCH, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  );
}

export function disposeGeometry(): void {
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
}