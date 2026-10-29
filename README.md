# Počasí Karviná

Mobilní webová aplikace (PWA) s detailním počasím, předpovědí a klimatickou historií pro Karvinou.
Běží zdarma na GitHub Pages a dá se nainstalovat na plochu telefonu (Android i iPhone).

**Aplikace:** https://hukanai.github.io/pocasi-karvina/

## Co umí

- **Dnes**: aktuální stav (měření ČHMÚ + model), odchylka od normálu, **čas od posledního deště** (živé počítadlo z 10min měření srážkoměru ČHMÚ), hodinová předpověď na 48 h, srážky na 2 h po 15 minutách, vítr, tlak, vlhkost, UV, oblačnost, kvalita ovzduší, Slunce a Měsíc, výstrahy ČHMÚ
- **Předpověď**: 16 dní s hodinovým detailem, jistota předpovědi (ensemble ECMWF, 51 variant), srovnání 6 modelů
- **Radar**: animace srážek za poslední 2 hodiny + výhled na 6 hodin
- **Ovzduší**: index EAQI, PM10, PM2,5, NO₂, O₃, SO₂, CO, denní průměry vs. limity, pyl
- **Historie**: normál 1991–2020, rekordy dne, tento den v minulých letech (od 1877), letošní rok po měsících, kumulativní srážky, charakteristické dny, klimatický trend a „warming stripes“, suchá období, srovnání libovolných dvou let. Zdroj lze přepnout mezi měřením ČHMÚ a reanalýzou ERA5.
- **Upozornění do telefonu** (přes aplikaci ntfy): mráz, náledí, bouřky, přívalový déšť, vítr, prudké ochlazení, smog, výstrahy ČHMÚ a ranní souhrn v 6:30

## Zdroje dat

| Data | Zdroj |
| --- | --- |
| Předpověď, modely, ensemble, archiv ERA5 | [Open-Meteo](https://open-meteo.com) |
| Měření stanice Karviná (0-203-0-11795) | [ČHMÚ – otevřená data](https://opendata.chmi.cz/meteorology/climate/) |
| Výstrahy | ČHMÚ přes [MeteoAlarm](https://meteoalarm.org) |
| Kvalita ovzduší a pyl | Copernicus CAMS přes Open-Meteo |
| Radar | [RainViewer](https://www.rainviewer.com) |
| Mapa | Esri, © přispěvatelé OpenStreetMap |

## Jak to funguje

```
main ──(Actions: build)──► GitHub Pages (PWA) ──► Open-Meteo, RainViewer (přímo z prohlížeče)
                                   │
                                   └──► raw.githubusercontent.com/…/data/*.json
data ◄──(Actions: každou hodinu)── scripts/*.ts ──► ntfy.sh ──► telefon
```

ČHMÚ ani MeteoAlarm nepovolují čtení přímo z prohlížeče (CORS), proto je stahuje
GitHub Action (`.github/workflows/data.yml`) do větve `data`:

| Soubor | Obsah | Obnova |
| --- | --- | --- |
| `station-now.json` | poslední měření ČHMÚ, 48h průběh, souhrn dne | každou hodinu |
| `station-sra10.json` | 10min srážky za ~120 dní (čas od posledního deště) | každou hodinu |
| `station-daily.json` | denní řada ČHMÚ od 1877 | denně |
| `era5-daily.json` | denní řada ERA5 od 1940 | denně |
| `warnings.json` | platné výstrahy pro ORP Karviná | každou hodinu |
| `alerts-state.json` | odeslaná upozornění (aby nechodila dvakrát) | každou hodinu |

## Nastavení upozornění

1. V repozitáři: **Settings → Secrets and variables → Actions → New repository secret**,
   název `NTFY_TOPIC`, hodnota = náhodný název kanálu (např. `karvina-` + 16 náhodných znaků).
2. V telefonu nainstalujte aplikaci **ntfy** a přihlaste se k odběru stejného kanálu.
3. Zkouška: Actions → *Aktualizace dat* → *Run workflow*.

## Vývoj

```bash
npm install
npm run data:dev     # stáhne data ČHMÚ/ERA5/výstrahy do public/dev-data (pro lokální běh)
npm run dev          # http://localhost:5173/pocasi-karvina/
npm run check        # typy + lint + testy + sestavení
```

Datové skripty lze spustit i samostatně (`DATA_DIR` určuje výstupní složku):

```bash
node scripts/update-station.ts          # měření ČHMÚ
node scripts/update-climate.ts --full   # celé historické řady
node scripts/fetch-warnings.ts          # výstrahy
node scripts/check-alerts.ts --dry-run  # vypíše upozornění, nic neodešle
```

Ověřené konvence dat ČHMÚ (testováno na skutečných datech):

- časy jsou v UTC, 10min značka = **konec** intervalu (hodinový úhrn v čase t = součet 10min hodnot t−50 … t)
- denní srážky dne D = úhrn od 7:00 SEČ dne D do 7:00 dne D+1
- denní maximum a minimum = období 21:00–21:00 SEČ končící dnem D
- teplotní řada stanice nemá úplná data (≥ 90 % dní) pro roky 1878, 1884–1897, 1939–1949, 1979–1987 a 2008–2011

## Licence dat

Data ČHMÚ jsou otevřená data. Open-Meteo: CC BY 4.0. Ikony Meteocons: MIT.
