import { LEGO } from '../core/constants';

/**
 * Background themes.
 *
 * These restyle everything AROUND the baseplate — the terrain plane, the sky
 * and fog, and the scatter props (trees, rocks, dunes). The baseplate, the
 * lane and the fortress are deliberately untouched, so a theme never changes
 * how a map plays or how the lane reads.
 */

export type ThemeId = 'forest' | 'desert' | 'arctic' | 'volcano';

/** Which prop generator a theme uses for its scatter. */
export type PropKind = 'broadleaf' | 'cactus' | 'pine' | 'burnt' | 'palm';

/** What a small patch of different ground out in the woods holds. */
export type PatchKind = 'oasis' | 'dune' | 'spring' | 'magma';

/**
 * How the land outside the baseplate is dressed.
 *
 * The belt is the dense tree wall that hugs the board, the grove and outskirt
 * are the woodland behind it, and the rest is the dressing — rocks, ancient
 * ruins and little desert or oasis patches — that stops the ring around the
 * arena from reading as an empty plain.
 */
export interface SurroundSpec {
  /** Trees in the dense belt right outside the kerb. */
  belt: number;
  /** Trees in the mid-field grove behind the belt. */
  grove: number;
  /** Cheap far trees in the outer woods, thinning towards the horizon. */
  outskirt: number;
  /** Rock clusters. */
  rocks: number;
  /** Ancient brick-built ruins. */
  ruins: number;
  /** Small desert or oasis patches near the outer edge. */
  patches: number;
  /** What those patches hold. */
  patch: PatchKind;
  /** Trodden ground colour in the clearing around the baseplate. */
  floor: number;
  /** Tree kinds used in the belt, the dominant one first. */
  beltTrees: [PropKind, PropKind];
}

/**
 * Big set dressing placed at fixed spots around the baseplate. A theme keeps its
 * everyday scatter prop and adds these, so the desert can have both cacti and a
 * pyramid instead of having to choose.
 */
export type LandmarkKind =
  | 'pyramid'
  | 'sphinx'
  | 'obelisk'
  | 'boulder'
  | 'stump'
  | 'bigTree'
  | 'campfire'
  | 'oasis'
  | 'iceberg'
  | 'iceArch'
  | 'igloo'
  | 'polarBear'
  | 'volcano'
  | 'obsidian'
  | 'obsidianSpire'
  | 'lavaPit'
  // Forest
  | 'rockArch'
  | 'logCabin'
  | 'lookoutTower'
  | 'mushroomRing'
  // Desert
  | 'tent'
  | 'ruins'
  | 'skull'
  | 'well'
  // Arctic
  | 'snowman'
  | 'iceCave'
  | 'mammoth'
  | 'researchHut'
  // Volcano
  | 'lavaRiver'
  | 'smokeVent'
  | 'magmaBoulder'
  | 'charredPines'
  // Shared dressing
  | 'hayBales'
  | 'shrine'
  | 'flagPole'
  | 'supplyCrates'
  | 'pottery'
  | 'bonePile';

/**
 * Critters that live in a theme's background. Placed a little closer to the
 * board than the hero landmarks so the player actually notices them.
 */
export type FaunaKind =
  | 'polarBear'
  | 'deer'
  | 'rabbit'
  | 'fox'
  | 'owl'
  | 'camel'
  | 'scorpion'
  | 'lizard'
  | 'penguin'
  | 'seal'
  | 'arcticFox'
  | 'lavaSlime'
  | 'fireBat'
  | 'magmaCrab'
  | 'butterfly'
  | 'goat'
  | 'crow';

/** Ground treatment scattered on the terrain plane around the baseplate. */
export type GroundKind = 'grass' | 'sand' | 'snow' | 'lava';

export interface BoardTheme {
  id: ThemeId;
  name: string;
  /** Sky colour, also used for the fog. */
  sky: number;
  /** Terrain plane around the baseplate. */
  ground: number;
  prop: PropKind;
  /** Hero props, placed once each at fixed spots. */
  landmarks: LandmarkKind[];
  /** Critters scattered around the board, closer in than the landmarks. */
  fauna: FaunaKind[];
  /** How the terrain around the baseplate is dressed. */
  terrain: GroundKind;
  /** Emissive accent, used for lava glow. */
  glow?: number;
  /** Foliage / main prop colour. */
  foliage: number;
  /** Secondary prop colour used for shading and variation. */
  foliageAlt: number;
  /** Trunk, rock or structural colour. */
  wood: number;
  /** Small ground-cover scatter colour. */
  scatter: number;
  /** Distant terrain silhouette, drawn far behind the board. */
  horizon: number;
  /** Colour of the distant hills / dunes / ridges. */
  horizonAlt: number;
  /** The forest and dressing that surrounds the arena. */
  surround: SurroundSpec;
  blurb: string;
}

export const THEMES: Record<ThemeId, BoardTheme> = {
  forest: {
    id: 'forest',
    name: 'FOREST',
    sky: 0x8fc0f2,
    ground: 0xe9e7e0,
    prop: 'broadleaf',
    landmarks: [
      'bigTree', 'logCabin', 'rockArch', 'boulder', 'stump', 'campfire', 'lookoutTower',
      'mushroomRing', 'hayBales', 'shrine', 'flagPole',
    ],
    fauna: ['deer', 'rabbit', 'fox', 'owl', 'butterfly', 'goat'],
    terrain: 'grass',
    foliage: LEGO.brightGreen,
    foliageAlt: LEGO.darkGreen,
    wood: LEGO.redBrown,
    scatter: LEGO.green,
    horizon: 0x9db98a,
    horizonAlt: 0x7f9c6d,
    surround: {
      belt: 78,
      grove: 64,
      outskirt: 150,
      rocks: 38,
      ruins: 7,
      patches: 5,
      patch: 'oasis',
      floor: 0xd8d2b4,
      beltTrees: ['pine', 'broadleaf'],
    },
    blurb: 'Broadleaf trees and grass. The default backyard.',
  },
  desert: {
    id: 'desert',
    name: 'DESERT',
    sky: 0xf0c987,
    ground: 0xe4c98f,
    prop: 'cactus',
    landmarks: [
      'pyramid', 'pyramid', 'sphinx', 'obelisk', 'ruins', 'tent', 'oasis', 'skull', 'well',
      'pottery', 'shrine', 'flagPole',
    ],
    fauna: ['camel', 'scorpion', 'lizard', 'goat'],
    terrain: 'sand',
    foliage: LEGO.brightGreen,
    foliageAlt: LEGO.green,
    wood: LEGO.tan,
    scatter: LEGO.yellow,
    horizon: 0xd9b877,
    horizonAlt: 0xc2a05f,
    surround: {
      belt: 46,
      grove: 56,
      outskirt: 120,
      rocks: 46,
      ruins: 10,
      patches: 6,
      patch: 'oasis',
      floor: 0xd7b87c,
      beltTrees: ['palm', 'cactus'],
    },
    blurb: 'Cacti and sandstone. Wide open and hard to hide in.',
  },
  arctic: {
    id: 'arctic',
    name: 'ARCTIC',
    sky: 0xbcd8ea,
    ground: 0xeaf3f8,
    prop: 'pine',
    landmarks: [
      'iceberg', 'iceArch', 'igloo', 'mammoth', 'snowman', 'iceCave', 'researchHut',
      'supplyCrates', 'flagPole',
    ],
    fauna: ['polarBear', 'penguin', 'seal', 'arcticFox'],
    terrain: 'snow',
    foliage: LEGO.green,
    foliageAlt: LEGO.darkGreen,
    wood: LEGO.redBrown,
    scatter: LEGO.white,
    horizon: 0xd2e4f0,
    horizonAlt: 0xb6cfe0,
    surround: {
      belt: 80,
      grove: 66,
      outskirt: 150,
      rocks: 30,
      ruins: 6,
      patches: 4,
      patch: 'spring',
      floor: 0xdfeaf1,
      beltTrees: ['pine', 'pine'],
    },
    blurb: 'Frosted pines and snowfields. Pale, cold and quiet.',
  },
  volcano: {
    id: 'volcano',
    name: 'VOLCANO',
    sky: 0x4a2a24,
    ground: 0x4d423c,
    prop: 'burnt',
    landmarks: [
      'volcano', 'obsidianSpire', 'lavaPit', 'obsidian', 'lavaRiver', 'smokeVent', 'magmaBoulder',
      'charredPines', 'bonePile', 'flagPole',
    ],
    fauna: ['lavaSlime', 'fireBat', 'magmaCrab', 'crow'],
    terrain: 'lava',
    glow: 0xff5a1f,
    foliage: LEGO.black,
    foliageAlt: LEGO.darkBluishGray,
    wood: LEGO.redBrown,
    scatter: LEGO.orange,
    horizon: 0x3a2a24,
    horizonAlt: 0x513029,
    surround: {
      belt: 60,
      grove: 52,
      outskirt: 120,
      rocks: 48,
      ruins: 9,
      patches: 5,
      patch: 'magma',
      floor: 0x453b34,
      beltTrees: ['burnt', 'burnt'],
    },
    blurb: 'Charred trunks and lava rock. Grim, and the lava glows.',
  },
};

export const THEME_ORDER: ThemeId[] = ['forest', 'desert', 'arctic', 'volcano'];

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && v in THEMES;
}