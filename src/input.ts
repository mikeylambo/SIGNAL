import * as THREE from 'three';
import { camera, raycaster, mouse } from './render/scene';
import { cubes } from './render/board';
import { loopState } from './render/loop';
import { handleInteraction } from './game/runLoop';
import { state } from './state';
import { composer, bloomPass, renderer, bloomResScale } from './render/scene';
import { createBoard } from './render/board';

export const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
export const hitstopScale = isTouchDevice ? 0.35 : 1;

// Suppress unused warning — hitstopScale is exported for runLoop.ts
void hitstopScale;

let initialPinchDist: number | null = null;
let baseZoom = 1;

export function onPointerDown(e: PointerEvent): void {
  if (e.target !== (renderer?.domElement ?? null) || (e.pointerType === 'touch' && !e.isPrimary)) return;
  loopState.isDragging = true;
  loopState.dragThreshold = false;
  loopState.prevMouse = { x: e.clientX, y: e.clientY };
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
}

export function onPointerMove(e: PointerEvent): void {
  if (e.pointerType === 'touch' && !e.isPrimary) return;
  if (loopState.isDragging) {
    const delta = { x: e.clientX - loopState.prevMouse.x, y: e.clientY - loopState.prevMouse.y };
    if (Math.abs(delta.x) > 8 || Math.abs(delta.y) > 8) loopState.dragThreshold = true;
    loopState.targetRot.y += delta.x * 0.005;
    loopState.targetRot.x += delta.y * 0.005;
    loopState.targetRot.x = Math.max(-Math.PI / 2 + 0.2, Math.min(Math.PI / 2 - 0.2, loopState.targetRot.x));
    loopState.prevMouse = { x: e.clientX, y: e.clientY };
  } else {
    loopState.mouseX = (e.clientX / window.innerWidth) * 2 - 1;
    loopState.mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
    mouse.x = loopState.mouseX;
    mouse.y = loopState.mouseY;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(cubes);
    document.body.style.cursor = (intersects.length > 0 && state.isPlayable && !state.isPaused) ? 'pointer' : 'default';
    cubes.forEach(c => { c.userData['targetScale'] = 1; });
    if (intersects.length > 0 && state.isPlayable && !state.isPaused && !state.userClicks.includes(intersects[0].object.userData['index'] as number)) {
      intersects[0].object.userData['targetScale'] = 1.15;
    }
  }
}

export function onPointerUp(e: PointerEvent): void {
  if (e.pointerType === 'touch' && !e.isPrimary) return;
  loopState.isDragging = false;
  const canvas = renderer?.domElement;
  if (!loopState.dragThreshold && state.isPlayable && !state.isPaused && e.target === canvas) {
    mouse.x = (loopState.prevMouse.x / window.innerWidth) * 2 - 1;
    mouse.y = -(loopState.prevMouse.y / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(cubes);
    if (intersects.length > 0) handleInteraction(intersects[0].object as THREE.Mesh);
  }
}

export function onTouchStart(e: TouchEvent): void {
  if (e.touches.length === 2) {
    initialPinchDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    baseZoom = camera.zoom;
  }
}

export function onTouchMove(e: TouchEvent): void {
  if (e.touches.length === 2 && initialPinchDist) {
    const currentDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    camera.zoom = Math.max(0.5, Math.min(3, baseZoom * (currentDist / initialPinchDist)));
    camera.updateProjectionMatrix();
  }
}

export function onWindowResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  // Reset zoom on orientation change so a pinch-zoom from portrait doesn't
  // carry over and leave a stale multiplier in landscape (or vice versa).
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
  if (bloomPass) {
    const scale = bloomResScale();
    bloomPass.setSize(window.innerWidth * scale, window.innerHeight * scale);
  }
  if (state.pattern.length === 0) {
    createBoard();
  }
}
