// Ikony Meteocons (Bas Milius, MIT). Do sestavení se zabalí jen vyjmenované ikony.

const ICONS = import.meta.glob(
  '/node_modules/@bybas/weather-icons/production/fill/all/{clear-day,clear-night,partly-cloudy-day,partly-cloudy-night,overcast-day,overcast-night,fog-day,fog-night,fog,partly-cloudy-day-drizzle,partly-cloudy-night-drizzle,drizzle,sleet,partly-cloudy-day-rain,partly-cloudy-night-rain,rain,partly-cloudy-day-snow,partly-cloudy-night-snow,snow,thunderstorms-day-rain,thunderstorms-night-rain,thunderstorms-rain,not-available,sunrise,sunset,moonrise,moonset,moon-new,moon-waxing-crescent,moon-first-quarter,moon-waxing-gibbous,moon-full,moon-waning-gibbous,moon-last-quarter,moon-waning-crescent,raindrops,raindrop,umbrella,thermometer,humidity,barometer,wind,uv-index,compass,horizon,smoke-particles,snowflake,windsock,star}.svg',
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>

const BY_NAME: Record<string, string> = {}
for (const [path, url] of Object.entries(ICONS)) BY_NAME[path.slice(path.lastIndexOf('/') + 1, -4)] = url

function iconUrl(name: string): string {
  return BY_NAME[name] ?? BY_NAME['not-available']
}

export function WeatherIcon({ name, size = 40, className = '', alt = '' }: { name: string; size?: number; className?: string; alt?: string }) {
  return <img src={iconUrl(name)} width={size} height={size} alt={alt} className={`inline-block select-none ${className}`} draggable={false} loading="lazy" />
}
