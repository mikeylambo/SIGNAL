import { initScene, adjustCameraForViewport, scene, pLight, gridFloor, camera, renderer } from './render/scene';
import { startRenderLoop, stopRenderLoop, isLoopRunning } from './render/loop';
import { state } from './state';
import { applyTheme, currentThemeKey, t, setThemeChangeCallback, profile, saveProfile } from './save';
import { updateMenuText, setupMenuListeners, initAccessiblePalette } from './ui/menu';
import { setupModalListeners, returnToMenu, pauseGame } from './ui/modals';
import { setupLeaderboardBrowser } from './ui/leaderboard';
import { onPointerDown, onPointerMove, onPointerUp, onTouchStart, onTouchMove, onWindowResize } from './input';
import { cubes, setCubeState, createBoard } from './render/board';
import type { CubeUserData } from './types';
import { initErrorBoundary, showFatalError } from './errorBoundary';
import { startOnboardingRound } from './game/runLoop';
import { setupKeyboard } from './keyboard';
import * as THREE from 'three';

initErrorBoundary();

document.addEventListener('touchmove', (e: TouchEvent) => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

// Splash screen: skip immediately for returning users (covers Playwright tests too,
// since they seed localStorage with hasCompletedOnboarding: true).
// New users see a 2s show + 0.5s fade = 2.5s total before the splash is removed.
{
  const splashEl = document.getElementById('splash-screen');
  if (splashEl) {
    // Keyed on hasSeenOnboarding, not hasCompletedOnboarding: a player who
    // skipped the tutorial has still seen the app, and shouldn't sit through
    // the first-run splash again on every launch.
    if (profile.hasSeenOnboarding) {
      splashEl.remove();
    } else {
      setTimeout(() => {
        splashEl.classList.add('splash-fade-out');
        setTimeout(() => splashEl.remove(), 500);
      }, 2000);
    }
  }
}

window.addEventListener('load', () => {
  // Safe-area insets are handled entirely in CSS now — index.html sets
  // viewport-fit=cover statically and derives --sat/--sab/--sal/--sar from
  // env(). The JS that used to live here injected viewport-fit at runtime and
  // then measured env() in the SAME synchronous task, which returns 0 because
  // the browser has not re-evaluated the viewport yet. The `if (x > 0)` guards
  // then skipped writing the variables, so cover mode was on with no insets
  // applied and the header rendered over the iOS status bar. It was also a
  // one-shot read, so the values went stale on rotation.

  const container = document.getElementById('canvas-container')!;

  // Restore the last modifier before the first menu render, so the button
  // doesn't briefly show Standard and then change.
  state.modifierId = (profile.lastModifier ?? 'none') as typeof state.modifierId;

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
    if (renderer) renderer.setClearColor(t.bg, 1);
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

  // A saved colour-vision palette overrides the stored calibration. Applied
  // here rather than only when Settings opens, or the setting would persist but
  // silently not take effect until the player went looking for it.
  initAccessiblePalette();

  createBoard();
  startRenderLoop();
  setupMenuListeners();
  setupModalListeners();
  setupLeaderboardBrowser();
  setupKeyboard();

  // Measure menu sheet height → CSS var so controls-hint sits just above it.
  function updateMenuSheetHeight(): void {
    const sheet = document.getElementById('menu-sheet');
    if (sheet) {
      const h = sheet.getBoundingClientRect().height;
      document.documentElement.style.setProperty('--menu-sheet-h', `${h + 12}px`);
    }
  }
  const sheetEl = document.getElementById('menu-sheet');
  if (sheetEl && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(updateMenuSheetHeight).observe(sheetEl);
  }
  updateMenuSheetHeight();
  window.addEventListener('resize', () => {
    updateMenuSheetHeight();
    adjustCameraForViewport();
  });

  document.getElementById('replay-intro-btn')!.addEventListener('click', () => {
    const btn = document.getElementById('replay-intro-btn') as HTMLButtonElement;
    btn.disabled = true;
    profile.hasCompletedOnboarding = false;
    profile.hasSeenOnboarding = false;
    saveProfile();
    returnToMenu();
    void startOnboardingRound().finally(() => { btn.disabled = false; });
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
    if (document.hidden) {
      // Suspend the run, not just the renderer. rAF stops while hidden but its
      // timestamps keep tracking wall-clock, so a timed run used to be charged
      // for the entire time the player was away and could end the moment they
      // came back. Gameplay sequences (Observe flashes, the n-Back stream)
      // would also play out unwatched.
      pauseGame();
      stopRenderLoop();
    } else {
      startRenderLoop();
    }
  });

  // Service worker: offline play. Registered after load so it never competes
  // with first paint, and skipped on localhost dev where a cached shell would
  // mask code changes behind a stale service worker.
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      // Non-fatal by design: no service worker just means no offline play.
      console.warn('[SIGNAL] Service worker registration failed', err);
    });
  }

  // Debug handle for Playwright tests only — stripped by tree-shaking in prod
  // since nothing in the production code path references window.__signal.
  (window as Window & { __signal?: unknown }).__signal = {
    isLoopRunning,
    getState: () => state,
    // Material properties of a board tile. Exposed so a test can prove a
    // purchased treatment actually reaches the renderer rather than only the
    // profile — those two drifting apart is the failure mode worth catching.
    getBoardMaterial: () => {
      const m = cubes[0]?.material as THREE.MeshStandardMaterial | undefined;
      return m ? {
        roughness: m.roughness, metalness: m.metalness, wireframe: m.wireframe,
        transparent: m.transparent, opacity: m.opacity, flatShading: m.flatShading,
      } : null;
    },
    // Brightest tile on the board. Exists so a test can assert that the
    // Resonant modifier never lights one — the whole point of that modifier is
    // that nothing is shown, which is otherwise unobservable from outside.
    getMaxEmissive: (): number =>
      cubes.reduce((m, c) => Math.max(m, (c.material as THREE.MeshStandardMaterial).emissiveIntensity), 0),
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
