// ── Deltakelsesrekke: hvor mange fredagsquizer på rad spilleren har spilt ────
//
// IKKE FORVEKSLE MED `attempts.correct_streak`. Det er riktige svar på rad
// INNE I ÉN quiz og har ingenting med denne filen å gjøre. Feltene som faller
// ut herfra heter derfor `deltakelsesrekke`, ikke noe med «streak» i seg —
// `PlayerStats.best_streak` er allerede opptatt av det andre begrepet, og to
// ting som begge heter «streak» i samme objekt blir blandet før eller siden.
//
// NEVNEREN — den eneste reelle designbeslutningen:
// Rekken måles mot QUIZENE SOM FAKTISK GIKK, ikke mot kalenderuker. Hopper
// Dennis over en fredag, finnes det ingen quiz å ha spilt, og fraværet skal
// ikke straffe spilleren. Populasjonen er derfor den samme markøren
// lib/retention.ts allerede bruker — `season_points_awarded = true` og
// `is_test = false` — ikke en datosammenligning på closes_at. (Målt mot prod
// 2. august 2026: 13 quizer finnes, 7 er gjort opp, 6 er planlagt fram til
// september. En dato-basert nevner ville talt de 6 planlagte som misser.)
//
// Fordi rekken hopper over uker uten quiz, er hele beregningen INDEKSBASERT
// over en ferdig sortert liste. Datoene brukes til å sortere og til å avgrense
// populasjonen — aldri til å regne avstand.

export type StreakQuiz = {
  id: string
  /**
   * `season_points_awarded` — quizen er stengt og gjort opp.
   *
   * En quiz som er åpnet, men ikke gjort opp ennå, er behandlet asymmetrisk;
   * se `computeParticipationStreak`.
   */
  settled: boolean
}

export type ParticipationStreak = {
  /**
   * Rekken som løper NÅ. 0 når spilleren ikke var med på siste gjorte opp quiz
   * — altså når rekken er brutt. Se filhodet i lib/history.ts for hvorfor det
   * er 0 og ikke den siste avsluttede rekken.
   */
  current: number
  /** Lengste rekke noensinne. Aldri lavere enn `current`. */
  longest: number
}

const EMPTY: ParticipationStreak = { current: 0, longest: 0 }

/**
 * Nåværende og lengste deltakelsesrekke.
 *
 * `quizzes` MÅ være sortert STIGENDE på opens_at — rekkefølgen er hele
 * grunnlaget for hva «på rad» betyr, på samme måte som i `computeRetention`.
 * `playedQuizIds` er quizene spilleren faktisk leverte inn (submitted_at satt);
 * duplikater er ufarlige, siden lista uansett slås om til et sett.
 *
 * ÅPEN, IKKE GJORT OPP QUIZ — den ene ikke-opplagte regelen:
 * En quiz som er åpnet, men ikke gjort opp ennå, teller som et ledd i kjeden
 * HVIS spilleren har spilt den, og er ellers helt usynlig — den bryter ingen
 * rekke. Asymmetrien speiler hva som faktisk er kjent: at noen HAR deltatt er
 * et faktum i samme øyeblikk `submitted_at` settes, mens at noen IKKE deltar
 * først er avgjort når quizen er stengt. Vinduet er ikke teoretisk: cronen
 * gjør opp først etter `closes_at` (`.lt('closes_at', now)` i
 * app/api/cron/award-season-points/route.ts), så hver fredag mellom 10:00 og
 * ~20:05 — nøyaktig når folk spiller — er kveldens quiz i denne gråsonen.
 * Uten regelen ville en spiller som nettopp leverte sett rekken sin stå
 * stille til langt på kveld.
 *
 * Samme regel gjør at en quiz som er åpnet og så avlyst eller aldri gjort opp
 * ikke bryter rekken til noen — den blir bare stående som et hull ingen
 * merker.
 *
 * Grensetilfeller, eksplisitt:
 *   • aldri spilt            → { current: 0, longest: 0 }
 *   • ingen quizer i det hele tatt → { current: 0, longest: 0 }
 *   • kun én quiz spilt, den siste → { current: 1, longest: 1 }
 *   • spilte før, men ikke siste gjorte opp quiz → current 0, longest bevart
 */
export function computeParticipationStreak(
  quizzes: readonly StreakQuiz[],
  playedQuizIds: Iterable<string>,
): ParticipationStreak {
  const played = new Set(playedQuizIds)
  if (quizzes.length === 0 || played.size === 0) return EMPTY

  let run = 0
  let longest = 0

  for (const quiz of quizzes) {
    if (played.has(quiz.id)) {
      run++
      if (run > longest) longest = run
      continue
    }
    // Ikke spilt. Kun en GJORT OPP quiz kan bryte rekken; en åpen quiz er
    // ennå ikke en miss.
    if (quiz.settled) run = 0
  }

  return { current: run, longest }
}
