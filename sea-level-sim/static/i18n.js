/**
 * Waterworld Simulator UI strings — Italian and English.
 * Persist with localStorage key ww-lang.
 */

export const LANGS = ["it", "en"];

const STRINGS = {
  it: {
    panelToggleHide: "Nascondi controlli",
    panelToggleShow: "Mostra controlli",
    panelAria: "Controlli Waterworld Simulator 1.0",
    version: "Versione 1.0",
    lede: "Globo offline con vette, città e punti di interesse (con altitudine). Clicca un punto sulla mappa per quota, città e tipo di suolo.",
    seaLevel: "Livello del mare",
    seaSliderAria: "Livello del mare (cursore)",
    presetsAria: "Scenari",
    preset0: "Attuale",
    preset70: "Ghiacci (+70 m)",
    preset135: "Ghiacci + falde (+135 m)",
    preset2000: "Alte montagne (+2000 m)",
    preset5000: "Solo grandi vette (+5000 m)",
    preset8500: "Solo ottomila (+8500 m)",
    preset9000: "Waterworld totale (+9000 m)",
    globeLabels: "Etichette (nomi) sulla mappa 3D",
    filtersLegend: "Quali punti sul globo",
    filterPeak: "Vette",
    filterCity: "Città",
    filterPoi: "Punti di interesse",
    autoRotate: "Rotazione automatica",
    gesturesTitle: "Gesture",
    gesture1: "giro est-ovest + inclinazione nord-sud (Nord resta in alto)",
    gesture1Label: "1 dito",
    gesture2: "sposta (pan)",
    gesture2Label: "2 dita trascina",
    gesture3: "zoom",
    gesture3Label: "2 dita pinch",
    gesture4: "orario / antiorario (piano)",
    gesture4Label: "2 dita torsione",
    gesture5: "stesso roll (trackpad / mouse)",
    gesture5Label: "Shift + trascina",
    gesture6Green: "Verde",
    gesture6Rest: "emerso ·",
    gesture6Red: "Rosso",
    gesture6End: "sommerso",
    gesture7: "quota, città, terreno",
    gesture7Label: "Clic",
    searchLabel: "Cerca luogo",
    searchPlaceholder: "Es. Legnano — Invio per inquadrare",
    listAria: "Elenco luoghi",
    note: "Ogni luogo mostra la quota. Oltre +135 m lo scenario è narrativo / non scientifico.",
    creditsAria: "Credits",
    creditsCopy: "© Alessandro Armiento · Solo uso non commerciale",
    creditsData: "Dati: ETOPO 2022 (NOAA) / NASA · GeoNames · three.js",
    langAria: "Lingua",
    langIt: "IT",
    langEn: "EN",
    // dynamic
    flooded: "sommerso",
    risk: "a rischio",
    dry: "emerso",
    coverOcean: "mare / oceano",
    coverFloodedLand: "terra sommersa",
    coverSettled: "zona abitata",
    coverSparse: "abitazioni sparse",
    coverIce: "ghiaccio polare",
    coverHigh: "alta montagna / altopiano",
    coverHill: "collina / rilievo",
    coverTerrain: "terreno",
    elevLine: "Altitudine: <strong>{v}</strong> s.l.m.<br>",
    depthLine: "Profondità: <strong>{v}</strong> sotto il livello del mare<br>",
    depthOverLine: "Profondità: <strong>oltre {v}</strong> sotto il livello del mare<br>",
    openSea: "Mare aperto",
    intlWaters: "acque internazionali / al largo",
    unclassified: "Area non classificata",
    noSearch: "Nessun luogo trovato per questa ricerca.",
    statusFetchElev: "Scarico mappa quote…",
    statusDecodeIos: "Decodifico DEM su iPhone (può richiedere un minuto)…",
    statusDecode: "Decodifico DEM…",
    statusLoadTex: "Caricamento texture e luoghi…",
    statusPrep: "Preparo il globo…",
    statusWebgl: "WebGL interrotto (memoria). Ricarica la pagina.",
    errLoad: "Impossibile caricare {name}",
    pointOnMap: "Punto sulla mappa",
    where: "Dove:",
    soilType: "Tipo suolo:",
    nearestCity: "Città più vicina:",
    withSea: "Con mare a {sea}:",
    seaNow: "Mare attuale (quota 0).",
    country: "Paese:",
    range: "Catena montuosa:",
    cityKind: "Città",
    peakKind: "Vetta",
    poiKind: "Punto di interesse",
    ab: "ab.",
    ewEast: "E",
    ewWest: "O",
    cityColon: "Città:",
    nearestCityColon: "Città più vicina:",
    nearbyCatalog: "Nel catalogo vicino:",
    nearTo: "vicino a",
    rangeColon: "Catena:",
    loadError: "Errore nel caricamento: {detail}",
    unknownError: "errore sconosciuto",
  },
  en: {
    panelToggleHide: "Hide controls",
    panelToggleShow: "Show controls",
    panelAria: "Waterworld Simulator 1.0 controls",
    version: "Version 1.0",
    lede: "Offline globe with peaks, cities and points of interest (with elevation). Click a map point for altitude, nearest city and ground type.",
    seaLevel: "Sea level",
    seaSliderAria: "Sea level (slider)",
    presetsAria: "Scenarios",
    preset0: "Present day",
    preset70: "Ice sheets (+70 m)",
    preset135: "Ice + aquifers (+135 m)",
    preset2000: "High mountains (+2000 m)",
    preset5000: "Major peaks only (+5000 m)",
    preset8500: "Eight-thousanders only (+8500 m)",
    preset9000: "Total Waterworld (+9000 m)",
    globeLabels: "Labels (names) on the 3D map",
    filtersLegend: "What to show on the globe",
    filterPeak: "Peaks",
    filterCity: "Cities",
    filterPoi: "Points of interest",
    autoRotate: "Auto-rotate",
    gesturesTitle: "Gestures",
    gesture1: "east–west spin + north–south tilt (North stays up)",
    gesture1Label: "1 finger",
    gesture2: "pan",
    gesture2Label: "2-finger drag",
    gesture3: "zoom",
    gesture3Label: "2-finger pinch",
    gesture4: "clockwise / counter-clockwise (flat roll)",
    gesture4Label: "2-finger twist",
    gesture5: "same roll (trackpad / mouse)",
    gesture5Label: "Shift + drag",
    gesture6Green: "Green",
    gesture6Rest: "emerged ·",
    gesture6Red: "Red",
    gesture6End: "submerged",
    gesture7: "altitude, city, terrain",
    gesture7Label: "Click",
    searchLabel: "Search place",
    searchPlaceholder: "e.g. Legnano — Enter to frame",
    listAria: "Place list",
    note: "Every place shows elevation. Above +135 m the scenario is narrative / not scientific.",
    creditsAria: "Credits",
    creditsCopy: "© Alessandro Armiento · Non-commercial use only",
    creditsData: "Data: ETOPO 2022 (NOAA) / NASA · GeoNames · three.js",
    langAria: "Language",
    langIt: "IT",
    langEn: "EN",
    flooded: "submerged",
    risk: "at risk",
    dry: "emerged",
    coverOcean: "sea / ocean",
    coverFloodedLand: "flooded land",
    coverSettled: "built-up area",
    coverSparse: "sparse settlement",
    coverIce: "polar ice",
    coverHigh: "high mountains / plateau",
    coverHill: "hills / relief",
    coverTerrain: "terrain",
    elevLine: "Elevation: <strong>{v}</strong> a.s.l.<br>",
    depthLine: "Depth: <strong>{v}</strong> below sea level<br>",
    depthOverLine: "Depth: <strong>over {v}</strong> below sea level<br>",
    openSea: "Open sea",
    intlWaters: "international waters / offshore",
    unclassified: "Unclassified area",
    noSearch: "No place found for this search.",
    statusFetchElev: "Downloading elevation map…",
    statusDecodeIos: "Decoding DEM on iPhone (may take a minute)…",
    statusDecode: "Decoding DEM…",
    statusLoadTex: "Loading textures and places…",
    statusPrep: "Building the globe…",
    statusWebgl: "WebGL interrupted (memory). Reload the page.",
    errLoad: "Could not load {name}",
    pointOnMap: "Point on the map",
    where: "Where:",
    soilType: "Ground type:",
    nearestCity: "Nearest city:",
    withSea: "At sea level {sea}:",
    seaNow: "Present-day sea (0 m).",
    country: "Country:",
    range: "Mountain range:",
    cityKind: "City",
    peakKind: "Peak",
    poiKind: "Point of interest",
    ab: "pop.",
    ewEast: "E",
    ewWest: "W",
    cityColon: "City:",
    nearestCityColon: "Nearest city:",
    nearbyCatalog: "Nearby in catalog:",
    nearTo: "near",
    rangeColon: "Range:",
    loadError: "Load error: {detail}",
    unknownError: "unknown error",
  },
};

let lang = "it";

export function getLang() {
  return lang;
}

export function localeTag() {
  return lang === "en" ? "en-GB" : "it-IT";
}

export function t(key, vars) {
  const table = STRINGS[lang] || STRINGS.it;
  let s = table[key] ?? STRINGS.it[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll("{" + k + "}", String(v));
    }
  }
  return s;
}

/**
 * Public GitHub clones default to English. Alessandro's machines keep Italian via a
 * gitignored owner-prefs.json (or a saved localStorage choice after first switch).
 */
export function detectLangSync() {
  try {
    const saved = localStorage.getItem("ww-lang");
    if (saved === "it" || saved === "en") return saved;
  } catch {
    /* ignore */
  }
  return "en";
}

export async function detectLang() {
  const sync = detectLangSync();
  if (sync !== "en" || localStorageHasLang()) return sync;
  try {
    const res = await fetch("/static/owner-prefs.json", { cache: "no-store" });
    if (!res.ok) return "en";
    const data = await res.json();
    if (data && (data.defaultLang === "it" || data.defaultLang === "en")) return data.defaultLang;
  } catch {
    /* missing file = public checkout */
  }
  return "en";
}

function localStorageHasLang() {
  try {
    const saved = localStorage.getItem("ww-lang");
    return saved === "it" || saved === "en";
  } catch {
    return false;
  }
}

export function setLang(next) {
  if (next !== "it" && next !== "en") return;
  lang = next;
  try {
    localStorage.setItem("ww-lang", next);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = next;
  applyStaticI18n();
  document.dispatchEvent(new CustomEvent("ww-langchange", { detail: { lang: next } }));
}

/** Fill every [data-i18n], [data-i18n-placeholder], [data-i18n-aria] from the active table. */
export function applyStaticI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key);
  });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const key = el.getAttribute("data-i18n-html");
    if (key) el.innerHTML = t(key);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key) el.setAttribute("placeholder", t(key));
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria");
    if (key) el.setAttribute("aria-label", t(key));
  });
  const hide = document.body.classList.contains("panel-collapsed");
  const toggle = document.getElementById("panel-toggle");
  if (toggle) toggle.textContent = hide ? t("panelToggleShow") : t("panelToggleHide");
  document.querySelectorAll("[data-lang]").forEach((btn) => {
    const on = btn.getAttribute("data-lang") === lang;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

export async function initI18n() {
  lang = await detectLang();
  document.documentElement.lang = lang;
  applyStaticI18n();
  document.querySelectorAll("[data-lang]").forEach((btn) => {
    btn.addEventListener("click", () => setLang(btn.getAttribute("data-lang")));
  });
}
