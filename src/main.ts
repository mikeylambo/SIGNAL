import { initScene, scene, pLight, gridFloor, camera, renderer } from './render/scene';
import { startRenderLoop, stopRenderLoop, isLoopRunning } from './render/loop';
import { state } from './state';
import { applyTheme, currentThemeKey, t, setThemeChangeCallback, profile, saveProfile } from './save';
import { updateMenuText, setupMenuListeners } from './ui/menu';
import { setupModalListeners, returnToMenu } from './ui/modals';
import { onPointerDown, onPointerMove, onPointerUp, onTouchStart, onTouchMove, onWindowResize } from './input';
import { cubes, setCubeState, createBoard } from './render/board';
import type { CubeUserData } from './types';
import { initErrorBoundary, showFatalError } from './errorBoundary';
import { startOnboardingRound } from './game/runLoop';
import * as THREE from 'three';

initErrorBoundary();

document.addEventListener('touchmove', (e: TouchEvent) => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

window.addEventListener('load', () => {
  // On iOS, enable viewport-fit=cover so env(safe-area-inset-*) returns real values,
  // then read those values once and store as static CSS vars (--sat / --sab).
  // Skipped entirely on non-iOS / headless to avoid layout overhead.
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    const vp = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
    if (vp && !vp.content.includes('viewport-fit')) {
      vp.content += ', viewport-fit=cover';
    }
    const _saDiv = document.createElement('div');
    _saDiv.style.cssText = 'position:fixed;top:env(safe-area-inset-top,0px);bottom:env(safe-area-inset-bottom,0px);height:0;visibility:hidden;pointer-events:none;';
    document.body.appendChild(_saDiv);
    const _saStyle = getComputedStyle(_saDiv);
    const _sat = parseFloat(_saStyle.top) || 0;
    const _sab = parseFloat(_saStyle.bottom) || 0;
    _saDiv.remove();
    if (_sat > 0) document.documentElement.style.setProperty('--sat', `${_sat}px`);
    if (_sab > 0) document.documentElement.style.setProperty('--sab', `${_sab}px`);
  }

  const container = document.getElementById('canvas-container')!;

  updateMenuText();
  applyTheme(currentThemeKey);

  try {
    initScene(container);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown graphics error.';
    showFatalError(msg);
    return;
  }

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

  document.getElementById('replay-intro-btn')!.addEventListener('click', () => {
    profile.hasCompletedOnboarding = false;
    profile.hasSeenOnboarding = false;
    saveProfile();
    returnToMenu();
    void startOnboardingRound();
  });

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
    // Projects a cube's world position to viewport coordinates so Playwright
    // tests can click tiles accurately without approximating geometry.
    getCubeScreenPos: (idx: number): { x: number; y: number } | null => {
      if (!cubes[idx]) return null;
      const worldPos = cubes[idx].getWorldPosition(new THREE.Vector3());
      const ndc = worldPos.clone().project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return {
        x: rect.left + (ndc.x + 1) / 2 * rect.width,
        y: rect.top + (1 - (ndc.y + 1) / 2) * rect.height,
      };
    },
  };
});
