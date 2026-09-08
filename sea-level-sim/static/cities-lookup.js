/**
 * Offline nearest-city lookup (GeoNames cities ≥ 1000 pop).
 * Data only — never rendered on the globe.
 */
let pack = null;
let grid = null;
let loadPromise = null;

const CELL = 1; // degrees

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
      return pack;
    })
    .catch((err) => {
      console.warn(err);
      pack = { n: [], la: [], lo: [], c: [], p: [], codes: [] };
      grid = new Map();
      return pack;
    });
  return loadPromise;
}

function cityScore(km, pop) {
  // Prefer larger places over tiny neighborhoods at similar distance.
  return km - 4 * Math.log10(pop + 10);
}

/**
 * @returns {{ name: string, lat: number, lon: number, pop: number, cc: string, km: number } | null}
 */
export function nearestCity(lat, lon, maxKm = 40) {
  if (!pack || !grid || !pack.n.length) return null;
  const ci = Math.floor((lat + 90) / CELL);
  const cj = Math.floor((lon + 180) / CELL);
  // Search radius in cells (~111 km/deg); pad for maxKm
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

export function citiesReady() {
  return !!(pack && pack.n && pack.n.length);
}
