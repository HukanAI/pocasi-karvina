// Základní statistika nad poli, která mohou obsahovat null

export type Maybe = number | null | undefined

export function valid(values: readonly Maybe[]): number[] {
  const out: number[] = []
  for (const v of values) if (v != null && Number.isFinite(v)) out.push(v)
  return out
}

export function mean(values: readonly Maybe[]): number | null {
  const v = valid(values)
  if (!v.length) return null
  let s = 0
  for (const x of v) s += x
  return s / v.length
}

export function sum(values: readonly Maybe[]): number | null {
  const v = valid(values)
  if (!v.length) return null
  let s = 0
  for (const x of v) s += x
  return s
}

export function min(values: readonly Maybe[]): number | null {
  const v = valid(values)
  return v.length ? Math.min(...v) : null
}

export function max(values: readonly Maybe[]): number | null {
  const v = valid(values)
  return v.length ? Math.max(...v) : null
}

/** Percentil (0–100) s lineární interpolací (metoda R-7, stejná jako Excel PERCENTIL.INC) */
export function percentile(values: readonly Maybe[], p: number): number | null {
  const v = valid(values).sort((a, b) => a - b)
  if (!v.length) return null
  if (v.length === 1) return v[0]
  const h = ((v.length - 1) * p) / 100
  const lo = Math.floor(h)
  const hi = Math.ceil(h)
  return v[lo] + (h - lo) * (v[hi] - v[lo])
}

/** Jaký percentil zaujímá hodnota x v rozdělení (0–100), podíl hodnot menších + polovina shodných */
export function percentileRank(values: readonly Maybe[], x: number): number | null {
  const v = valid(values)
  if (!v.length) return null
  let below = 0
  let equal = 0
  for (const y of v) {
    if (y < x) below++
    else if (y === x) equal++
  }
  return ((below + equal / 2) / v.length) * 100
}

/** Lineární regrese metodou nejmenších čtverců: y = a + b·x */
export function linearRegression(points: readonly { x: number; y: number }[]): { slope: number; intercept: number } | null {
  const n = points.length
  if (n < 2) return null
  let sx = 0
  let sy = 0
  for (const p of points) {
    sx += p.x
    sy += p.y
  }
  const mx = sx / n
  const my = sy / n
  let num = 0
  let den = 0
  for (const p of points) {
    num += (p.x - mx) * (p.y - my)
    den += (p.x - mx) ** 2
  }
  if (den === 0) return null
  const slope = num / den
  return { slope, intercept: my - slope * mx }
}

export const round = (v: number, digits = 1) => Math.round(v * 10 ** digits) / 10 ** digits
