# Waterworld Simulator 1.0 (offline)

## Avvio

```bash
cd sea-level-sim
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

Apri http://127.0.0.1:8000

### Icona su iPhone (Schermata Home)

Serve un URL raggiungibile dal telefono (Mac e iPhone sulla stessa Wi‑Fi: avvia il server sul Mac e apri `http://<IP-del-Mac>:8000` in Safari). Poi Safari → Condividi → Aggiungi a Schermata Home. L’URL del Cloud Agent non va bene: sparisce a fine run.

## Controlli

- Slider 0–9000 m (oltre +135 m è scenario narrativo / non scientifico)
- Preset: attuale, +70, +135, +2000, +5000, +8500, +9000
- Flag **Etichette (nomi) sulla mappa 3D**: nasconde i testi; i prismi rossi restano
- Filtri etichette: vette / città / punti di interesse (solo sul globo; l’elenco a sinistra resta)
- Clicca un punto sul globo: quota DEM, città vicina, abitazioni o terreno vuoto
- Cerca un luogo e clicca per volare lì

Il globo usa un DEM ETOPO 2022 a 8192×4096, PNG 16 bit con le quote in metri (passo 1 m,
profondità limitate a -500 m). Il browser non lo decodifica: `app.js` legge i byte da sé,
così CPU e GPU leggono lo stesso valore. Terra emersa e acqua hanno colori nettamente
distinti; la costa allagata è chiara.

Le sorgenti (ETOPO 466 MB, Blue Marble 30 MB) non stanno in git: `main.py` le scarica al
primo avvio solo se la texture derivata manca.
