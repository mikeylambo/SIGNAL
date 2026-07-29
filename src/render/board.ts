import * as THREE from 'three';
import type { CubeState } from '../types';
import { scene, boardGroup, gridFloor, adjustCameraForViewport } from './scene';
import { t, profile, currentThemeKey, themes } from '../save';
import { state } from '../state';
import { getMaterial, isMaterialUnlocked, type BoardMaterial } from '../materials';

export let cubes: THREE.Mesh[] = [];

/**
 * The material treatment in force.
 *
 * A Calibration equips its own signature material; the Forge's custom palettes
 * use whichever material the player has bought and selected. The ownership
 * check is repeated here rather than trusted from the profile so a hand-edited
 * save can't equip a material that was never bought.
 */
export function activeBoardMaterial(): BoardMaterial {
  if (currentThemeKey !== 'custom') {
    return getMaterial(themes[currentThemeKey]?.materialId ?? 'standard');
  }
  const id = profile.activeMaterial ?? 'standard';
  return isMaterialUnlocked(id) ? getMaterial(id) : getMaterial('standard');
}

export function makeRimMaterial(opts: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial(opts);
  mat.userData['emissiveBoost'] = 1;
  mat.userData['rimBoost'] = 1;
  mat.userData['rimUniforms'] = {
    rimColor: { value: new THREE.Color(0xffffff) },
    rimPower: { value: 2.2 },
    rimIntensity: { value: 0.35 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData['rimUniforms']);
    mat.userData['shader'] = shader;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 rimColor;
        uniform float rimPower;
        uniform float rimIntensity;`
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        float rimFresnel = 1.0 - max(dot(normalize(vViewPosition), normalize(vNormal)), 0.0);
        rimFresnel = pow(rimFresnel, rimPower);
        gl_FragColor.rgb += rimColor * rimFresnel * rimIntensity;`
      );
  };
  return mat;
}

/**
 * Chromatic override. When set, a cube's 'active' flash uses this colour
 * instead of the theme's, because under the Chromatic modifier the flash colour
 * is information the player must remember, not decoration. Cleared back to null
 * the moment the flash ends so nothing else in the game is tinted.
 */
export function setCubeChannelTint(cube: THREE.Mesh, hexNum: number | null): void {
  cube.userData['channelTint'] = hexNum;
}

export function setCubeState(cube: THREE.Mesh, cubeState: CubeState): void {
  cube.userData['state'] = cubeState;
  const mat = cube.material as THREE.MeshStandardMaterial;
  const edge = (cube.children[0] as THREE.LineSegments).material as THREE.LineBasicMaterial;
  const rimRaw = mat.userData['rimUniforms'] as {
    rimColor: { value: THREE.Color };
    rimIntensity: { value: number };
  };
  const eBoost = (mat.userData['emissiveBoost'] as number) ?? 1;
  const rBoost = (mat.userData['rimBoost'] as number) ?? 1;

  // Wraps the raw uniform so every `rim.rimIntensity.value = x` below scales by
  // the material's rimBoost without each case having to know about it.
  const rim = {
    rimColor: rimRaw.rimColor,
    rimIntensity: {
      set value(v: number) { rimRaw.rimIntensity.value = v * rBoost; },
      get value() { return rimRaw.rimIntensity.value; },
    },
  };
  const setEmissive = (v: number) => { mat.emissiveIntensity = v * eBoost; };

  switch (cubeState) {
    case 'base':
      mat.emissive.setHex(t.active); setEmissive(0.12); edge.color.setHex(t.edge);
      rim.rimColor.value.setHex(t.active); rim.rimIntensity.value = 0.35; break;
    case 'active': {
      // Chromatic's channel colour takes precedence over the theme here — see
      // setCubeChannelTint. Everything else about the flash is unchanged.
      const tint = cube.userData['channelTint'] as number | null | undefined;
      const activeCol = (tint ?? t.active) as number;
      mat.emissive.setHex(activeCol); setEmissive(1.1); edge.color.setHex(0xffffff);
      rim.rimColor.value.setHex(activeCol); rim.rimIntensity.value = 1.1; break;
    }
    case 'correct':
      mat.emissive.setHex(t.correct); setEmissive(1.6); edge.color.setHex(0xffffff);
      rim.rimColor.value.setHex(t.correct); rim.rimIntensity.value = 1.4; break;
    case 'wrong':
      mat.emissive.setHex(t.wrong); setEmissive(1.5); edge.color.setHex(0xffffff);
      rim.rimColor.value.setHex(t.wrong); rim.rimIntensity.value = 1.4; break;
    case 'decoy':
      mat.emissive.setHex(t.wrong); setEmissive(1.0); edge.color.setHex(0xffffff);
      rim.rimColor.value.setHex(t.wrong); rim.rimIntensity.value = 1.0; break;
  }
}


// Cube and edge geometry never vary — only how many instances exist — so they
// are built once and shared. They were previously reallocated on every
// createBoard() call (level-up, every Zen/Sprint mistake, every menu return)
// and never disposed, leaking GPU buffers for the life of the session.
const CUBE_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
const EDGE_GEOMETRY = new THREE.EdgesGeometry(CUBE_GEOMETRY);

export function createBoard(): void {
  // Remove old cubes and release their GPU-side resources. Materials are
  // per-cube (each carries its own rim uniforms) so they must be disposed
  // individually; the two geometries above are shared and must not be.
  cubes.forEach(cube => {
    boardGroup.remove(cube);
    (cube.material as THREE.Material).dispose();
    const edges = cube.children[0] as THREE.LineSegments | undefined;
    if (edges) (edges.material as THREE.Material).dispose();
  });
  cubes.length = 0;

  const spacing = 1.4;
  const offset = (state.gridSize - 1) * spacing / 2;

  for (let x = 0; x < state.gridSize; x++) {
    for (let z = 0; z < state.gridSize; z++) {
      const preset = activeBoardMaterial();
      const material = makeRimMaterial({
        color: t.base,
        roughness: preset.roughness,
        metalness: preset.metalness,
        transparent: preset.transparent,
        opacity: preset.opacity,
        wireframe: preset.wireframe,
        flatShading: preset.flatShading,
      });
      // Stashed on the material so setCubeState can scale each state's glow
      // without re-resolving the active treatment on every state change.
      material.userData['emissiveBoost'] = preset.emissiveBoost;
      material.userData['rimBoost'] = preset.rimBoost;
      const cube = new THREE.Mesh(CUBE_GEOMETRY, material);
      const edges = new THREE.LineSegments(
        EDGE_GEOMETRY,
        new THREE.LineBasicMaterial({ color: t.edge, linewidth: 2 })
      );
      cube.add(edges);
      cube.position.set(x * spacing - offset, 0, z * spacing - offset);
      cube.scale.set(0.01, 0.01, 0.01);
      cube.userData = { index: cubes.length, targetScale: 1, targetY: 0, state: 'base' };
      setCubeState(cube, 'base');
      cubes.push(cube);
      boardGroup.add(cube);
    }
  }

  // Reposition camera to fit the (possibly resized) grid. Single shared
  // implementation in scene.ts — see adjustCameraForViewport() for why this
  // used to be duplicated here.
  void gridFloor;
  void scene;
  adjustCameraForViewport();
}
