// Graf „naměřeno → předpověď“: teplota (plná čára měření, čárkovaná předpověď napojená na měření),
// hodinové srážky (plné sloupce měření, světlé předpověď) a pruh pravděpodobnosti srážek.
// Odečet prstem vždy přeskočí na celou hodinu – teplota i srážky jsou pro tutéž hodinu (jako v hodinové předpovědi).

import { type PointerEvent, useEffect, useRef, useState } from 'react'
import { num } from '../../lib/format.ts'
import { formatPrecip, precipPhase } from '../../lib/snow.ts'
import type { Timeline, TimelineHour } from '../../lib/stationTimeline.ts'
import { formatTime, formatWeekdayShort, HOUR, localParts } from '../../lib/time.ts'
import type { ChartColors } from '../charts/chartTheme.ts'

const HEIGHT = 160
const L = 28 // místo na popisky teploty
const R = 26 // místo na měřítko srážek
const TOP = 16
const BOTTOM = 118 // spodek grafu
const STRIP_Y = 122 // pruh pravděpodobnosti
const STRIP_H = 6
const LABEL_Y = 146

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(340)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.max(200, el.clientWidth)))
    ro.observe(el)
    setW(Math.max(200, el.clientWidth))
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** Hezký krok osy teploty (1, 2, 5 °C …) pro 3–4 popisky */
function tempTicks(min: number, max: number): number[] {
  const span = Math.max(1, max - min)
  const step = [1, 2, 5, 10].find((s) => span / s <= 4) ?? 10
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v)
  return out
}

/** Cesta čáry; null přeruší čáru */
function path(points: [number, number | null][], x: (t: number) => number, y: (v: number) => number): string {
  let d = ''
  let pen = false
  for (const [t, v] of points) {
    if (v == null) {
      pen = false
      continue
    }
    d += `${pen ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`
    pen = true
  }
  return d
}

const srcWord = (s: TimelineHour['tempSrc']) => (s === 'measured' ? 'naměřeno' : s === 'forecast' ? 'předpověď' : '')

export function TimelineChart({ tl, c, label = 'Teplota a srážky za posledních 24 hodin a předpověď na 24 hodin' }: { tl: Timeline; c: ChartColors; label?: string }) {
  const [ref, W] = useWidth()
  const [sel, setSel] = useState<number | null>(null)
  const { from, to, now, hours } = tl
  const x = (t: number) => L + ((t - from) / (to - from)) * (W - L - R)

  const temps = [...tl.measured.map(([, v]) => v), ...tl.forecast.map(([, v]) => v)].filter((v): v is number => v != null)
  const tMin = temps.length ? Math.floor(Math.min(...temps) - 0.5) : 0
  const tMax = temps.length ? Math.ceil(Math.max(...temps) + 0.5) : 10
  const y = (v: number) => TOP + ((tMax - v) / (tMax - tMin)) * (BOTTOM - TOP)

  const maxMm = Math.max(0, ...hours.map((h) => h.mm ?? 0))
  // Sníh má vlastní barvu; výška sloupce je vždy voda (mm), aby šly hodiny porovnat
  const isSnowy = (h: TimelineHour) => h.mm != null && h.mm > 0 && precipPhase(h.mm, h.snowCm) !== 'rain'
  const barColor = (h: TimelineHour) => (h.mm != null && precipPhase(h.mm, h.snowCm) === 'snow' ? c.snow : h.mm != null && isSnowy(h) ? `url(#mix)` : c.rain)
  const anySnow = hours.some(isSnowy)
  const mmScale = maxMm <= 1 ? 1 : Math.ceil(maxMm)
  const barMaxH = (BOTTOM - TOP) * 0.55
  const barH = (mm: number) => (mm / mmScale) * barMaxH

  const pick = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const t = from + ((e.clientX - r.left - L) / (W - L - R)) * (to - from)
    setSel(Math.min(hours.length - 1, Math.max(0, Math.round((t - from) / HOUR))))
  }

  const midnights = hours.filter((h) => localParts(h.t).hour === 0)
  const labels = hours.filter((h) => localParts(h.t).hour % 6 === 0)
  const s = sel != null ? hours[sel] : null
  // Teplota i srážky ze stejného zdroje → jeden štítek v prvním řádku, jinak u každé hodnoty zvlášť
  const same = !s || !s.tempSrc || !s.mmSrc || s.tempSrc === s.mmSrc
  const nowX = x(now)
  // „Teď“ jen když leží v grafu (detail zítřka apod. je celý předpověď)
  const nowIn = now >= from && now <= to
  const hasMeasured = tl.measured.some(([, v]) => v != null)

  return (
    <div>
      {/* Odečet: pevná výška tří řádků (u sněhu a v úzkém detailu dne se řádky zalamují), graf při tažení neposkakuje */}
      <div className="tabular mb-1 h-12 overflow-hidden text-[11px] leading-4" aria-live="polite">
        {s ? (
          <>
            <div className="font-semibold">
              {formatWeekdayShort(s.t)} {formatTime(s.t)}
              {same && (s.tempSrc ?? s.mmSrc) && <span className="font-normal text-muted"> · {srcWord(s.tempSrc ?? s.mmSrc)}</span>}
            </div>
            <div>
              <span style={{ color: c.warm }}>{s.temp != null ? `${num(s.temp, 1)} °C` : 'teplota –'}</span>
              {s.tempSrc === 'forecast' && s.modelTemp != null && Math.abs(s.modelTemp - s.temp!) >= 0.3 && (
                <span className="text-muted"> (model {num(s.modelTemp, 1)})</span>
              )}
              {!same && <span className="text-muted"> {srcWord(s.tempSrc)}</span>}
              <span className="text-muted"> · </span>
              <span style={{ color: isSnowy(s) ? c.snow : c.rain }}>
                {formatTime(s.t).slice(0, 2)}–{formatTime(s.t + HOUR).slice(0, 2)} h:{' '}
                {s.mm != null ? formatPrecip(s.mm, s.snowCm, { water: true, approx: s.mmSrc === 'measured' }) : '–'}
              </span>
              {s.prob != null && <span style={{ color: c.rain }}> · {num(s.prob, 0)} %</span>}
              {!same && <span className="text-muted"> {srcWord(s.mmSrc)}</span>}
            </div>
          </>
        ) : (
          <>
            <div className="text-faint">Táhněte prstem po grafu – ukáže hodnoty pro celou hodinu</div>
            <div className="text-faint">
              {tl.offset != null && Math.abs(tl.offset) >= 0.3
                ? `Předpověď navazuje na měření (model se liší o ${num(Math.abs(tl.offset), 1)} °C, rozdíl do 6 h vymizí)`
                : hasMeasured
                  ? 'Vlevo od „teď“ měření, vpravo předpověď'
                  : 'Předpověď po hodinách'}
            </div>
          </>
        )}
      </div>
      <div
        ref={ref}
        style={{ touchAction: 'pan-y', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
        onPointerDown={pick}
        onPointerMove={(e) => (e.pointerType === 'mouse' || e.buttons) && pick(e)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setSel(null)}
      >
        <svg width={W} height={HEIGHT} role="img" aria-label={label} className="block">
          <defs>
            {/* Déšť se sněhem: dolní polovina déšť, horní sníh */}
            <linearGradient id="mix" x1="0" x2="0" y1="1" y2="0">
              <stop offset="50%" stopColor={c.rain} />
              <stop offset="50%" stopColor={c.snow} />
            </linearGradient>
          </defs>
          {/* Oblast předpovědi */}
          {nowIn && <rect x={nowX} y={TOP - 4} width={Math.max(0, x(to) - nowX)} height={STRIP_Y + STRIP_H - TOP + 4} fill={c.text} opacity={0.04} />}
          {/* Mřížka a popisky teploty */}
          {tempTicks(tMin, tMax).map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={c.grid} />
              <text x={L - 4} y={y(v) + 3} textAnchor="end" fontSize={10} fill={c.muted}>
                {num(v, 0)}°
              </text>
            </g>
          ))}
          {/* Měřítko srážek vpravo */}
          <line x1={L} x2={W - R} y1={BOTTOM - barMaxH} y2={BOTTOM - barMaxH} stroke={c.rain} strokeOpacity={0.35} strokeDasharray="2 3" />
          <text x={W - R + 3} y={BOTTOM - barMaxH + 3} fontSize={9} fill={c.rain}>
            {num(mmScale, 0)} mm
          </text>
          {/* Půlnoci */}
          {midnights.map((h) => (
            <g key={h.t}>
              <line x1={x(h.t)} x2={x(h.t)} y1={TOP - 4} y2={STRIP_Y + STRIP_H} stroke={c.muted} strokeOpacity={0.35} strokeDasharray="2 3" />
              <text x={x(h.t) + 3} y={TOP - 6} fontSize={9} fill={c.muted}>
                {formatWeekdayShort(h.t)}
              </text>
            </g>
          ))}
          {/* Srážky */}
          {hours.map((h, i) =>
            h.mm != null && h.mm > 0 && i < hours.length - 1 ? (
              <rect
                key={h.t}
                x={x(h.t) + 0.75}
                width={Math.max(1, x(h.t + HOUR) - x(h.t) - 1.5)}
                y={BOTTOM - Math.max(1.5, barH(h.mm))}
                height={Math.max(1.5, barH(h.mm))}
                rx={1.5}
                fill={barColor(h)}
                opacity={sel === i ? 1 : h.mmSrc === 'measured' ? 0.85 : 0.38}
              />
            ) : null,
          )}
          {/* Pravděpodobnost srážek */}
          {hours.map((h, i) =>
            h.prob != null && i < hours.length - 1 ? (
              <rect key={h.t} x={x(h.t)} width={x(h.t + HOUR) - x(h.t)} y={STRIP_Y} height={STRIP_H} fill={c.rain} opacity={Math.max(0.04, (h.prob / 100) * 0.9)} />
            ) : null,
          )}
          <line x1={L} x2={W - R} y1={BOTTOM} y2={BOTTOM} stroke={c.grid} />
          {/* Teplota */}
          <path d={path(tl.measured, x, y)} fill="none" stroke={c.warm} strokeWidth={2} strokeLinejoin="round" />
          <path d={path(tl.forecast, x, y)} fill="none" stroke={c.warm} strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" opacity={0.9} />
          {/* Teď */}
          {nowIn && (
            <>
              <line x1={nowX} x2={nowX} y1={TOP - 4} y2={STRIP_Y + STRIP_H} stroke={c.text} strokeOpacity={0.5} />
              <text x={nowX} y={STRIP_Y + STRIP_H + 10} textAnchor="middle" fontSize={9} fontWeight={600} fill={c.text}>
                teď
              </text>
            </>
          )}
          {/* Časová osa */}
          {labels.map((h) =>
            !nowIn || Math.abs(x(h.t) - nowX) > 16 ? (
              <text key={h.t} x={x(h.t)} y={LABEL_Y} textAnchor="middle" fontSize={10} fill={c.muted}>
                {formatTime(h.t)}
              </text>
            ) : null,
          )}
          {/* Výběr */}
          {s && (
            <g pointerEvents="none">
              <line x1={x(s.t)} x2={x(s.t)} y1={TOP - 4} y2={STRIP_Y + STRIP_H} stroke={c.text} strokeOpacity={0.6} strokeDasharray="3 2" />
              {sel! < hours.length - 1 && (
                <rect
                  x={x(s.t)}
                  width={x(s.t + HOUR) - x(s.t)}
                  y={TOP - 4}
                  height={STRIP_Y + STRIP_H - TOP + 4}
                  fill={c.rain}
                  opacity={0.08}
                />
              )}
              {s.temp != null && <circle cx={x(s.t)} cy={y(s.temp)} r={4} fill={c.warm} stroke={c.tooltipBg} strokeWidth={1.5} />}
            </g>
          )}
        </svg>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted">
        {hasMeasured && (
          <span className="flex items-center gap-1">
            <svg width="16" height="6" aria-hidden="true">
              <line x1="0" x2="16" y1="3" y2="3" stroke={c.warm} strokeWidth="2" />
            </svg>
            naměřeno
          </span>
        )}
        <span className="flex items-center gap-1">
          <svg width="16" height="6" aria-hidden="true">
            <line x1="0" x2="16" y1="3" y2="3" stroke={c.warm} strokeWidth="2" strokeDasharray="4 3" />
          </svg>
          předpověď
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-1.5 rounded-sm" style={{ background: c.rain, opacity: 0.85 }} />
          <span className="inline-block h-2 w-1.5 rounded-sm" style={{ background: c.rain, opacity: 0.38 }} />
          srážky za hodinu
        </span>
        {anySnow && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-1.5 rounded-sm" style={{ background: c.snow }} />
            sníh
          </span>
        )}
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-4 rounded-sm" style={{ background: `linear-gradient(90deg, transparent, ${c.rain})` }} />
          pravděpodobnost srážek
        </span>
      </div>
    </div>
  )
}
