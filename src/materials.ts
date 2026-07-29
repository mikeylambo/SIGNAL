import { profile, saveProfile } from './save';

/**
 * Board material treatments — the economy's answer to a structural problem.
 *
 * The Forge gives every player eight designed palettes and a full hue slider,
 * for free. That made the shop's paid Calibrations pointless: anything they sold
 * was a rotation away. Selling colour to players who already have all of it is
 * not a pricing problem, it's a "you have nothing to sell" problem.
 *
 * Materials are the axis hue rotation cannot reach. Surface character, glow
 * falloff, transparency, wireframe structure — none of it is expressible as a
 * palette, so a material is genuinely additional to what the Forge produces.
 *
 * Two ways to get one:
 *  - Buy it outright, and apply it to your own custom palettes.
 *  - Own a paid Calibration, which equips its signature material automatically.
 *    That is what stops the two from being arbitrage: a Calibration is a curated
 *    pairing, not a cheaper route to a material for general use.
 */

export interface BoardMaterial {
  id: string;
  name: string;
  price: number;
  description: string;
  roughness: number;
  metalness: number;
  /** Multiplies every state's emissiveIntensity — how hot the glow reads. */
  emissiveBoost: number;
  /** Multiplies the fresnel rim strength — how pronounced the edge light is. */
  rimBoost: number;
  transparent: boolean;
  opacity: number;
  wireframe: boolean;
  flatShading: boolean;
}

export const BOARD_MATERIALS: ReadonlyArray<BoardMaterial> = [
  {
    id: 'standard', name: 'Standard', price: 0,
    description: 'The default surface.',
    roughness: 0.55, metalness: 0.25, emissiveBoost: 1, rimBoost: 1,
    transparent: false, opacity: 1, wireframe: false, flatShading: false,
  },
  {
    id: 'matte', name: 'Matte', price: 400,
    description: 'Soft, non-reflective. Glow reads cleaner against it.',
    roughness: 0.95, metalness: 0, emissiveBoost: 1.1, rimBoost: 0.6,
    transparent: false, opacity: 1, wireframe: false, flatShading: false,
  },
  {
    id: 'chrome', name: 'Chrome', price: 900,
    description: 'Polished metal with a hard specular edge.',
    roughness: 0.12, metalness: 1, emissiveBoost: 0.85, rimBoost: 1.6,
    transparent: false, opacity: 1, wireframe: false, flatShading: false,
  },
  {
    id: 'glass', name: 'Glass', price: 1400,
    description: 'Translucent. You can see the grid through the tiles.',
    roughness: 0.08, metalness: 0.1, emissiveBoost: 1.25, rimBoost: 2.0,
    transparent: true, opacity: 0.42, wireframe: false, flatShading: false,
  },
  {
    id: 'facet', name: 'Facet', price: 2000,
    description: 'Flat-shaded planes. Each face catches light separately.',
    roughness: 0.4, metalness: 0.55, emissiveBoost: 1, rimBoost: 1.2,
    transparent: false, opacity: 1, wireframe: false, flatShading: true,
  },
  {
    id: 'lattice', name: 'Lattice', price: 3000,
    description: 'Structure only — tiles reduced to their edges.',
    roughness: 0.5, metalness: 0.3, emissiveBoost: 1.8, rimBoost: 1,
    transparent: false, opacity: 1, wireframe: true, flatShading: false,
  },
];

export function getMaterial(id: string): BoardMaterial {
  return BOARD_MATERIALS.find(m => m.id === id) ?? BOARD_MATERIALS[0];
}

export function isMaterialUnlocked(id: string): boolean {
  if (getMaterial(id).price === 0) return true;
  return (profile.unlockedMaterials ?? []).includes(id);
}

export function buyMaterial(id: string): boolean {
  const mat = getMaterial(id);
  if (profile.signal < mat.price) return false;
  profile.signal -= mat.price;
  if (!profile.unlockedMaterials) profile.unlockedMaterials = [];
  if (!profile.unlockedMaterials.includes(id)) profile.unlockedMaterials.push(id);
  saveProfile();
  return true;
}

export function setActiveMaterial(id: string): void {
  profile.activeMaterial = id;
  saveProfile();
}
