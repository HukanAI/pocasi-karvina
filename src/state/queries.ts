// Dotazy TanStack Query. Výsledky se ukládají do IndexedDB (viz main.tsx), takže aplikace
// po otevření bez internetu ukáže poslední stažená data.

import { useQuery } from '@tanstack/react-query'
import { fetchData, fetchRadar } from '../api/dataBranch.ts'
import { fetchAir, fetchEnsemble, fetchForecast, fetchModels, fetchPrecipGrid } from '../api/openMeteo.ts'
import type { DailySeries } from '../lib/climate.ts'
import type { MetaFile, StationNow, StationSra10, WarningsFile } from '../lib/dataTypes.ts'

const MIN = 60_000

export const useForecast = () =>
  useQuery({ queryKey: ['forecast'], queryFn: ({ signal }) => fetchForecast(signal), staleTime: 10 * MIN, refetchInterval: 15 * MIN })

export const useModels = () =>
  useQuery({ queryKey: ['models'], queryFn: ({ signal }) => fetchModels(signal), staleTime: 30 * MIN })

export const useEnsemble = () =>
  useQuery({ queryKey: ['ensemble'], queryFn: ({ signal }) => fetchEnsemble(signal), staleTime: 60 * MIN })

export const useAir = () =>
  useQuery({ queryKey: ['air'], queryFn: ({ signal }) => fetchAir(signal), staleTime: 30 * MIN, refetchInterval: 30 * MIN })

export const usePrecipGrid = () =>
  useQuery({ queryKey: ['precipGrid'], queryFn: ({ signal }) => fetchPrecipGrid(signal), staleTime: 20 * MIN, refetchInterval: 30 * MIN })

export const useRadar = () =>
  useQuery({ queryKey: ['radar'], queryFn: ({ signal }) => fetchRadar(signal), staleTime: 5 * MIN, refetchInterval: 5 * MIN })

const dataQuery = <T,>(name: string, staleTime: number, refetchInterval?: number) => ({
  queryKey: ['data', name],
  queryFn: ({ signal }: { signal: AbortSignal }) => fetchData<T>(name, signal),
  staleTime,
  refetchInterval,
})

export const useStationNow = () => useQuery(dataQuery<StationNow>('station-now.json', 10 * MIN, 15 * MIN))
export const useStationSra = () => useQuery(dataQuery<StationSra10>('station-sra10.json', 10 * MIN, 15 * MIN))
export const useStationDaily = (enabled = true) => useQuery({ ...dataQuery<DailySeries>('station-daily.json', 6 * 60 * MIN), enabled })
export const useEra5Daily = (enabled = true) => useQuery({ ...dataQuery<DailySeries>('era5-daily.json', 6 * 60 * MIN), enabled })
export const useWarnings = () => useQuery(dataQuery<WarningsFile>('warnings.json', 10 * MIN, 15 * MIN))
export const useMeta = () => useQuery(dataQuery<MetaFile>('meta.json', 10 * MIN))
