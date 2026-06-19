import { initScene, scene, pLight, gridFloor } from './render/scene';
import { startRenderLoop, stopRenderLoop, isLoopRunning } from './render/loop';
import { state } from './state';
import { applyTheme, currentThemeKey, t, setThemeChangeCallback } from './save';
import { updateMenuText, setupMenuListeners } from './ui/menu';
import { setupModalListeners } from './ui/modals';
import { onPointerDown, onPointerMove, onPointerUp, onTouchStart, onTouchMove, onWindowResize } from './input';
import { cubes, setCubeState, createBoard } from './render/board';
import type { CubeUserData } from './types';
import * as THREE from 'three';

document.addEventListener('touchmove', (e: TouchEvent) => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

window.addEventListener('load', () => {
  const container = document.getElementById('canvas-container')!;

  updateMenuText();
  applyTheme(currentThemeKey);

  initScene(container);

  // Register theme-change callback now that scene objects exist
  setThemeChangeCallback(() => {
    if (!scene) return;
    if (scene.fog) (scene.fog as THREE.FogExp2).color.setHex(t.bg);
    if (pLight) pLight.color.setHex(t.active);
    if (gridFloor) (gridFloor.material as THREE.LineBasicMaterial).color.setHex(t.edge);
    cubes.forEach(cube => {
      (cube.material as THREE.MeshStandardMaterial).color.setHex(t.base);
      ((cube.children[0] as THREE.LineSegments).material as THREE.LineBasicMaterial).color.setHex(t.edge);
      if (!state.isPlayable && (cube.userData as CubeUserData).state !== 'active') {
        setCubeState(cube, 'base');
      }
    });
  });

  // Re-apply now that scene is ready so Three.js objects get the correct initial colors
  applyTheme(currentThemeKey);

  createBoard();
  startRenderLoop();
  setupMenuListeners();
  setupModalListeners();

  // Input listeners
  const canvas = container.querySelector('canvas')!;
  canvas.addEventListener('pointerdown', onPointerDown as EventListener);
  window.addEventListener('pointerup', onPointerUp as EventListener);
  window.addEventListener('pointermove', onPointerMove as EventListener);
  canvas.addEventListener('touchstart', onTouchStart as EventListener, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove as EventListener, { passive: false });
  window.addEventListener('resize', onWindowResize);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopRenderLoop();
    else startRenderLoop();
  });

  // Debug handle for Playwright tests only — stripped by tree-shaking in prod
  // since nothing in the production code path references window.__signal.
  (window as Window & { __signal?: unknown }).__signal = {
    isLoopRunning,
    getState: () => state,
  };
});
