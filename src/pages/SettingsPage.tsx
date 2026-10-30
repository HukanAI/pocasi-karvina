// Nastavení, návody (instalace, notifikace) a informace o zdrojích dat

import type { ReactNode } from 'react'
import { InstallCard } from '../components/InstallCard.tsx'
import { Card, Segmented, SourceNote } from '../components/ui.tsx'
import { CHMI_STATION, GITHUB, LOCATION } from '../config.ts'
import type { MetaFile } from '../lib/dataTypes.ts'
import { num } from '../lib/format.ts'
import { formatAgo, formatDayMonth, formatTime } from '../lib/time.ts'
import { useNow } from '../state/derived.ts'
import { useMeta } from '../state/queries.ts'
import type { Settings } from '../state/useSettings.ts'
import { useSettings } from '../state/useSettings.ts'

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[11px] font-bold text-white">{n}</span>
      <span>{children}</span>
    </li>
  )
}

const META_LABELS: [keyof MetaFile, string][] = [
  ['station', 'Měření ČHMÚ (10 min)'],
  ['stationDaily', 'Denní řada ČHMÚ'],
  ['era5', 'Reanalýza ERA5'],
  ['warnings', 'Výstrahy'],
  ['alerts', 'Kontrola upozornění'],
]

export default function SettingsPage() {
  const now = useNow(60_000)
  const { settings, update } = useSettings()
  const meta = useMeta()
  return (
    <div className="space-y-3 pb-4">
      <Card title="Vzhled">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">Motiv</span>
          <Segmented<Settings['theme']>
            value={settings.theme}
            onChange={(theme) => update({ theme })}
            options={[
              { value: 'auto', label: 'Podle telefonu' },
              { value: 'light', label: 'Světlý' },
              { value: 'dark', label: 'Tmavý' },
            ]}
          />
        </div>
      </Card>

      <Card title="Karta „Bez deště“">
        <p className="text-sm">Jaký nejmenší déšť přeruší počítání suchého období?</p>
        <Segmented<Settings['rainMinTotal']>
          className="mt-2"
          value={settings.rainMinTotal}
          onChange={(rainMinTotal) => update({ rainMinTotal })}
          options={[0.1, 0.5, 1, 2].map((v) => ({ value: v as Settings['rainMinTotal'], label: `${num(v, v < 1 ? 1 : 0)} mm` }))}
        />
        <SourceNote>
          0,1 mm = jakýkoli měřitelný déšť. Vyšší hodnota ignoruje krátké slabé přeháňky a mrholení: počítá se úhrn celé srážkové epizody (přestávky do 30 minut se slučují).
        </SourceNote>
      </Card>

      <InstallCard />

      <Card title="Upozornění do telefonu">
        <p className="text-sm">
          Upozornění na mráz a náledí, bouřky, silný déšť a vítr, smog, oficiální výstrahy ČHMÚ a ranní souhrn v 6:30 posílá každou hodinu automatická kontrola na GitHubu přes bezplatnou službu ntfy.
        </p>
        <ol className="mt-2 space-y-1 text-sm">
          <Step n={1}>Nainstalujte aplikaci ntfy (Google Play / App Store, zdarma).</Step>
          <Step n={2}>V ntfy klepněte na „+“ (Subscribe to topic).</Step>
          <Step n={3}>Zadejte název kanálu, který jste dostali při nastavení (začíná „karvina-“), server ponechte ntfy.sh.</Step>
          <Step n={4}>Na iPhonu povolte ntfy notifikace v Nastavení.</Step>
        </ol>
        <SourceNote>Název kanálu je uložen jako tajný údaj v repozitáři ({GITHUB.owner}/{GITHUB.repo} → Settings → Secrets → NTFY_TOPIC). Kdo ho zná, může upozornění odebírat, proto ho nesdílejte veřejně.</SourceNote>
      </Card>

      <Card title="Zdroje dat">
        <ul className="space-y-2 text-sm">
          <li>
            <b>Předpověď, srovnání modelů, ensemble:</b> Open-Meteo (ECMWF, DWD ICON, NOAA GFS, Météo-France, UK Met Office) pro bod {num(LOCATION.latitude, 5)} N, {num(LOCATION.longitude, 5)} E.
          </li>
          <li>
            <b>Měření:</b> ČHMÚ, stanice {CHMI_STATION.name} ({CHMI_STATION.wsi}, {CHMI_STATION.elevation} m n. m., měří od {CHMI_STATION.since}), otevřená data opendata.chmi.cz.
          </li>
          <li>
            <b>Klimatická řada bez mezer:</b> reanalýza ERA5 (ECMWF / Copernicus) přes Open-Meteo.
          </li>
          <li>
            <b>Kvalita ovzduší a pyl:</b> Copernicus CAMS přes Open-Meteo.
          </li>
          <li>
            <b>Radar:</b> RainViewer. <b>Mapa:</b> Esri, © přispěvatelé OpenStreetMap.
          </li>
          <li>
            <b>Výstrahy:</b> ČHMÚ přes MeteoAlarm (EUMETNET). <b>Ikony:</b> Meteocons (Bas Milius, MIT).
          </li>
        </ul>
      </Card>

      <Card title="Stav dat">
        {meta.data ? (
          <table className="tabular w-full text-sm">
            <tbody>
              {META_LABELS.map(([k, label]) => {
                const v = meta.data[k]
                const t = v ? Date.parse(v) : null
                return (
                  <tr key={k} className="border-t border-[var(--divider)] first:border-0">
                    <td className="py-1">{label}</td>
                    <td className="py-1 text-right text-muted">{t ? `${formatDayMonth(t)} ${formatTime(t)} (${formatAgo(t, now)})` : '–'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted">{meta.isError ? 'Stav dat se nepodařilo načíst.' : 'Načítám…'}</p>
        )}
        <SourceNote>Data ČHMÚ a výstrahy obnovuje GitHub Actions každých 10 minut (plánovač GitHubu ale běhy občas vynechává).</SourceNote>
      </Card>

      <p className="px-2 text-center text-[11px] text-faint">
        Počasí Karviná · verze {__APP_VERSION__} · <a className="underline" href={`https://github.com/${GITHUB.owner}/${GITHUB.repo}`}>zdrojový kód</a>
      </p>
    </div>
  )
}
