import { scene, camera, renderer, boardGroup, pivotGroup, gridFloor, particles, composer, bloomEnabled } from './scene';
import { cubes } from './board';
import { state } from '../state';
import { PACINGS } from '../game/protocols';
import { isReducedMotion } from '../reducedMotion';

export const loopState = {
  isDragging: false,
  dragThreshold: false,
  prevMouse: { x: 0, y: 0 },
  targetRot: { x: 0, y: 0 },  // only the drag handler updates this
  mouseX: 0,
  mouseY: 0,
  hitstopEndTime: 0,
};

let lastAnimFrameTime = 0;
let animFrameId: number | null = null;
let loopRunning = false;

export function isLoopRunning(): boolean { return loopRunning; }

export function resetAnimTime(): void {
  lastAnimFrameTime = 0;
}

export function resetPivotRotation(): void {
  // Sync targetRot to current pivot angle — no snap on game start
  loopState.targetRot.x = pivotGroup.rotation.x;
  loopState.targetRot.y = pivotGroup.rotation.y;
}

export function startRenderLoop(): void {
  if (loopRunning) return;
  loopRunning = true;
  lastAnimFrameTime = 0;
  animFrameId = requestAnimationFrame(animate);
}

export function stopRenderLoop(): void {
  loopRunning = false;
  if (animFrameId) cancelAnimationFrame(animFrameId);
  animFrameId = null;
}

export function animate(timestamp: number): void {
  if (!loopRunning) return;
  animFrameId = requestAnimationFrame(animate);

  if (state.isPaused || Date.now() < loopState.hitstopEndTime) {
    lastAnimFrameTime = timestamp;
    return;
  }

  if (!lastAnimFrameTime) lastAnimFrameTime = timestamp;
  let dt60 = (timestamp - lastAnimFrameTime) / (1000 / 60);
  lastAnimFrameTime = timestamp;
  dt60 = Math.min(dt60, 4);

  const pPace = PACINGS[state.curPaceIdx];

  const reducedMotion = isReducedMotion();

  if (gridFloor && !reducedMotion) {
    gridFloor.position.z += (pPace.id === 'sprint' ? 0.08 : 0.03) * dt60;
    if (gridFloor.position.z > 1) gridFloor.position.z = 0;
  }

  // Grid stays wherever the player left it — targetRot only changes on drag.
  {
    const rotLerp = 1 - Math.pow(1 - 0.1, dt60);
    pivotGroup.rotation.x += (loopState.targetRot.x - pivotGroup.rotation.x) * rotLerp;
    pivotGroup.rotation.y += (loopState.targetRot.y - pivotGroup.rotation.y) * rotLerp;
  }
 else if (!isMenuIdle) {
    pivotGroup.rotation.x += (loopState.targetRot.x - pivotGroup.rotation.x) * rotLerp;
    pivotGroup.rotation.y += (loopState.targetRot.y - pivotGroup.rotation.y) * rotLerp;
  }

  if (!loopState.isDragging && !reducedMotion) {
    const driftLerp = 1 - Math.pow(1 - 0.05, dt60);
    boardGroup.position.x += (loopState.mouseX * 0.5 - boardGroup.position.x) * driftLerp;
    boardGroup.position.y += (-loopState.mouseY * 0.5 - boardGroup.position.y) * driftLerp;
  }

  const scaleLerp = 1 - Math.pow(1 - 0.2, dt60);
  const posLerp = 1 - Math.pow(1 - 0.3, dt60);
  cubes.forEach(cube => {
    const s = cube.scale.x + (cube.userData['targetScale'] - cube.scale.x) * scaleLerp;
    cube.scale.set(s, s, s);
    cube.position.y += (cube.userData['targetY'] - cube.position.y) * posLerp;
  });

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    const vel = p.userData['velocity'] as { x: number; y: number; z: number };
    p.position.x += vel.x * dt60;
    p.position.y += vel.y * dt60;
    p.position.z += vel.z * dt60;
    vel.y -= 0.01 * dt60;
    p.userData['life'] = (p.userData['life'] as number) - 0.02 * dt60;
    p.scale.setScalar(Math.max(0, p.userData['life'] as number));
    if ((p.userData['life'] as number) <= 0) {
      scene.remove(p);
      particles.splice(i, 1);
    }
  }

  if (bloomEnabled && composer) composer.render();
  else renderer.render(scene, camera);
}

export function flashScreen(color: string): void {
  const el = document.getElementById('screen-flash');
  if (!el) return;
  el.style.background = color;
  el.classList.remove('flash-active');
  void el.offsetWidth;
  el.classList.add('flash-active');
}

// Cancellation token: each cameraShake call increments this. A tick closure
// captures the token at the moment it's created; if a newer shake starts
// before the old one finishes, the old tick sees a stale token and exits,
// preventing two concurrent loops from fighting over camera.position.
let shakeGeneration = 0;

export function cameraShake(intensity: number, durationMs: number, onComplete?: () => void): void {
  if (isReducedMotion()) { if (onComplete) onComplete(); return; }

  const restX = camera.position.x;
  const restY = camera.position.y;
  const restZ = camera.position.z;
  const start = performance.now();
  const generation = ++shakeGeneration;

  function tick(now: number) {
    if (generation !== shakeGeneration) { camera.position.set(restX, restY, restZ); return; }
    const elapsed = now - start;
    const progress = Math.min(1, elapsed / durationMs);
    const falloff = 1 - progress;
    if (progress < 1) {
      const fx = (Math.sin(elapsed * 0.08) + Math.sin(elapsed * 0.13)) * 0.5;
      const fy = (Math.sin(elapsed * 0.10) + Math.sin(elapsed * 0.17)) * 0.5;
      camera.position.x = restX + fx * intensity * falloff;
      camera.position.y = restY + fy * intensity * falloff;
      requestAnimationFrame(tick);
    } else {
      camera.position.set(restX, restY, restZ);
      if (onComplete) onComplete();
    }
  }
  requestAnimationFrame(tick);
}
