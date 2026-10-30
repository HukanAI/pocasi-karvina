import { InstallCard } from '../components/InstallCard.tsx'
import { AstroCard, HistoryTeaser, WarningsBanner } from '../components/today/Extras.tsx'
import { DetailTiles } from '../components/today/DetailTiles.tsx'
import { Hero } from '../components/today/Hero.tsx'
import { HourlyStrip, Nowcast } from '../components/today/HourlyStrip.tsx'
import { RainCard } from '../components/today/RainCard.tsx'
import { StationCard } from '../components/today/StationCard.tsx'

export default function TodayPage() {
  return (
    <div className="space-y-3 pb-4">
      <Hero />
      <InstallCard compact />
      <WarningsBanner />
      <RainCard />
      <HourlyStrip />
      <Nowcast />
      <StationCard />
      <DetailTiles />
      <AstroCard />
      <HistoryTeaser />
    </div>
  )
}
