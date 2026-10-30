// Radar srážek ve stylu Windy: tmavá mapa, vlastní paleta, jedna časová osa
// – minulost: skutečný radar RainViewer (dlaždice přebarvené z hodnot dBZ),
// – budoucnost: předpověď srážek modelu z mřížky bodů Open-Meteo (stejná paleta).

import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RadarData } from '../api/dataBranch.ts'
import { Card, ErrorCard, LoadingCard, SourceNote } from '../components/ui.tsx'
import { CHMI_STATION, LOCATION } from '../config.ts'
import { num } from '../lib/format.ts'
import { gridBounds, type PrecipGrid, renderGridFrame } from '../lib/precipGrid.ts'
import { LEGEND_DBZ_RANGE, LEGEND_MMH, legendGradient, mmhToDbz, recolorRainViewer } from '../lib/radarPalette.ts'
import { formatAgo, formatMoment, formatTime, HOUR, MINUTE } from '../lib/time.ts'
import { useNow } from '../state/derived.ts'
import { useForecast, usePrecipGrid, useRadar } from '../state/queries.ts'

/** RainViewer poskytuje dlaždice jen do zoomu 7 (vyšší vrací „Zoom Level Not Supported“) */
const RADAR_MAX_NATIVE_ZOOM = 7
const FORECAST_HOURS = 12
const FORECAST_STEP = 30 * MINUTE

type Frame = { kind: 'radar'; time: number; path: string } | { kind: 'model'; time: number; index: number }

/** Dlaždice RainViewer přebarvené paletou Windy (barva → dBZ → nová barva) */
class RadarTiles extends L.GridLayer {
  url: string

  constructor(url: string, options: L.GridLayerOptions) {
    super(options)
    this.url = url
  }

  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const tile = document.createElement('canvas')
    tile.width = tile.height = 256
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const ctx = tile.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(img, 0, 0)
        const data = ctx.getImageData(0, 0, 256, 256)
        recolorRainViewer(data.data)
        ctx.putImageData(data, 0, 0)
        done(undefined, tile)
      } catch (e) {
        done(e as Error, tile)
      }
    }
    img.onerror = () => done(new Error('Radarová dlaždice nedostupná'), tile)
    // 0_1 = bez vyhlazení (přesné barvy pro převod na dBZ), se sněhem
    img.src = this.url.replace('{z}', String(coords.z)).replace('{x}', String(coords.x)).replace('{y}', String(coords.y))
    return tile
  }
}

function gridFrameUrl(grid: PrecipGrid, index: number): string {
  const { width, height, data } = renderGridFrame(grid, index, 24)
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  c.getContext('2d')!.putImageData(new ImageData(data, width, height), 0, 0)
  return c.toDataURL('image/png')
}

function buildFrames(radar: RadarData | undefined, grid: PrecipGrid | undefined, now: number): Frame[] {
  const frames: Frame[] = (radar?.frames ?? []).map((f) => ({ kind: 'radar', time: f.time, path: f.path }))
  const lastRadar = frames.length ? frames[frames.length - 1].time : now
  if (grid) {
    grid.times.forEach((t, index) => {
      if (t > lastRadar && t <= now + FORECAST_HOURS * HOUR && t % FORECAST_STEP === 0) frames.push({ kind: 'model', time: t, index })
    })
  }
  return frames
}

function RadarMap({ radar, grid }: { radar: RadarData | undefined; grid: PrecipGrid | undefined }) {
  const now = useNow(60_000)
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layers = useRef(new Map<string, L.Layer & { setOpacity: (o: number) => unknown }>())
  const areaRect = useRef<L.Rectangle | null>(null)
  const frames = useMemo(() => buildFrames(radar, grid, now), [radar, grid, now])
  const nowIndex = useMemo(() => {
    let i = -1
    frames.forEach((f, k) => f.kind === 'radar' && (i = k))
    return Math.max(0, i)
  }, [frames])
  const [frame, setFrame] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const current = Math.min(frame ?? nowIndex, frames.length - 1)

  // Mapa – vždy tmavá jako ve Windy
  useEffect(() => {
    if (!box.current) return
    const m = L.map(box.current, { center: [LOCATION.latitude, LOCATION.longitude], zoom: 7, minZoom: 5, maxZoom: 10, zoomControl: false })
    L.control.zoom({ position: 'topright' }).addTo(m)
    const esri = (kind: 'Base' | 'Reference') => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_${kind}/MapServer/tile/{z}/{y}/{x}`
    L.tileLayer(esri('Base'), { attribution: 'Podklad © Esri, HERE, Garmin, © OpenStreetMap', maxZoom: 16 }).addTo(m)
    m.createPane('labels')
    const labels = m.getPane('labels')!
    labels.style.zIndex = '650'
    labels.style.pointerEvents = 'none'
    L.tileLayer(esri('Reference'), { pane: 'labels', maxZoom: 16 }).addTo(m)
    L.circleMarker([LOCATION.latitude, LOCATION.longitude], { radius: 6, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1, pane: 'labels' })
      .addTo(m)
      .bindTooltip(LOCATION.name)
    L.circleMarker([CHMI_STATION.latitude, CHMI_STATION.longitude], { radius: 4, color: '#fff', weight: 1.5, fillColor: '#f59e0b', fillOpacity: 1, pane: 'labels' })
      .addTo(m)
      .bindTooltip(`Stanice ČHMÚ ${CHMI_STATION.name}`)
    map.current = m
    const store = layers.current
    return () => {
      m.remove()
      map.current = null
      store.clear()
      areaRect.current = null
    }
  }, [])

  // Při nových datech zahodit vrstvy, které už na ose nejsou
  useEffect(() => {
    const keep = new Set(frames.map((f) => (f.kind === 'radar' ? `r:${f.path}` : `m:${f.time}:${grid?.times[0]}`)))
    for (const [k, l] of layers.current) {
      if (!keep.has(k)) {
        l.remove()
        layers.current.delete(k)
      }
    }
  }, [frames, grid])

  // Zobrazení aktuálního snímku; vrstvy se vytvářejí až při prvním zobrazení a další snímek se načte dopředu
  useEffect(() => {
    const m = map.current
    if (!m || !frames.length) return
    const ensure = (f: Frame) => {
      const key = f.kind === 'radar' ? `r:${f.path}` : `m:${f.time}:${grid?.times[0]}`
      let l = layers.current.get(key)
      if (!l) {
        if (f.kind === 'radar') {
          l = new RadarTiles(`${radar!.host}${f.path}/256/{z}/{x}/{y}/2/0_1.png`, {
            maxNativeZoom: RADAR_MAX_NATIVE_ZOOM,
            maxZoom: 10,
            opacity: 0,
            zIndex: 10,
            attribution: '<a href="https://www.rainviewer.com/">RainViewer</a>',
          })
        } else {
          l = L.imageOverlay(gridFrameUrl(grid!, f.index), gridBounds(grid!), { opacity: 0, zIndex: 10, attribution: 'Předpověď Open-Meteo' })
        }
        l.addTo(m)
        layers.current.set(key, l)
      }
      return key
    }
    const curKey = ensure(frames[current])
    if (current + 1 < frames.length) ensure(frames[current + 1])
    for (const [k, l] of layers.current) l.setOpacity(k === curKey ? 0.9 : 0)

    // Obrys oblasti modelové předpovědi
    if (frames[current].kind === 'model' && grid) {
      areaRect.current ??= L.rectangle(gridBounds(grid), { color: '#ffffff', weight: 1, opacity: 0.35, dashArray: '4 6', fill: false, interactive: false }).addTo(m)
    } else {
      areaRect.current?.remove()
      areaRect.current = null
    }
  }, [current, frames, radar, grid])

  useEffect(() => {
    if (!playing || frames.length < 2) return
    const id = setInterval(() => setFrame((f) => ((f ?? nowIndex) + 1) % frames.length), 550)
    return () => clearInterval(id)
  }, [playing, frames.length, nowIndex])

  if (!frames.length) return null
  const f = frames[current]
  const firstModel = frames.findIndex((x) => x.kind === 'model')
  const radarShare = firstModel === -1 ? 100 : (firstModel / Math.max(1, frames.length - 1)) * 100

  return (
    <div>
      <div className="relative">
        <div ref={box} className="h-[58vh] min-h-[340px] w-full overflow-hidden rounded-2xl bg-[#1d1f22]" />
        {/* Štítek času jako ve Windy */}
        <div className="pointer-events-none absolute top-3 left-3 z-[700] rounded-xl bg-black/60 px-3 py-1.5 text-white backdrop-blur">
          <div className="text-[10px] font-semibold tracking-wider uppercase opacity-80">{f.kind === 'radar' ? 'Radar · skutečnost' : 'Předpověď modelu'}</div>
          <div className="tabular text-lg leading-tight font-semibold">{formatMoment(f.time, now)}</div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow active:scale-95"
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
          {/* Pruh časové osy: radar (plná) a předpověď (šrafovaná) – zarovnaný s posuvníkem */}
          <div className="mx-[8px] flex h-1.5 overflow-hidden rounded-full">
            <div className="h-full bg-sky-400/70" style={{ width: `${radarShare}%` }} />
            <div className="h-full flex-1" style={{ background: 'repeating-linear-gradient(90deg, rgba(167,139,250,.75) 0 6px, rgba(167,139,250,.25) 6px 10px)' }} />
          </div>
          <input
            type="range"
            min={0}
            max={frames.length - 1}
            value={current}
            onChange={(e) => {
              setPlaying(false)
              setFrame(Number(e.target.value))
            }}
            className="w-full accent-[var(--accent)]"
            aria-label="Čas snímku"
          />
          <div className="flex justify-between text-[10px] text-faint">
            <span>
              {formatTime(frames[0].time)} <span className="text-sky-500">radar</span>
            </span>
            <button type="button" className="font-semibold text-[var(--accent)]" onClick={() => (setPlaying(false), setFrame(nowIndex))}>
              Teď
            </button>
            <span>
              <span className="text-violet-400">předpověď</span> +{Math.round((frames[frames.length - 1].time - now) / HOUR)} h
            </span>
          </div>
        </div>
      </div>

      <Legend />
    </div>
  )
}

function Legend() {
  const { min, max } = LEGEND_DBZ_RANGE
  const pos = (mmh: number) => ((mmhToDbz(mmh) - min) / (max - min)) * 100
  return (
    <div className="mt-3 space-y-1.5">
      <div className="relative h-3 rounded-full" style={{ background: legendGradient() }} />
      <div className="relative h-3 text-[10px] text-muted">
        {LEGEND_MMH.map((v) => (
          <span key={v} className="absolute -translate-x-1/2" style={{ left: `${Math.min(97, Math.max(3, pos(v)))}%` }}>
            {num(v, v < 1 ? 1 : 0)}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2 text-[10px] text-muted">
        <span>mm/h · déšť</span>
        <span className="ml-auto">sníh</span>
        <div className="h-2 w-20 rounded-full" style={{ background: legendGradient(true) }} />
      </div>
    </div>
  )
}

/** Shrnutí z modelové mřížky: kdy a jak silně bude pršet v okolí (≤ ~25 km) */
function nearbySummary(grid: PrecipGrid, now: number): string {
  const cy = Math.floor(grid.lats.length / 2)
  const cx = Math.floor(grid.lons.length / 2)
  let first: number | null = null
  let peak = 0
  grid.times.forEach((t, k) => {
    if (t <= now || t > now + FORECAST_HOURS * HOUR) return
    let m = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m = Math.max(m, grid.rate[k][cy + dy]?.[cx + dx] ?? 0)
    if (m >= 0.1 && first === null) first = t - 15 * MINUTE
    peak = Math.max(peak, m)
  })
  if (first === null) return `V okolí Karviné se v příštích ${FORECAST_HOURS} hodinách srážky nečekají.`
  return `V okolí Karviné začne podle modelu pršet ${formatMoment(first, now)}, nejvyšší intenzita asi ${num(peak, 1)} mm/h.`
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
  const g = usePrecipGrid()
  const lastRadar = q.data?.frames.at(-1)?.time
  return (
    <div className="space-y-3 pb-4">
      {q.isError && !q.data && g.isError && !g.data ? (
        <ErrorCard title="Radar srážek" error={q.error} onRetry={() => (q.refetch(), g.refetch())} />
      ) : !q.data && !g.data ? (
        <LoadingCard title="Radar srážek" lines={8} />
      ) : (
        <Card
          title="Radar a předpověď srážek"
          subtitle={`${lastRadar ? `Radar do ${formatTime(lastRadar)} (${formatAgo(lastRadar, now)})` : 'Radar nedostupný'}${g.data ? `, předpověď na ${FORECAST_HOURS} h` : ''}`}
        >
          <RadarMap radar={q.data} grid={g.data} />
          {g.data && <p className="mt-3 text-sm">{nearbySummary(g.data, now)}</p>}
          {q.isError && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Radar se nepodařilo načíst – zobrazuji jen předpověď.</p>}
          {g.isError && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Předpověď srážek se nepodařilo načíst – zobrazuji jen radar.</p>}
          <SourceNote>
            Plná část osy = skutečný radar (RainViewer, posledních ~2 h, detail do ≈ 1 km). Šrafovaná část = předpověď modelu Open-Meteo pro oblast ±130 km (čárkovaný obdélník),
            hrubší rozlišení (≈ 20 km). Barvy podle intenzity srážek jako ve Windy; slabé mrholení je modré, sníh bělavý.
          </SourceNote>
        </Card>
      )}
      <ModelOutlook />
    </div>
  )
}
