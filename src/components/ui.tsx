// Základní stavební prvky rozhraní

import type { ReactNode } from 'react'
import { formatAgo } from '../lib/time.ts'

export function Card({
  title,
  subtitle,
  action,
  children,
  className = '',
  pad = true,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  pad?: boolean
}) {
  return (
    <section className={`glass rounded-3xl ${pad ? 'p-4' : ''} ${className}`}>
      {(title || action) && (
        <header className={`mb-3 flex items-start justify-between gap-3 ${pad ? '' : 'px-4 pt-4'}`}>
          <div className="min-w-0">
            {title && <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-faint">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function Stat({ label, value, sub, className = '' }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular text-lg leading-tight font-semibold">{value}</div>
      {sub && <div className="text-xs text-faint">{sub}</div>}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-white/25 dark:bg-white/10 ${className}`} />
}

export function LoadingCard({ lines = 3, title }: { lines?: number; title?: ReactNode }) {
  return (
    <Card title={title}>
      <div className="space-y-2">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className="h-5" />
        ))}
      </div>
    </Card>
  )
}

export function ErrorCard({ title, error, onRetry }: { title?: ReactNode; error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error)
  const offline = typeof navigator !== 'undefined' && !navigator.onLine
  return (
    <Card title={title}>
      <p className="text-sm">{offline ? 'Jste offline a pro tuto část zatím nejsou uložená data.' : 'Data se nepodařilo načíst.'}</p>
      <p className="mt-1 text-xs break-words text-faint">{msg}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-3 rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white active:scale-95">
          Zkusit znovu
        </button>
      )}
    </Card>
  )
}

/** Upozornění, že se zobrazují starší (uložená) data, protože aktualizace selhala */
export function StaleNote({ updatedAt, error }: { updatedAt: number; error: unknown }) {
  if (!error) return null
  return (
    <p className="mt-2 rounded-xl bg-amber-500/15 px-3 py-1.5 text-xs text-amber-900 dark:text-amber-200">
      Aktualizace se nezdařila – zobrazuji data z doby {formatAgo(updatedAt)}.
    </p>
  )
}

export function Pill({ children, className = '', style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`} style={style}>
      {children}
    </span>
  )
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  className = '',
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div className={`inline-flex rounded-full bg-black/5 p-0.5 dark:bg-white/10 ${className}`} role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition ${o.value === value ? 'glass-strong shadow-sm' : 'text-muted'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function SourceNote({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[11px] leading-snug text-faint">{children}</p>
}
