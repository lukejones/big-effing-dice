import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { getDie } from './dice.js';

const MIN_N = 2;
const MAX_N = 1000000;

// ---------------- three.js scene ----------------
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(0, 0, 3.4);

// environment for nice gem reflections
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// lighting — a warm key and a cool rim to read the facets
const key = new THREE.DirectionalLight(0xfff0d0, 2.4);
key.position.set(2.5, 3, 2);
scene.add(key);
const rim = new THREE.DirectionalLight(0x54e0d0, 1.4);
rim.position.set(-3, -1, -2);
scene.add(rim);
scene.add(new THREE.AmbientLight(0x404a5c, 0.6));

const material = new THREE.MeshStandardMaterial({
  color: 0xf4a83a,
  metalness: 0.55,
  roughness: 0.18,
  flatShading: true,
});
const edgeMaterial = new THREE.LineBasicMaterial({ color: 0xf4ead6, transparent: true, opacity: 0.5 });

let mesh = null;
let edges = null;

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.autoRotate = true;
controls.autoRotateSpeed = 1.3;
controls.minDistance = 1.6;
controls.maxDistance = 12;

// ---------------- build / swap the die ----------------
function buildDie(n) {
  const { geometry, flatShading, faces, mode } = getDie(n);

  // normalise so every die fills the same screen space
  geometry.computeBoundingSphere();
  const r = geometry.boundingSphere.radius || 1;
  const scale = 1 / r;

  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
  if (edges) { scene.remove(edges); edges.geometry.dispose(); edges = null; }

  material.flatShading = flatShading;
  material.needsUpdate = true;

  mesh = new THREE.Mesh(geometry, material);
  mesh.scale.setScalar(scale);
  scene.add(mesh);

  // crisp facet edges, but only when the count is low enough to read
  if (faces <= 300) {
    const eg = new THREE.EdgesGeometry(geometry, 1);
    edges = new THREE.LineSegments(eg, edgeMaterial);
    edges.scale.setScalar(scale);
    scene.add(edges);
  }

  // ui text
  dieLabel.textContent = 'd' + n.toLocaleString();
  modeLabel.textContent = mode;
  faceCount.textContent = faces.toLocaleString() + (faces === 1 ? ' face' : ' faces');
}

// ---------------- state + ui sync ----------------
const dieLabel = document.getElementById('dieLabel');
const modeLabel = document.getElementById('modeLabel');
const faceCount = document.getElementById('faceCount');
const numInput = document.getElementById('numInput');
const slider = document.getElementById('slider');
const presets = document.getElementById('presets');

let currentN = 6;
let rebuildTimer = null;

// logarithmic mapping between slider (0..1000) and N (2..1e6)
const logMin = Math.log(MIN_N);
const logMax = Math.log(MAX_N);
const nToSlider = (n) => Math.round(((Math.log(n) - logMin) / (logMax - logMin)) * 1000);
const sliderToN = (s) => Math.round(Math.exp(logMin + (s / 1000) * (logMax - logMin)));

function setN(n, { fromSlider = false } = {}) {
  n = Math.max(MIN_N, Math.min(MAX_N, Math.round(n || MIN_N)));
  currentN = n;

  numInput.value = n;
  if (!fromSlider) slider.value = nToSlider(n);

  // highlight a matching preset chip
  for (const b of presets.children) b.classList.toggle('is-active', +b.dataset.n === n);

  // debounce the (potentially heavy) geometry rebuild
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => buildDie(n), 55);

  // keep the headline number instant even while geometry catches up
  dieLabel.textContent = 'd' + n.toLocaleString();
}

// ---------------- wiring ----------------
slider.addEventListener('input', () => setN(sliderToN(+slider.value), { fromSlider: true }));
numInput.addEventListener('change', () => setN(+numInput.value));

presets.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setN(+b.dataset.n);
});

document.querySelector('.clicker__jumps').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.set) setN(+b.dataset.set);
  if (b.dataset.mul) setN(currentN * +b.dataset.mul);
});

// hold-to-accelerate stepper (the "click all the way to a million" feel)
let holdTimer = null;
function startHold(dir) {
  let step = 1, ticks = 0;
  const tick = () => {
    setN(currentN + dir * step);
    if (++ticks % 5 === 0 && step < 100000) step *= 10; // accelerate
  };
  tick();
  holdTimer = setInterval(tick, 110);
}
function stopHold() { clearInterval(holdTimer); holdTimer = null; }

for (const b of document.querySelectorAll('.step')) {
  const dir = +b.dataset.step;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); startHold(dir); });
  b.addEventListener('pointerup', stopHold);
  b.addEventListener('pointerleave', stopHold);
  b.addEventListener('pointercancel', stopHold);
}

// view controls
document.getElementById('spinBtn').addEventListener('click', (e) => {
  controls.autoRotate = !controls.autoRotate;
  e.currentTarget.classList.toggle('is-on', controls.autoRotate);
});
document.getElementById('wireBtn').addEventListener('click', (e) => {
  material.wireframe = !material.wireframe;
  e.currentTarget.classList.toggle('is-on', material.wireframe);
});
document.getElementById('resetBtn').addEventListener('click', () => {
  controls.reset();
  camera.position.set(0, 0, defaultCameraDistance());
  controls.update();
});

// mobile: open/close the control panel
const menuToggle = document.getElementById('menuToggle');
const panelClose = document.getElementById('panelClose');
function setControls(open) {
  document.body.classList.toggle('controls-open', open);
  menuToggle.setAttribute('aria-expanded', String(open));
}
menuToggle.addEventListener('click', () => setControls(true));
panelClose.addEventListener('click', () => setControls(false));

// Default camera distance. On mobile, frame the (unit-radius) die so it spans
// ~80% of the viewport WIDTH; on desktop use a comfortable fixed distance.
function defaultCameraDistance() {
  if (window.innerWidth <= 640) {
    const vFov = (camera.fov * Math.PI) / 180;
    const hHalf = Math.atan(camera.aspect * Math.tan(vFov / 2)); // horizontal half-FOV
    const d = 1 / (0.8 * Math.tan(hHalf));
    return Math.min(d, controls.maxDistance);
  }
  return 3.4;
}

// ---------------- resize + render ----------------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// boot
setControls(window.innerWidth > 640); // open on desktop, collapsed on mobile
camera.position.set(0, 0, defaultCameraDistance());
controls.update();
setN(6);
buildDie(6);
