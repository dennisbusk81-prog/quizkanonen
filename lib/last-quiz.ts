// ── «Siste quiz» — ÉN definisjon, ett oppslag ───────────────────────────────
//
// BAKGRUNN (26. august 2026)
// «Siste quiz» ble utledet to steder med to ulike spørringer:
//
//   A  app/api/toppliste/route.ts (last_quiz-fanen)
//        quiz_type='weekly' + attempts!inner + order(closes_at, desc).limit(1)
//        — INGEN closes_at-grense.
//   B  app/api/toppliste/history/route.ts (accordionen «Tidligere quizer»)
//        closes_at < now + order(closes_at, desc).limit(21), deretter
//        `.slice(1)` for å hoppe over «den nyeste, som vises i hovedfanen».
//
// `.slice(1)` ANTOK at A og B pekte på samme quiz. Det gjorde de ikke, og de
// var uenige på TRE punkter samtidig:
//
//   1. A godtok en ÅPEN quiz, B krevde stengt. Hver fredag ca. 12–22 pekte de
//      derfor på hver sin quiz: fanen viste den åpne (halvtom liste), og
//      `.slice(1)` kastet forrige ukes quiz ut av historikken. Forrige ukes
//      quiz fantes da ikke på flaten i det hele tatt.
//   2. A krevde 'weekly', B tillot også 'bonus'.
//   3. A krevde minst ett forsøk, B krevde ingen.
//
// Punkt 2 og 3 gir den motsatte feilen: stenger en bonusquiz — eller en weekly
// uten forsøk — sist, viser fanen forrige weekly, `.slice(1)` kaster
// bonusquizen, og den weeklyen fanen viser blir rad 1 i historikken og vises
// DOBBELT.
//
// ── HVORFOR ET OPPSLAG OG IKKE ET FILTER-PÅFØRER ───────────────────────────
// lib/real-quiz-population.ts er med vilje en filter-påfører: kallerne der
// deler POPULASJON, men har hver sin spørringsform og sitt eget formål.
// Her er det motsatte tilfellet — de to kallerne trenger samme SVAR, ikke
// samme filtersett. Et delt filtersett ville fortsatt latt de to kjøre hver
// sin spørring og dermed hver sin `attempts!inner`/`quiz_type`-mening; det er
// nettopp den formen for enighet som drifter fra hverandre igjen.
//
// Derfor: historikkruten SPØR hvilken quiz fanen viser, og ekskluderer den på
// ID. Da kan de to ikke være uenige, uansett hvilken quizform som dukker opp
// senere. Prisen er ett ekstra limit-1-oppslag i historikkruten.
//
// ── HVORFOR «NYESTE STENGTE», OG IKKE «NYESTE» ─────────────────────────────
// Beslutning av Dennis 26. august 2026. Fredagsquizen eier forsiden
// (nedtelling, live-stilling, spillesti). Topplisten er der man ser hva som
// BLE resultatet. En åpen quiz i fanen viser en halvtom liste, og for quizer
// med hide_leaderboard_until_closed er stillingen uansett gatet bort.
//
// Merk at `.lt('closes_at', nowIso)` også lukker et hull som fantes uavhengig
// av alt over: `closes_at` er nullable, og Postgres sorterer NULLS FIRST på
// DESC. En quiz uten stengetid med minst ett forsøk vant derfor A. NULL kan
// ikke tilfredsstille `lt`, så den er ute nå. Samme semantikk som
// `isQuizClosed()` i lib/standings-cache (`now > closes_at`, NULL = ikke
// stengt) — de to skal fortsette å tolke feltet identisk.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { onlyRealQuizzes } from '@/lib/real-quiz-population'

/**
 * «Ukens quiz» er en PRODUKTdefinisjon som avgrenser strengere enn
 * populasjonsgulvet i lib/real-quiz-population.ts. Gulvet ('weekly' | 'bonus')
 * sier hva det er forsvarlig å rangere folk på; denne sier hva fanen heter
 * etter. Ikke slå dem sammen — se REAL_QUIZ_TYPES for skillet.
 */
export const LAST_QUIZ_TYPE = 'weekly'

export type LastQuiz = {
  id: string
  title: string
  closes_at: string
  season_points_awarded: boolean | null
  hide_leaderboard_until_closed: boolean | null
  show_leaderboard: boolean | null
}

/**
 * Quizen «Siste quiz»-fanen viser: nyeste STENGTE ekte weekly med minst ett
 * forsøk.
 *
 * `nowIso` tas som argument og leses ikke av funksjonen selv, slik at en
 * kaller som allerede har stemplet et tidspunkt kan bruke NØYAKTIG samme
 * grense på begge oppslagene sine. Historikkruten gjør det.
 *
 * `attempts!inner(id)` + `limit(1, { referencedTable: 'attempts' })` er et rent
 * EXISTS-oppslag: joinen brukes som filter, verdiene brukes aldri.
 *
 * Spørringen står i en LOKAL VARIABEL og helperen påføres den — inlinet som
 * argument til `onlyRealQuizzes()` gir `next build` TS2589 «Type instantiation
 * is excessively deep». Helperen må dessuten stå FØR `.maybeSingle()`, som
 * ikke lenger har `.not()`/`.in()`. Se lib/real-quiz-population.ts.
 */
export async function fetchLastQuiz(nowIso: string): Promise<LastQuiz | null> {
  const query = supabaseAdmin
    .from('quizzes')
    .select('id, title, closes_at, season_points_awarded, hide_leaderboard_until_closed, show_leaderboard, attempts!inner(id)')
    .eq('quiz_type', LAST_QUIZ_TYPE)
    .lt('closes_at', nowIso)
    .order('closes_at', { ascending: false })
    .limit(1, { referencedTable: 'attempts' })
    .limit(1)

  const { data } = await onlyRealQuizzes(query).maybeSingle()
  return (data as LastQuiz | null) ?? null
}
