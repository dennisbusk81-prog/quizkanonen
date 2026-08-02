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
