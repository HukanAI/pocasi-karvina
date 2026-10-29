import { NavLink } from 'react-router-dom'

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

const ICONS = {
  today: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  forecast: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="4" width="18" height="17" rx="3" />
      <path d="M3 9h18M8 2v4M16 2v4M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2" />
    </svg>
  ),
  radar: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <path d="M12 12l6-6" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  ),
  air: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h8" />
    </svg>
  ),
  history: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l3 2" />
    </svg>
  ),
}

const ITEMS = [
  { to: '/', label: 'Dnes', icon: ICONS.today, end: true },
  { to: '/predpoved', label: 'Předpověď', icon: ICONS.forecast },
  { to: '/radar', label: 'Radar', icon: ICONS.radar },
  { to: '/ovzdusi', label: 'Ovzduší', icon: ICONS.air },
  { to: '/historie', label: 'Historie', icon: ICONS.history },
]

export function BottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--glass-border)] bg-[var(--nav-bg)] backdrop-blur-xl"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Hlavní navigace"
    >
      <ul className="mx-auto flex max-w-xl justify-around">
        {ITEMS.map((it) => (
          <li key={it.to} className="flex-1">
            <NavLink
              to={it.to}
              end={it.end}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition ${isActive ? 'text-[var(--accent)]' : 'text-muted'}`
              }
            >
              <span className="h-6 w-6">{it.icon}</span>
              {it.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
