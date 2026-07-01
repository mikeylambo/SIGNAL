import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import { t } from '../save';

// Bloom resolution scales with detected device tier so mid-tier mobile
// doesn't spend 60% of its frame budget on a blur effect.
// Tier is estimated once at init from devicePixelRatio + logical core count.
// low  → 1/4 screen  (single-core / low-DPI)
// mid  → 1/3 screen  (2–3 cores or mid DPI)
// high → 1/2 screen  (4+ cores and high DPI — original value)
export function bloomResScale(): number {
  const cores = navigator.hardwareConcurrency ?? 2;
  const dpr = window.devicePixelRatio ?? 1;
  if (cores <= 2 || dpr <= 1) return 0.25;
  if (cores <= 3 || dpr <= 1.5) return 0.33;
  return 0.5;
}

export let scene: THREE.Scene;
export let camera: THREE.PerspectiveCamera;
export let renderer: THREE.WebGLRenderer;
export let raycaster: THREE.Raycaster;
export let mouse: THREE.Vector2;
export let boardGroup: THREE.Group;
export let pivotGroup: THREE.Group;
export let pLight: THREE.PointLight;
export let gridFloor: THREE.GridHelper;
export const particles: THREE.Mesh[] = [];
export let composer: EffectComposer | null = null;
export let bloomPass: UnrealBloomPass | null = null;
export let bloomEnabled = false;

export const particleGeo = new THREE.BoxGeometry(0.15, 0.15, 0.15);

// Pulls the camera back on small or portrait viewports so the board isn't clipped.
// Camera is positioned for a flatter, more face-on view of the grid,
// and looks toward the upper half of the screen so the bottom sheet UI
// sits below the board without overlap.
export function adjustCameraForViewport(): void {
  const portrait = window.innerWidth < window.innerHeight;
  const small    = window.innerHeight < 667;
  if (small) {
    camera.fov = 68;
    camera.position.set(0, 6, 16);
    camera.lookAt(0, 2, 0);
  } else if (portrait) {
    camera.fov = 62;
    camera.position.set(0, 5, 14);
    camera.lookAt(0, 1.5, 0);
  } else {
    camera.fov = 45;
    camera.position.set(0, 4, 12);
    camera.lookAt(0, 1, 0);
  }
  camera.updateProjectionMatrix();
}

export function initScene(container: HTMLElement): void {
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(t.bg, 0.04);

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 4, 12);

  // WebGL availability check — throws a readable error instead of white-screening.
  const testCanvas = document.createElement('canvas');
  const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
  if (!gl) throw new Error('WebGL is not supported or has been disabled on this device.');

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(t.bg, 1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const dLight = new THREE.DirectionalLight(0xffffff, 0.75);
  dLight.position.set(5, 10, 7);
  scene.add(dLight);

  pLight = new THREE.PointLight(t.active, 0.5, 20);
  pLight.position.set(0, 5, 0);
  scene.add(pLight);

  pivotGroup = new THREE.Group();
  boardGroup = new THREE.Group();
  pivotGroup.add(boardGroup);
  scene.add(pivotGroup);

  gridFloor = new THREE.GridHelper(50, 25, t.edge, t.edge);
  gridFloor.position.y = -2;
  (gridFloor.material as THREE.LineBasicMaterial).transparent = true;
  (gridFloor.material as THREE.LineBasicMaterial).opacity = 0.18;
  scene.add(gridFloor);

  try {
    const scale = bloomResScale();
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth * scale, window.innerHeight * scale),
      0.65,
      0.55,
      0.18
    );
    composer.addPass(bloomPass);
    bloomEnabled = true;
  } catch (e) {
    console.warn('Bloom unavailable, falling back to standard render.', e);
    bloomEnabled = false;
  }

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  adjustCameraForViewport();
}

export function spawnParticles(position: THREE.Vector3, colorHex: string, count = 10): void {
  const colorNum = parseInt(colorHex.replace('#', ''), 16);
  const particleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: colorNum, emissiveIntensity: 2 });
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(particleGeo, particleMat);
    mesh.position.copy(position);
    mesh.userData['velocity'] = new THREE.Vector3(
      (Math.random() - 0.5) * 0.4,
      Math.random() * 0.3 + 0.1,
      (Math.random() - 0.5) * 0.4
    );
    mesh.userData['life'] = 1.0;
    scene.add(mesh);
    particles.push(mesh);
  }
}
