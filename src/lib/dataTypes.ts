// Formát souborů v data větvi (zapisují skripty v GitHub Actions, čte aplikace)

/** Pravidelná časová řada: hodnota i patří k času start + i·step (u srážek = konec intervalu) */
export interface RegularSeries {
  start: number
  step: number
  values: (number | null)[]
}

/** station-sra10.json – klouzavá zásoba 10min srážek stanice ČHMÚ Karviná (mm za 10 min) */
export type StationSra10 = RegularSeries & { updated: string }

export interface StationObs {
  /** Čas měření (ms UTC, konec 10min intervalu) */
  t: number
  /** Teplota 2 m (°C) */
  T: number | null
  /** Relativní vlhkost (%) */
  H: number | null
  /** Rychlost větru (m/s) */
  F: number | null
  /** Maximální náraz za 10 min (m/s) */
  Fmax: number | null
  /** Směr větru (°) */
  D: number | null
  /** Přízemní teplota 5 cm (°C) */
  TPM: number | null
  /** Srážky za 10 min (mm) */
  SRA: number | null
}

/** station-now.json – poslední měření a 48h průběh */
export interface StationNow {
  updated: string
  last: StationObs | null
  series: {
    start: number
    step: number
    T: (number | null)[]
    H: (number | null)[]
    F: (number | null)[]
    Fmax: (number | null)[]
    D: (number | null)[]
    SRA: (number | null)[]
  }
  /** Souhrn od místní půlnoci */
  today: {
    date: string
    from: number
    to: number
    tmax: number | null
    tmaxAt: number | null
    tmin: number | null
    tminAt: number | null
    prcp: number | null
    gustMax: number | null
  } | null
}

export interface WarningItem {
  id: string
  event: string
  /** Minor | Moderate | Severe | Extreme */
  severity: string
  /** yellow | orange | red */
  level: 'yellow' | 'orange' | 'red' | 'unknown'
  certainty: string
  onset: string
  expires: string
  description: string
  instruction: string
  area: string
  sent: string
}

/** warnings.json */
export interface WarningsFile {
  updated: string
  items: WarningItem[]
}

/** meta.json – časy poslední úspěšné aktualizace jednotlivých částí */
export type MetaFile = Partial<
  Record<'station' | 'stationDaily' | 'stationDailyFull' | 'era5' | 'era5Full' | 'warnings' | 'alerts' | 'radar', string>
>
