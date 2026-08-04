// Kategorisammendraget på resultatskjermen (app/quiz/[id]/page.tsx). Ren
// funksjon, testdekket i category-stats.test.ts.
//
// Invarianten (QK_4 punkt 12, 2. august 2026): summen av `total` over alle
// rader skal være antall besvarte spørsmål — sammendraget står på samme skjerm
// som «X av N riktige», og en liste som teller til N−1 ser ut som en regnefeil.
// Fram til 2. august ble svar på spørsmål uten kategori droppet fra alle bøtter
// (4 av 199 spørsmål i banken manglet kategori per 30. juli), og rå, utrimmede
// kategoristrenger ga egne bøtter for «Historie » og «historie».
//
// «Diverse» telles her på linje med andre kategorier: sammendraget påstår bare
// antall riktige per kategori, som er sant også for en sekkepost.
// CATEGORY_MESSAGE_EXCLUDED (lib/select-quiz-message.ts) gjelder kun
// skryte-meldingen på mellomskjermen — «Du kan Diverse, du» er meningsløst,
// «Diverse 2/3» er det ikke.

export const UNCATEGORIZED_LABEL = 'Uten kategori'

export interface CategoryStat {
  category: string
  correct: number
  total: number
}

// ── Sterkeste/svakeste kategori på tvers av all historikk ────────────────────
// Brukt av getPlayerStats() i lib/history.ts. Bygger på computeCategoryStats
// over ALLE brukerens svar, ikke ett forsøk — funksjonen over vet ikke
// forskjell, og skal ikke vite det.

// Minste antall BESVARTE spørsmål i en kategori før den kan kalles sterkest
// eller svakest. 3 er samme tall som CATEGORY_MESSAGE_THRESHOLD i
// lib/select-quiz-message.ts, bevisst: «sterk i Historie» bør bety det samme
// på mellomskjermen og på /historikk.
//
// Målt mot prod 2. august 2026 (130 spillere, median 45 svar hver): terskel 3
// gir 120 av 130 spillere to kvalifiserte kategorier, terskel 4 gir 104, og
// terskel 5 faller til 85. Fallet skjer fordi de små kategoriene (Kunst &
// Kultur, Mat & Drikke, Politikk & Samfunn) ligger på 2–5 svar selv for de
// mest aktive. 2 ble valgt bort fordi 1 av 2 riktige = 50 % er et myntkast.
export const STRENGTH_MIN_ANSWERS = 3

// Kategorier som aldri kan bli sterkest eller svakest: rene sekkeposter, ikke
// ferdigheter. «Du er svakest i Diverse» gir spilleren ingenting å gjøre noe
// med, og Diverse er samtidig den STØRSTE kategorien i banken (34 av 199
// spørsmål per 2. august) — altså den som oftest klarer terskelen. Uten denne
// lista ville Diverse blitt valgt som sterkeste for 18 og svakeste for 20 av
// 130 spillere, målt mot prod.
//
// BEVISST IKKE gjenbruk av CATEGORY_MESSAGE_EXCLUDED i
// lib/select-quiz-message.ts, selv om lista er identisk i dag: den er
// dokumentert som tekstøktens eiendom («Tekstøkten kan utvide lista»), og en
// utvidelse gjort av tekstlige grunner skal ikke stille endre hvilke tall
// /historikk viser. Samme verdi, to eiere.
export const STRENGTH_EXCLUDED_CATEGORIES = ['diverse']

export interface CategoryStrength {
  sterkeste: string | null
  svakeste: string | null
  // Andel riktige i prosent for de to kategoriene over, avrundet med
  // Math.round som resten av /historikk (pct() i lib/history.ts).
  //
  // Prosenten følger kategorien sin: er kategorien null, er prosenten null, og
  // omvendt. De skal ALDRI kunne stå fra hverandre — et prosenttall uten
  // kategori ville vært et tall uten påstand, og en kategori uten tall er
  // nettopp det denne utvidelsen fjernet.
  sterkesteProsent: number | null
  svakesteProsent: number | null
  // Råtallene bak prosenten. Prosenten alene skjuler hvor tynt den hviler:
  // terskelen er 3 svar, så «100 %» er ofte 3 av 3. Målt mot prod 4. august
  // 2026 fikk 3 av de 4 mest aktive spillerne nettopp Kunst & Kultur 3/3 =
  // 100 % som sterkeste. Kalleren viser derfor begge deler, og trenger
  // nevneren for å kunne gjøre det.
  //
  // Utledes IKKE i UI-et fra prosenten (100 % kan være 3/3 eller 11/11) —
  // de er egne tall og må hentes som egne tall.
  sterkesteRiktige: number | null
  sterkesteBesvart: number | null
  svakesteRiktige: number | null
  svakesteBesvart: number | null
}

const EMPTY_STRENGTH: CategoryStrength = {
  sterkeste: null,
  svakeste: null,
  sterkesteProsent: null,
  svakesteProsent: null,
  sterkesteRiktige: null,
  sterkesteBesvart: null,
  svakesteRiktige: null,
  svakesteBesvart: null,
}

/**
 * Velger sterkeste og svakeste kategori ut fra andel riktige.
 *
 * KREVER MINST TO kvalifiserte kategorier. «Sterkest» og «svakest» er
 * sammenligninger — med bare én målt kategori finnes det ingenting å
 * sammenligne mot, og å kalle den både sterkest og svakest ville vært tomt.
 * Da returneres null for BEGGE, aldri en vilkårlig kategori.
 *
 * Ekskludert fra utvalget, i denne rekkefølgen:
 *   1. UNCATEGORIZED_LABEL — «Uten kategori» er fraværet av en kategori.
 *   2. STRENGTH_EXCLUDED_CATEGORIES — sekkeposter.
 *   3. Kategorier med færre enn `minAnswers` besvarte spørsmål.
 *
 * Uavgjort brytes deterministisk: flest besvarte først (mest belegg), deretter
 * kategorinavn stigende. Uten det ville to kategorier på samme andel byttet
 * plass mellom to sidelastinger.
 */
export function pickCategoryStrength(
  stats: CategoryStat[],
  opts: { minAnswers?: number; excluded?: readonly string[] } = {},
): CategoryStrength {
  const minAnswers = opts.minAnswers ?? STRENGTH_MIN_ANSWERS
  const excluded = (opts.excluded ?? STRENGTH_EXCLUDED_CATEGORIES).map(c => c.trim().toLowerCase())

  const eligible = stats.filter(s => {
    const key = s.category.trim().toLowerCase()
    if (key === UNCATEGORIZED_LABEL.toLowerCase()) return false
    if (excluded.includes(key)) return false
    return s.total >= minAnswers
  })

  if (eligible.length < 2) return EMPTY_STRENGTH

  const rate = (s: CategoryStat) => s.correct / s.total
  // To separate sorteringer framfor first/last på én: tie-breaket skal peke
  // samme vei i begge ender (flest svar vinner), og det gjør det ikke hvis man
  // leser den siste raden av en synkende sortering.
  const byBest = [...eligible].sort(
    (a, b) => rate(b) - rate(a) || b.total - a.total || a.category.localeCompare(b.category, 'nb'),
  )
  const byWorst = [...eligible].sort(
    (a, b) => rate(a) - rate(b) || b.total - a.total || a.category.localeCompare(b.category, 'nb'),
  )

  // Prosenten regnes fra de SAMME radene som ble valgt, ikke slås opp på nytt
  // på kategorinavn: to bøtter kan ha samme navn i ulik skrivemåte, og et
  // oppslag ville da kunne treffe en annen rad enn den sorteringen valgte.
  const best = byBest[0]
  const worst = byWorst[0]
  const asPct = (s: CategoryStat) => (s.total > 0 ? Math.round(rate(s) * 100) : 0)

  return {
    sterkeste: best.category,
    svakeste: worst.category,
    sterkesteProsent: asPct(best),
    svakesteProsent: asPct(worst),
    sterkesteRiktige: best.correct,
    sterkesteBesvart: best.total,
    svakesteRiktige: worst.correct,
    svakesteBesvart: worst.total,
  }
}

// Kobler på questionId → question.id, IKKE på indeks (withAnswer flytter
// re-besvarte spørsmål bakerst i answers — samme mønster som
// computeStrongCategory). Bøtter i første-svar-rekkefølge, slått sammen
// case-insensitivt med sist sette trimmede variant som visningsform. Svar uten
// kategori (null/tom/whitespace, eller questionId uten treff i questions)
// samles under UNCATEGORIZED_LABEL, alltid nederst.
//
// Uten reelle kategorier returneres tom liste — et sammendrag som KUN består av
// «Uten kategori» bryter ingen sum, men sier ingenting, og seksjonen skjules.
export function computeCategoryStats(
  answers: { questionId: string; isCorrect: boolean }[],
  questions: ({ id: string; category: string | null } | undefined)[],
): CategoryStat[] {
  const catById = new Map<string, string>()
  for (const q of questions) {
    const trimmed = q?.category?.trim()
    if (!q || !trimmed) continue
    catById.set(q.id, trimmed)
  }

  const buckets = new Map<string, { display: string; correct: number; total: number }>()
  let uncatCorrect = 0
  let uncatTotal = 0
  for (const a of answers) {
    const cat = catById.get(a.questionId)
    if (!cat) {
      uncatTotal++
      if (a.isCorrect) uncatCorrect++
      continue
    }
    const key = cat.toLowerCase()
    const b = buckets.get(key) ?? { display: cat, correct: 0, total: 0 }
    b.display = cat
    b.total++
    if (a.isCorrect) b.correct++
    buckets.set(key, b)
  }

  if (buckets.size === 0) return []

  const result: CategoryStat[] = [...buckets.values()].map(
    ({ display, correct, total }) => ({ category: display, correct, total })
  )
  if (uncatTotal > 0) {
    // En reell kategori kan i teorien hete «Uten kategori» — slå sammen i
    // stedet for å vise to like rader.
    const collision = result.find(
      r => r.category.toLowerCase() === UNCATEGORIZED_LABEL.toLowerCase()
    )
    if (collision) {
      collision.correct += uncatCorrect
      collision.total += uncatTotal
    } else {
      result.push({ category: UNCATEGORIZED_LABEL, correct: uncatCorrect, total: uncatTotal })
    }
  }
  return result
}
