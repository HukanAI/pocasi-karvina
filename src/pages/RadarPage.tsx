// Radar srážek ve stylu Windy – jedna časová osa ze tří zdrojů ČHMÚ:
//   minulost:   radar ČHMÚ pseudoCAPPI 2 km (1 km, po 5 min) + RainViewer jako okolí mimo dosah ČHMÚ
//   +10–60 min: nowcasting ČHMÚ (COTREC – posun skutečných srážkových buněk)
//   +1–24 h:    model ČHMÚ ALADIN 2,3 km (hodinová intenzita srážek)
// Všechno se kreslí stejnou paletou podle intenzity (dBZ).

import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RadarData } from '../api/dataBranch.ts'
import { colorize, type FrameData, leafletBounds, loadFrame, maxDbzNear } from '../components/radar/frames.ts'
import { Card, ErrorCard, LoadingCard, SourceNote } from '../components/ui.tsx'
import { CHMI_STATION, LOCATION } from '../config.ts'
import { num } from '../lib/format.ts'
import { CHMI_DATA_BOUNDS, type GeoBounds, mercY, type RadarIndex } from '../lib/radarData.ts'
import { dbzToMmh, LEGEND_DBZ_RANGE, LEGEND_MMH, legendGradient, mmhToDbz, recolorRainViewer } from '../lib/radarPalette.ts'
import { formatAgo, formatMoment, formatTime, HOUR, MINUTE } from '../lib/time.ts'
import { useNow } from '../state/derived.ts'
import { useForecast, useRadar, useRadarIndex } from '../state/queries.ts'

/** RainViewer poskytuje dlaždice jen do zoomu 7 (vyšší vrací „Zoom Level Not Supported“) */
const RV_MAX_NATIVE_ZOOM = 7
const MODEL_HOURS = 24
const OPACITY = 0.85

type Kind = 'obs' | 'rv' | 'nowcast' | 'model'
interface Frame {
  kind: Kind
  time: number
  /** Soubor v data větvi (obs, nowcast, model) nebo cesta RainViewer (rv) */
  src: string
  bounds?: GeoBounds
}

const KIND_INFO: Record<Kind, { label: string; color: string }> = {
  obs: { label: 'Radar ČHMÚ · skutečnost', color: '#38bdf8' },
  rv: { label: 'Radar · skutečnost', color: '#38bdf8' },
  nowcast: { label: 'Nowcasting ČHMÚ', color: '#2dd4bf' },
  model: { label: 'Předpověď modelu ALADIN', color: '#a78bfa' },
}

function buildFrames(idx: RadarIndex | undefined, rv: RadarData | undefined, now: number): Frame[] {
  const frames: Frame[] = []
  if (idx?.obs?.frames.length) {
    for (const f of idx.obs.frames) frames.push({ kind: 'obs', time: f.t, src: f.file, bounds: idx.obs.bounds })
  } else if (rv) {
    for (const f of rv.frames) frames.push({ kind: 'rv', time: f.time, src: f.path })
  }
  let last = frames.length ? frames[frames.length - 1].time : now - 5 * MINUTE
  if (idx?.nowcast) {
    for (const f of idx.nowcast.frames) if (f.t > last) frames.push({ kind: 'nowcast', time: f.t, src: f.file, bounds: idx.nowcast.bounds })
    last = frames[frames.length - 1]?.time ?? last
  }
  if (idx?.model) {
    for (const f of idx.model.frames) if (f.t > last + 20 * MINUTE && f.t <= now + MODEL_HOURS * HOUR) frames.push({ kind: 'model', time: f.t, src: f.file, bounds: idx.model.bounds })
  }
  return frames
}

const worldPx = (z: number) => 256 * 2 ** z
const tileX = (lon: number, z: number) => ((lon + 180) / 360) * worldPx(z)
const tileY = (lat: number, z: number) => ((1 - mercY(lat) / Math.PI) / 2) * worldPx(z)

/** Dlaždice RainViewer přebarvené stejnou paletou; volitelně s vyříznutou oblastí, kterou pokrývá radar ČHMÚ */
class RainViewerTiles extends L.GridLayer {
  url: string
  mask: GeoBounds | null

  constructor(url: string, mask: GeoBounds | null, options: L.GridLayerOptions) {
    super(options)
    this.url = url
    this.mask = mask
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
        if (this.mask) {
          const x0 = tileX(this.mask.west, coords.z) - coords.x * 256
          const x1 = tileX(this.mask.east, coords.z) - coords.x * 256
          const y0 = tileY(this.mask.north, coords.z) - coords.y * 256
          const y1 = tileY(this.mask.south, coords.z) - coords.y * 256
          ctx.clearRect(x0, y0, x1 - x0, y1 - y0)
        }
        done(undefined, tile)
      } catch (e) {
        done(e as Error, tile)
      }
    }
    img.onerror = () => done(new Error('Radarová dlaždice nedostupná'), tile)
    img.src = this.url.replace('{z}', String(coords.z)).replace('{x}', String(coords.x)).replace('{y}', String(coords.y))
    return tile
  }
}

type OpacityLayer = L.Layer & { setOpacity: (o: number) => unknown }

function RadarMap({ frames, rv }: { frames: Frame[]; rv: RadarData | undefined }) {
  const now = useNow(60_000)
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layers = useRef(new Map<string, OpacityLayer>())
  const nowIndex = useMemo(() => {
    let i = 0
    frames.forEach((f, k) => (f.kind === 'obs' || f.kind === 'rv') && (i = k))
    return i
  }, [frames])
  const [frame, setFrame] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const current = Math.min(frame ?? nowIndex, frames.length - 1)

  useEffect(() => {
    if (!box.current) return
    const m = L.map(box.current, { center: [LOCATION.latitude, LOCATION.longitude], zoom: 8, minZoom: 5, maxZoom: 11, zoomControl: false })
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
    }
  }, [])

  // Vrstvy, které už na ose nejsou, odstranit
  useEffect(() => {
    const keep = new Set(frames.flatMap((f) => [`${f.kind}:${f.src}`, `ctx:${f.time}`]))
    for (const [k, l] of layers.current) {
      if (!keep.has(k)) {
        l.remove()
        layers.current.delete(k)
      }
    }
  }, [frames])

  // Aktuální snímek (vrstvy se tvoří až při prvním zobrazení, další snímek se načte dopředu)
  useEffect(() => {
    const m = map.current
    if (!m || !frames.length) return
    let cancelled = false
    const ensure = (f: Frame): string => {
      const key = `${f.kind}:${f.src}`
      if (layers.current.has(key)) return key
      if (f.kind === 'rv') {
        const l = new RainViewerTiles(`${rv!.host}${f.src}/256/{z}/{x}/{y}/2/0_1.png`, null, { maxNativeZoom: RV_MAX_NATIVE_ZOOM, maxZoom: 11, opacity: 0, zIndex: 10 })
        l.addTo(m)
        layers.current.set(key, l)
      } else {
        // Obrázek se doplní po načtení; do té doby průhledný zástupce
        const overlay = L.imageOverlay('data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', leafletBounds(f.bounds!), { opacity: 0, zIndex: 10 })
        overlay.addTo(m)
        layers.current.set(key, overlay)
        loadFrame(f.src)
          .then((d) => overlay.setUrl(colorize(d)))
          .catch(() => {})
      }
      return key
    }
    // RainViewer jako okolí mimo dosah ČHMÚ (jen u skutečných radarových snímků)
    const ensureContext = (f: Frame): string | null => {
      if (f.kind !== 'obs' || !rv?.frames.length) return null
      const near = rv.frames.reduce((a, b) => (Math.abs(b.time - f.time) < Math.abs(a.time - f.time) ? b : a))
      if (Math.abs(near.time - f.time) > 10 * MINUTE) return null
      const key = `ctx:${f.time}`
      if (!layers.current.has(key)) {
        const l = new RainViewerTiles(`${rv.host}${near.path}/256/{z}/{x}/{y}/2/0_1.png`, CHMI_DATA_BOUNDS, {
          maxNativeZoom: RV_MAX_NATIVE_ZOOM,
          maxZoom: 11,
          opacity: 0,
          zIndex: 9,
        })
        l.addTo(m)
        layers.current.set(key, l)
      }
      return key
    }
    const cur = frames[current]
    const visible = new Set([ensure(cur), ensureContext(cur)])
    if (current + 1 < frames.length) {
      ensure(frames[current + 1])
      ensureContext(frames[current + 1])
    }
    if (!cancelled) for (const [k, l] of layers.current) l.setOpacity(visible.has(k) ? OPACITY : 0)
    return () => {
      cancelled = true
    }
  }, [current, frames, rv])

  useEffect(() => {
    if (!playing || frames.length < 2) return
    const id = setInterval(() => setFrame((f) => ((f ?? nowIndex) + 1) % frames.length), 450)
    return () => clearInterval(id)
  }, [playing, frames.length, nowIndex])

  const f = frames[current]
  const kinds = frames.map((x) => x.kind)
  const segments: { kind: Kind; share: number }[] = []
  kinds.forEach((k, i) => {
    if (i === kinds.length - 1) return
    const last = segments[segments.length - 1]
    if (last && last.kind === k) last.share++
    else segments.push({ kind: k, share: 1 })
  })
  const total = Math.max(1, kinds.length - 1)
  const ahead = f.time - now
  return (
    <div>
      <div className="relative -mx-4">
        {/* Pozadí v barvě podkladu: případné subpixelové mezery mezi dlaždicemi pak nejsou vidět (Leaflet jinak dává #ddd) */}
        <div ref={box} className="h-[60vh] min-h-[360px] w-full" style={{ background: "#474749" }} />
        <div className="pointer-events-none absolute top-3 left-3 z-[700] rounded-xl bg-black/65 px-3 py-1.5 text-white backdrop-blur">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider uppercase">
            <span className="h-2 w-2 rounded-full" style={{ background: KIND_INFO[f.kind].color }} />
            {KIND_INFO[f.kind].label}
          </div>
          <div className="tabular text-lg leading-tight font-semibold">{formatMoment(f.time, now)}</div>
          {ahead > 5 * MINUTE && <div className="text-[11px] opacity-80">za {ahead < HOUR ? `${Math.round(ahead / MINUTE)} min` : `${num(ahead / HOUR, ahead < 10 * HOUR ? 1 : 0)} h`}</div>}
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
        <div className="min-w-0 flex-1">
          <div className="mx-[8px] flex h-1.5 overflow-hidden rounded-full">
            {segments.map((s, i) => (
              <div key={i} className="h-full" style={{ width: `${(s.share / total) * 100}%`, background: KIND_INFO[s.kind].color, opacity: s.kind === 'model' ? 0.75 : 0.9 }} />
            ))}
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
          <div className="flex items-center justify-between text-[10px] text-faint">
            <span>{formatTime(frames[0].time)}</span>
            <button type="button" className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 font-semibold text-[var(--accent)]" onClick={() => (setPlaying(false), setFrame(nowIndex))}>
              Teď
            </button>
            <span>+{Math.round((frames[frames.length - 1].time - now) / HOUR)} h</span>
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
        {(['obs', 'nowcast', 'model'] as const)
          .filter((k) => kinds.includes(k) || (k === 'obs' && kinds.includes('rv')))
          .map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: KIND_INFO[k].color }} />
              {k === 'obs' ? 'radar (skutečnost)' : k === 'nowcast' ? 'nowcasting do 1 h' : 'model do 24 h'}
            </span>
          ))}
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
        <span>intenzita srážek v mm/h</span>
        <span className="ml-auto">sníh</span>
        <div className="h-2 w-20 rounded-full" style={{ background: legendGradient(true) }} />
      </div>
    </div>
  )
}

const intensityLabel = (dbz: number) => {
  const r = dbzToMmh(dbz)
  return r < 0.5 ? 'slabě' : r < 4 ? 'mírně' : r < 16 ? 'silně' : 'velmi silně'
}

/** Shrnutí pro okolí Karviné (do 10 km) z radaru, nowcastingu a modelu */
function useNearbySummary(frames: Frame[], now: number): string | null {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const relevant = frames.filter((f) => f.kind !== 'rv')
    if (!relevant.length) return
    Promise.all(relevant.map((f) => loadFrame(f.src).then((d): [Frame, FrameData] => [f, d]).catch(() => null))).then((rows) => {
      if (cancelled) return
      const at = rows.filter((r): r is [Frame, FrameData] => !!r).map(([f, d]) => ({ f, dbz: maxDbzNear(d, f.bounds!, LOCATION.latitude, LOCATION.longitude, 10) }))
      const lastObs = [...at].reverse().find((x) => x.f.kind === 'obs')
      const future = at.filter((x) => x.f.time > (lastObs?.f.time ?? now))
      const rainingNow = lastObs && lastObs.dbz != null && lastObs.dbz >= 10
      const firstRain = future.find((x) => x.dbz != null && x.dbz >= 10)
      const firstDry = future.find((x) => x.dbz == null || x.dbz < 10)
      const src = (k: Kind) => (k === 'nowcast' ? 'nowcastingu ČHMÚ' : 'modelu ALADIN')
      if (rainingNow) {
        setText(
          `V okolí Karviné teď ${intensityLabel(lastObs!.dbz!)} prší (radar ČHMÚ). ` +
            (firstDry ? `Podle ${src(firstDry.f.kind)} by mělo přestat ${formatMoment(firstDry.f.time, now)}.` : 'Podle předpovědi bude pršet i dalších 24 hodin.'),
        )
      } else if (firstRain) {
        setText(`V okolí Karviné teď neprší. Podle ${src(firstRain.f.kind)} začne ${intensityLabel(firstRain.dbz!)} pršet ${formatMoment(firstRain.f.time, now)}.`)
      } else {
        setText(`V okolí Karviné teď neprší a podle radaru ani modelu ALADIN se v příštích ${MODEL_HOURS} hodinách srážky nečekají.`)
      }
    })
    return () => {
      cancelled = true
    }
  }, [frames, now])
  return text
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
    <Card title="Srážky na 6 hodin přímo v Karviné" subtitle="Po 15 minutách (Open-Meteo)">
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
  const idx = useRadarIndex()
  const rv = useRadar()
  const frames = useMemo(() => buildFrames(idx.data, rv.data, now), [idx.data, rv.data, now])
  const summary = useNearbySummary(frames, now)
  const lastObs = [...frames].reverse().find((f) => f.kind === 'obs' || f.kind === 'rv')
  const loading = (idx.isLoading || rv.isLoading) && !frames.length
  return (
    <div className="space-y-3 pb-4">
      {loading ? (
        <LoadingCard title="Radar srážek" lines={8} />
      ) : !frames.length ? (
        <ErrorCard title="Radar srážek" error={idx.error ?? rv.error ?? 'Žádná data'} onRetry={() => (idx.refetch(), rv.refetch())} />
      ) : (
        <Card title="Radar a předpověď srážek" subtitle={lastObs ? `Poslední radarový snímek ${formatTime(lastObs.time)} (${formatAgo(lastObs.time, now)})` : 'Radar nedostupný – jen předpověď'}>
          <RadarMap frames={frames} rv={rv.data} />
          {summary && <p className="mt-3 rounded-2xl bg-black/5 px-3 py-2 text-sm dark:bg-white/5">{summary}</p>}
          <SourceNote>
            Skutečnost: radar ČHMÚ (rozlišení 1 km, nový snímek každých 5 min), mimo Česko RainViewer. Do hodiny dopředu nowcasting ČHMÚ – posouvá skutečné
            srážkové buňky podle jejich pohybu. Dál předpověď modelu ČHMÚ ALADIN (2,3 km), aktualizovaná 4× denně. Modrá tečka = Karviná, oranžová = stanice ČHMÚ.
          </SourceNote>
        </Card>
      )}
      <ModelOutlook />
    </div>
  )
}
