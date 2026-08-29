// ── «Slik ville du havnet den uken» — spøkelsesplasseringen ─────────────────
//
// Bygget 27. august 2026 ([ARK-1] steg 1B). Ren beslutning: ruten skaffer
// fakta (arkivforsøket, det frosne feltet, org-medlemmene, blocked-settet) og
// denne funksjonen avgjør hva som skal vises. Ingen I/O, ingen klokke.
//
// MÅLESTOKKEN ER DET ORIGINALE FELTET, IKKE SPILLERENS EGET GAMLE RESULTAT.
// «Bedre enn sist» måler HUKOMMELSE, ikke ferdighet — samme feilklasse som
// «raskere enn andre» (r = 0,06), som allerede er kastet ut av /historikk.
//
// ═══════════════════════════════════════════════════════════════════════════
// DE TRE FELLENE — alle tre er håndtert HER, hos kalleren av computePlacement
// ═══════════════════════════════════════════════════════════════════════════
//
// ── 1. TOMT FELT: computePlacement svarer «nr. 1 av 1» ─────────────────────
// Funksjonen har INGEN tom-tilstand — den legger alltid spilleren til i sitt
// eget «av N», så et tomt felt gir rank 1 av 1 (karakterisert 26. august i
// lib/compute-placement.test.ts). Den er REN og skal forbli det: «ingen
// plassering finnes» kan ikke uttrykkes av en funksjon hvis eneste jobb er å
// plassere noen i en liste.
//
// Guarden bor derfor her, og den står FØR kallet: er det rangerte feltet
// tomt, KALLES computePlacement aldri. Det er ikke en detalj — en guard
// etterpå («hvis total === 1, skjul») ville vært en tolkning av et svar
// funksjonen ikke kan gi, og den ville dessuten skjult det legitime
// tilfellet der feltet faktisk hadde nøyaktig én deltaker.
//
// Tom-tilstanden er en FØRSTEKLASSES TILSTAND fra dag én, ikke en feilsti:
// den er normalen for genererte og importerte arkivquizer, som aldri har
// hatt et felt (`sourceQuizId` er da null — se lib/archive-source-quiz.ts).
//
// ── 2. SPILLERENS EGEN ORIGINALE RAD MÅ UT AV FELTET ───────────────────────
// Spilte hun fredagsquizen den uken, ligger hun allerede i feltet. Måles
// arkivscoren mot et felt hun selv er med i, konkurrerer hun mot seg selv:
// gjorde hun det bra den gangen, dytter hennes egen gamle rad henne ett hakk
// ned nå. Raden trekkes derfor ut FØR rangeringen, ikke etter — ellers ville
// plassene 1..N vært tildelt med henne i lista og hullet blitt stående.
//
// Bieffekt som er verdt å kjenne: `total` blir da nøyaktig det ORIGINALE
// deltakertallet for en spiller som var med (N − 1 andre + henne selv = N),
// og originalen + 1 for en som ikke var med — hun trer inn i feltet. Begge
// er sanne utsagn om «slik ville du havnet». `selfWasInField` sier hvilket
// av de to som gjelder, så visningen kan si det presist.
//
// Gjester kan ikke trekkes ut: en gjesterad har ingen `user_id`, og det
// finnes ingen annen kobling til kontoen. Spilte hun originalen uinnlogget,
// blir hun stående i feltet. Kjent og akseptert — alternativet (navnematching)
// ville truffet feil personer.
//
// ── 3. ORG-MEDLEMMER MÅLES MOT DET INTERNE FELTET ─────────────────────────
// Elkjøp betaler ikke for en offentlig toppliste. «8. plass av 57» sier en
// Elkjøp-ansatt ingenting; «3. plass av 29» er noe man nevner ved
// kaffemaskinen. Org har ingen egne quizer — de spiller de samme globale
// fredagsquizene — så det interne feltet FINNES allerede for hver historisk
// quiz, som delmengden av forsøkene som tilhører medlemmene.
//
// Formen er HENTET, ikke oppfunnet: `resolveOrgMembership` +
// `.filter(user_id ∈ memberIds)` + `includeGuests: false` er nøyaktig
// app/api/leaderboard/[id]/route.ts:214-224. Medlemskapet verifiseres i
// ruten, av samme delte gate.
//
// ── BLOCKED-SETTET GJELDER KUN DET GLOBALE FELTET ─────────────────────────
// Samme skille som leaderboard-ruten gjør: i org-modus er visningen intern og
// medlemskapet verifisert — «det er nettopp dit de blokkerte hører hjemme».
// Globalt filtreres de bort, ellers ville nevneren her ikke stemt med
// tellepillen på den samme quizens offentlige resultatliste.
//
// ── HVA SOM ALDRI FORLATER FUNKSJONEN ─────────────────────────────────────
// Kun tall: rank, feltstørrelse, scope. INGEN navn — hverken topp-3 eller
// naboene over/under, som computePlacement ellers returnerer. Arkivet har
// ingen toppliste, og en spøkelsesplassering er et privat tall til én
// spiller. Utvid ikke returtypen med `above`/`below` uten å ta
// blocked-/gjeste-spørsmålet på nytt.

import { rankQuizAttempts, type RankableAttempt } from './ranking'
import { computePlacement, type SnapshotEntry } from './ranking-snapshot'

/** Feltraden slik `attempts`-oppslaget på ORIGINALQUIZEN leverer den. */
export type ArchiveFieldRow = RankableAttempt & {
  id: string
  user_id: string | null
  player_name: string
  correct_answers: number
  total_time_ms: number
  correct_streak: number | null
}

/**
 * Spillerens EGET gamle resultat på originalquizen, slik resultatlisten for
 * den quizen viser det I DAG.
 *
 * ── LES DETTE FØR DU FORMULERER NOE OM DETTE TALLET ────────────────────────
 * Dette er IKKE «det hun så den fredagen». Det er en rekonstruksjon, og den
 * er beviselig lik dagens `/api/leaderboard/[kilde-id]` (samme
 * `rankQuizAttempts`, samme opsjoner, samme blokkert-filter — se
 * app/api/leaderboard/[id]/route.ts:216 mot linja under). Men to ting kan ha
 * flyttet den siden den kvelden:
 *
 *   1. RADER KAN VÆRE SLETTET. Tre produksjonsruter hard-sletter `attempts`:
 *      app/api/profile/delete (GDPR art. 17, bevisst), app/api/admin/users/[id]
 *      og app/api/admin/quizzes/[id]/reset (tømmer HELE feltet). Slettet én
 *      som lå over henne kontoen sin, er hennes rekonstruerte plassering
 *      BEDRE enn den hun så.
 *   2. FASITEN KAN VÆRE RETTET. app/api/admin/correct-answer:198 skriver
 *      `attempts.correct_answers` og `correct_streak` på nytt. Da er dette
 *      den RETTEDE sannheten, ikke tallet på skjermen den kvelden.
 *
 * Derfor sier teksten «står i dag» (lib/archive-result-view.ts), ikke «du
 * fikk». Setningen påstår ikke hva hun så — den peker på en liste hun kan
 * åpne og verifisere, og som per konstruksjon viser nøyaktig dette tallet.
 * Endrer du ordlyden, ta med den forskjellen.
 *
 * `season_scores.rank` ble vurdert som «lagret fasit» og FORKASTET: den
 * utelater gjester (nøklet på user_id), bruker delt plassering ved likhet der
 * leaderboardet bruker strengt økende, regner rank FØR blokkert-filteret, og
 * skrives også om ved fasitretting (lib/resync-season-scores.ts). Den er et
 * annet tall for et annet formål — ikke en bedre kilde.
 */
export type ArchivePreviousResult = {
  /** Plasseringen på originalquizens resultatliste slik den står i dag. */
  rank: number
  /** Antall riktige. Ingen nevner: en DELVIS arkivkopi kan ha færre
   *  spørsmål enn originalen, så kopiens spørsmålstall er ikke originalens. */
  correctAnswers: number
}

export type ArchivePlacementOutcome =
  | {
      kind: 'plassering'
      /** Plasseringen spilleren VILLE fått i det originale feltet. */
      rank: number
      /** Nevneren rank garantert ligger innenfor (feltet + spilleren selv). */
      total: number
      /** Det frosne feltet etter scoping, uten spillerens egen gamle rad. */
      fieldSize: number
      /** Spilte hun originalen? Da er `total` det originale deltakertallet. */
      selfWasInField: boolean
      /** Hennes eget gamle resultat, eller null om hun ikke var med. */
      previous: ArchivePreviousResult | null
      scope: 'org' | 'global'
    }
  | { kind: 'ingen'; reason: 'ingen-kilde' | 'tomt-felt' | 'lagforsok' }

export function decideArchivePlacement(input: {
  /** `quizzes.source_quiz_id` på arkivkopien. NULL → aldri hatt et felt. */
  sourceQuizId: string | null
  /** Alle leverte solo-forsøk på ORIGINALQUIZEN. */
  field: readonly ArchiveFieldRow[]
  self: {
    userId: string
    correctAnswers: number
    totalTimeMs: number
    isTeam: boolean
  }
  /** Satt → org-scope (internt felt). null → globalt felt. */
  orgMemberIds: readonly string[] | null
  /** Globalt blokkerte brukere. Ignoreres med vilje i org-scope. */
  blockedUserIds: ReadonlySet<string>
}): ArchivePlacementOutcome {
  // FELLE 1, del A: ingen kilde → ingen frosset felt. Genererte og delvise
  // arkivquizer lander her, og det er normaltilstanden for dem.
  if (input.sourceQuizId === null) return { kind: 'ingen', reason: 'ingen-kilde' }

  // Feltet er solo-populasjonen (is_team=false). Et lagforsøk har ingen
  // sammenlignbar målestokk — og å måle et lag mot enkeltspillere ville vært
  // å finne på en konkurranse som aldri fantes.
  if (input.self.isTeam) return { kind: 'ingen', reason: 'lagforsok' }

  const scope: 'org' | 'global' = input.orgMemberIds ? 'org' : 'global'

  // FELLE 3: org-medlemmer måles mot det interne feltet. Samme form som
  // leaderboard-ruten — medlemsfilter på user_id, gjester faller ut.
  // Globalt: blocked-settet ut, gjester beholdes (de er en del av feltet).
  const memberSet = input.orgMemberIds ? new Set(input.orgMemberIds) : null
  const scoped = memberSet
    ? input.field.filter((r) => r.user_id !== null && memberSet.has(r.user_id))
    : input.field.filter((r) => r.user_id === null || !input.blockedUserIds.has(r.user_id))

  // FELLE 2: egen original rad UT — før rangeringen, ikke etter.
  const selfWasInField = scoped.some((r) => r.user_id === input.self.userId)
  const withoutSelf = scoped.filter((r) => r.user_id !== input.self.userId)

  const rankOptions = {
    includeGuests: memberSet ? false : true,
    requireSubmitted: true,
  }

  // ── Hennes eget gamle resultat, på det UFILTRERTE feltet ─────────────────
  // Spøkelsesplasseringen rangerer `withoutSelf` — hun skal ikke konkurrere
  // mot seg selv. Det gamle resultatet må rangeres på `scoped`, MED henne i,
  // fordi hun beviselig var i feltet den gangen. To ulike spørsmål, to ulike
  // populasjoner, med vilje.
  //
  // Samme `rankOptions` som spøkelsesplasseringen og som
  // /api/leaderboard/[id]: det er dette som gjør tallet etterprøvbart mot
  // resultatlisten hun kan åpne. Ikke la de to drifte fra hverandre.
  //
  // Kun beregnet når hun faktisk var med — ellers finnes det ikke noe å
  // rekonstruere, og en spiller som ikke deltok skal ikke koste en sortering.
  //
  // `rankQuizAttempts` deduper til beste forsøk per spiller (ranking.ts:127),
  // så flere gamle forsøk gir samme rad som resultatlisten viser.
  // Finner vi henne likevel ikke — hun ble filtrert bort av `requireSubmitted`
  // eller `includeGuests` — blir det null, ikke en gjetning. Da faller
  // teksten tilbake til setningen uten tillegg.
  let previous: ArchivePreviousResult | null = null
  if (selfWasInField) {
    const meg = rankQuizAttempts(scoped, rankOptions)
      .find((r) => r.user_id === input.self.userId)
    if (meg) previous = { rank: meg.rank, correctAnswers: meg.correct_answers }
  }

  const ranked = rankQuizAttempts(withoutSelf, rankOptions)

  // FELLE 1, del B: guarden STÅR FØR kallet. Et tomt felt gir «nr. 1 av 1»
  // hvis det slippes inn i computePlacement — les filhodet før du flytter
  // denne linja ned.
  if (ranked.length === 0) return { kind: 'ingen', reason: 'tomt-felt' }

  const entries: SnapshotEntry[] = ranked.map((a) => ({
    id: a.id,
    user_id: a.user_id,
    player_name: a.player_name,
    rank: a.rank,
    correct_answers: a.correct_answers,
    total_time_ms: a.total_time_ms,
    correct_streak: a.correct_streak ?? 0,
  }))

  const placement = computePlacement(entries, {
    // Arkivforsøket er IKKE i det frosne feltet (det ligger på kopiens
    // quiz-id), så self-grenen skal aldri treffe. `null` sier det eksplisitt
    // i stedet for å hvile på at id-ene tilfeldigvis ikke kolliderer.
    attemptId: null,
    correct: input.self.correctAnswers,
    time: input.self.totalTimeMs,
    // false → `total = felt + 1`. Riktig og nødvendig: spilleren er beviselig
    // ikke i feltet (raden hennes er nettopp trukket ut), og grenen er den
    // eneste som garanterer rank <= total også når hun ville havnet sist.
    playerInPool: false,
    // Ingen projeksjon: både hennes tall og feltets gjelder hele quizen.
    // (`answered`/`totalQuestions` utelatt — se computePlacement.)
  })

  return {
    kind: 'plassering',
    rank: placement.rank,
    total: placement.total,
    fieldSize: ranked.length,
    selfWasInField,
    previous,
    scope,
  }
}
