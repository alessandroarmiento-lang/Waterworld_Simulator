/**
 * Offline country lookup from Natural Earth 110m (compact JSON).
 */
let countries = null;
let loadPromise = null;

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInCountry(lon, lat, country) {
  const [minLon, minLat, maxLon, maxLat] = country.bbox;
  // bbox may cross antimeridian for Russia/Fiji — skip strict reject then
  if (maxLon - minLon < 300) {
    if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) return false;
  } else if (lat < minLat || lat > maxLat) {
    return false;
  }
  for (const poly of country.polys) {
    if (pointInRing(lon, lat, poly[0])) return true;
  }
  return false;
}

export function loadCountries() {
  if (countries) return Promise.resolve(countries);
  if (loadPromise) return loadPromise;
  loadPromise = fetch("/static/data/countries.json")
    .then((r) => {
      if (!r.ok) throw new Error("countries.json missing");
      return r.json();
    })
    .then((data) => {
      countries = data;
      return countries;
    })
    .catch((err) => {
      console.warn(err);
      countries = [];
      return countries;
    });
  return loadPromise;
}

export function lookupCountry(lat, lon) {
  if (!countries || !countries.length) return null;
  for (const country of countries) {
    if (pointInCountry(lon, lat, country)) {
      return { name: country.name, code: country.code, continent: country.continent };
    }
  }
  return null;
}

export function oceanBasin(lat, lon) {
  if (lat >= 66) return "Oceano Artico";
  if (lat <= -55) return "Oceano Australe";
  // Pacific vs Atlantic / Indian (rough)
  if (lon >= 100 || lon <= -70) {
    if (lat > -55 && lat < 66) {
      if (lon > 20 && lon < 100) return "Oceano Indiano";
      return "Oceano Pacifico";
    }
  }
  if (lon > 20 && lon < 145 && lat < 30 && lat > -60) {
    if (lon < 100 || (lon >= 100 && lat < 10)) return "Oceano Indiano";
  }
  if (lon > -70 && lon < 20) return "Oceano Atlantico";
  if (lon >= 20 && lon <= 100) return "Oceano Indiano";
  return "Oceano aperto";
}
