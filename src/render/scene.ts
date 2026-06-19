import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import { t } from '../save';

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

export function initScene(container: HTMLElement): void {
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(t.bg, 0.04);

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 8, 12);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
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
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2),
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
