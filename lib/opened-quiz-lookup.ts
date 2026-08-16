import { supabaseAdmin } from '@/lib/supabase-admin'
import * as Sentry from '@sentry/nextjs'

// ── «Quiz som nettopp åpnet» — ÉN kilde for de tre varslingsrutene ───────────
//
// BAKGRUNN (16. august 2026)
// `notify-subscribers`, `send-reminders` og `send-push` fyrer alle på samme
// hendelse og hadde hver sin kopi av det samme oppslaget. Kopiene har allerede
// drevet fra hverandre én gang: `is_test`/`is_active`-guardene ble lagt inn i
// `send-push` (28d74c9), mens søsterruten `notify-subscribers` beholdt hullet og
// sendte «[TEST – ikke ekte] …» til påmeldingslisten samme kveld (7c81c0a).
//
// Oppslaget bor derfor her, ikke i rutene. En fjerde varslingsrute arver
// guardene gratis i stedet for å måtte huske dem.
//
// ── HVORFOR EN INNHOLDSSJEKK, OG HVORFOR IKKE `count > 0` ───────────────────
// Ingen av rutene sjekket at quizen faktisk HAR spørsmål. En tellevakt ville
// ikke hjulpet: admin-editoren oppretter quiz-raden på TITTEL-BLUR
// (app/admin/quizzes/new/page.tsx → POST /api/admin/quizzes/import), og samme
// kall setter `is_active: true` OG legger inn N placeholder-rader med
// `question_text: ''`. Antallet er altså ≥ 1 fra første sekund — det er
// INNHOLDET som mangler, ikke radene.
//
// Vakten spør derfor etter minst én rad med ikke-tom tekst. Filteret ligger i
// databasen og ikke i JS, slik at vi slipper å hente et vilkårlig utvalg rader
// og gjette på resten.
//
// Kjent, bevisst begrensning: en tekst som kun er mellomrom (' ') passerer.
// Begge skriverne gjør det umulig i praksis — editoren lagrer `q.text.trim()`,
// og importruten skriver den bokstavelige tomme strengen — og alternativet
// (hent rader, trim i JS) ville innført et utvalgstak som kunne gi motsatt feil:
// «tom» for en quiz som faktisk har innhold lenger ned i lista.
//
// ── FEILRETNING: FAIL-OPEN, og hvorfor ──────────────────────────────────────
// Feiler selve innholdssjekken, regnes quizen som spillbar og varselet går ut.
// En forbigående DB-feil skal ikke koste fredagens varsling til hele listen.
// Vakten er en backstop mot en sjelden admin-tilstand; varslingen er den
// normale, forventede hendelsen. Feilen rapporteres uansett.
//
// Merk at DELETE-sperren i app/api/admin/quizzes/[id]/questions/[qid]/route.ts
// feiler i MOTSATT retning (nekter slettingen når den ikke får telt). Det er
// med vilje: der er den dyre utgangen en tom quiz, her er den en uteblitt
// varsling.

export type OpenedQuiz = {
  id: string
  title: string | null
  opens_at: string
  closes_at: string | null
}

export type OpenedQuizResult =
  /** Quiz funnet, og den har spørsmål med innhold. Eneste status det skal varsles på. */
  | { status: 'found'; quiz: OpenedQuiz }
  /** Ingen quiz åpnet i vinduet. Normaltilstanden nesten hele tiden. */
  | { status: 'none' }
  /** Quiz funnet, men uten et eneste spørsmål med tekst. Alt varslet er rapportert. */
  | { status: 'empty'; quizId: string; title: string | null }
  /** Selve quiz-oppslaget feilet. Kalleren skal svare 500, ikke «ingen quiz». */
  | { status: 'error'; message: string }

// Hvor lenge etter åpning en quiz fortsatt kan varsles om.
//
// Vinduet var 10 minutter, og var da en KOMPENSASJON for at stemplingen var
// feil: den skjedde én gang etter hele løkken, så et avbrudd etterlot ingen
// spor, og et smalt vindu begrenset hvor mange ganger alle kunne få varselet på
// nytt. Nå som hver mottaker stemples fortløpende (quiz_notification_log /
// quiz_notifications.notified_quiz_id), er gjentatte kjøringer trygge — de
// plukker opp nøyaktig restene. Da blir det smale vinduet i stedet en
// kapasitetsgrense: med cron hvert 5. minutt rakk to kjøringer aldri en stor
// liste. 60 minutter gir ~12 kjøringer.
//
// Tallet sto tidligere som tre identiske konstanter, én per rute (3a27619).
//
// BEVISST IKKE UTVIDET (16. august 2026). Kartleggingen målte at hele halen
// ligger godt innenfor: verste observerte mottaker ble stemplet 25,3 minutter
// etter opens_at (07.08-quizen), og 14.08 var ferdig etter 5,3. Vinduet er
// altså ikke bindende for kapasitet i dag. Dødsonen utenfor vinduet er i
// stedet gjort SYNLIG — se lib/notify-dead-zone.ts — i stedet for å flyttes
// noen timer lenger ut, der den ville truffet sjeldnere og fortsatt vært
// stille.
export const NOTIFY_WINDOW_MS = 60 * 60 * 1000

// Hvor mange kandidater oppslaget henter for å kunne SE at det var flere enn
// én. Behandlingen tar fortsatt kun den første — se `findOpenedQuizToNotify`.
//
// Tallet er et lesetak, ikke en grense på hva som er lov: treffer vi det, sier
// rapporten «minst N» i stedet for å påstå et eksakt antall.
const CANDIDATE_PROBE_LIMIT = 5

/**
 * Rapporterer at en varsling ble holdt tilbake, eller at vakten selv sviktet.
 *
 * KASTER ALDRI — samme holdning som lib/money-path-alert.ts. En cron-jobb skal
 * ikke velte fordi Sentry er nede.
 *
 * `captureMessage` med en STABIL tekst: grupperingen skal følge tilstanden, ikke
 * quiz-id-en, slik at gjentatte kjøringer blir én sak med teller i stedet for
 * tolv nye saker i timen. Id og tittel ligger i `extra`, der de er nyttige.
 * Quiz-tittelen er vår egen tekst, ikke en personopplysning.
 */
export function varsleNotifyGuard(
  melding: string,
  nivå: 'error' | 'warning',
  ekstra: Record<string, string | number | null | undefined>,
): void {
  try {
    Sentry.captureMessage(`notify-guard: ${melding}`, {
      level: nivå,
      tags: { area: 'notify-guard' },
      extra: ekstra,
    })
  } catch {
    // Rapporteringen kan ikke rapportere sin egen svikt. Kallstedet fortsetter.
  }
}

/**
 * Har quizen minst ett spørsmål med faktisk tekst?
 *
 * Eksportert fordi org-stengevarselet i `cron/send-reminders` finner quizen sin
 * med et ANNET oppslag (aktiv nå, sortert på closes_at) og trenger den samme
 * sjekken på en quiz den allerede har i hånda.
 *
 * Ved feil: `true` (fail-open) + rapport. Se filhodet.
 */
export async function quizHasQuestions(quizId: string, context: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('questions')
    .select('id')
    .eq('quiz_id', quizId)
    .not('question_text', 'is', null)
    .neq('question_text', '')
    .limit(1)

  if (error) {
    console.error(`[opened-quiz-lookup] innholdssjekk feilet for quiz ${quizId} (${context}) — antar spillbar:`, error.message)
    varsleNotifyGuard('innholdssjekken feilet', 'warning', {
      context,
      quizId,
      consequence: 'Vakten kunne ikke avgjøre om quizen har spørsmål. Varselet ble sendt (fail-open) — sjekk at quizen faktisk er ferdig.',
      errorMessage: error.message,
    })
    return true
  }

  return (data?.length ?? 0) > 0
}

/**
 * Finner quizen som nettopp åpnet, og som det er forsvarlig å varsle om.
 *
 * Returnerer ALDRI en quiz som ikke skal varsles om — vakten ligger her, ikke
 * hos kallerne, slik at et nytt kallsted ikke kan glemme den. Kallerne skiller
 * likevel på `none` og `empty` i svaret sitt: «ingen quiz i vinduet» er den
 * normale meldingen nesten hele tiden, og å skjule en tilbakeholdt varsling bak
 * den teksten ville vært stille undersending forkledd som normaldrift.
 */
export async function findOpenedQuizToNotify(
  context: string,
  now: number = Date.now(),
): Promise<OpenedQuizResult> {
  const windowStart = new Date(now - NOTIFY_WINDOW_MS).toISOString()
  const nowIso = new Date(now).toISOString()

  // is_test/is_active-guardene: uten dem plukker oppslaget ENHVER quiz-rad som
  // åpnet i vinduet — også en testquiz eller en som er skjult i admin («Skjul»
  // setter is_active=false). En testquiz som åpnet sist vinner dessuten
  // order('opens_at', desc).
  //
  // closes_at-vakten (16. august 2026): oppslaget HENTET closes_at, men
  // filtrerte aldri på den. En quiz som allerede hadde stengt kunne derfor
  // utløse «Fredagsquizen er nå åpen» — e-post og push om noe som er over. At
  // det ikke har skjedd skyldes utelukkende at hver quiz i prod varer 10–23
  // timer, altså mye lengre enn vinduet. Det er en egenskap ved dataene, ikke
  // ved koden, og den holder kun så lenge ingen lager en kort quiz.
  //
  // `gte` og ikke `gt`: «stengt» er definert som `closes_at < nå` av
  // oppgjørsstien (cron/publish-quiz og cron/award-season-points bruker begge
  // `.lt('closes_at', now)`). Med `gte` her er de to nøyaktig komplementære —
  // ingen glippe, ingen overlapp. Velger man `gt`, finnes det ett millisekund
  // der en quiz hverken er åpen nok til å varsles om eller stengt nok til å
  // gjøres opp.
  //
  // NULL closes_at = ingen stengetid = fortsatt åpen. Samme lesning som
  // forsidens activeQuiz-filter i cron/publish-quiz.
  const { data, error } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, opens_at, closes_at')
    .eq('is_test', false)
    .eq('is_active', true)
    .lte('opens_at', nowIso)
    .gte('opens_at', windowStart)
    .or(`closes_at.is.null,closes_at.gte.${nowIso}`)
    .order('opens_at', { ascending: false })
    .limit(CANDIDATE_PROBE_LIMIT)

  if (error) {
    console.error(`[opened-quiz-lookup] quiz-oppslaget feilet (${context}):`, error.message)
    return { status: 'error', message: error.message }
  }

  const kandidater = (data ?? []) as OpenedQuiz[]
  if (kandidater.length === 0) return { status: 'none' }

  const quiz = kandidater[0]

  // ── Flere kvalifiserende quizer samtidig ───────────────────────────────────
  // Vi behandler fortsatt kun den ene — hele sende-maskineriet nedstrøms er
  // bygget rundt ÉN quiz-snapshot, og å varsle om to samtidig ville dessuten
  // sendt to «quizen er åpen»-e-poster til samme person i samme minutt.
  //
  // Det som er endret er at de andre ikke lenger forsvinner STILLE. Fram til nå
  // tok `.limit(1)` den nyeste og de øvrige fikk aldri varsel fra noen kanal,
  // uten en linje i loggen eller en hendelse i Sentry.
  //
  // Rapporteres FØR innholdssjekken under, med vilje: er den nyeste en tom
  // placeholder-quiz, returnerer vi `empty` og kommer aldri hit — og da ville
  // nettopp den eldre, ekte quizen vært den som forsvant.
  if (kandidater.length > 1) {
    const øvrige = kandidater.slice(1)
    console.error(
      `[opened-quiz-lookup] ${kandidater.length} quizer kvalifiserte samtidig (${context}) — ` +
      `behandler "${quiz.title}" (${quiz.id}), lar ${øvrige.length} ligge`
    )
    varsleNotifyGuard('flere quizer kvalifiserte samtidig', 'error', {
      context,
      antall: kandidater.length,
      antallEksakt: kandidater.length < CANDIDATE_PROBE_LIMIT ? 'ja' : `nei — minst ${CANDIDATE_PROBE_LIMIT}`,
      behandletQuizId: quiz.id,
      behandletTittel: quiz.title,
      behandletOpensAt: quiz.opens_at,
      ubehandlede: øvrige.map(q => `${q.id} "${q.title}" opens_at=${q.opens_at}`).join(' | '),
      consequence:
        'Kun den nyest åpnede quizen varsles. De øvrige får INGEN e-post og INGEN push fra denne kanalen, ' +
        'og vil heller ikke bli plukket opp senere — vinduet lukker seg. Vurder å varsle manuelt.',
    })
  }

  if (!(await quizHasQuestions(quiz.id, context))) {
    // Høylytt, ikke stille: quizen står LIVE og tom for alle som finner den på
    // egen hånd. At varselet ble holdt tilbake fjerner ikke behovet for å gripe
    // inn — det er derfor dette er `error` og ikke `warning`.
    console.error(
      `[opened-quiz-lookup] quiz "${quiz.title}" (${quiz.id}) åpnet UTEN spørsmål — ` +
      `varsling holdt tilbake (${context})`
    )
    varsleNotifyGuard('quiz åpnet uten spørsmål', 'error', {
      context,
      quizId: quiz.id,
      quizTitle: quiz.title,
      opensAt: quiz.opens_at,
      consequence: 'Quizen er publisert og spillbar, men har ingen spørsmål med tekst. Varsling er holdt tilbake. Legg inn spørsmål, eller skjul quizen i admin.',
    })
    return { status: 'empty', quizId: quiz.id, title: quiz.title }
  }

  return { status: 'found', quiz }
}
