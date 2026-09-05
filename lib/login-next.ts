// Hvilken `next` en DELT lenke sender med til innloggingen.
//
// Denne fila rører IKKE auth-flyten. Den bygger kun strengen som sendes inn i
// AuthModal (`next`) eller henges på `/login?next=` — hvor brukeren skal lande
// ETTER at innloggingen er ferdig. Selve valideringen av verdien gjøres av
// `safeNextPath` i lib/auth-post-login.ts, som er uendret.
//
// ── HVILKEN FEIL DE FINNES FOR ──────────────────────────────────────────────
// En fremmed som klikker en delt lenke fra Facebook er den ENESTE brukeren som
// møter disse to flatene uten sesjon. Uten `next` lander Google-runden og
// magic link på forsiden i stedet for på siden hun kom for — quizlista hun
// ville se, eller utfordringen hun ble sendt.

/**
 * Veien tilbake til den leaderboard-siden brukeren faktisk står på.
 *
 * Scope-parameterne er med fordi de bestemmer hvilken LISTE siden viser:
 * `?org=` scoper til én bedrift, `?league=` styrer tilbakelenken nederst, og
 * `?hist=1` åpner samme fane i historikken. Faller de bort under innloggingen,
 * kommer hun tilbake til en annen liste enn den hun sto i.
 *
 * Rekkefølgen på parameterne er fast (org, league, hist) slik at strengen er
 * sammenlignbar i test.
 */
export function buildLeaderboardNext(
  quizId: string,
  opts: { org?: string | null; league?: string | null; hist?: boolean } = {},
): string {
  const qs = new URLSearchParams()
  if (opts.org) qs.set('org', opts.org)
  if (opts.league) qs.set('league', opts.league)
  if (opts.hist) qs.set('hist', '1')
  const spor = qs.toString()
  return `/leaderboard/${encodeURIComponent(quizId)}${spor ? `?${spor}` : ''}`
}

/**
 * Veien tilbake til utfordringssiden, med utfordringen intakt.
 *
 * `fra` og `quiz` ER utfordringen — siden har ingen annen kilde til hvem som
 * utfordret og hvilken quiz det gjelder (den leser dem ut av query-strengen).
 * Uten dem er retur til `/utfordring` en tom side.
 */
export function buildChallengeNext(
  opts: { fra?: string | null; quiz?: string | null } = {},
): string {
  const qs = new URLSearchParams()
  if (opts.fra) qs.set('fra', opts.fra)
  if (opts.quiz) qs.set('quiz', opts.quiz)
  const spor = qs.toString()
  return `/utfordring${spor ? `?${spor}` : ''}`
}

/** `/login?next=<sti>` — én formulering, så ingen kaller glemmer å enkode. */
export function loginHref(next: string): string {
  return `/login?next=${encodeURIComponent(next)}`
}
