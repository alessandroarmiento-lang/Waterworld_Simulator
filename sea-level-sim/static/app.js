import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { LANDMARKS, TYPE_META } from "./landmarks.js?v=9";
import { loadCountries, lookupCountry, oceanBasin } from "./country-lookup.js?v=1";
import { loadCities, nearestCity, searchCities } from "./cities-lookup.js?v=2";
import { lookupMountainRange } from "./mountain-ranges.js?v=1";

const canvas = document.getElementById("globe");
const appRoot = document.getElementById("app");
const slider = document.getElementById("sea-slider");
const seaInput = document.getElementById("sea-input");
const statusEl = document.getElementById("status");
const presetButtons = [...document.querySelectorAll("[data-level]")];
const filterChecks = {
  peak: document.getElementById("filter-peak"),
  city: document.getElementById("filter-city"),
  poi: document.getElementById("filter-poi"),
};
const globeLabelsEl = document.getElementById("show-globe-labels");
const listEl = document.getElementById("landmark-list");
const searchEl = document.getElementById("landmark-search");
const searchFormEl = document.getElementById("landmark-search-form");
const selectedEl = document.getElementById("selected-landmark");
const rotateEl = document.getElementById("rotate-globe");
const panelEl = document.querySelector(".panel");
const panelToggleEl = document.getElementById("panel-toggle");
const pinTooltipEl = document.getElementById("pin-tooltip");

const EARTH_RADIUS = 2;
const DISP_SCALE = 0.16;
const DISP_BIAS = -DISP_SCALE * 0.12;
const REF_ELEV_M = 9000;
const MARKER_LIFT = 0.03;

const filters = { peak: true, city: true, poi: true };
let showGlobeLabels = true;
let seaLevelM = 0;
let autoRotate = true;
let selectedId = null;
let probeInfo = null;
let sampleElev = null;
let sampleLights = null;
let probeMarker = null;
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
let pointerDown = null;
const entries = [];
let earth = null;
let ocean = null;
const landmarksRoot = new THREE.Group();
const PIN_UP = new THREE.Vector3(0, 1, 0);
const RING_NORMAL = new THREE.Vector3(0, 0, 1);
const PIN_HEIGHT = 0.0085;
const pinGeometry = new THREE.CylinderGeometry(0.0052, 0.0052, PIN_HEIGHT, 3);
pinGeometry.translate(0, PIN_HEIGHT / 2, 0);
pinGeometry.computeVertexNormals();
const pinHitGeometry = new THREE.SphereGeometry(0.032, 10, 10);
const pinHitMaterial = new THREE.MeshBasicMaterial({ visible: false });
const pinMaterialDry = new THREE.MeshBasicMaterial({ color: 0x22c55e, flatShading: true });
const pinMaterialFlooded = new THREE.MeshBasicMaterial({ color: 0xe11d2e, flatShading: true });
function pinMaterialFor(elevM) {
  return floodState(elevM) === "flooded" ? pinMaterialFlooded : pinMaterialDry;
}
let hoverLandmarkId = null;
let searchMarker = null;
const searchPinMaterial = new THREE.MeshBasicMaterial({ color: 0x38bdf8, flatShading: true });

function setStatus(message, kind = "info") {
  if (!message) { statusEl.hidden = true; statusEl.textContent = ""; return; }
  statusEl.hidden = false; statusEl.dataset.kind = kind; statusEl.textContent = message;
}
function formatElev(meters) { return Math.round(meters).toLocaleString("it-IT") + " m"; }
function formatSea(meters) {
  const rounded = Math.round(meters);
  return rounded === 0 ? "0 m" : "+" + rounded.toLocaleString("it-IT") + " m";
}
function heightOffset(meters) {
  const h = THREE.MathUtils.clamp(meters / REF_ELEV_M, 0, 1.15);
  return DISP_SCALE * h + DISP_BIAS;
}
/** Radius matching the flood/displacement vertex shader (visual terrain). */
function visualRadiusFromElev(elevM) {
  const landM = elevM < 2 ? 0 : elevM;
  return EARTH_RADIUS + heightOffset(landM);
}
function elevMetersAt(lat, lon) {
  return sampleElev ? sampleElev(lat, lon) * (REF_ELEV_M / 255) : 0;
}
function visualRadiusAt(lat, lon) {
  return visualRadiusFromElev(elevMetersAt(lat, lon));
}
function oceanRadius(meters) {
  return EARTH_RADIUS + heightOffset(meters) + 0.004;
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
  return EARTH_RADIUS + heightOffset(Math.max(elevM, seaLevelM)) + MARKER_LIFT;
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
function vecToLatLon(local) {
  const n = local.clone().normalize();
  const lat = 90 - THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(n.y, -1, 1)));
  let lon = THREE.MathUtils.radToDeg(Math.atan2(n.z, -n.x)) - 180;
  if (lon < -180) lon += 360;
  if (lon > 180) lon -= 360;
  return { lat, lon };
}
const _pickOrigin = new THREE.Vector3();
const _pickDir = new THREE.Vector3();
const _pickPoint = new THREE.Vector3();
const _pickWorld = new THREE.Vector3();

/** Ray–sphere: returns [tEnter, tExit] or null (local/world space, sphere at origin). */
function raySphereTs(origin, dir, radius) {
  const ocDot = origin.dot(dir);
  const ocLen2 = origin.lengthSq();
  const disc = ocDot * ocDot - (ocLen2 - radius * radius);
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  return [-ocDot - s, -ocDot + s];
}

/**
 * Pick lat/lon on the *displaced* terrain (not the base mesh).
 * Raycasts against the geometric sphere miss mountains visually.
 */
function pickDisplacedLatLon() {
  if (!earth || !sampleElev) return null;
  earth.updateWorldMatrix(true, false);
  _pickOrigin.copy(raycaster.ray.origin);
  _pickDir.copy(raycaster.ray.direction).normalize();
  earth.worldToLocal(_pickOrigin);
  // Direction: transform a point along the ray, then subtract (handles earth rotation).
  _pickWorld.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, 1);
  earth.worldToLocal(_pickWorld);
  _pickDir.copy(_pickWorld).sub(_pickOrigin).normalize();

  const rMax = EARTH_RADIUS + DISP_SCALE * 1.15 + DISP_BIAS + 0.04;
  const span = raySphereTs(_pickOrigin, _pickDir, rMax);
  if (!span) return null;
  let t0 = Math.max(0, span[0]);
  let t1 = span[1];
  if (t1 < 0) return null;
  if (ocean && ocean.visible) {
    // Cap march at ocean shell so flooded basins pick the water surface.
    const oceanR = ocean.scale.x;
    const oceanSpan = raySphereTs(_pickOrigin, _pickDir, oceanR);
    if (oceanSpan && oceanSpan[1] > 0) {
      t1 = Math.min(t1, Math.max(oceanSpan[0], oceanSpan[1]));
    }
  }

  const steps = 96;
  let prevD = null;
  let prevT = t0;
  for (let i = 0; i <= steps; i += 1) {
    const t = t0 + (t1 - t0) * (i / steps);
    _pickPoint.copy(_pickOrigin).addScaledVector(_pickDir, t);
    const { lat, lon } = vecToLatLon(_pickPoint);
    let surfR = visualRadiusAt(lat, lon);
    if (ocean && ocean.visible) surfR = Math.max(surfR, ocean.scale.x);
    const d = _pickPoint.length() - surfR;
    if (prevD !== null && prevD > 0 && d <= 0) {
      let lo = prevT;
      let hi = t;
      for (let k = 0; k < 14; k += 1) {
        const mid = (lo + hi) * 0.5;
        _pickPoint.copy(_pickOrigin).addScaledVector(_pickDir, mid);
        const ll = vecToLatLon(_pickPoint);
        let r = visualRadiusAt(ll.lat, ll.lon);
        if (ocean && ocean.visible) r = Math.max(r, ocean.scale.x);
        if (_pickPoint.length() - r > 0) lo = mid;
        else hi = mid;
      }
      const tf = (lo + hi) * 0.5;
      _pickPoint.copy(_pickOrigin).addScaledVector(_pickDir, tf);
      return vecToLatLon(_pickPoint);
    }
    prevD = d;
    prevT = t;
  }

  // Fallback: first hit of base mesh (oceans / flat).
  const hit = raycaster.intersectObject(earth, false)[0];
  if (!hit) return null;
  return vecToLatLon(earth.worldToLocal(hit.point.clone()));
}
function haversineKm(lat1, lon1, lat2, lon2) {
  const r = 6371;
  const p1 = THREE.MathUtils.degToRad(lat1);
  const p2 = THREE.MathUtils.degToRad(lat2);
  const dp = THREE.MathUtils.degToRad(lat2 - lat1);
  const dl = THREE.MathUtils.degToRad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}
function makeGraySampler(texture) {
  const img = texture.image;
  if (!img) return null;
  const canvasEl = document.createElement("canvas");
  canvasEl.width = img.width;
  canvasEl.height = img.height;
  const ctx = canvasEl.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
  return (lat, lon, radius = 1) => {
    let u = (lon + 180) / 360;
    u = u - Math.floor(u);
    const v = THREE.MathUtils.clamp((90 - lat) / 180, 0, 1);
    const cx = Math.floor(u * width);
    const cy = Math.floor(v * (height - 1));
    let sum = 0;
    let count = 0;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const x = (cx + dx + width) % width;
        const y = THREE.MathUtils.clamp(cy + dy, 0, height - 1);
        sum += data[(y * width + x) * 4];
        count += 1;
      }
    }
    return sum / count;
  };
}
function nearestLandmark(lat, lon, type, maxKm) {
  let best = null;
  for (const item of LANDMARKS) {
    if (type && item.type !== type) continue;
    const km = haversineKm(lat, lon, item.lat, item.lon);
    if (km > maxKm) continue;
    if (!best || km < best.km) best = { item, km };
  }
  return best;
}
function describePoint(lat, lon) {
  const elevM = sampleElev ? sampleElev(lat, lon) * (REF_ELEV_M / 255) : 0;
  const lights = sampleLights ? sampleLights(lat, lon, 2) : 0;
  const worldCity = nearestCity(lat, lon, 45);
  const city = nearestLandmark(lat, lon, "city", 80);
  const peak = nearestLandmark(lat, lon, "peak", 120);
  const nearby = nearestLandmark(lat, lon, null, 35);
  let country = lookupCountry(lat, lon);
  // Costa / isole piccole: prova punti vicini se il poligono manca il bordo.
  if (!country && elevM >= 1) {
    const deltas = [[0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4], [0.6, 0.6], [-0.6, -0.6]];
    for (const [dLat, dLon] of deltas) {
      country = lookupCountry(lat + dLat, lon + dLon);
      if (country) break;
    }
  }
  const basin = oceanBasin(lat, lon);
  let cover;
  if (elevM < Math.max(seaLevelM, 0.5)) {
    cover = elevM < 1 && seaLevelM < 1 ? "mare / oceano" : "terra sommersa";
  } else if (lights >= 48) {
    cover = "zona abitata";
  } else if (lights >= 16) {
    cover = "abitazioni sparse";
  } else if (Math.abs(lat) > 66 && elevM > 80) {
    cover = "ghiaccio polare";
  } else if (elevM >= 2500) {
    cover = "alta montagna / altopiano";
  } else if (elevM >= 800) {
    cover = "collina / rilievo";
  } else {
    cover = "terreno";
  }
  let mountainRange = null;
  const mountainLike = elevM >= 800
    || cover === "alta montagna / altopiano"
    || cover === "collina / rilievo"
    || (peak && peak.km <= 40);
  if (mountainLike) {
    if (peak && peak.km <= 55 && peak.item.range) {
      mountainRange = { name: peak.item.range, source: "peak", peak: peak.item.name, km: peak.km };
    } else {
      const region = lookupMountainRange(lat, lon, elevM);
      if (region) mountainRange = { name: region.name, source: region.source };
      else if (peak && peak.km <= 100 && peak.item.range) {
        mountainRange = { name: peak.item.range, source: "peak", peak: peak.item.name, km: peak.km };
      }
    }
  }
  let placeName = null;
  if (peak && peak.km <= 8) placeName = peak.item.name;
  else if (worldCity && worldCity.km <= 25) placeName = worldCity.name;
  else if (city && city.km <= 15) placeName = city.item.name;
  else if (nearby && nearby.km <= 20) placeName = nearby.item.name;
  return {
    lat, lon, elevM, lights, worldCity, city, peak, nearby, cover, country, basin, placeName, mountainRange,
  };
}
function formatCoords(lat, lon) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "O";
  return Math.abs(lat).toFixed(2) + "° " + ns + " · " + Math.abs(lon).toFixed(2) + "° " + ew;
}
function geographyLine(info) {
  if (info.country) {
    const cont = info.country.continent ? " · " + info.country.continent : "";
    return "<strong>" + info.country.name + "</strong>" + cont;
  }
  if (info.cover === "mare / oceano" || (info.elevM < 1 && !info.country)) {
    return "<strong>" + (info.basin || "Mare aperto") + "</strong> · acque internazionali / al largo";
  }
  return "<strong>" + (info.basin || "Area non classificata") + "</strong>";
}
function formatKm(km) {
  if (km < 1) return Math.round(km * 1000) + " m";
  return km.toLocaleString("it-IT", { maximumFractionDigits: km < 10 ? 1 : 0 }) + " km";
}
function foldText(value) {
  return (value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function searchHaystack(item) {
  return foldText(`${item.name} ${item.note || ""} ${item.id}`);
}
function rankedSearchMatches(query) {
  const q = foldText(query);
  if (!q) return [];
  const scored = [];
  for (const item of LANDMARKS) {
    const name = foldText(item.name);
    const hay = searchHaystack(item);
    let score = 0;
    if (name === q) score = 500;
    else if (name.startsWith(q)) score = 400;
    else if (hay.includes(" " + q) || name.includes(q)) score = 280;
    else if (hay.includes(q)) score = 160;
    else continue;
    score -= Math.min(40, item.name.length);
    scored.push({ kind: "landmark", item, score, sortName: item.name });
  }
  const landmarkNames = new Set(scored.map((row) => foldText(row.item.name)));
  for (const city of searchCities(query, 80)) {
    const folded = foldText(city.name);
    if (landmarkNames.has(folded)) continue;
    scored.push({ kind: "city", city, score: city.score, sortName: city.name });
  }
  scored.sort((a, b) => b.score - a.score || a.sortName.localeCompare(b.sortName, "it"));
  return scored;
}
function goToSearchMatch() {
  const matches = rankedSearchMatches(searchEl.value);
  if (!matches.length) {
    setStatus("Nessun luogo trovato per questa ricerca.");
    return;
  }
  setStatus("");
  const match = matches[0];
  if (match.kind === "landmark") selectLandmark(match.item.id, true);
  else selectWorldCity(match.city);
}
function clearSearchMarker() {
  if (!searchMarker) return;
  landmarksRoot.remove(searchMarker.pin);
  landmarksRoot.remove(searchMarker.label);
  searchMarker = null;
}
function placeSearchMarker(city, elevM) {
  clearSearchMarker();
  const pin = new THREE.Mesh(pinGeometry, searchPinMaterial);
  const el = document.createElement("button");
  el.type = "button";
  el.className = "landmark-label landmark-city is-selected search-result-label";
  el.innerHTML = '<span class="dot">●</span><span class="txt">' + city.name + '</span><span class="elev">≈ '
    + city.pop.toLocaleString("it-IT") + " ab.</span>";
  el.addEventListener("click", (event) => {
    event.stopPropagation();
    selectWorldCity(city);
  });
  const label = new CSS2DObject(el);
  landmarksRoot.add(pin);
  landmarksRoot.add(label);
  searchMarker = { pin, label, el, city, elev: elevM };
  updateSearchMarkerPose();
}
function updateSearchMarkerPose() {
  if (!searchMarker) return;
  const elevM = searchMarker.elev;
  const radius = surfaceRadius(elevM);
  const position = latLonToVec(searchMarker.city.lat, searchMarker.city.lon, radius);
  const dir = position.clone().normalize();
  searchMarker.pin.position.copy(position);
  searchMarker.pin.quaternion.setFromUnitVectors(PIN_UP, dir);
  searchMarker.pin.material = floodState(elevM) === "flooded" ? pinMaterialFlooded : searchPinMaterial;
  searchMarker.label.position.copy(dir.clone().multiplyScalar(radius + 0.03));
  searchMarker.pin.visible = true;
  searchMarker.label.visible = true;
  searchMarker.el.style.visibility = "visible";
}
function selectWorldCity(city) {
  selectedId = null;
  for (const entry of entries) entry.el.classList.toggle("is-selected", false);
  const elevM = elevMetersAt(city.lat, city.lon);
  placeSearchMarker(city, elevM);
  probeInfo = describePoint(city.lat, city.lon);
  if (probeMarker) probeMarker.visible = false;
  renderProbe(probeInfo);
  rebuildList();
  flyTo({ lat: city.lat, lon: city.lon, elev: elevM });
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance", logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = "label-layer";
appRoot.appendChild(labelRenderer.domElement);

function viewportSize() {
  const vv = window.visualViewport;
  const w = Math.max(1, Math.round(appRoot.clientWidth || vv?.width || window.innerWidth));
  const h = Math.max(1, Math.round(appRoot.clientHeight || vv?.height || window.innerHeight));
  return { w, h };
}

function resizeGlobe() {
  const { w, h } = viewportSize();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  labelRenderer.setSize(w, h);
  canvas.style.width = "100%";
  canvas.style.height = "100%";
}

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x061018, 0.035);
const camera = new THREE.PerspectiveCamera(45, 1, 0.008, 100);
camera.position.set(0.6, 1.1, 5.2);
resizeGlobe();
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 2.02;
controls.maxDistance = 16;
controls.zoomSpeed = 1.15;
// Pan/zoom move the camera; one-finger drag tumbles the Earth about its center.
controls.enableRotate = false;
controls.enablePan = true;
controls.screenSpacePanning = true;
controls.panSpeed = 0.85;
controls.target.set(0, 0, 0);
controls.addEventListener("start", () => { autoRotate = false; rotateEl.checked = false; });

const GLOBE_CENTER = new THREE.Vector3(0, 0, 0);
const AUTO_SPIN_AXIS = new THREE.Vector3(0, 1, 0); // through sphere center
const AUTO_SPIN_RAD = 0.00035;
const DRAG_SPIN_SENS = 0.005;
const _dragAxisRight = new THREE.Vector3();
const _dragAxisUp = new THREE.Vector3();
const _dragAxisLook = new THREE.Vector3();
const _rollQuat = new THREE.Quaternion();
const activePointers = new Map();
let globeDrag = null;
/** @type {{ angle: number } | null} */
let twistSample = null;
let gestureRotationDeg = 0;

scene.add(new THREE.AmbientLight(0xffffff, 2.1));
// Nessun sole direzionale: le terre emerse restano chiare su tutto il globo.

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
function loadTexture(name, colorSpace) {
  return new Promise((resolve, reject) => {
    loader.load(name, (texture) => {
      texture.colorSpace = colorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      resolve(texture);
    }, undefined, () => reject(new Error("Impossibile caricare " + name)));
  });
}

function installFloodShader(material) {
  material.customProgramCacheKey = () => "sea-flood-v13";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSeaLevel = { value: seaLevelM };
    material.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float uSeaLevel;
         varying float vElevM;`
      )
      .replace(
        "#include <displacementmap_vertex>",
        `#ifdef USE_DISPLACEMENTMAP
          vElevM = texture2D( displacementMap, vDisplacementMapUv ).x * 9000.0;
          // Oceano piatto; terra (anche sommersa) tiene il rilievo così restano i contorni.
          float landM = vElevM < 2.0 ? 0.0 : vElevM;
          float h = clamp( landM / 9000.0, 0.0, 1.15 );
          transformed += normalize( objectNormal ) * ( displacementScale * h + displacementBias );
        #else
          vElevM = 0.0;
        #endif`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float uSeaLevel;
         varying float vElevM;`
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
         float elevM = vElevM;
         float landMask = smoothstep( 1.5, 22.0, elevM );
         if ( uSeaLevel > 1.0 ) {
           float aa = max( fwidth( elevM ) * 1.2, 12.0 );
           float above = ( elevM - uSeaLevel ) / aa;
           float dryAmt = smoothstep( -0.35, 0.55, above );
           float depthM = max( 0.0, uSeaLevel - elevM );
           vec3 landLit = min( diffuseColor.rgb * vec3( 1.70, 1.48, 1.15 ), vec3( 1.0 ) );
           landLit = mix( landLit, landLit * vec3( 1.15, 1.06, 0.86 ), 0.4 );
           if ( elevM < 2.0 ) {
             diffuseColor.rgb = vec3( 0.012, 0.06, 0.18 );
           } else {
             vec3 water = mix( vec3( 0.06, 0.30, 0.48 ), vec3( 0.012, 0.06, 0.18 ), smoothstep( 8.0, 260.0, depthM ) );
             vec3 drowned = mix( diffuseColor.rgb * vec3( 0.20, 0.38, 0.58 ), water, 0.82 );
             drowned *= 0.65;
             vec3 shore = vec3( 1.0, 0.92, 0.42 );
             float rim = dryAmt * ( 1.0 - dryAmt ) * 4.0;
             drowned = mix( drowned, shore, clamp( rim, 0.0, 1.0 ) * 0.6 );
             diffuseColor.rgb = mix( drowned, landLit, dryAmt );
           }
         } else {
           diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.18, 1.08, 0.90 ), landMask * 0.4 );
         }`
      );
  };
}

function setSeaUniform(meters) {
  const shader = earth && earth.material.userData.shader;
  if (shader) shader.uniforms.uSeaLevel.value = meters;
}

function placeMarker(entry) {
  const radius = surfaceRadius(entry.item.elev);
  const position = latLonToVec(entry.item.lat, entry.item.lon, radius);
  const dir = position.clone().normalize();
  entry.pin.position.copy(position);
  entry.pin.quaternion.setFromUnitVectors(PIN_UP, dir);
  entry.label.position.copy(dir.multiplyScalar(radius + 0.03));
}

function createMarker(item) {
  const meta = TYPE_META[item.type];
  const pin = new THREE.Mesh(pinGeometry, pinMaterialFor(item.elev));
  const hit = new THREE.Mesh(pinHitGeometry, pinHitMaterial);
  hit.position.y = PIN_HEIGHT * 0.55;
  pin.add(hit);
  const el = document.createElement("button");
  el.type = "button";
  el.className = "landmark-label landmark-" + item.type;
  el.dataset.id = item.id;
  el.innerHTML = '<span class="dot">' + meta.short + '</span><span class="txt">' + item.name + '</span><span class="elev">' + formatElev(item.elev) + "</span>";
  el.addEventListener("click", (event) => { event.stopPropagation(); selectLandmark(item.id, true); });
  el.addEventListener("pointerenter", () => showPinTooltip(item, null));
  el.addEventListener("pointerleave", () => hidePinTooltip(item.id));
  el.addEventListener("pointermove", (event) => positionPinTooltip(event.clientX, event.clientY));
  const label = new CSS2DObject(el);
  landmarksRoot.add(pin);
  landmarksRoot.add(label);
  const entry = { item, pin, hit, label, el };
  placeMarker(entry);
  return entry;
}

function landmarkTooltipHtml(item) {
  const meta = TYPE_META[item.type];
  const state = floodLabel(item.elev);
  let html = "<strong>" + item.name + "</strong>"
    + '<div class="tt-meta">' + meta.label + " · " + formatElev(item.elev) + " · " + state + "</div>";
  if (item.range) html += '<div class="tt-meta">Catena: ' + item.range + "</div>";
  if (item.note) html += '<div class="tt-note">' + item.note + "</div>";
  return html;
}

function positionPinTooltip(clientX, clientY) {
  if (!pinTooltipEl || pinTooltipEl.hidden) return;
  const pad = 12;
  const tw = pinTooltipEl.offsetWidth || 180;
  const th = pinTooltipEl.offsetHeight || 60;
  let left = clientX + 14;
  let top = clientY + 16;
  if (left + tw > window.innerWidth - pad) left = clientX - tw - 12;
  if (top + th > window.innerHeight - pad) top = clientY - th - 10;
  pinTooltipEl.style.left = Math.max(pad, left) + "px";
  pinTooltipEl.style.top = Math.max(pad, top) + "px";
}

function showPinTooltip(item, event) {
  if (!pinTooltipEl) return;
  hoverLandmarkId = item.id;
  pinTooltipEl.innerHTML = landmarkTooltipHtml(item);
  pinTooltipEl.hidden = false;
  if (event) positionPinTooltip(event.clientX, event.clientY);
  canvas.style.cursor = "pointer";
}

function hidePinTooltip(id) {
  if (id && hoverLandmarkId !== id) return;
  hoverLandmarkId = null;
  if (pinTooltipEl) pinTooltipEl.hidden = true;
  canvas.style.cursor = "crosshair";
}

function pickPinUnderPointer(event) {
  if (!earth || !entries.length) return null;
  const rect = canvas.getBoundingClientRect();
  pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, camera);
  const hits = entries.filter((e) => e.pin.visible).map((e) => e.hit);
  const hit = raycaster.intersectObjects(hits, false)[0];
  if (!hit) return null;
  return entries.find((e) => e.hit === hit.object) || null;
}

function rebuildList() {
  listEl.innerHTML = "";
  const rawQ = (searchEl.value || "").trim();
  const q = foldText(rawQ);
  if (q) {
    const matches = rankedSearchMatches(rawQ).slice(0, 60);
    for (const match of matches) {
      const btn = document.createElement("button");
      btn.type = "button";
      if (match.kind === "landmark") {
        const item = match.item;
        const meta = TYPE_META[item.type];
        btn.className = "landmark-item" + (item.id === selectedId ? " active" : "");
        btn.innerHTML = '<span class="kind" style="color:' + meta.color + '">' + meta.short + '</span><span class="body"><strong>' + item.name + '</strong><small>' + meta.label + " · " + formatElev(item.elev) + ' · <em class="flood-' + floodState(item.elev) + '">' + floodLabel(item.elev) + "</em></small></span>";
        btn.addEventListener("click", () => selectLandmark(item.id, true));
      } else {
        const city = match.city;
        const elevM = elevMetersAt(city.lat, city.lon);
        btn.className = "landmark-item";
        btn.innerHTML = '<span class="kind" style="color:#7ec8ff">●</span><span class="body"><strong>' + city.name + '</strong><small>Città · ≈ ' + city.pop.toLocaleString("it-IT") + " ab. (GeoNames) · " + formatElev(elevM) + ' · <em class="flood-' + floodState(elevM) + '">' + floodLabel(elevM) + "</em></small></span>";
        btn.addEventListener("click", () => selectWorldCity(city));
      }
      listEl.appendChild(btn);
    }
    return;
  }
  const sorted = [...LANDMARKS].sort((a, b) => a.name.localeCompare(b.name, "it"));
  for (const item of sorted) {
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
    entry.pin.material = pinMaterialFor(entry.item.elev);
    entry.el.title = entry.item.name + " — " + formatElev(entry.item.elev) + " — " + floodLabel(entry.item.elev);
    placeMarker(entry);
  }
  rebuildList();
  if (selectedId) renderSelection(selectedId);
  else if (probeInfo) {
    probeInfo = describePoint(probeInfo.lat, probeInfo.lon);
    placeProbe(probeInfo.lat, probeInfo.lon, probeInfo.elevM);
    renderProbe(probeInfo);
  }
  if (searchMarker) {
    searchMarker.elev = elevMetersAt(searchMarker.city.lat, searchMarker.city.lon);
    updateSearchMarkerPose();
  }
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
    const showZoom = priorityVisible(entry.item.priority, camDist);
    const worldPos = entry.pin.getWorldPosition(new THREE.Vector3());
    const normal = worldPos.clone().normalize();
    const toCam = worldCam.clone().sub(worldPos).normalize();
    const facing = normal.dot(toCam) > 0.12;
    const onFront = filters[entry.item.type] && showZoom && facing;
    entry.pin.visible = onFront;
    const showLabel = showGlobeLabels && onFront;
    entry.label.visible = showLabel;
    entry.el.style.visibility = showLabel ? "visible" : "hidden";
  }
}

function hideLabelsOverPanel() {
  if (!panelEl) return;
  const pr = panelEl.getBoundingClientRect();
  for (const entry of entries) {
    if (entry.el.style.visibility === "hidden") continue;
    const r = entry.el.getBoundingClientRect();
    if (r.right > pr.left && r.left < pr.right && r.bottom > pr.top && r.top < pr.bottom) {
      entry.el.style.visibility = "hidden";
    }
  }
}

function renderProbe(info) {
  const state = floodState(info.elevM);
  const title = info.placeName
    || (info.country && info.country.name)
    || (info.cover === "mare / oceano" ? (info.basin || "Mare") : info.cover);
  const geo = geographyLine(info);
  let place = "";
  if (info.worldCity && info.worldCity.km <= 12) {
    place = '<p class="sel-note">Città: <strong>' + info.worldCity.name + "</strong>"
      + " · ≈ " + info.worldCity.pop.toLocaleString("it-IT") + " ab. (GeoNames)</p>";
  } else if (info.worldCity) {
    place = '<p class="sel-note">Città più vicina: <strong>' + info.worldCity.name + "</strong> ("
      + formatKm(info.worldCity.km) + ") · ≈ " + info.worldCity.pop.toLocaleString("it-IT") + " ab. (GeoNames)</p>";
  } else if (info.city && info.city.km <= 12) {
    place = '<p class="sel-note">Città: <strong>' + info.city.item.name + "</strong>"
      + (info.city.item.note ? " — " + info.city.item.note : "") + "</p>";
  } else if (info.city) {
    place = '<p class="sel-note">Città più vicina: <strong>' + info.city.item.name + "</strong> (" + formatKm(info.city.km) + ")"
      + (info.city.item.note ? " — " + info.city.item.note : "") + "</p>";
  }
  let nearby = "";
  if (info.nearby && (!info.city || info.nearby.item.id !== info.city.item.id) && info.nearby.km <= 25) {
    const meta = TYPE_META[info.nearby.item.type];
    nearby = '<p class="sel-note">Nel catalogo vicino: ' + meta.label.toLowerCase() + " <strong>" + info.nearby.item.name + "</strong> (" + formatKm(info.nearby.km) + ")</p>";
  }
  let rangeLine = "";
  if (info.mountainRange) {
    rangeLine = '<p class="sel-note">Catena montuosa: <strong>' + info.mountainRange.name + "</strong>";
    if (info.mountainRange.peak && info.mountainRange.km != null && info.mountainRange.km > 2) {
      rangeLine += " (vicino a " + info.mountainRange.peak + ", " + formatKm(info.mountainRange.km) + ")";
    }
    rangeLine += "</p>";
  }
  let floodLine = '<p class="sel-flood flood-' + state + '">Con mare a ' + formatSea(seaLevelM) + ': <strong>' + floodLabel(info.elevM) + "</strong></p>";
  if (info.cover === "mare / oceano" && seaLevelM < 1) {
    floodLine = '<p class="sel-note">Mare attuale (quota 0).</p>';
  }
  selectedEl.hidden = false;
  selectedEl.innerHTML = '<p class="sel-kicker">Punto sulla mappa</p><h2>' + title + "</h2>"
    + '<p class="sel-meta">Dove: ' + geo + "<br>"
    + "Tipo suolo: <strong>" + info.cover + "</strong><br>"
    + "Altitudine: <strong>" + formatElev(info.elevM) + "</strong> s.l.m.<br>"
    + formatCoords(info.lat, info.lon) + "</p>"
    + rangeLine + place + nearby + floodLine;
}

function placeProbe(lat, lon, elevM) {
  if (!probeMarker) {
    probeMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.01, 0.016, 28),
      new THREE.MeshBasicMaterial({
        color: 0x5eead4,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    );
    probeMarker.renderOrder = 3;
    landmarksRoot.add(probeMarker);
  }
  // Sit on the same displaced surface the user clicked (tiny lift only for z-fight).
  const radius = visualRadiusFromElev(elevM) + 0.0015;
  const position = latLonToVec(lat, lon, radius);
  const dir = position.clone().normalize();
  probeMarker.position.copy(position);
  probeMarker.quaternion.setFromUnitVectors(RING_NORMAL, dir);
  probeMarker.visible = true;
}

function inspectGlobe(lat, lon) {
  selectedId = null;
  for (const entry of entries) entry.el.classList.toggle("is-selected", false);
  // Keep search marker only if this inspect is for that city (handled by selectWorldCity order).
  probeInfo = describePoint(lat, lon);
  placeProbe(probeInfo.lat, probeInfo.lon, probeInfo.elevM);
  renderProbe(probeInfo);
  rebuildList();
}

function pickOnCanvas(event) {
  if (!earth) return;
  const rect = canvas.getBoundingClientRect();
  pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, camera);
  const pinMeshes = entries.filter((e) => e.pin.visible).map((entry) => entry.hit);
  if (searchMarker) pinMeshes.push(searchMarker.pin);
  const pinHit = pinMeshes.length ? raycaster.intersectObjects(pinMeshes, false)[0] : null;
  if (pinHit) {
    if (searchMarker && pinHit.object === searchMarker.pin) {
      selectWorldCity(searchMarker.city);
      return;
    }
    const entry = entries.find((e) => e.hit === pinHit.object);
    if (entry) {
      clearSearchMarker();
      if (probeMarker) probeMarker.visible = false;
      probeInfo = null;
      selectLandmark(entry.item.id, false);
      return;
    }
  }
  clearSearchMarker();
  const picked = pickDisplacedLatLon();
  if (!picked) return;
  inspectGlobe(picked.lat, picked.lon);
}

function renderSelection(id) {
  const item = LANDMARKS.find((l) => l.id === id);
  if (!item) { selectedEl.hidden = true; return; }
  const meta = TYPE_META[item.type];
  const state = floodState(item.elev);
  const country = lookupCountry(item.lat, item.lon);
  let rangeName = item.range || null;
  if (!rangeName && item.type === "peak") {
    const region = lookupMountainRange(item.lat, item.lon, item.elev);
    if (region) rangeName = region.name;
  }
  let geo = "";
  if (country) geo += "Paese: <strong>" + country.name + "</strong>" + (country.continent ? " · " + country.continent : "") + "<br>";
  if (rangeName) geo += "Catena montuosa: <strong>" + rangeName + "</strong><br>";
  selectedEl.hidden = false;
  selectedEl.innerHTML = '<p class="sel-kicker" style="color:' + meta.color + '">' + meta.label + '</p><h2>' + item.name + "</h2>"
    + '<p class="sel-meta">' + geo
    + "Altitudine: <strong>" + formatElev(item.elev) + "</strong> s.l.m.<br>"
    + formatCoords(item.lat, item.lon) + "</p>"
    + '<p class="sel-note">' + (item.note || "") + "</p>"
    + '<p class="sel-flood flood-' + state + '">Con mare a ' + formatSea(seaLevelM) + ': <strong>' + floodLabel(item.elev) + "</strong></p>";
}

function flyTo(item) {
  // Camera along the ray from globe center → place; pivot stays at center.
  const radius = surfaceRadius(item.elev);
  const local = latLonToVec(item.lat, item.lon, radius);
  const worldPoint = local.clone();
  landmarksRoot.localToWorld(worldPoint);
  const dir = worldPoint.clone().normalize();
  const dest = dir.multiplyScalar(2.68);
  const start = camera.position.clone();
  const startTarget = controls.target.clone();
  let t = 0;
  autoRotate = false;
  rotateEl.checked = false;
  function step() {
    t = Math.min(1, t + 0.032);
    const ease = 1 - (1 - t) ** 3;
    camera.position.lerpVectors(start, dest, ease);
    controls.target.lerpVectors(startTarget, GLOBE_CENTER, ease);
    controls.update();
    if (t < 1) requestAnimationFrame(step);
  }
  step();
}

function selectLandmark(id, shouldFly) {
  clearSearchMarker();
  selectedId = id;
  probeInfo = null;
  if (probeMarker) probeMarker.visible = false;
  const item = LANDMARKS.find((l) => l.id === id);
  if (!item) return;
  renderSelection(id); rebuildList();
  for (const entry of entries) entry.el.classList.toggle("is-selected", entry.item.id === id);
  if (shouldFly) flyTo(item);
}

async function buildGlobe() {
  setStatus("Caricamento texture e luoghi…");
  const [colorMap, elevMap, nightMap] = await Promise.all([
    loadTexture("earth.jpg", THREE.SRGBColorSpace),
    loadTexture("elevation.png", THREE.NoColorSpace),
    loadTexture("earth-night.jpg", THREE.NoColorSpace).catch(() => null),
    loadCountries(),
    loadCities(),
  ]);
  elevMap.minFilter = THREE.LinearFilter;
  elevMap.magFilter = THREE.LinearFilter;
  sampleElev = makeGraySampler(elevMap);
  sampleLights = nightMap ? makeGraySampler(nightMap) : null;
  // Lambert (not Basic): displacementMap is required for relief + flood shader.
  // Ambient-only lighting keeps land evenly bright with no directional sun.
  const material = new THREE.MeshLambertMaterial({
    map: colorMap,
    displacementMap: elevMap,
    displacementScale: DISP_SCALE,
    displacementBias: DISP_BIAS,
  });
  installFloodShader(material);
  earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS, 256, 256), material);
  scene.add(earth);
  earth.add(landmarksRoot);
  ocean = new THREE.Mesh(
    new THREE.SphereGeometry(1, 192, 192),
    new THREE.MeshBasicMaterial({
      color: 0x0c4a7a,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    })
  );
  ocean.renderOrder = -1;
  ocean.visible = false;
  ocean.scale.setScalar(oceanRadius(0));
  earth.add(ocean);
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS * 1.05, 64, 64),
    new THREE.MeshBasicMaterial({ color: 0x6eb6ff, transparent: true, opacity: 0.07, side: THREE.BackSide, depthWrite: false })
  ));
  for (const item of LANDMARKS) entries.push(createMarker(item));
  setStatus("");
  applySeaLevel(Number(slider.value));
  rebuildList();
}

function clampSeaLevel(meters) {
  const n = Number(meters);
  if (!Number.isFinite(n)) return seaLevelM;
  return THREE.MathUtils.clamp(Math.round(n), 0, 9000);
}

/** Single source of truth: slider, number field and presets always match. */
function applySeaLevel(meters) {
  const level = clampSeaLevel(meters);
  seaLevelM = level;
  slider.value = String(level);
  slider.setAttribute("aria-valuenow", String(level));
  seaInput.value = String(level);
  setSeaUniform(level);
  if (ocean) {
    ocean.scale.setScalar(oceanRadius(level));
    ocean.visible = level > 0.5;
  }
  for (const btn of presetButtons) {
    const preset = Number(btn.dataset.level);
    const on = preset === level;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  refreshFloodUI();
}

slider.addEventListener("input", () => applySeaLevel(Number(slider.value)));
seaInput.addEventListener("input", () => {
  const raw = seaInput.value.trim();
  if (raw === "" || raw === "-") return;
  const n = Number(raw);
  if (!Number.isFinite(n)) return;
  // Update globe + slider without rewriting the field on every keystroke mid-edit
  // unless clamp changed the value (e.g. >9000).
  const level = clampSeaLevel(n);
  seaLevelM = level;
  slider.value = String(level);
  slider.setAttribute("aria-valuenow", String(level));
  setSeaUniform(level);
  if (ocean) {
    ocean.scale.setScalar(oceanRadius(level));
    ocean.visible = level > 0.5;
  }
  for (const btn of presetButtons) {
    const preset = Number(btn.dataset.level);
    const on = preset === level;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  refreshFloodUI();
  if (n !== level) seaInput.value = String(level);
});
seaInput.addEventListener("change", () => {
  applySeaLevel(seaInput.value.trim() === "" ? 0 : seaInput.value);
});
seaInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  applySeaLevel(seaInput.value.trim() === "" ? 0 : seaInput.value);
  seaInput.blur();
});
for (const btn of presetButtons) {
  btn.setAttribute("aria-pressed", "false");
  btn.addEventListener("click", () => applySeaLevel(Number(btn.dataset.level)));
}
for (const [type, input] of Object.entries(filterChecks)) {
  input.addEventListener("change", () => {
    filters[type] = input.checked;
    updateVisibility();
  });
}
globeLabelsEl.addEventListener("change", () => {
  showGlobeLabels = globeLabelsEl.checked;
  updateVisibility();
});
searchEl.addEventListener("input", () => rebuildList());
searchFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  goToSearchMatch();
});
rotateEl.addEventListener("change", () => { autoRotate = rotateEl.checked; });

function spinEarthByPointerDelta(dx, dy, event) {
  if (!earth) return;
  // Shift+drag: flat CW/CCW roll (works on trackpad/mouse where OS twist is unavailable).
  if (event?.shiftKey) {
    rollEarthFlat(-dx * DRAG_SPIN_SENS);
    return;
  }
  // Trackball about the sphere center (any axis through origin).
  _dragAxisRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  _dragAxisUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  earth.rotateOnWorldAxis(_dragAxisUp, dx * DRAG_SPIN_SENS);
  earth.rotateOnWorldAxis(_dragAxisRight, dy * DRAG_SPIN_SENS);
  autoRotate = false;
  rotateEl.checked = false;
}

function pairAngle(x0, y0, x1, y1) {
  return Math.atan2(y1 - y0, x1 - x0);
}

/** Flat roll about the view axis through the sphere center (CW / CCW). */
function rollEarthFlat(deltaAngle) {
  if (!earth || !Number.isFinite(deltaAngle) || Math.abs(deltaAngle) < 1e-8) return;
  camera.getWorldDirection(_dragAxisLook);
  _rollQuat.setFromAxisAngle(_dragAxisLook, -deltaAngle);
  earth.quaternion.premultiply(_rollQuat);
  earth.updateMatrixWorld(true);
  autoRotate = false;
  rotateEl.checked = false;
}

function feedTwistAngle(angle, reset) {
  if (angle == null || !Number.isFinite(angle)) {
    twistSample = null;
    return;
  }
  if (reset || !twistSample) {
    twistSample = { angle };
    return;
  }
  let dAng = angle - twistSample.angle;
  if (dAng > Math.PI) dAng -= Math.PI * 2;
  if (dAng < -Math.PI) dAng += Math.PI * 2;
  rollEarthFlat(dAng);
  twistSample = { angle };
}

function twistFromPointerMap(reset) {
  if (activePointers.size !== 2) {
    if (reset) twistSample = null;
    return;
  }
  const pts = [...activePointers.values()];
  feedTwistAngle(pairAngle(pts[0].x, pts[0].y, pts[1].x, pts[1].y), reset);
}

function twistFromTouchList(touchList, reset) {
  if (!touchList || touchList.length < 2) {
    if (reset) twistSample = null;
    return;
  }
  feedTwistAngle(
    pairAngle(touchList[0].clientX, touchList[0].clientY, touchList[1].clientX, touchList[1].clientY),
    reset
  );
}

canvas.addEventListener("pointerdown", (event) => {
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (event.button !== 0) return;
  pointerDown = { x: event.clientX, y: event.clientY };
  if (activePointers.size === 1) {
    globeDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    twistSample = null;
  } else {
    globeDrag = null;
    twistFromPointerMap(true);
  }
});
canvas.addEventListener("pointermove", (event) => {
  if (activePointers.has(event.pointerId)) {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }
  if (globeDrag && event.pointerId === globeDrag.id && activePointers.size === 1) {
    const dx = event.clientX - globeDrag.x;
    const dy = event.clientY - globeDrag.y;
    globeDrag.x = event.clientX;
    globeDrag.y = event.clientY;
    if (dx * dx + dy * dy > 1) {
      globeDrag.moved = true;
      spinEarthByPointerDelta(dx, dy, event);
    }
  } else if (activePointers.size === 2) {
    twistFromPointerMap(false);
  }
  const entry = pickPinUnderPointer(event);
  if (entry) {
    if (hoverLandmarkId !== entry.item.id) showPinTooltip(entry.item, event);
    else positionPinTooltip(event.clientX, event.clientY);
  } else if (hoverLandmarkId) {
    const overLabel = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".landmark-label");
    if (!overLabel) hidePinTooltip(hoverLandmarkId);
  }
});
function endPointer(event) {
  activePointers.delete(event.pointerId);
  if (globeDrag && event.pointerId === globeDrag.id) globeDrag = null;
  twistSample = null;
  if (activePointers.size === 1) {
    const [id, p] = activePointers.entries().next().value;
    globeDrag = { id, x: p.x, y: p.y, moved: true };
  } else if (activePointers.size === 2) {
    twistFromPointerMap(true);
  }
}
canvas.addEventListener("pointerup", (event) => {
  const wasDrag = globeDrag && globeDrag.id === event.pointerId ? globeDrag : null;
  endPointer(event);
  if (!pointerDown || event.button !== 0) return;
  const dx = event.clientX - pointerDown.x;
  const dy = event.clientY - pointerDown.y;
  pointerDown = null;
  if (wasDrag?.moved || dx * dx + dy * dy > 36) return;
  pickOnCanvas(event);
});
canvas.addEventListener("pointercancel", (event) => {
  endPointer(event);
  pointerDown = null;
});
canvas.addEventListener("pointerleave", () => {
  if (activePointers.size === 0) {
    pointerDown = null;
    globeDrag = null;
  }
  hidePinTooltip(hoverLandmarkId);
});

// Native touch (capture): reliable two-finger twist on phones / touchscreens.
canvas.addEventListener("touchstart", (event) => {
  if (event.touches.length >= 2) {
    globeDrag = null;
    twistFromTouchList(event.touches, true);
  }
}, { capture: true, passive: true });
canvas.addEventListener("touchmove", (event) => {
  if (event.touches.length >= 2) twistFromTouchList(event.touches, false);
}, { capture: true, passive: true });
canvas.addEventListener("touchend", (event) => {
  if (event.touches.length < 2) twistSample = null;
  else twistFromTouchList(event.touches, true);
}, { capture: true, passive: true });
canvas.addEventListener("touchcancel", () => { twistSample = null; }, { capture: true, passive: true });

// Safari / WebKit trackpad rotate gesture.
canvas.addEventListener("gesturestart", (event) => {
  event.preventDefault();
  gestureRotationDeg = 0;
  twistSample = null;
}, { passive: false });
canvas.addEventListener("gesturechange", (event) => {
  event.preventDefault();
  const deg = Number(event.rotation) || 0;
  rollEarthFlat(((deg - gestureRotationDeg) * Math.PI) / 180);
  gestureRotationDeg = deg;
}, { passive: false });
canvas.addEventListener("gestureend", () => {
  gestureRotationDeg = 0;
  twistSample = null;
}, { passive: true });

if (panelToggleEl) {
  panelToggleEl.addEventListener("click", () => {
    const collapsed = document.body.classList.toggle("panel-collapsed");
    panelToggleEl.setAttribute("aria-expanded", collapsed ? "false" : "true");
    panelToggleEl.textContent = collapsed ? "Mostra controlli" : "Nascondi controlli";
  });
}

window.addEventListener("resize", resizeGlobe);
window.visualViewport?.addEventListener("resize", resizeGlobe);
window.visualViewport?.addEventListener("scroll", resizeGlobe);
if (typeof ResizeObserver !== "undefined") {
  new ResizeObserver(() => resizeGlobe()).observe(appRoot);
}
window.addEventListener("orientationchange", () => {
  requestAnimationFrame(resizeGlobe);
});
function animate() {
  requestAnimationFrame(animate);
  if (earth && autoRotate) {
    // Idle spin about vertical through the sphere center.
    earth.rotateOnWorldAxis(AUTO_SPIN_AXIS, AUTO_SPIN_RAD);
  }
  controls.update();
  updateVisibility();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  hideLabelsOverPanel();
}
animate();
buildGlobe().catch((err) => {
  console.error(err);
  setStatus("Errore nel caricamento delle texture. Avvia main.py almeno una volta con rete.", "error");
});
