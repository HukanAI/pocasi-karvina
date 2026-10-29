// Radar srážek (RainViewer) nad mapou s animací posledních ~2 hodin + modelový výhled

import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RadarData } from '../api/dataBranch.ts'
import { Card, ErrorCard, LoadingCard, SourceNote } from '../components/ui.tsx'
import { CHMI_STATION, LOCATION } from '../config.ts'
import { num } from '../lib/format.ts'
import { formatAgo, formatTime, HOUR, MINUTE } from '../lib/time.ts'
import { useNow } from '../state/derived.ts'
import { useForecast, useRadar } from '../state/queries.ts'
import { useSettings } from '../state/useSettings.ts'

/** RainViewer poskytuje dlaždice jen do zoomu 7 (vyšší vrací „Zoom Level Not Supported“) */
const RADAR_MAX_NATIVE_ZOOM = 7

function RadarMap({ radar }: { radar: RadarData }) {
  const { dark } = useSettings()
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const base = useRef<L.TileLayer[]>([])
  const layers = useRef<L.TileLayer[]>([])
  const [frame, setFrame] = useState(radar.frames.length - 1)
  const [playing, setPlaying] = useState(false)
  const [opacity, setOpacity] = useState(0.75)

  // Mapa
  useEffect(() => {
    if (!box.current) return
    const m = L.map(box.current, { center: [LOCATION.latitude, LOCATION.longitude], zoom: 8, minZoom: 5, maxZoom: 11, zoomControl: false, attributionControl: true })
    L.control.zoom({ position: 'topright' }).addTo(m)
    const marker = L.circleMarker([LOCATION.latitude, LOCATION.longitude], { radius: 6, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 }).addTo(m)
    marker.bindTooltip(LOCATION.name, { permanent: false })
    L.circleMarker([CHMI_STATION.latitude, CHMI_STATION.longitude], { radius: 4, color: '#fff', weight: 1.5, fillColor: '#f59e0b', fillOpacity: 1 })
      .addTo(m)
      .bindTooltip(`Stanice ČHMÚ ${CHMI_STATION.name}`)
    // Popisky měst nad radarem
    m.createPane('labels')
    const labels = m.getPane('labels')!
    labels.style.zIndex = '650'
    labels.style.pointerEvents = 'none'
    map.current = m
    return () => {
      m.remove()
      map.current = null
      base.current = []
      layers.current = []
    }
  }, [])

  // Podkladová mapa podle motivu (Esri Gray Canvas – neutrální podklad pro překryvné vrstvy, bez API klíče)
  useEffect(() => {
    const m = map.current
    if (!m) return
    base.current.forEach((l) => l.remove())
    const variant = dark ? 'Dark' : 'Light'
    const url = (kind: 'Base' | 'Reference') =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${variant}_Gray_${kind}/MapServer/tile/{z}/{y}/{x}`
    const ground = L.tileLayer(url('Base'), {
      attribution: 'Podklad © Esri, HERE, Garmin, © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 16,
    }).addTo(m)
    ground.bringToBack()
    const labels = L.tileLayer(url('Reference'), { pane: 'labels', maxZoom: 16 }).addTo(m)
    base.current = [ground, labels]
  }, [dark])

  // Radarové vrstvy (předem načtené, přepíná se jen průhlednost → plynulá animace)
  useEffect(() => {
    const m = map.current
    if (!m) return
    layers.current.forEach((l) => l.remove())
    layers.current = radar.frames.map((f) =>
      L.tileLayer(`${radar.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, {
        opacity: 0,
        maxNativeZoom: RADAR_MAX_NATIVE_ZOOM,
        maxZoom: 11,
        attribution: '<a href="https://www.rainviewer.com/">RainViewer</a>',
        zIndex: 10,
      }).addTo(m),
    )
    setFrame(radar.frames.length - 1)
  }, [radar])

  useEffect(() => {
    layers.current.forEach((l, i) => l.setOpacity(i === frame ? opacity : 0))
  }, [frame, opacity, radar])

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setFrame((f) => (f + 1) % radar.frames.length), 700)
    return () => clearInterval(id)
  }, [playing, radar.frames.length])

  const f = radar.frames[frame]
  return (
    <div>
      <div ref={box} className="h-[52vh] min-h-[320px] w-full overflow-hidden rounded-2xl" />
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-white active:scale-95"
          aria-label={playing ? 'Zastavit animaci' : 'Přehrát animaci'}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <div className="flex-1">
          <input
            type="range"
            min={0}
            max={radar.frames.length - 1}
            value={frame}
            onChange={(e) => {
              setPlaying(false)
              setFrame(Number(e.target.value))
            }}
            className="w-full accent-[var(--accent)]"
            aria-label="Čas snímku"
          />
          <div className="flex justify-between text-[11px] text-faint">
            <span>{formatTime(radar.frames[0].time)}</span>
            <span className="tabular text-sm font-semibold text-[var(--fg)]">{f ? formatTime(f.time) : '–'}</span>
            <span>{formatTime(radar.frames[radar.frames.length - 1].time)}</span>
          </div>
        </div>
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs text-muted">
        Průhlednost radaru
        <input type="range" min={0.3} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" />
      </label>
      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted">
        <span>mrholení</span>
        <div className="h-2 flex-1 rounded-full" style={{ background: 'linear-gradient(90deg,#d6d0bf,#88ddee,#0099cc,#0077aa,#ffee00,#ffaa00,#ff4400,#c10000,#ffaaff)' }} />
        <span>extrémní</span>
      </div>
    </div>
  )
}

function ModelOutlook() {
  const now = useNow(60_000)
  const f = useForecast()
  const items = useMemo(() => {
    if (!f.data) return []
    const m = f.data.minutely15
    return m.time.map((t, i) => ({ t, mm: m.precipitation[i] ?? 0 })).filter((x) => x.t > now && x.t <= now + 6 * HOUR)
  }, [f.data, now])
  if (!items.length) return null
  const maxV = Math.max(0.5, ...items.map((x) => x.mm))
  const total = items.reduce((s, x) => s + x.mm, 0)
  return (
    <Card title="Výhled srážek na 6 hodin" subtitle="Model po 15 minutách pro váš bod">
      <div className="flex h-20 items-end gap-[2px]">
        {items.map((x) => (
          <div
            key={x.t}
            className="flex-1 rounded-t-sm bg-[var(--rain)]"
            style={{ height: `${Math.max(x.mm >= 0.1 ? 6 : 1, (x.mm / maxV) * 100)}%`, opacity: x.mm >= 0.1 ? 0.9 : 0.2 }}
            title={`${formatTime(x.t - 15 * MINUTE)}–${formatTime(x.t)}: ${num(x.mm, 1)} mm`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-faint">
        <span>{formatTime(items[0].t - 15 * MINUTE)}</span>
        <span>+3 h</span>
        <span>{formatTime(items[items.length - 1].t)}</span>
      </div>
      <p className="mt-2 text-sm">{total < 0.1 ? 'V příštích 6 hodinách bez srážek.' : `Celkem asi ${num(total, 1)} mm za 6 hodin.`}</p>
    </Card>
  )
}

export default function RadarPage() {
  const now = useNow(60_000)
  const q = useRadar()
  return (
    <div className="space-y-3 pb-4">
      {q.isError && !q.data ? (
        <ErrorCard title="Radar srážek" error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <LoadingCard title="Radar srážek" lines={8} />
      ) : (
        <Card title="Radar srážek" subtitle={`Posledních ${Math.round((q.data.frames.at(-1)!.time - q.data.frames[0].time) / 60_000)} min · poslední snímek ${formatAgo(q.data.frames.at(-1)!.time, now)}`}>
          <RadarMap radar={q.data} />
          <SourceNote>
            Radarová data: RainViewer (kompozit evropských radarů). Detail je omezen na úroveň přiblížení 7 (≈ 1 km), při větším přiblížení se obraz jen zvětšuje. Modrá tečka = váš bod, oranžová = stanice ČHMÚ.
          </SourceNote>
        </Card>
      )}
      <ModelOutlook />
    </div>
  )
}
