import * as THREE from 'three';
import type { CubeState } from '../types';
import { scene, boardGroup, camera, gridFloor } from './scene';
import { t } from '../save';
import { state } from '../state';

export let cubes: THREE.Mesh[] = [];

export function makeRimMaterial(opts: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial(opts);
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

export function setCubeState(cube: THREE.Mesh, cubeState: CubeState): void {
  cube.userData['state'] = cubeState;
  const mat = cube.material as THREE.MeshStandardMaterial;
  const edge = (cube.children[0] as THREE.LineSegments).material as THREE.LineBasicMaterial;
  const rim = mat.userData['rimUniforms'] as {
    rimColor: { value: THREE.Color };
    rimIntensity: { value: number };
  };

  switch (cubeState) {
    case 'base':
      mat.emissive.setHex(t.active); mat.emissiveIntensity = 0.12; edge.color.setHex(t.edge);
      rim.rimColor.value.setHex(t.active); rim.rimIntensity.value = 0.35; break;
    case 'active':
      mat.emissive.setHex(t.active); mat.emissiveIntensity = 1.1; edge.color.setHex(0xffffff);
      rim.rimColor.value.setHex(t.active); rim.rimIntensity.value = 1.1; break;
    case 'correct':
      mat.emissive.setHex(t.correct); mat.emissiveIntensity = 1.6; edge.color.setHex(0xffffff);
      rim.rimColor.value.setHex(t.correct); rim.rimIntensity.value = 1.4; break;
    case 'wrong':
      mat.emissive.setHex(t.wrong); mat.emissiveIntensity = 1.5; edge.color.setHex(0xffffff);
      rim.rimColor.value.setHex(t.wrong); rim.rimIntensity.value = 1.4; break;
    case 'decoy':
      mat.emissive.setHex(t.wrong); mat.emissiveIntensity = 1.0; edge.color.setHex(0xffffff);
      rim.rimColor.value.setHex(t.wrong); rim.rimIntensity.value = 1.0; break;
  }
}


export function createBoard(): void {
  // Remove old cubes but keep reference valid
  cubes.forEach(cube => boardGroup.remove(cube));
  cubes.length = 0;

  const spacing = 1.4;
  const offset = (state.gridSize - 1) * spacing / 2;
  const geometry = new THREE.BoxGeometry(1, 1, 1);

  for (let x = 0; x < state.gridSize; x++) {
    for (let z = 0; z < state.gridSize; z++) {
      const material = makeRimMaterial({ color: t.base, roughness: 0.55, metalness: 0.25 });
      const cube = new THREE.Mesh(geometry, material);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
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

  // Reposition camera to fit the grid
  // gridFloor is needed to silence the unused-import warning; it's used in scene.ts
  void gridFloor;
  void scene;

  const portrait  = window.innerWidth < window.innerHeight;
  const small     = window.innerHeight < 667;
  const lookY     = small ? 2 : portrait ? 1.5 : 1;
  const baseZ     = small ? 16 : portrait ? 14 : 12;
  const baseY     = small ? 6 : portrait ? 5 : 4;
  const gridScale = Math.max(1, state.gridSize / 3);
  camera.position.set(0, baseY * gridScale, baseZ * gridScale);
  camera.lookAt(0, lookY * gridScale, 0);
  camera.zoom = 1;
  camera.updateProjectionMatrix();
}
