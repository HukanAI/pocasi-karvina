// Sloupcový graf srážek ovladatelný prstem: klepnutí nebo tažení po sloupcích ukáže čas, množství a intenzitu.
// Atribut title na telefonu nefunguje, proto vlastní odečet nad grafem.

import { type PointerEvent, useState } from 'react'
import { num } from '../lib/format.ts'
import { intensityWord, WET_MIN_MM } from '../lib/rain.ts'
import { formatTime, HOUR } from '../lib/time.ts'

export interface PrecipBar {
  /** Začátek a konec intervalu (ms) */
  start: number
  end: number
  mm: number
}

export function PrecipBars({ bars, values = false, height = 64 }: { bars: PrecipBar[]; values?: boolean; height?: number }) {
  const [sel, setSel] = useState<number | null>(null)
  if (!bars.length) return null
  const maxMm = Math.max(...bars.map((b) => b.mm))
  // Nad sloupci musí zbýt místo na popisky hodnot
  const scale = Math.max(0.5, maxMm * (values ? 1.35 : 1.05))
  const pick = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.floor(((e.clientX - r.left) / r.width) * bars.length)
    setSel(Math.min(bars.length - 1, Math.max(0, i)))
  }
  const b = sel != null ? bars[sel] : null
  return (
    <div>
      <div className="mb-1 h-4 text-[11px] leading-4" aria-live="polite">
        {b ? (
          <span className="tabular font-medium">
            {formatTime(b.start)}–{formatTime(b.end)} · {num(b.mm, 1)} mm · {intensityWord((b.mm * HOUR) / (b.end - b.start))}
          </span>
        ) : (
          <span className="text-faint">
            Klepněte na sloupec{maxMm >= WET_MIN_MM ? ` · nejvíc ${num(maxMm, 1)} mm` : ''}
          </span>
        )}
      </div>
      <div
        className="flex items-stretch gap-[2px]"
        style={{ height, touchAction: 'pan-y' }}
        onPointerDown={pick}
        onPointerMove={(e) => (e.pointerType === 'mouse' || e.buttons) && pick(e)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setSel(null)}
      >
        {bars.map((x, i) => {
          const wet = x.mm >= WET_MIN_MM
          const pct = Math.max(wet ? 8 : 2, (x.mm / scale) * 100)
          return (
            <button
              key={x.start}
              type="button"
              className="relative h-full flex-1 rounded-t-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              aria-label={`${formatTime(x.start)}–${formatTime(x.end)}: ${num(x.mm, 1)} mm`}
              onFocus={() => setSel(i)}
            >
              <span
                className="absolute inset-x-0 bottom-0 rounded-t-md bg-[var(--rain)] transition-opacity"
                style={{ height: `${pct}%`, opacity: sel === i ? 1 : wet ? (sel == null ? 0.9 : 0.6) : 0.25 }}
              />
              {values && wet && (
                <span className="tabular absolute inset-x-0 text-center text-[9px] font-medium text-muted" style={{ bottom: `calc(${pct}% + 1px)` }}>
                  {num(x.mm, 1)}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div className="tabular mt-1 flex justify-between text-[10px] text-faint">
        <span>{formatTime(bars[0].start)}</span>
        <span>{formatTime(bars[Math.floor(bars.length / 2)].start)}</span>
        <span>{formatTime(bars[bars.length - 1].end)}</span>
      </div>
    </div>
  )
}
