# Simulatore livello del mare (offline)

## Avvio

```bash
cd sea-level-sim
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

Apri http://127.0.0.1:8000

## Controlli

- Slider 0–9000 m (oltre +135 m è scenario narrativo / non scientifico)
- Preset: attuale, +70, +135, +2000, +5000, +8500, +9000
- Flag **Etichette (nomi) sulla mappa 3D**: nasconde i testi; i prismi rossi restano
- Filtri etichette: vette / città / punti di interesse (solo sul globo; l’elenco a sinistra resta)
- Clicca un punto sul globo: quota DEM, città vicina, abitazioni o terreno vuoto
- Cerca un luogo e clicca per volare lì

Il globo usa un DEM GEBCO (quote in metri). Terra emersa e acqua hanno colori nettamente distinti; la costa allagata è chiara.
