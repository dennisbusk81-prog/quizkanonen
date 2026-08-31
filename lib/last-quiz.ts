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
// MERK om punkt 2 (31. august 2026): uenigheten der er nå lukket fra DEN ANDRE
// siden — fanen tillater også 'bonus'. Historikken var altså aldri den som tok
// feil på den aksen. Se «HVA ‘SISTE QUIZ’ BETYR» under. Punkt 1 og 3 står
// uendret: fanen krever fortsatt stengt og minst ett forsøk.
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
// ── HVA «SISTE QUIZ» BETYR — DEFINISJONSENDRING 31. AUGUST 2026 ────────────
// Beslutning av Dennis. «Siste quiz» betyr den siste quizen som TELLER I
// SESONGKONKURRANSEN — ikke den siste fredagsquizen. En julequiz, en
// eurovisionquiz eller en månedsquiz skal eie fanen når de er sist, så lenge
// de teller.
//
// Begrunnelsen: fanen heter «Siste quiz», ikke «Fredagsquizen». Filteret sa
// weekly, etiketten sier siste, og etiketten er det brukeren leser. Fanen
// sitter dessuten INNE i sesongtopplisten, der jobben er å vise den siste
// konkurransen som matet sesongen — ikke å definere hva en fredag er.
//
// Dette er en definisjonsendring på et delt begrep, ikke en tekstfiks. Den
// traff tre flater samtidig: denne, `/api/org/[slug]/quiz-scores` (bedriftens
// «Siste quiz»-tabell) og nedtellingen i `/api/toppliste` sin `emptyResponse`.
// Alle tre importerer nå LAST_QUIZ_SEASON_TYPES herfra.
//
// To flater ble BEVISST stående på 'weekly', fordi de svarer på et annet
// spørsmål — «hva er en fredag», ikke «hvilken quiz var sist»:
//   • lib/history.ts:434  deltakelsesrekken. «Fredagsrekke» betyr fredag.
//   • app/org/[slug]/velkommen/page.tsx:211  onboarding-tidsvinduet. En
//     julequiz skal ikke definere en bedrifts åpningstider.
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
 * Quiz-typene som kan EIE «Siste quiz» — altså de som teller i
 * sesongkonkurransen. Beslutning av Dennis 31. august 2026; se
 * «HVA ‘SISTE QUIZ’ BETYR» i filheaderen for hvorfor etiketten, ikke
 * fredagen, er det som styrer.
 *
 * ── DENNE ER LIK REAL_QUIZ_TYPES I DAG, OG DET ER MED VILJE ────────────────
 * Verdien er identisk med `REAL_QUIZ_TYPES` i lib/real-quiz-population.ts,
 * og det er fristende å importere den i stedet. IKKE gjør det.
 *
 * De er like i dag AV EN GRUNN — «teller i sesongen» ER hvitelisten så lenge
 * det ikke finnes noe annet signal — men de svarer på to ULIKE spørsmål:
 *
 *   REAL_QUIZ_TYPES        hva er det forsvarlig å rangere folk på i det hele
 *                          tatt (populasjonsgulvet: ikke test, ikke arkiv)
 *   LAST_QUIZ_SEASON_TYPES hvilken quiz teller i sesongkonkurransen, og kan
 *                          derfor eie fanen
 *
 * Den dagen `counts_in_season` blir et eget felt på quizzes (se QK_3) skal de
 * to kunne skille lag uten at noen først må grave fram at det fantes et skille
 * her. Slås de sammen, forsvinner sømmen — og den må graves fram igjen.
 *
 * ── HVA DENNE LINJA FAKTISK HOLDER, MÅLT 31. AUGUST 2026 ──────────────────
 * Siden verdiene er like, og hvert kallsted uansett kjører gjennom
 * `onlyRealQuizzes()`, overlapper de to på quiz_type-aksen. Mutasjonsmålt, i
 * begge retninger, på alle tre kallstedene:
 *
 *   fjern denne `.in`, behold gulvet   → 0 røde. Linja er altså BEHAVIOURELT
 *                                        INERT i dag, nøyaktig som forventet.
 *   fjern gulvet, behold denne `.in`   → kun is_test-testene blir røde.
 *                                        Arkiv-aksen holdes fortsatt — av
 *                                        DENNE linja.
 *   fjern begge                        → arkivtestene blir røde også.
 *
 * Konklusjonen er ikke «sømmen er pynt», men at de to dekker HVER SIN halvdel
 * av gulvet med overlapp på den ene: `is_test` holdes KUN av
 * `onlyRealQuizzes()`, `quiz_type` holdes av begge. Ikke fjern gulvet fra et
 * kallsted i den tro at denne linja dekker det — den ser ikke `is_test` i det
 * hele tatt, og admin-editorens testbryter setter nettopp `is_test = true`
 * mens nedtrekket blir stående på 'weekly'.
 */
export const LAST_QUIZ_SEASON_TYPES = ['weekly', 'bonus'] as const

export type LastQuiz = {
  id: string
  title: string
  closes_at: string
  season_points_awarded: boolean | null
  hide_leaderboard_until_closed: boolean | null
  show_leaderboard: boolean | null
}

/**
 * Quizen «Siste quiz»-fanen viser: nyeste STENGTE quiz som teller i sesongen,
 * med minst ett forsøk. Ikke «nyeste weekly» — se LAST_QUIZ_SEASON_TYPES.
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
    .in('quiz_type', LAST_QUIZ_SEASON_TYPES)
    .lt('closes_at', nowIso)
    .order('closes_at', { ascending: false })
    .limit(1, { referencedTable: 'attempts' })
    .limit(1)

  const { data } = await onlyRealQuizzes(query).maybeSingle()
  return (data as LastQuiz | null) ?? null
}
