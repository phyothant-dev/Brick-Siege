import * as THREE from 'three';
import { LEGO } from '../core/constants';
import type { TowerId } from '../core/types';
import { createTowerModel, type TowerModel } from './towerView';

/**
 * Translucent hologram of the tower about to be placed, shown under the
 * cursor while a build option is armed.
 */
export class PlacementPreview {
  readonly group = new THREE.Group();

  private model: TowerModel | null = null;
  private ghostOk: THREE.MeshStandardMaterial;
  private ghostBad: THREE.MeshStandardMaterial;
  private current: TowerId | null = null;

  constructor() {
    this.ghostOk = new THREE.MeshStandardMaterial({
      color: LEGO.brightGreen,
      emissive: LEGO.brightGreen,
      emissiveIntensity: 0.45,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      roughness: 0.3,
    });
    this.ghostBad = new THREE.MeshStandardMaterial({
      color: LEGO.brightRed,
      emissive: LEGO.brightRed,
      emissiveIntensity: 0.45,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      roughness: 0.3,
    });

    this.group.visible = false;
    this.group.renderOrder = 8;
  }

  get type(): TowerId | null {
    return this.current;
  }

  setType(type: TowerId | null): void {
    if (type === this.current) return;
    this.current = type;

    if (this.model) {
      this.group.remove(this.model.root);
      this.model = null;
    }
    if (!type) {
      this.group.visible = false;
      return;
    }

    const model = createTowerModel(type, 1);
    model.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = false;
        o.receiveShadow = false;
        o.renderOrder = 8;
        o.material = this.ghostOk;
      }
    });
    this.model = model;
    this.group.add(model.root);
    this.group.visible = true;
  }

  setValid(ok: boolean): void {
    const mat = ok ? this.ghostOk : this.ghostBad;
    if (!this.model) return;
    this.model.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = mat;
    });
  }

  moveTo(x: number, z: number): void {
    this.group.position.set(x, 0.02, z);
  }

  show(): void {
    this.group.visible = this.current !== null;
  }

  hide(): void {
    this.group.visible = false;
  }
}