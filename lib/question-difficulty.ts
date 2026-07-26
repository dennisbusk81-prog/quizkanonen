/**
 * Ren logikk for å plukke ut de(n) letteste og vanskeligste spørsmålene fra
 * en quiz sin per-spørsmål svarstatistikk.
 *
 * Trukket ut 26. juli 2026. Denne beregningen (sorter på riktig-prosent,
 * plukk fra hver ende) fantes tidligere som TRE separate inline-kopier:
 * app/api/admin/quizzes/[id]/results/route.ts (1+1, krav ≥2 svar),
 * app/api/admin/quiz-results-text/route.ts (1+1, egen sortering) og
 * app/api/org/[slug]/quiz-insights/route.ts (1 lettest, inntil 3 vanskeligst).
 * Denne filen erstatter kun den FØRSTE (den DEL 2 i sesong-topplisten trengte
 * samme grunnlag som), og gjør den parametrisert på antall slik at admin sin
 * 1+1 og den nye Premium-visningens 2+2 bruker samme kode. De to andre
 * inline-kopiene er urørt — utenfor denne oppgavens omfang, se
 * project-question-difficulty-extraction-2026-07-26 i minnet for detaljer.
 */

export type QuestionDifficulty = {
  question_id: string
  order_index: number
  question_text: string
  total: number
  correct: number
  correct_pct: number
}

/**
 * Plukker `count` letteste og `count` vanskeligste spørsmål, uten overlapp.
 *
 * Kvalifiserer kun spørsmål med minst `minAnswers` svar (samme terskel som
 * admin-siden alltid har brukt: et spørsmål to spillere har rukket å svare
 * på, er nok til at prosenten betyr noe — færre gir tilfeldige 0%/100%-utslag).
 *
 * Overlapp-fri ved konstruksjon: `easiestCount` og `hardestCount` deler
 * alltid opp den kvalifiserte lista uten at noe spørsmål kan havne i begge —
 * ved få kvalifiserte spørsmål krymper begge sider heller enn å gjenta et
 * spørsmål. Med `count=1` er dette bit-for-bit identisk med den opprinnelige
 * admin-logikken (verifisert i lib/question-difficulty.test.ts): easiest er
 * alltid det ene letteste kvalifiserte spørsmålet hvis noen finnes, hardest
 * er null (tom liste) med under 2 kvalifiserte, ellers det siste i sortert
 * rekkefølge.
 */
export function selectEasiestAndHardest(
  stats: readonly QuestionDifficulty[],
  count: number,
  minAnswers = 2
): { easiest: QuestionDifficulty[]; hardest: QuestionDifficulty[] } {
  const qualified = stats.filter(s => s.total >= minAnswers)
  if (qualified.length === 0) return { easiest: [], hardest: [] }

  const sorted = [...qualified].sort((a, b) => b.correct_pct - a.correct_pct)

  const easiestCount = Math.min(count, Math.ceil(sorted.length / 2))
  const hardestCount = Math.min(count, sorted.length - easiestCount)

  const easiest = sorted.slice(0, easiestCount)
  // Vanskeligste vises verste-først: sorted er allerede DESC på pct, siste
  // elementer er lavest pct — reverse() gir "verst, så nest verst" osv.
  const hardest = hardestCount > 0
    ? sorted.slice(sorted.length - hardestCount).reverse()
    : []

  return { easiest, hardest }
}
