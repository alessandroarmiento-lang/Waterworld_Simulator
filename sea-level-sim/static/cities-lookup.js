/**
 * Offline nearest-city lookup + name search (GeoNames cities ≥ 1000 pop).
 * Data only — never rendered as the full set of globe markers.
 */
let pack = null;
let grid = null;
let nameFolds = null;
let prefixIndex = null;
let loadPromise = null;

const CELL = 1; // degrees

function foldText(value) {
  return (value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function cellKey(i, j) {
  return i + ":" + j;
}

function buildGrid(data) {
  const map = new Map();
  const n = data.n.length;
  for (let i = 0; i < n; i++) {
    const lat = data.la[i] / 1000;
    const lon = data.lo[i] / 1000;
    const ci = Math.floor((lat + 90) / CELL);
    const cj = Math.floor((lon + 180) / CELL);
    const key = cellKey(ci, cj);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = [];
      map.set(key, bucket);
    }
    bucket.push(i);
  }
  return map;
}

function buildSearchIndex(data) {
  nameFolds = new Array(data.n.length);
  prefixIndex = new Map();
  for (let i = 0; i < data.n.length; i++) {
    const folded = foldText(data.n[i]);
    nameFolds[i] = folded;
    const key = folded.slice(0, 3) || folded;
    let bucket = prefixIndex.get(key);
    if (!bucket) {
      bucket = [];
      prefixIndex.set(key, bucket);
    }
    bucket.push(i);
  }
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function loadCities() {
  if (pack) return Promise.resolve(pack);
  if (loadPromise) return loadPromise;
  loadPromise = fetch("/static/data/cities1000.json")
    .then((r) => {
      if (!r.ok) throw new Error("cities1000.json missing");
      return r.json();
    })
    .then((data) => {
      pack = data;
      grid = buildGrid(data);
      buildSearchIndex(data);
      return pack;
    })
    .catch((err) => {
      console.warn(err);
      pack = { n: [], la: [], lo: [], c: [], p: [], codes: [] };
      grid = new Map();
      nameFolds = [];
      prefixIndex = new Map();
      return pack;
    });
  return loadPromise;
}

function cityScore(km, pop) {
  return km - 4 * Math.log10(pop + 10);
}

/**
 * @returns {{ name: string, lat: number, lon: number, pop: number, cc: string, km: number } | null}
 */
export function nearestCity(lat, lon, maxKm = 40) {
  if (!pack || !grid || !pack.n.length) return null;
  const ci = Math.floor((lat + 90) / CELL);
  const cj = Math.floor((lon + 180) / CELL);
  const pad = Math.max(1, Math.ceil(maxKm / (CELL * 80)));
  let best = null;
  let bestScore = Infinity;
  for (let di = -pad; di <= pad; di++) {
    for (let dj = -pad; dj <= pad; dj++) {
      const bucket = grid.get(cellKey(ci + di, cj + dj));
      if (!bucket) continue;
      for (const idx of bucket) {
        const clat = pack.la[idx] / 1000;
        const clon = pack.lo[idx] / 1000;
        const km = haversineKm(lat, lon, clat, clon);
        if (km > maxKm) continue;
        const pop = pack.p[idx];
        const score = cityScore(km, pop);
        if (score < bestScore || (score === bestScore && pop > (best?.pop || 0))) {
          bestScore = score;
          best = {
            name: pack.n[idx],
            lat: clat,
            lon: clon,
            pop,
            cc: pack.codes[pack.c[idx]] || "",
            km,
          };
        }
      }
    }
  }
  return best;
}

/**
 * Name search over the full cities pack.
 * @returns {{ name: string, lat: number, lon: number, pop: number, cc: string, score: number }[]}
 */
export function searchCities(query, limit = 80) {
  if (!pack || !nameFolds || !prefixIndex) return [];
  const q = foldText(query).trim();
  if (q.length < 2) return [];
  const scored = [];
  const seen = new Set();

  const addIdx = (idx) => {
    if (seen.has(idx)) return;
    const name = nameFolds[idx];
    let score = 0;
    if (name === q) score = 450;
    else if (name.startsWith(q)) score = 350;
    else if (name.includes(" " + q)) score = 260;
    else if (name.includes(q)) score = 200;
    else return;
    seen.add(idx);
    score += Math.min(40, Math.log10(pack.p[idx] + 10) * 8);
    score -= Math.min(30, name.length * 0.4);
    scored.push({
      name: pack.n[idx],
      lat: pack.la[idx] / 1000,
      lon: pack.lo[idx] / 1000,
      pop: pack.p[idx],
      cc: pack.codes[pack.c[idx]] || "",
      score,
    });
  };

  const buckets = [];
  if (q.length < 3) {
    for (const [key, bucket] of prefixIndex) {
      if (key.startsWith(q)) buckets.push(bucket);
    }
  } else {
    const prefixKey = q.slice(0, 3);
    if (prefixIndex.has(prefixKey)) buckets.push(prefixIndex.get(prefixKey));
    for (const [key, bucket] of prefixIndex) {
      if (key === prefixKey) continue;
      if (key.startsWith(prefixKey.slice(0, 2))) buckets.push(bucket);
    }
  }

  if (buckets.length) {
    for (const bucket of buckets) {
      for (const idx of bucket) addIdx(idx);
    }
  } else {
    for (let i = 0; i < nameFolds.length; i++) addIdx(i);
  }

  // Containment fallback for multi-word / mid-string matches.
  if (scored.length < 12 && q.length >= 3) {
    for (let i = 0; i < nameFolds.length; i++) {
      if (!seen.has(i) && nameFolds[i].includes(q)) addIdx(i);
    }
  }

  scored.sort((a, b) => b.score - a.score || b.pop - a.pop || a.name.localeCompare(b.name, "it"));
  return scored.slice(0, limit);
}

export function citiesReady() {
  return !!(pack && pack.n && pack.n.length);
}
