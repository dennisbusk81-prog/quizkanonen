import { fetchResult, type Loaded, type MinimalResponse } from './fetch-result'

// Sesongvinnerne på bedriftspanelet: tre UAVHENGIGE kall mot /api/toppliste,
// ett per periode. Uavhengigheten er hele grunnen til at tilstanden er per
// periode og ikke én global: måneden kan lastes fint samtidig som året feiler,
// og da skal måneden fortsatt vises.
//
// Fram til 30. juli gjorde hver av dem
//   .then(r => r.ok ? r.json() : { entries: [] }).catch(() => ({ entries: [] }))
// slik at et feilsvar ble til en tom entries-liste → ingen vinner → kortet
// skrev «Ikke kåret ennå». Det er en PÅSTAND om at ingen har vunnet, ikke en
// innrømmelse av at vi ikke vet. Se lib/fetch-result.ts for invarianten.
export type WinnerPeriod = 'month' | 'quarter' | 'year'
export const WINNER_PERIODS: readonly WinnerPeriod[] = ['month', 'quarter', 'year']

export type WinnerApiEntry = { displayName: string; avatarUrl: string | null; points: number }
export type SeasonWinner = { displayName: string; avatarUrl: string | null; points: number }
export type Top3Entry = { displayName: string; points: number }

// winner og top3 utledes av SAMME entries-liste og holdes derfor i samme
// objekt. De lå tidligere i to separate React-states som ble satt ved siden av
// hverandre — to kilder til samme sannhet, som er nøyaktig formen på
// «aktiv»-feilene i denne kodebasen.
export type PeriodWinners = { winner: SeasonWinner | null; top3: Top3Entry[] }

export function toPeriodWinners(entries: WinnerApiEntry[]): PeriodWinners {
  const first = entries[0]
  return {
    // null = ingen har poeng i perioden ennå. Reell tilstand, og fortsatt lov
    // å vise som «Ikke kåret ennå» — men KUN når hentingen faktisk lyktes.
    winner: first
      ? { displayName: first.displayName, avatarUrl: first.avatarUrl ?? null, points: first.points }
      : null,
    top3: entries.slice(0, 3).map(e => ({ displayName: e.displayName, points: e.points })),
  }
}

export type SeasonWinnersState = Record<WinnerPeriod, Loaded<PeriodWinners>>

export async function fetchSeasonWinners(
  run: (period: WinnerPeriod) => Promise<MinimalResponse>
): Promise<SeasonWinnersState> {
  const results = await Promise.all(
    WINNER_PERIODS.map(period =>
      fetchResult(
        () => run(period),
        json => toPeriodWinners(((json as { entries?: WinnerApiEntry[] } | null)?.entries) ?? [])
      )
    )
  )
  return { month: results[0], quarter: results[1], year: results[2] }
}
