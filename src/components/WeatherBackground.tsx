// Dynamické pozadí podle počasí, denní doby a motivu (gradient + animované částice)

import { memo, useMemo } from 'react'
import type { SkyKind } from '../lib/wmo.ts'

export type DayPhase = 'day' | 'night' | 'golden'

interface Props {
  sky: SkyKind
  phase: DayPhase
  dark: boolean
  /** Intenzita srážek mm/h (počet kapek) */
  intensity?: number
}

type Palette = [string, string, string]

const LIGHT: Record<SkyKind, { day: Palette; night: Palette }> = {
  clear: { day: ['#3b8fe0', '#7dbcf2', '#cbe5fa'], night: ['#6f82bd', '#9eadd6', '#cfd7ee'] },
  partly: { day: ['#4f8fd0', '#9dc3e6', '#d6e5f1'], night: ['#7686b6', '#a3afd2', '#d0d6ea'] },
  cloudy: { day: ['#8193a8', '#adbccb', '#d6dee7'], night: ['#7d8aa3', '#a6b1c5', '#cdd4e0'] },
  fog: { day: ['#a3aeb9', '#c9d1d8', '#e5e9ec'], night: ['#8f99a6', '#b5bdc7', '#d7dce2'] },
  drizzle: { day: ['#6b7f96', '#93a5b8', '#bfcad6'], night: ['#6e7a92', '#97a2b6', '#c1c8d6'] },
  rain: { day: ['#5a6e86', '#8395aa', '#b0bdcb'], night: ['#626e88', '#8d98ae', '#b9c1d1'] },
  sleet: { day: ['#6a7d92', '#97a8ba', '#c8d3de'], night: ['#6b7790', '#96a1b5', '#c3cad8'] },
  snow: { day: ['#93a9c0', '#cbd7e4', '#eef3f8'], night: ['#8796b0', '#b6c1d3', '#dde3ec'] },
  storm: { day: ['#4b5668', '#6c7889', '#98a3b3'], night: ['#4f5872', '#76809a', '#a2aabf'] },
}

const DARK: Record<SkyKind, { day: Palette; night: Palette }> = {
  clear: { day: ['#0c3768', '#1b5794', '#2f70b0'], night: ['#040a1c', '#0b1a3b', '#1a2b54'] },
  partly: { day: ['#123760', '#24507f', '#3b6896'], night: ['#060d20', '#101d3c', '#1f2e50'] },
  cloudy: { day: ['#1d2735', '#2c3848', '#3c495b'], night: ['#0d121b', '#18202d', '#252f3f'] },
  fog: { day: ['#252c35', '#37404b', '#49535f'], night: ['#11151b', '#1d232b', '#2b323c'] },
  drizzle: { day: ['#172231', '#243244', '#344458'], night: ['#0a0f18', '#141c28', '#222c3b'] },
  rain: { day: ['#111b28', '#1e2b3c', '#2d3c50'], night: ['#070b12', '#111823', '#1d2633'] },
  sleet: { day: ['#1a2533', '#2b3849', '#3e4d61'], night: ['#0b1018', '#172030', '#253043'] },
  snow: { day: ['#22304a', '#38496a', '#536689'], night: ['#0e1526', '#1c2742', '#2e3b5c'] },
  storm: { day: ['#0b0f17', '#1a2130', '#2a3242'], night: ['#05070c', '#0e131c', '#1a202b'] },
}

const GOLDEN_LIGHT: Palette = ['#5b7fc4', '#f2a77a', '#fbd8a8']
const GOLDEN_DARK: Palette = ['#1d1838', '#5f3657', '#b5644a']

/** Deterministická pseudonáhoda, aby se částice při překreslení neposouvaly */
function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

function WeatherBackgroundInner({ sky, phase, dark, intensity = 0 }: Props) {
  const palette: Palette = useMemo(() => {
    const clearish = sky === 'clear' || sky === 'partly'
    if (phase === 'golden' && clearish) return dark ? GOLDEN_DARK : GOLDEN_LIGHT
    const set = (dark ? DARK : LIGHT)[sky]
    return phase === 'night' ? set.night : set.day
  }, [sky, phase, dark])

  const particles = useMemo(() => {
    const r = rng(42)
    const wet = sky === 'rain' || sky === 'drizzle' || sky === 'storm' || sky === 'sleet'
    const dropCount = !wet ? 0 : sky === 'drizzle' ? 28 : Math.round(Math.min(130, 45 + intensity * 18))
    const flakeCount = sky === 'snow' ? 55 : sky === 'sleet' ? 20 : 0
    const starCount = phase === 'night' && (sky === 'clear' || sky === 'partly') ? (sky === 'clear' ? 70 : 35) : 0
    const cloudCount = sky === 'partly' ? 3 : sky === 'cloudy' || wet || sky === 'snow' ? 5 : sky === 'fog' ? 6 : 0
    return {
      drops: Array.from({ length: dropCount }, () => ({
        left: r() * 110,
        delay: -r() * 2,
        dur: (sky === 'drizzle' ? 1.4 : 0.7) + r() * 0.5,
        opacity: 0.35 + r() * 0.5,
      })),
      flakes: Array.from({ length: flakeCount }, () => ({
        left: r() * 100,
        size: 2 + r() * 4,
        delay: -r() * 12,
        dur: 8 + r() * 8,
      })),
      stars: Array.from({ length: starCount }, () => ({
        left: r() * 100,
        top: r() * 60,
        size: r() < 0.85 ? 1.5 : 2.5,
        delay: -r() * 5,
        dur: 2.5 + r() * 4,
      })),
      clouds: Array.from({ length: cloudCount }, (_, i) => ({
        top: 4 + i * (60 / Math.max(1, cloudCount)) + r() * 8,
        w: 45 + r() * 40,
        h: 14 + r() * 12,
        delay: -r() * 120,
        dur: 90 + r() * 80,
      })),
    }
  }, [sky, phase, intensity])

  const cloudColor =
    sky === 'storm' || sky === 'rain'
      ? dark
        ? 'rgb(10 14 22 / 0.55)'
        : 'rgb(70 82 100 / 0.35)'
      : dark
        ? 'rgb(148 163 184 / 0.16)'
        : 'rgb(255 255 255 / 0.55)'

  const showSun = phase !== 'night' && (sky === 'clear' || sky === 'partly')
  const showMoon = phase === 'night' && (sky === 'clear' || sky === 'partly')

  return (
    <div
      className="sky"
      aria-hidden="true"
      style={{ background: `linear-gradient(180deg, ${palette[0]} 0%, ${palette[1]} 55%, ${palette[2]} 100%)` }}
    >
      {showSun && (
        <div
          className="sun-glow"
          style={{
            right: '-12vw',
            top: '-10vh',
            width: '70vw',
            height: '70vw',
            maxWidth: 520,
            maxHeight: 520,
            background:
              phase === 'golden'
                ? 'radial-gradient(circle, rgb(255 200 120 / 0.85) 0%, rgb(255 160 90 / 0.35) 35%, transparent 70%)'
                : 'radial-gradient(circle, rgb(255 244 200 / 0.9) 0%, rgb(255 220 130 / 0.35) 30%, transparent 68%)',
          }}
        />
      )}
      {showMoon && (
        <div
          className="absolute"
          style={{
            right: '12vw',
            top: '9vh',
            width: 54,
            height: 54,
            borderRadius: 9999,
            background: 'radial-gradient(circle at 35% 35%, #fefce8, #e2e8f0 60%, #cbd5e1)',
            boxShadow: '0 0 60px 18px rgb(226 232 240 / 0.25)',
            opacity: dark ? 0.9 : 0.75,
          }}
        />
      )}
      <div className="sky-layer">
        {particles.stars.map((s, i) => (
          <span
            key={`s${i}`}
            className="star"
            style={{ left: `${s.left}%`, top: `${s.top}%`, width: s.size, height: s.size, animationDelay: `${s.delay}s`, animationDuration: `${s.dur}s` }}
          />
        ))}
        {particles.clouds.map((c, i) => (
          <span
            key={`c${i}`}
            className="cloud"
            style={{ top: `${c.top}%`, width: `${c.w}vw`, height: `${c.h}vh`, background: cloudColor, animationDelay: `${c.delay}s`, animationDuration: `${c.dur}s` }}
          />
        ))}
        {particles.drops.map((d, i) => (
          <span key={`d${i}`} className="drop" style={{ left: `${d.left}%`, opacity: d.opacity, animationDelay: `${d.delay}s`, animationDuration: `${d.dur}s` }} />
        ))}
        {particles.flakes.map((f, i) => (
          <span
            key={`f${i}`}
            className="flake"
            style={{ left: `${f.left}%`, width: f.size, height: f.size, animationDelay: `${f.delay}s`, animationDuration: `${f.dur}s` }}
          />
        ))}
        {sky === 'fog' && (
          <div className="absolute inset-x-0 bottom-0 h-2/3" style={{ background: `linear-gradient(to top, ${dark ? 'rgb(148 163 184 / 0.18)' : 'rgb(255 255 255 / 0.55)'}, transparent)` }} />
        )}
        {sky === 'storm' && <div className="flash absolute inset-0" />}
      </div>
    </div>
  )
}

export const WeatherBackground = memo(WeatherBackgroundInner)
