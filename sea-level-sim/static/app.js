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
// Elevation map encoding, mirrored from main.py: metres = sample * step - offset.
// One metre per step; anything deeper than -500 m was flattened when the map was built.
const ELEV_OFFSET_M = 500;
const ELEV_STEP_M = 1;
const ELEV_FLOOR_M = -500;
const MARKER_LIFT = 0.0015;
// iPhone Safari cannot hold an 8k float DEM + 8k colour + 512-segment sphere in WebGL
// memory: the UI loads, the fetch finishes, then the globe never appears. Cap mesh and
 // texture size on constrained devices; desktop keeps the full map.
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const IS_CONSTRAINED = IS_IOS
  || (typeof navigator.deviceMemory === "number" && navigator.deviceMemory > 0 && navigator.deviceMemory <= 4)
  || (navigator.maxTouchPoints > 1 && window.matchMedia("(pointer: coarse)").matches);
const EARTH_SEGMENTS = IS_CONSTRAINED ? 256 : 1024;
const GPU_TEX_CAP = IS_CONSTRAINED ? 4096 : 8192;

const filters = { peak: true, city: true, poi: true };
let showGlobeLabels = true;
let seaLevelM = 0;
let autoRotate = true;
let selectedId = null;
let probeInfo = null;
let sampleElev = null;
let sampleLights = null;
let probeMarker = null;
let probePlaced = false;
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
let pointerDown = null;
const entries = [];
const entryById = new Map();
const listFloodRows = [];
let earth = null;
let ocean = null;
const landmarksRoot = new THREE.Group();
const PIN_UP = new THREE.Vector3(0, 1, 0);
const PIN_HEIGHT = 0.018;
const pinGeometry = new THREE.CylinderGeometry(0.0065, 0.0035, PIN_HEIGHT, 3);
pinGeometry.translate(0, PIN_HEIGHT / 2, 0);
pinGeometry.computeVertexNormals();
// Click marker: the same width as the flat disc it replaces, laid on the ground and walled.
// The wall stands taller than a pin, so the marker never reads as shorter than the pins
// standing next to it. PIN_HEIGHT is about 1000 m, so this is close to 3000 m.
const PROBE_SEGMENTS = 96;
const PROBE_INNER_RAD = 0.01 / EARTH_RADIUS;
const PROBE_OUTER_RAD = 0.016 / EARTH_RADIUS;
const PROBE_WALL = PIN_HEIGHT * 2.8;
const _probeEast = new THREE.Vector3();
const _probeUp = new THREE.Vector3();
const _probeDir = new THREE.Vector3();
const _probePoint = new THREE.Vector3();
const _probeAnchor = new THREE.Vector3();
const PIN_HOVER_PX = 26;
const PIN_CLICK_PX = 11;
const _pinWorld = new THREE.Vector3();
const _pinNdc = new THREE.Vector3();
// Reused every frame: allocating per marker per frame kept the collector busy.
const _visWorld = new THREE.Vector3();
const _visNormal = new THREE.Vector3();
const _visToCam = new THREE.Vector3();
const _coveredLabels = [];
const pinMatOpts = { flatShading: true, fog: false, depthTest: false, depthWrite: false };
const pinMaterialFlooded = new THREE.MeshBasicMaterial({ color: 0xe11d2e, ...pinMatOpts });
const pinMaterialDry = new THREE.MeshBasicMaterial({ color: 0x22c55e, ...pinMatOpts });
/** Catalog altitude decides flooding (same number the panel shows); DEM only for ocean cells. */
function pinFloodElev(item, groundElev) {
  if (item.elev >= 2) return item.elev;
  return groundElev != null ? groundElev : item.elev;
}

/** Two states only: green emerged, red submerged. */
function pinMaterialFor(item, groundElev) {
  return isSubmerged(pinFloodElev(item, groundElev)) ? pinMaterialFlooded : pinMaterialDry;
}
let hoverLandmarkId = null;
let searchMarker = null;
let flyToken = 0;

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
  // Point sample (r=0): must match flood/ocean masks — max-neighborhood flooded valleys.
  return sampleElev ? sampleElev(lat, lon, 0, "avg") : 0;
}
function visualRadiusAt(lat, lon) {
  return visualRadiusFromElev(elevMetersAt(lat, lon));
}
/**
 * Radius of the terrain as it is really drawn. Displacement moves only sphere vertices,
 * so between them the surface is a lerp of vertex heights: a pin placed at the DEM value
 * of a peak would hang above the mesh. Rebuild that lerp from the vertex grid.
 */
function renderedRadiusAt(lat, lon) {
  if (!sampleElev || !sampleElev.uv) return visualRadiusFromElev(elevMetersAt(lat, lon));
  let u = (lon + 180) / 360;
  u -= Math.floor(u);
  const v = THREE.MathUtils.clamp((90 - lat) / 180, 0, 1);
  const fx = u * EARTH_SEGMENTS;
  const fy = v * EARTH_SEGMENTS;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const vertexRadius = (gx, gy) => {
    // Sphere v runs north→south, texture v runs upwards: flip before reading.
    const uvY = 1 - THREE.MathUtils.clamp(gy, 0, EARTH_SEGMENTS) / EARTH_SEGMENTS;
    return visualRadiusFromElev(sampleElev.uv(gx / EARTH_SEGMENTS, uvY));
  };
  const top = vertexRadius(ix, iy) * (1 - tx) + vertexRadius(ix + 1, iy) * tx;
  const bottom = vertexRadius(ix, iy + 1) * (1 - tx) + vertexRadius(ix + 1, iy + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}
/**
 * Sea sphere radius for the set waterline (meters).
 * Same mapping as terrain displacement: land with DEM elev E emerges iff E > meters.
 */
function oceanRadius(meters) {
  return EARTH_RADIUS + heightOffset(meters);
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
  // Water-top radius (probe ring).
  return EARTH_RADIUS + heightOffset(Math.max(elevM, seaLevelM)) + MARKER_LIFT;
}

/**
 * Resolve where a landmark pin should sit.
 * DEM only; never lift ocean cells with catalog height (false "emersed" mid-sea).
 * Snap only when the sample is ocean-like — not when inland land is legitimately flooded
 * (that used to jump cities onto nearby peaks above the waterline).
 */
function resolveMarkerPose(lat, lon, catalogElev) {
  let useLat = lat;
  let useLon = lon;
  const landFloor = 2;
  let demHere = sampleElev ? elevMetersAt(lat, lon) : catalogElev;
  const catalogIsLand = catalogElev >= landFloor;
  const demLooksOcean = demHere < landFloor;

  if (sampleElev && catalogIsLand && demLooksOcean) {
    let bestElev = -1;
    let bestLat = lat;
    let bestLon = lon;
    let bestScore = -Infinity;
    // Texel-scale nudge only: closest land wins, height just breaks ties. A wider,
    // height-driven search used to drag coastal pins 100-300 km onto inland peaks.
    const span = 0.35;
    const step = 0.06;
    for (let dLat = -span; dLat <= span; dLat += step) {
      for (let dLon = -span; dLon <= span; dLon += step) {
        const e = elevMetersAt(lat + dLat, lon + dLon);
        if (e < landFloor) continue;
        const dist2 = dLat * dLat + dLon * dLon;
        const score = -dist2 + e / 1e6;
        if (score > bestScore) {
          bestScore = score;
          bestElev = e;
          bestLat = lat + dLat;
          bestLon = lon + dLon;
        }
      }
    }
    if (bestElev >= landFloor) {
      useLat = bestLat;
      useLon = bestLon;
    }
  }

  const ground = sampleElev ? elevMetersAt(useLat, useLon) : catalogElev;
  // Always seat on DEM terrain (underwater included); materials keep pins visible when flooded.
  return {
    lat: useLat,
    lon: useLon,
    groundElev: ground,
    radius: renderedRadiusAt(useLat, useLon) + MARKER_LIFT,
  };
}

function groundMarkerRadius(lat, lon, catalogElev) {
  return resolveMarkerPose(lat, lon, catalogElev).radius;
}

/**
 * One rule for pin colour, panel, list and labels: they used to disagree, so a place
 * at 1 m got a red pin while its text read "a rischio".
 * The map cannot tell a shore at 0 m from open sea, so map level always counts as water.
 */
function isSubmerged(elevM) {
  return elevM < Math.max(seaLevelM, 0.5);
}

function floodState(elevM) {
  if (isSubmerged(elevM)) return "flooded";
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
// Where startup time goes; read it from window.__ww.timing.
const loadTiming = {};

/**
 * Elevation is decoded here instead of by the browser. Canvas and WebGL both collapse a
 * 16-bit image to 8 bit while decoding it, and a colour profile on the file once made every
 * altitude read ~30% too high. Reading the bytes ourselves keeps metres exact and leaves
 * the browser no chance to reinterpret them.
 */
async function loadElevationField(name, maxWidth = Infinity) {
  const started = performance.now();
  setStatus("Scarico mappa quote…");
  const response = await fetch("/static/textures/" + name + "?v=" + TEXTURE_VERSION);
  if (!response.ok) throw new Error("Impossibile caricare " + name);
  const bytes = new Uint8Array(await response.arrayBuffer());
  loadTiming.fetch = Math.round(performance.now() - started);
  setStatus(IS_IOS
    ? "Decodifico DEM su iPhone (può richiedere un minuto)…"
    : "Decodifico DEM…");
  const raster = await decodeGray16Png(bytes);
  const { width, height, samples } = raster;
  const beforeMetres = performance.now();
  // Raster rows run north→south; WebGL samples v upwards. Flip while converting.
  // On iPhone skip the full-size Float32Array (≈128 MB) or Safari kills WebGL.
  if (width <= maxWidth) {
    const metres = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
      const src = y * width;
      const dst = (height - 1 - y) * width;
      for (let x = 0; x < width; x += 1) {
        metres[dst + x] = samples[src + x] * ELEV_STEP_M - ELEV_OFFSET_M;
      }
    }
    loadTiming.metres = Math.round(performance.now() - beforeMetres);
    return { width, height, metres };
  }
  const scale = width / maxWidth;
  const outH = Math.max(1, Math.round(height / scale));
  const metres = new Float32Array(maxWidth * outH);
  for (let y = 0; y < outH; y += 1) {
    const srcY = Math.min(height - 1, Math.floor((1 - (y + 0.5) / outH) * height));
    for (let x = 0; x < maxWidth; x += 1) {
      const srcX = Math.min(width - 1, Math.floor((x + 0.5) * scale));
      metres[y * maxWidth + x] = samples[srcY * width + srcX] * ELEV_STEP_M - ELEV_OFFSET_M;
    }
  }
  loadTiming.metres = Math.round(performance.now() - beforeMetres);
  return { width: maxWidth, height: outH, metres };
}

/** Shrink a metres field so it fits the GPU (and iPhone RAM). Nearest sample. */
function constrainElevField(field, maxWidth) {
  if (field.width <= maxWidth) return field;
  const scale = field.width / maxWidth;
  const height = Math.max(1, Math.round(field.height / scale));
  const metres = new Float32Array(maxWidth * height);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(field.height - 1, Math.floor((y + 0.5) * scale));
    for (let x = 0; x < maxWidth; x += 1) {
      const sx = Math.min(field.width - 1, Math.floor((x + 0.5) * scale));
      metres[y * maxWidth + x] = field.metres[sy * field.width + sx];
    }
  }
  return { width: maxWidth, height, metres };
}

/** Colour maps above maxTextureSize fail silently on Safari; redraw onto a canvas. */
function constrainColorTexture(texture, maxWidth) {
  const image = texture.image;
  if (!image || !image.width || image.width <= maxWidth) return texture;
  const height = Math.max(1, Math.round(image.height * (maxWidth / image.width)));
  const canvasEl = document.createElement("canvas");
  canvasEl.width = maxWidth;
  canvasEl.height = height;
  const ctx = canvasEl.getContext("2d");
  if (!ctx) return texture;
  ctx.drawImage(image, 0, 0, maxWidth, height);
  texture.image = canvasEl;
  texture.needsUpdate = true;
  return texture;
}

async function decodeGray16Png(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunkType = (at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = -1;
  let interlace = 0;
  const parts = [];
  let pos = 8; // past the PNG signature
  while (pos + 8 <= bytes.length) {
    const length = view.getUint32(pos);
    const type = chunkType(pos + 4);
    const start = pos + 8;
    if (type === "IHDR") {
      width = view.getUint32(start);
      height = view.getUint32(start + 4);
      depth = bytes[start + 8];
      colorType = bytes[start + 9];
      interlace = bytes[start + 12];
    } else if (type === "IDAT") {
      parts.push(bytes.subarray(start, start + length));
    } else if (type === "IEND") {
      break;
    }
    pos = start + length + 4; // skip the chunk CRC
  }
  if (depth !== 16 || colorType !== 0 || interlace !== 0) {
    throw new Error("elevation: serve un PNG 16 bit grigio non interlacciato");
  }
  const beforeInflate = performance.now();
  const stream = new Blob(parts).stream().pipeThrough(new DecompressionStream("deflate"));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());
  loadTiming.inflate = Math.round(performance.now() - beforeInflate);
  const beforeUnfilter = performance.now();
  const samples = unfilterGray16(raw, width, height);
  loadTiming.unfilter = Math.round(performance.now() - beforeUnfilter);
  return { width, height, samples };
}

/** Undo the per-row PNG filters (spec 9.2). Two bytes per pixel, so "left" is i - 2. */
function unfilterGray16(raw, width, height) {
  const stride = width * 2;
  const samples = new Uint16Array(width * height);
  const line = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  let at = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[at];
    at += 1;
    line.set(raw.subarray(at, at + stride));
    at += stride;
    if (filter !== 0) {
      for (let i = 0; i < stride; i += 1) {
        const left = i >= 2 ? line[i - 2] : 0;
        const up = prev[i];
        const upLeft = i >= 2 ? prev[i - 2] : 0;
        let value = line[i];
        if (filter === 1) value += left;
        else if (filter === 2) value += up;
        else if (filter === 3) value += (left + up) >> 1;
        else if (filter === 4) {
          const pa = Math.abs(up - upLeft);
          const pb = Math.abs(left - upLeft);
          const pc = Math.abs(left + up - 2 * upLeft);
          value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        } else throw new Error("elevation: filtro PNG " + filter + " non previsto");
        line[i] = value & 255;
      }
    }
    for (let x = 0; x < width; x += 1) {
      samples[y * width + x] = (line[x * 2] << 8) | line[x * 2 + 1];
    }
    prev.set(line);
  }
  return samples;
}

/**
 * Reads the elevation field in metres. Longitude wraps, latitude clamps, and the texel
 * picked is the one the GPU picks with a nearest filter, so pin, click probe and terrain
 * can never answer with different cells.
 */
function makeElevSampler(field) {
  const { width, height, metres } = field;
  const indexAt = (u, uvY, dx, dy) => {
    const wrapped = u - Math.floor(u);
    const x = ((Math.floor(wrapped * width) + dx) % width + width) % width;
    const row = Math.min(height - 1, Math.floor(THREE.MathUtils.clamp(uvY, 0, 1) * height));
    const y = THREE.MathUtils.clamp(row + dy, 0, height - 1);
    return y * width + x;
  };
  const sample = (lat, lon, radius = 1, mode = "avg") => {
    const u = (lon + 180) / 360;
    const uvY = (lat + 90) / 180;
    if (radius === 0) return metres[indexAt(u, uvY, 0, 0)];
    let peak = -Infinity;
    let sum = 0;
    let count = 0;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const value = metres[indexAt(u, uvY, dx, dy)];
        peak = Math.max(peak, value);
        sum += value;
        count += 1;
      }
    }
    return mode === "max" ? peak : sum / count;
  };
  // Same read the vertex shader performs, for reproducing drawn terrain heights.
  sample.uv = (u, uvY) => metres[indexAt(u, uvY, 0, 0)];
  sample.field = field;
  return sample;
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
  const sample = (lat, lon, radius = 1, mode = "avg") => {
    let u = (lon + 180) / 360;
    u = u - Math.floor(u);
    const v = THREE.MathUtils.clamp((90 - lat) / 180, 0, 1);
    const cx = Math.floor(u * width);
    const cy = Math.floor(v * (height - 1));
    if (mode === "max") {
      let peak = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const x = (cx + dx + width) % width;
          const y = THREE.MathUtils.clamp(cy + dy, 0, height - 1);
          peak = Math.max(peak, data[(y * width + x) * 4]);
        }
      }
      return peak;
    }
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
  // Texture-space read matching THREE.LinearFilter, for reproducing vertex heights.
  sample.uv = (u, v) => {
    const x = u * width - 0.5;
    const y = THREE.MathUtils.clamp(v, 0, 1) * (height - 1) - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const read = (xi, yi) => {
      const xw = ((xi % width) + width) % width;
      const yw = THREE.MathUtils.clamp(yi, 0, height - 1);
      return data[(yw * width + xw) * 4];
    };
    const top = read(x0, y0) * (1 - tx) + read(x0 + 1, y0) * tx;
    const bottom = read(x0, y0 + 1) * (1 - tx) + read(x0 + 1, y0 + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  };
  return sample;
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
  const elevM = elevMetersAt(lat, lon);
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
/**
 * A clicked point on the sea floor reads better as a depth than as a negative altitude.
 * The map was built with everything below ELEV_FLOOR_M flattened, so at the floor the
 * exact figure is unknown and the line says so.
 */
function depthOrHeightLine(elevM) {
  if (elevM >= 0) return "Altitudine: <strong>" + formatElev(elevM) + "</strong> s.l.m.<br>";
  const depth = formatElev(-elevM);
  if (elevM > ELEV_FLOOR_M) return "Profondità: <strong>" + depth + "</strong> sotto il livello del mare<br>";
  return "Profondità: <strong>oltre " + depth + "</strong> sotto il livello del mare<br>";
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
  const pin = new THREE.Mesh(pinGeometry, pinMaterialDry);
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
  const radius = groundMarkerRadius(searchMarker.city.lat, searchMarker.city.lon, elevM);
  const position = latLonToVec(searchMarker.city.lat, searchMarker.city.lon, radius);
  const dir = position.clone().normalize();
  searchMarker.pin.position.copy(position);
  searchMarker.pin.quaternion.setFromUnitVectors(PIN_UP, dir);
  searchMarker.pin.renderOrder = 6;
  searchMarker.pin.material = floodState(elevM) === "flooded" ? pinMaterialFlooded : pinMaterialDry;
  searchMarker.label.renderOrder = 6;
  searchMarker.label.position.copy(dir.clone().multiplyScalar(radius + 0.028));
  searchMarker.pin.visible = true;
  searchMarker.label.visible = showGlobeLabels;
  searchMarker.el.style.visibility = showGlobeLabels ? "visible" : "hidden";
}
function selectWorldCity(city) {
  selectedId = null;
  for (const entry of entries) entry.el.classList.toggle("is-selected", false);
  const elevM = elevMetersAt(city.lat, city.lon);
  placeSearchMarker(city, elevM);
  probeInfo = describePoint(city.lat, city.lon);
  hideProbe();
  renderProbe(probeInfo);
  rebuildList();
  flyTo({ lat: city.lat, lon: city.lon, elev: elevM });
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !IS_CONSTRAINED,
  alpha: true,
  powerPreference: IS_IOS ? "default" : "high-performance",
  // Logarithmic depth fails or blanks the scene on some iOS Safari GPUs.
  logarithmicDepthBuffer: !IS_CONSTRAINED,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_CONSTRAINED ? 1.25 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const GPU_TEX_MAX = Math.min(renderer.capabilities.maxTextureSize || 4096, GPU_TEX_CAP);
canvas.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  setStatus("WebGL interrotto (memoria). Ricarica la pagina.", "error");
}, false);

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
// Above the tallest displaced terrain (EARTH_RADIUS + DISP_SCALE + DISP_BIAS): no diving inside.
controls.minDistance = 2.17;
controls.maxDistance = 16;
controls.zoomSpeed = 1.15;
// Pan/zoom move the camera; one-finger drag tumbles the Earth about its center.
controls.enableRotate = false;
controls.enablePan = true;
controls.screenSpacePanning = true;
controls.panSpeed = 0.85;
controls.target.set(0, 0, 0);

const GLOBE_CENTER = new THREE.Vector3(0, 0, 0);
const EARTH_POLE = new THREE.Vector3(0, 1, 0);
const AUTO_SPIN_RAD = 0.00055;
const DRAG_SPIN_SENS = 0.005;
const TILT_LIMIT = THREE.MathUtils.degToRad(88);
const _dragAxisRight = new THREE.Vector3();
const _dragAxisLook = new THREE.Vector3();
const _poleView = new THREE.Vector3();
const _camQuatInv = new THREE.Quaternion();
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
// Bump when a texture file changes: browsers keep the old copy otherwise, and a stale
// elevation map means wrong altitudes everywhere.
const TEXTURE_VERSION = "3";
function loadTexture(name, colorSpace) {
  return new Promise((resolve, reject) => {
    loader.load(name + "?v=" + TEXTURE_VERSION, (texture) => {
      texture.colorSpace = colorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      resolve(texture);
    }, undefined, () => reject(new Error("Impossibile caricare " + name)));
  });
}

function installFloodShader(material, elevTexture) {
  material.customProgramCacheKey = () => "sea-flood-v23";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSeaLevel = { value: seaLevelM };
    // Own sampler: three exposes displacementMap to the vertex stage only.
    shader.uniforms.uElevMap = { value: elevTexture };
    material.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float uSeaLevel;
         varying float vElevM;
         varying vec2 vElevUv;`
      )
      .replace(
        "#include <displacementmap_vertex>",
        `#ifdef USE_DISPLACEMENTMAP
          vElevUv = vDisplacementMapUv;
          vElevM = texture2D( displacementMap, vDisplacementMapUv ).x;
          // Oceano piatto; terra (anche sommersa) tiene il rilievo così restano i contorni.
          float landM = vElevM < 2.0 ? 0.0 : vElevM;
          float h = clamp( landM / ${REF_ELEV_M.toFixed(1)}, 0.0, 1.15 );
          transformed += normalize( objectNormal ) * ( displacementScale * h + displacementBias );
        #else
          vElevM = 0.0;
          vElevUv = vec2( 0.0 );
        #endif`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float uSeaLevel;
         uniform sampler2D uElevMap;
         varying float vElevM;
         varying vec2 vElevUv;`
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
         // Metres, from the map's own cell: the texture filters nearest, so this is the
         // same value the pin and the click probe read and they cannot disagree.
         float elevM = texture2D( uElevMap, vElevUv ).x;
         float landMask = smoothstep( 1.5, 22.0, elevM );
         if ( uSeaLevel > 1.0 ) {
           // Narrow transition: a wide antialias band let whole ranges read as dry land
           // even where the DEM sits hundreds of metres below the waterline.
           float aa = clamp( fwidth( elevM ) * 0.5, 8.0, 60.0 );
           float above = ( elevM - uSeaLevel ) / aa;
           float dryAmt = smoothstep( -0.5, 0.5, above );
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
  const pose = resolveMarkerPose(entry.item.lat, entry.item.lon, entry.item.elev);
  entry.pose = pose;
  const position = latLonToVec(pose.lat, pose.lon, pose.radius);
  const dir = position.clone().normalize();
  entry.pin.position.copy(position);
  entry.pin.quaternion.setFromUnitVectors(PIN_UP, dir);
  entry.pin.renderOrder = 6;
  entry.pin.material = pinMaterialFor(entry.item, pose.groundElev);
  entry.label.renderOrder = 6;
  entry.label.position.copy(dir.multiplyScalar(pose.radius + 0.032));
}

function createMarker(item) {
  const meta = TYPE_META[item.type];
  const pin = new THREE.Mesh(pinGeometry, pinMaterialFor(item, item.elev));
  pin.renderOrder = 4;
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
  const entry = { item, pin, label, el };
  placeMarker(entry);
  return entry;
}

/** Height every readout judges flood state on: the one the pin already uses. */
function itemFloodElev(item) {
  const entry = entryById.get(item.id);
  return pinFloodElev(item, entry && entry.pose ? entry.pose.groundElev : item.elev);
}

function landmarkTooltipHtml(item) {
  const meta = TYPE_META[item.type];
  const state = floodLabel(itemFloodElev(item));
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

function projectPinToClient(entry) {
  if (!entry?.pin?.visible) return null;
  entry.pin.getWorldPosition(_pinWorld);
  _pinNdc.copy(_pinWorld).project(camera);
  if (_pinNdc.z > 1) return null;
  const rect = canvas.getBoundingClientRect();
  return {
    x: (_pinNdc.x * 0.5 + 0.5) * rect.width + rect.left,
    y: (-_pinNdc.y * 0.5 + 0.5) * rect.height + rect.top,
  };
}

function nearestPinByScreen(clientX, clientY, maxPx) {
  let best = null;
  let bestD = maxPx * maxPx;
  for (const entry of entries) {
    const s = projectPinToClient(entry);
    if (!s) continue;
    const dx = clientX - s.x;
    const dy = clientY - s.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD) {
      bestD = d2;
      best = entry;
    }
  }
  if (searchMarker?.pin?.visible) {
    searchMarker.pin.getWorldPosition(_pinWorld);
    _pinNdc.copy(_pinWorld).project(camera);
    if (_pinNdc.z <= 1) {
      const rect = canvas.getBoundingClientRect();
      const sx = (_pinNdc.x * 0.5 + 0.5) * rect.width + rect.left;
      const sy = (-_pinNdc.y * 0.5 + 0.5) * rect.height + rect.top;
      const dx = clientX - sx;
      const dy = clientY - sy;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestD) best = { search: true, city: searchMarker.city };
    }
  }
  return best;
}

function pickPinUnderPointer(event) {
  if (!earth) return null;
  const hit = nearestPinByScreen(event.clientX, event.clientY, PIN_HOVER_PX);
  if (!hit || hit.search) return null;
  return hit;
}

function rebuildList() {
  listEl.innerHTML = "";
  listFloodRows.length = 0;
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
        const floodElev = itemFloodElev(item);
        btn.className = "landmark-item" + (item.id === selectedId ? " active" : "");
        btn.innerHTML = '<span class="kind" style="color:' + meta.color + '">' + meta.short + '</span><span class="body"><strong>' + item.name + '</strong><small>' + meta.label + " · " + formatElev(item.elev) + ' · <em class="flood-' + floodState(floodElev) + '">' + floodLabel(floodElev) + "</em></small></span>";
        btn.addEventListener("click", () => selectLandmark(item.id, true));
        trackListFlood(btn, floodElev);
      } else {
        const city = match.city;
        const elevM = elevMetersAt(city.lat, city.lon);
        btn.className = "landmark-item";
        btn.innerHTML = '<span class="kind" style="color:#7ec8ff">●</span><span class="body"><strong>' + city.name + '</strong><small>Città · ≈ ' + city.pop.toLocaleString("it-IT") + " ab. (GeoNames) · " + formatElev(elevM) + ' · <em class="flood-' + floodState(elevM) + '">' + floodLabel(elevM) + "</em></small></span>";
        btn.addEventListener("click", () => selectWorldCity(city));
        trackListFlood(btn, elevM);
      }
      listEl.appendChild(btn);
    }
    return;
  }
  const sorted = [...LANDMARKS].sort((a, b) => a.name.localeCompare(b.name, "it"));
  for (const item of sorted) {
    const meta = TYPE_META[item.type];
    const btn = document.createElement("button");
    const floodElev = itemFloodElev(item);
    btn.type = "button";
    btn.className = "landmark-item" + (item.id === selectedId ? " active" : "");
    btn.innerHTML = '<span class="kind" style="color:' + meta.color + '">' + meta.short + '</span><span class="body"><strong>' + item.name + '</strong><small>' + meta.label + " · " + formatElev(item.elev) + ' · <em class="flood-' + floodState(floodElev) + '">' + floodLabel(floodElev) + "</em></small></span>";
    btn.addEventListener("click", () => selectLandmark(item.id, true));
    trackListFlood(btn, floodElev);
    listEl.appendChild(btn);
  }
}

function trackListFlood(btn, floodElev) {
  const em = btn.querySelector("em");
  if (em) listFloodRows.push({ em, elev: floodElev });
}

/**
 * Moving the sea only changes the state word on each row. Rebuilding all ~190 rows
 * of markup on every slider tick made the drag stutter.
 */
function refreshListFlood() {
  for (const row of listFloodRows) {
    row.em.className = "flood-" + floodState(row.elev);
    row.em.textContent = floodLabel(row.elev);
  }
}

function refreshFloodUI() {
  for (const entry of entries) {
    placeMarker(entry);
    const floodElev = pinFloodElev(entry.item, entry.pose ? entry.pose.groundElev : entry.item.elev);
    const state = floodState(floodElev);
    entry.el.classList.toggle("is-flooded", state === "flooded");
    entry.el.classList.toggle("is-risk", state === "risk");
    entry.el.title = entry.item.name + " — " + formatElev(entry.item.elev) + " — " + floodLabel(floodElev);
  }
  refreshListFlood();
  if (selectedId) renderSelection(selectedId);
  else if (probeInfo) {
    probeInfo = describePoint(probeInfo.lat, probeInfo.lon);
    placeProbe(probeInfo.lat, probeInfo.lon);
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
  for (const entry of entries) {
    const showZoom = priorityVisible(entry.item.priority, camDist);
    entry.pin.getWorldPosition(_visWorld);
    _visNormal.copy(_visWorld).normalize();
    _visToCam.copy(camera.position).sub(_visWorld).normalize();
    const facing = _visNormal.dot(_visToCam) > 0.12;
    const onFront = filters[entry.item.type] && showZoom && facing;
    entry.pin.visible = onFront;
    const showLabel = showGlobeLabels && onFront;
    entry.label.visible = showLabel;
    entry.el.style.visibility = showLabel ? "visible" : "hidden";
  }
  if (searchMarker) {
    // Follows the same checkbox as the catalog labels; it used to stay on screen.
    searchMarker.label.visible = showGlobeLabels;
    searchMarker.el.style.visibility = showGlobeLabels ? "visible" : "hidden";
  }
  if (probeMarker && probePlaced) {
    // The marker ignores depth, so nothing but the far side of the globe may hide it.
    probeMarker.localToWorld(_visWorld.copy(_probeAnchor));
    _visNormal.copy(_visWorld).normalize();
    _visToCam.copy(camera.position).sub(_visWorld).normalize();
    probeMarker.visible = _visNormal.dot(_visToCam) > 0;
  }
}

function hideLabelsOverPanel() {
  if (!panelEl) return;
  const pr = panelEl.getBoundingClientRect();
  // Read every rect first, hide afterwards: hiding inside the loop invalidated layout
  // and forced a reflow per label, sixty times a second.
  _coveredLabels.length = 0;
  for (const entry of entries) {
    if (entry.el.style.visibility === "hidden") continue;
    const r = entry.el.getBoundingClientRect();
    if (r.right > pr.left && r.left < pr.right && r.bottom > pr.top && r.top < pr.bottom) {
      _coveredLabels.push(entry.el);
    }
  }
  for (const el of _coveredLabels) el.style.visibility = "hidden";
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
    + depthOrHeightLine(info.elevM)
    + formatCoords(info.lat, info.lon) + "</p>"
    + rangeLine + place + nearby + floodLine;
}

function placeProbe(lat, lon) {
  if (!probeMarker) {
    probeMarker = new THREE.Mesh(
      makeProbeRing(),
      new THREE.MeshBasicMaterial({
        color: 0x5eead4,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.7, // the wall stands up: solid teal would hide the ground behind it
        // Drawn over water and terrain alike, like the pins: a mountain in front of the
        // marker used to eat half of it.
        depthTest: false,
        depthWrite: false,
      })
    );
    probeMarker.renderOrder = 5;
    landmarksRoot.add(probeMarker);
  }
  drapeProbeRing(probeMarker.geometry, lat, lon);
  // Kept for the per-frame check: with depth testing off, only the far side must hide it.
  _probeAnchor.copy(latLonToVec(lat, lon, renderedRadiusAt(lat, lon)));
  probePlaced = true;
  probeMarker.visible = true;
}

function hideProbe() {
  probePlaced = false;
  if (probeMarker) probeMarker.visible = false;
}

function makeProbeRing() {
  const geometry = new THREE.BufferGeometry();
  const steps = PROBE_SEGMENTS + 1;
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(steps * 3 * 3), 3));
  const index = [];
  for (let i = 0; i < PROBE_SEGMENTS; i += 1) {
    const here = i * 3;
    const next = here + 3;
    // Flat band on the ground, then the wall standing on its outer edge.
    index.push(here, here + 1, next + 1, here, next + 1, next);
    index.push(here + 1, here + 2, next + 2, here + 1, next + 2, next + 1);
  }
  geometry.setIndex(index);
  return geometry;
}

/**
 * The click marker is a cylinder laid on the ground: a band that follows the terrain plus
 * a wall on its outer edge. It spans about 100 km, so a flat disc on a tangent plane cut
 * into the uphill side of a mountain and the circle came out broken. Only the base follows
 * the relief; the top rim sits at one radius, above the highest ground the ring covers, so
 * it reads as a level circle from any angle. Points under water ride the sea surface, or
 * the marker would disappear whenever the clicked spot is flooded.
 */
function drapeProbeRing(geometry, lat, lon) {
  const centre = latLonToVec(lat, lon, 1);
  // Any tangent direction serves as the ring's start; north degenerates at the poles.
  _probeEast.set(0, 1, 0).cross(centre);
  if (_probeEast.lengthSq() < 1e-8) _probeEast.set(1, 0, 0);
  _probeEast.normalize();
  _probeUp.copy(centre).cross(_probeEast).normalize();
  const water = oceanRadius(seaLevelM);
  const position = geometry.attributes.position;
  const array = position.array;
  let highest = 0;
  for (let i = 0; i <= PROBE_SEGMENTS; i += 1) {
    const angle = (i / PROBE_SEGMENTS) * Math.PI * 2;
    _probeDir.copy(_probeEast).multiplyScalar(Math.cos(angle)).addScaledVector(_probeUp, Math.sin(angle));
    for (let corner = 0; corner < 2; corner += 1) {
      const spread = corner === 0 ? PROBE_INNER_RAD : PROBE_OUTER_RAD;
      _probePoint.copy(centre).multiplyScalar(Math.cos(spread)).addScaledVector(_probeDir, Math.sin(spread));
      // Unit vector already: read its latitude and longitude without another normalise.
      const pointLat = 90 - THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(_probePoint.y, -1, 1)));
      const pointLon = THREE.MathUtils.radToDeg(Math.atan2(_probePoint.z, -_probePoint.x)) - 180;
      const ground = Math.max(renderedRadiusAt(pointLat, pointLon), water) + MARKER_LIFT;
      highest = Math.max(highest, ground);
      const at = (i * 3 + corner) * 3;
      array[at] = _probePoint.x * ground;
      array[at + 1] = _probePoint.y * ground;
      array[at + 2] = _probePoint.z * ground;
    }
  }
  const rim = highest + PROBE_WALL;
  for (let i = 0; i <= PROBE_SEGMENTS; i += 1) {
    // The rim shares its direction with the outer base vertex written above.
    const outer = (i * 3 + 1) * 3;
    _probePoint.set(array[outer], array[outer + 1], array[outer + 2]).normalize().multiplyScalar(rim);
    const at = outer + 3;
    array[at] = _probePoint.x;
    array[at + 1] = _probePoint.y;
    array[at + 2] = _probePoint.z;
  }
  position.needsUpdate = true;
  geometry.computeBoundingSphere();
}

function inspectGlobe(lat, lon) {
  selectedId = null;
  for (const entry of entries) entry.el.classList.toggle("is-selected", false);
  // Keep search marker only if this inspect is for that city (handled by selectWorldCity order).
  probeInfo = describePoint(lat, lon);
  placeProbe(probeInfo.lat, probeInfo.lon);
  renderProbe(probeInfo);
  rebuildList();
}

function pickOnCanvas(event) {
  if (!earth) return;
  // Strict screen radius: near-pin tooltip must not steal map clicks.
  const pinPick = nearestPinByScreen(event.clientX, event.clientY, PIN_CLICK_PX);
  if (pinPick) {
    if (pinPick.search) {
      selectWorldCity(pinPick.city);
      return;
    }
    clearSearchMarker();
    hideProbe();
    probeInfo = null;
    selectLandmark(pinPick.item.id, false);
    return;
  }
  clearSearchMarker();
  const rect = canvas.getBoundingClientRect();
  pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, camera);
  const picked = pickDisplacedLatLon();
  if (!picked) return;
  inspectGlobe(picked.lat, picked.lon);
}

function renderSelection(id) {
  const item = LANDMARKS.find((l) => l.id === id);
  if (!item) { selectedEl.hidden = true; return; }
  const meta = TYPE_META[item.type];
  const floodElev = itemFloodElev(item);
  const state = floodState(floodElev);
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
    + '<p class="sel-flood flood-' + state + '">Con mare a ' + formatSea(seaLevelM) + ': <strong>' + floodLabel(floodElev) + "</strong></p>";
}

function flyTo(item) {
  // Camera along the ray from globe center → place; pivot stays at center.
  // Own token: two quick selections used to run both flights and fight over the camera.
  const token = ++flyToken;
  const radius = surfaceRadius(item.elev);
  const local = latLonToVec(item.lat, item.lon, radius);
  const worldPoint = local.clone();
  landmarksRoot.localToWorld(worldPoint);
  const dir = worldPoint.clone().normalize();
  const dest = dir.multiplyScalar(2.68);
  const start = camera.position.clone();
  const startTarget = controls.target.clone();
  let t = 0;
  function step() {
    if (token !== flyToken) return;
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
  hideProbe();
  const item = LANDMARKS.find((l) => l.id === id);
  if (!item) return;
  renderSelection(id); rebuildList();
  for (const entry of entries) entry.el.classList.toggle("is-selected", entry.item.id === id);
  if (shouldFly) flyTo(item);
}

/**
 * One DEM texel spans several km, so it disagrees with the catalog altitude a place
 * is labelled with: summits read far too low (Denali 4165 m instead of 6190 m) and a
 * few valley sites read too high. Both cases showed a pin whose flood state contradicted
 * the terrain under it. Write the catalog altitude into the map so terrain, click probe
 * and pin all answer with the same number.
 */
function stampCatalogIntoElevation(field) {
  const { width, height, metres } = field;
  const texelAt = (lat, lon, dx, dy) => {
    let u = (lon + 180) / 360;
    u -= Math.floor(u);
    const uvY = THREE.MathUtils.clamp((lat + 90) / 180, 0, 1);
    const x = ((Math.floor(u * width) + dx) % width + width) % width;
    const row = Math.min(height - 1, Math.floor(uvY * height));
    const y = THREE.MathUtils.clamp(row + dy, 0, height - 1);
    return y * width + x;
  };
  const ringScale = [1, 0.9, 0.72]; // summit texel, then two rings of massif
  for (const item of LANDMARKS) {
    if (!Number.isFinite(item.elev)) continue;
    if (item.type === "peak") {
      if (item.elev < 1000) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const meters = item.elev * ringScale[Math.max(Math.abs(dx), Math.abs(dy))];
          const i = texelAt(item.lat, item.lon, dx, dy);
          if (meters > metres[i]) metres[i] = meters; // a summit is a maximum: never dig
        }
      }
      continue;
    }
    // Cities and areas: their own texel becomes authoritative, so the pin never
    // contradicts the ground it stands on. One texel only, so coastlines keep their shape.
    // Below-sea places (Amsterdam, the Dead Sea) keep their negative height.
    metres[texelAt(item.lat, item.lon, 0, 0)] = item.elev;
  }
}

async function buildGlobe() {
  setStatus("Caricamento texture e luoghi…");
  const buildStarted = performance.now();
  const [colorMapRaw, elevFieldRaw, nightMap] = await Promise.all([
    loadTexture("earth.jpg", THREE.SRGBColorSpace),
    loadElevationField("elevation.png", GPU_TEX_MAX),
    loadTexture("earth-night.jpg", THREE.NoColorSpace).catch(() => null),
    loadCountries(),
    loadCities(),
  ]);
  setStatus("Preparo il globo…");
  const colorMap = constrainColorTexture(colorMapRaw, GPU_TEX_MAX);
  if (nightMap) constrainColorTexture(nightMap, GPU_TEX_MAX);
  stampCatalogIntoElevation(elevFieldRaw);
  const elevField = constrainElevField(elevFieldRaw, GPU_TEX_MAX);
  // Metres straight to the GPU: nearest and no mipmaps, so the shader reads the same
  // single cell the pin and the click probe read.
  const elevMap = new THREE.DataTexture(
    elevField.metres, elevField.width, elevField.height, THREE.RedFormat, THREE.FloatType
  );
  elevMap.magFilter = THREE.NearestFilter;
  elevMap.minFilter = THREE.NearestFilter;
  elevMap.generateMipmaps = false;
  elevMap.wrapS = THREE.RepeatWrapping;
  elevMap.needsUpdate = true;
  sampleElev = makeElevSampler(elevField);
  sampleLights = nightMap ? makeGraySampler(nightMap) : null;
  // Lambert (not Basic): displacementMap is required for relief + flood shader.
  // Ambient-only lighting keeps land evenly bright with no directional sun.
  const material = new THREE.MeshLambertMaterial({
    map: colorMap,
    displacementMap: elevMap,
    displacementScale: DISP_SCALE,
    displacementBias: DISP_BIAS,
  });
  installFloodShader(material, elevMap);
  earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS, EARTH_SEGMENTS, EARTH_SEGMENTS), material);
  scene.add(earth);
  earth.add(landmarksRoot);
  ocean = new THREE.Mesh(
    new THREE.SphereGeometry(1, 192, 192),
    new THREE.MeshBasicMaterial({
      color: 0x0c4a7a,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    })
  );
  // Open water / limb only: submerged land is tinted by the flood shader itself.
  ocean.renderOrder = -1;
  ocean.visible = false;
  ocean.scale.setScalar(oceanRadius(0));
  earth.add(ocean);
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS * 1.05, 64, 64),
    new THREE.MeshBasicMaterial({ color: 0x6eb6ff, transparent: true, opacity: 0.07, side: THREE.BackSide, depthWrite: false })
  ));
  const beforeMarkers = performance.now();
  for (const item of LANDMARKS) {
    const entry = createMarker(item);
    entries.push(entry);
    entryById.set(item.id, entry);
  }
  loadTiming.markers = Math.round(performance.now() - beforeMarkers);
  setStatus("");
  applySeaLevel(Number(slider.value));
  rebuildList();
  loadTiming.total = Math.round(performance.now() - buildStarted);
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
rotateEl.checked = true;
autoRotate = true;
rotateEl.addEventListener("change", () => { autoRotate = rotateEl.checked; });

/** Pole tilt read on screen: 0 = north up, +/-90 deg = pole aimed at / away from the viewer. */
function poleTiltAngle() {
  _poleView.copy(EARTH_POLE).applyQuaternion(earth.quaternion);
  _poleView.applyQuaternion(_camQuatInv.copy(camera.quaternion).invert());
  return Math.atan2(_poleView.z, _poleView.y);
}

function spinEarthByPointerDelta(dx, dy, event) {
  if (!earth) return;
  // Shift+drag: flat CW/CCW roll (works on trackpad/mouse where OS twist is unavailable).
  if (event?.shiftKey) {
    rollEarthFlat(-dx * DRAG_SPIN_SENS);
    return;
  }
  // North locked upright: spin about the globe's own axis, tilt about the screen horizontal.
  earth.rotateY(dx * DRAG_SPIN_SENS);
  const tilt = poleTiltAngle();
  const step = THREE.MathUtils.clamp(tilt + dy * DRAG_SPIN_SENS, -TILT_LIMIT, TILT_LIMIT) - tilt;
  if (Math.abs(step) > 1e-8) {
    _dragAxisRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    earth.rotateOnWorldAxis(_dragAxisRight, step);
  }
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
  } else if (activePointers.size === 2 && event.pointerType !== "touch") {
    // Touch is handled by the touchmove listener below; running both rolled the globe twice.
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
    // Idle spin about the globe's own axis (longitude only).
    earth.rotateY(AUTO_SPIN_RAD);
  }
  controls.update();
  updateVisibility();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  hideLabelsOverPanel();
}
animate();
// Read-only hook: lets a checker compare what the map, the pins and the panel report.
window.__ww = {
  sea: () => seaLevelM,
  elev: (lat, lon) => elevMetersAt(lat, lon),
  screenOf: (id) => {
    const entry = entryById.get(id);
    if (!entry) return null;
    const p = entry.pin.getWorldPosition(new THREE.Vector3()).project(camera);
    const { w, h } = viewportSize();
    return { x: Math.round(((p.x + 1) / 2) * w), y: Math.round(((1 - p.y) / 2) * h), z: p.z };
  },
  timing: () => ({ ...loadTiming }),
  placeProbe: (lat, lon) => placeProbe(lat, lon),
  /**
   * Click marker against the ground beneath it, in metres. Clearance must stay positive or
   * the ring gets cut by the slope; spread is the drop a flat disc would have to bridge.
   */
  probeFit: () => {
    if (!probeMarker || !probePlaced) return null;
    const position = probeMarker.geometry.attributes.position;
    const perUnit = REF_ELEV_M / DISP_SCALE;
    let clearance = Infinity;
    let lowest = Infinity;
    let highest = -Infinity;
    for (let i = 0; i < position.count; i += 1) {
      _probePoint.fromBufferAttribute(position, i);
      const radius = _probePoint.length();
      _probePoint.normalize();
      const lat = 90 - THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(_probePoint.y, -1, 1)));
      const lon = THREE.MathUtils.radToDeg(Math.atan2(_probePoint.z, -_probePoint.x)) - 180;
      const ground = Math.max(renderedRadiusAt(lat, lon), oceanRadius(seaLevelM));
      clearance = Math.min(clearance, radius - ground);
      lowest = Math.min(lowest, ground);
      highest = Math.max(highest, ground);
    }
    return { clearanceM: Math.round(clearance * perUnit), spreadM: Math.round((highest - lowest) * perUnit) };
  },
  /** Pin colour vs label state for every place: the two used to disagree near sea level. */
  states: () => entries.map((entry) => ({
    id: entry.item.id,
    name: entry.item.name,
    floodElev: pinFloodElev(entry.item, entry.pose ? entry.pose.groundElev : entry.item.elev),
    pinRed: entry.pin.material === pinMaterialFlooded,
    labelRed: entry.el.classList.contains("is-flooded"),
  })),
  pickAt: (x, y) => {
    const rect = canvas.getBoundingClientRect();
    pointerNdc.x = ((x - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((y - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    const picked = pickDisplacedLatLon();
    return picked ? { lat: picked.lat, lon: picked.lon, elev: elevMetersAt(picked.lat, picked.lon) } : null;
  },
};
buildGlobe().catch((err) => {
  console.error(err);
  const detail = err && err.message ? String(err.message) : "errore sconosciuto";
  setStatus("Errore nel caricamento: " + detail, "error");
});
