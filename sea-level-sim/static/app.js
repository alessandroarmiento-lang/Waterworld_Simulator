import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { LANDMARKS, TYPE_META } from "./landmarks.js";

const canvas = document.getElementById("globe");
const appRoot = document.getElementById("app");
const slider = document.getElementById("sea-slider");
const seaValue = document.getElementById("sea-value");
const statusEl = document.getElementById("status");
const presetButtons = [...document.querySelectorAll("[data-level]")];
const filterChecks = {
  peak: document.getElementById("filter-peak"),
  city: document.getElementById("filter-city"),
  poi: document.getElementById("filter-poi"),
};
const listEl = document.getElementById("landmark-list");
const searchEl = document.getElementById("landmark-search");
const selectedEl = document.getElementById("selected-landmark");
const rotateEl = document.getElementById("rotate-globe");

const EARTH_RADIUS = 2;
const DISP_SCALE = 0.16;
const DISP_BIAS = -DISP_SCALE * 0.12;
const REF_ELEV_M = 9000;
const MARKER_LIFT = 0.03;

const filters = { peak: true, city: true, poi: true };
let seaLevelM = 0;
let autoRotate = true;
let selectedId = null;
const entries = [];
let earth = null;
let ocean = null;
const landmarksRoot = new THREE.Group();

function setStatus(message, kind = "info") {
  if (!message) { statusEl.hidden = true; statusEl.textContent = ""; return; }
  statusEl.hidden = false; statusEl.dataset.kind = kind; statusEl.textContent = message;
}
function formatElev(meters) { return Math.round(meters).toLocaleString("it-IT") + " m"; }
function formatSea(meters) {
  const rounded = Math.round(meters);
  return rounded === 0 ? "0 m" : "+" + rounded.toLocaleString("it-IT") + " m";
}
function oceanRadius(meters) {
  const h = THREE.MathUtils.clamp(meters / REF_ELEV_M, 0, 1.15);
  return EARTH_RADIUS + DISP_SCALE * h + DISP_BIAS;
}
function latLonToVec(lat, lon, radius) {
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lon + 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}
function surfaceRadius(elevM) {
  const h = THREE.MathUtils.clamp(elevM / REF_ELEV_M, -0.05, 1.2);
  return EARTH_RADIUS + DISP_SCALE * h + DISP_BIAS + MARKER_LIFT;
}
function floodState(elevM) {
  if (elevM < seaLevelM) return "flooded";
  if (elevM < seaLevelM + 50) return "risk";
  return "dry";
}
function floodLabel(elevM) {
  const state = floodState(elevM);
  if (state === "flooded") return "sommerso";
  if (state === "risk") return "a rischio";
  return "emerso";
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.className = "label-layer";
appRoot.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0b1520, 0.04);
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0.6, 1.1, 5.2);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 2.55;
controls.maxDistance = 14;
controls.addEventListener("start", () => { autoRotate = false; rotateEl.checked = false; });

scene.add(new THREE.AmbientLight(0x9eb6c8, 0.55));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.35);
sun.position.set(5, 2.5, 3);
scene.add(sun);
const fillLight = new THREE.DirectionalLight(0x6fa8ff, 0.35);
fillLight.position.set(-4, -1, -2);
scene.add(fillLight);

const starGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(1800 * 3);
for (let i = 0; i < 1800; i += 1) {
  const r = 40 + Math.random() * 40;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
  starPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
  starPos[i * 3 + 2] = r * Math.cos(phi);
}
starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xb9d4ea, size: 0.035, sizeAttenuation: true })));

const loader = new THREE.TextureLoader();
loader.setPath("/static/textures/");
function loadTexture(name) {
  return new Promise((resolve, reject) => {
    loader.load(name, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      resolve(texture);
    }, undefined, () => reject(new Error("Impossibile caricare " + name)));
  });
}

function createMarker(item) {
  const meta = TYPE_META[item.type];
  const radius = surfaceRadius(item.elev);
  const position = latLonToVec(item.lat, item.lon, radius);
  const pin = new THREE.Mesh(new THREE.SphereGeometry(0.015, 10, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(meta.color) }));
  pin.position.copy(position);
  const el = document.createElement("button");
  el.type = "button";
  el.className = "landmark-label landmark-" + item.type;
  el.dataset.id = item.id;
  el.innerHTML = '<span class="dot">' + meta.short + '</span><span class="txt">' + item.name + '</span><span class="elev">' + formatElev(item.elev) + "</span>";
  el.addEventListener("click", (event) => { event.stopPropagation(); selectLandmark(item.id, true); });
  const label = new CSS2DObject(el);
  label.position.copy(position.clone().normalize().multiplyScalar(radius + 0.03));
  landmarksRoot.add(pin); landmarksRoot.add(label);
  return { item, pin, label, el };
}

function rebuildList() {
  listEl.innerHTML = "";
  const q = (searchEl.value || "").trim().toLowerCase();
  const sorted = [...LANDMARKS].sort((a, b) => a.name.localeCompare(b.name, "it"));
  for (const item of sorted) {
    if (!filters[item.type]) continue;
    if (q && !(`${item.name} ${item.note || ""}`).toLowerCase().includes(q)) continue;
    const meta = TYPE_META[item.type];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "landmark-item" + (item.id === selectedId ? " active" : "");
    btn.innerHTML = '<span class="kind" style="color:' + meta.color + '">' + meta.short + '</span><span class="body"><strong>' + item.name + '</strong><small>' + meta.label + " · " + formatElev(item.elev) + ' · <em class="flood-' + floodState(item.elev) + '">' + floodLabel(item.elev) + "</em></small></span>";
    btn.addEventListener("click", () => selectLandmark(item.id, true));
    listEl.appendChild(btn);
  }
}

function refreshFloodUI() {
  for (const entry of entries) {
    const state = floodState(entry.item.elev);
    entry.el.classList.toggle("is-flooded", state === "flooded");
    entry.el.classList.toggle("is-risk", state === "risk");
    entry.el.title = entry.item.name + " — " + formatElev(entry.item.elev) + " — " + floodLabel(entry.item.elev);
  }
  rebuildList();
  if (selectedId) renderSelection(selectedId);
}

function priorityVisible(priority, camDist) {
  if (camDist > 8) return priority === 1;
  if (camDist > 5) return priority <= 2;
  return true;
}

function updateVisibility() {
  if (!earth) return;
  const camDist = camera.position.length();
  const worldCam = camera.position.clone();
  for (const entry of entries) {
    const showType = filters[entry.item.type];
    const showZoom = priorityVisible(entry.item.priority, camDist);
    const worldPos = entry.pin.getWorldPosition(new THREE.Vector3());
    const normal = worldPos.clone().normalize();
    const toCam = worldCam.clone().sub(worldPos).normalize();
    const facing = normal.dot(toCam) > 0.12;
    const visible = showType && showZoom && facing;
    entry.pin.visible = visible;
    entry.el.style.visibility = visible ? "visible" : "hidden";
  }
}

function renderSelection(id) {
  const item = LANDMARKS.find((l) => l.id === id);
  if (!item) { selectedEl.hidden = true; return; }
  const meta = TYPE_META[item.type];
  const state = floodState(item.elev);
  selectedEl.hidden = false;
  selectedEl.innerHTML = '<p class="sel-kicker" style="color:' + meta.color + '">' + meta.label + '</p><h2>' + item.name + '</h2><p class="sel-meta">Altitudine: <strong>' + formatElev(item.elev) + '</strong> s.l.m.<br>lat ' + item.lat.toFixed(2) + ' · lon ' + item.lon.toFixed(2) + '</p><p class="sel-note">' + (item.note || '') + '</p><p class="sel-flood flood-' + state + '">Con mare a ' + formatSea(seaLevelM) + ': <strong>' + floodLabel(item.elev) + '</strong></p>';
}

function flyTo(item) {
  const radius = surfaceRadius(item.elev);
  const local = latLonToVec(item.lat, item.lon, radius);
  const worldTarget = local.clone();
  landmarksRoot.localToWorld(worldTarget);
  const dir = worldTarget.clone().normalize();
  const distance = Math.max(3.1, Math.min(5.4, camera.position.length()));
  const dest = dir.multiplyScalar(distance);
  const start = camera.position.clone();
  const startTarget = controls.target.clone();
  const endTarget = worldTarget.clone().multiplyScalar(0.12);
  let t = 0;
  autoRotate = false; rotateEl.checked = false;
  function step() {
    t = Math.min(1, t + 0.035);
    const ease = 1 - (1 - t) ** 3;
    camera.position.lerpVectors(start, dest, ease);
    controls.target.lerpVectors(startTarget, endTarget, ease);
    controls.update();
    if (t < 1) requestAnimationFrame(step);
  }
  step();
}

function selectLandmark(id, shouldFly) {
  selectedId = id;
  const item = LANDMARKS.find((l) => l.id === id);
  if (!item) return;
  renderSelection(id); rebuildList();
  for (const entry of entries) entry.el.classList.toggle("is-selected", entry.item.id === id);
  if (shouldFly) flyTo(item);
}

async function buildGlobe() {
  setStatus("Caricamento texture locali…");
  const [colorMap, heightMap] = await Promise.all([loadTexture("earth.jpg"), loadTexture("heightmap.jpg")]);
  heightMap.colorSpace = THREE.NoColorSpace;
  earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS, 192, 192), new THREE.MeshStandardMaterial({
    map: colorMap, displacementMap: heightMap, displacementScale: DISP_SCALE, displacementBias: DISP_BIAS, roughness: 0.92, metalness: 0.05,
  }));
  scene.add(earth); earth.add(landmarksRoot);
  ocean = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 128), new THREE.MeshPhysicalMaterial({
    color: 0x1a6fb5, transparent: true, opacity: 0.55, roughness: 0.2, metalness: 0.05, transmission: 0.12, thickness: 0.4, depthWrite: false,
  }));
  ocean.scale.setScalar(oceanRadius(0)); scene.add(ocean);
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS * 1.05, 64, 64), new THREE.MeshBasicMaterial({ color: 0x6eb6ff, transparent: true, opacity: 0.07, side: THREE.BackSide, depthWrite: false })));
  for (const item of LANDMARKS) entries.push(createMarker(item));
  setStatus(""); applySeaLevel(Number(slider.value)); rebuildList();
}

function applySeaLevel(meters) {
  seaLevelM = meters;
  seaValue.textContent = formatSea(meters);
  if (ocean) ocean.scale.setScalar(oceanRadius(meters));
  for (const btn of presetButtons) btn.classList.toggle("active", Number(btn.dataset.level) === meters);
  refreshFloodUI();
}

slider.addEventListener("input", () => applySeaLevel(Number(slider.value)));
for (const btn of presetButtons) btn.addEventListener("click", () => { const level = Number(btn.dataset.level); slider.value = String(level); applySeaLevel(level); });
for (const [type, input] of Object.entries(filterChecks)) input.addEventListener("change", () => { filters[type] = input.checked; rebuildList(); updateVisibility(); });
searchEl.addEventListener("input", () => rebuildList());
rotateEl.addEventListener("change", () => { autoRotate = rotateEl.checked; });
window.addEventListener("resize", () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); labelRenderer.setSize(w, h);
});
function animate() {
  requestAnimationFrame(animate);
  if (earth && autoRotate) earth.rotation.y += 0.00035;
  if (ocean && autoRotate) ocean.rotation.y += 0.00025;
  controls.update(); updateVisibility();
  renderer.render(scene, camera); labelRenderer.render(scene, camera);
}
animate();
buildGlobe().catch((err) => {
  console.error(err);
  setStatus("Errore nel caricamento delle texture. Avvia main.py almeno una volta con rete.", "error");
});
