/**
 * Offline mountain-range hints from coarse geographic corridors + catalog peaks.
 * Italian names for the UI.
 */

/** @type {{ name: string, minLat: number, maxLat: number, minLon: number, maxLon: number, minElev: number, weight: number }[]} */
const RANGES = [
  { name: "Himalaya", minLat: 26.5, maxLat: 36.5, minLon: 72, maxLon: 97, minElev: 1200, weight: 3 },
  { name: "Karakorum", minLat: 34.5, maxLat: 37.2, minLon: 74, maxLon: 78.5, minElev: 2000, weight: 4 },
  { name: "Hindu Kush", minLat: 34, maxLat: 37.5, minLon: 67, maxLon: 74.5, minElev: 1500, weight: 3 },
  { name: "Tian Shan", minLat: 38, maxLat: 45, minLon: 70, maxLon: 95, minElev: 1500, weight: 2 },
  { name: "Altai", minLat: 45, maxLat: 52, minLon: 82, maxLon: 100, minElev: 1200, weight: 2 },
  { name: "Alpi", minLat: 43.5, maxLat: 48.5, minLon: 4.5, maxLon: 16.5, minElev: 700, weight: 4 },
  { name: "Appennini", minLat: 38.5, maxLat: 44.8, minLon: 8.5, maxLon: 16.5, minElev: 700, weight: 3 },
  { name: "Pirenei", minLat: 42.0, maxLat: 43.5, minLon: -2.5, maxLon: 3.5, minElev: 700, weight: 3 },
  { name: "Carpazi", minLat: 44.5, maxLat: 50, minLon: 18, maxLon: 27, minElev: 700, weight: 2 },
  { name: "Caucaso", minLat: 40.5, maxLat: 44.5, minLon: 39, maxLon: 49, minElev: 1000, weight: 3 },
  { name: "Urali", minLat: 51, maxLat: 68, minLon: 56, maxLon: 66, minElev: 500, weight: 2 },
  { name: "Ande", minLat: -56, maxLat: 11, minLon: -82, maxLon: -62, minElev: 800, weight: 3 },
  { name: "Montagne Rocciose", minLat: 32, maxLat: 60, minLon: -125, maxLon: -104, minElev: 1000, weight: 3 },
  { name: "Sierra Nevada (USA)", minLat: 35.5, maxLat: 40.5, minLon: -122, maxLon: -117.5, minElev: 1000, weight: 4 },
  { name: "Catena delle Cascate", minLat: 40, maxLat: 50, minLon: -124, maxLon: -120, minElev: 900, weight: 3 },
  { name: "Appalachi", minLat: 33, maxLat: 48, minLon: -85, maxLon: -70, minElev: 600, weight: 2 },
  { name: "Sierra Madre", minLat: 16, maxLat: 32, minLon: -110, maxLon: -96, minElev: 900, weight: 2 },
  { name: "Alaska Range", minLat: 60, maxLat: 64.5, minLon: -155, maxLon: -141, minElev: 1000, weight: 3 },
  { name: "Atlas", minLat: 29, maxLat: 36.5, minLon: -10, maxLon: 10, minElev: 800, weight: 2 },
  { name: "Drakensberg", minLat: -31.5, maxLat: -28, minLon: 27, maxLon: 30.5, minElev: 1200, weight: 3 },
  { name: "Altopiano etiopico", minLat: 5, maxLat: 15, minLon: 35, maxLon: 43, minElev: 1500, weight: 2 },
  { name: "Rift orientale", minLat: -5, maxLat: 2, minLon: 34, maxLon: 40, minElev: 1500, weight: 2 },
  { name: "Alpi giapponesi", minLat: 35, maxLat: 37.2, minLon: 136.5, maxLon: 139.5, minElev: 1000, weight: 3 },
  { name: "Arco vulcanico giapponese", minLat: 31, maxLat: 45, minLon: 130, maxLon: 146, minElev: 800, weight: 1 },
  { name: "Alpi meridionali (NZ)", minLat: -45.5, maxLat: -41.5, minLon: 166.5, maxLon: 173.5, minElev: 800, weight: 3 },
  { name: "Grande Catena Divisoria", minLat: -38, maxLat: -15, minLon: 145, maxLon: 153.5, minElev: 700, weight: 2 },
  { name: "Monti Ellsworth", minLat: -80, maxLat: -77, minLon: -90, maxLon: -80, minElev: 1000, weight: 3 },
  { name: "Alpi Transantartiche", minLat: -85, maxLat: -70, minLon: 140, maxLon: 180, minElev: 1000, weight: 2 },
  { name: "Alpi Transantartiche", minLat: -85, maxLat: -70, minLon: -180, maxLon: -150, minElev: 1000, weight: 2 },
  { name: "Sistema vulcanico siciliano", minLat: 37.2, maxLat: 38.2, minLon: 14.5, maxLon: 15.5, minElev: 800, weight: 4 },
  { name: "Isole Canarie", minLat: 27.5, maxLat: 29.5, minLon: -18.5, maxLon: -13, minElev: 800, weight: 3 },
  { name: "Altopiano del Tibet", minLat: 28, maxLat: 38, minLon: 78, maxLon: 103, minElev: 3500, weight: 1 },
];

function inBox(lat, lon, box) {
  if (lat < box.minLat || lat > box.maxLat) return false;
  if (box.minLon <= box.maxLon) {
    return lon >= box.minLon && lon <= box.maxLon;
  }
  // antimeridian
  return lon >= box.minLon || lon <= box.maxLon;
}

/**
 * @param {number} lat
 * @param {number} lon
 * @param {number} elevM
 * @returns {{ name: string, source: string } | null}
 */
export function lookupMountainRange(lat, lon, elevM) {
  if (elevM < 600) return null;
  let best = null;
  for (const range of RANGES) {
    if (elevM < range.minElev) continue;
    if (!inBox(lat, lon, range)) continue;
    const latSpan = Math.max(0.1, range.maxLat - range.minLat);
    const lonSpan = Math.max(0.1, range.maxLon - range.minLon);
    const cy = (range.minLat + range.maxLat) / 2;
    const cx = (range.minLon + range.maxLon) / 2;
    const dist = Math.hypot((lat - cy) / latSpan, (lon - cx) / lonSpan);
    const score = range.weight * 10 - dist * 4 + Math.min(3, elevM / 2000);
    if (!best || score > best.score) best = { name: range.name, score, source: "region" };
  }
  return best ? { name: best.name, source: best.source } : null;
}
