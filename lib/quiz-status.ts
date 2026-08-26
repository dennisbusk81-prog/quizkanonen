// ── Quiz-status fra (opens_at, closes_at) — NULL-bevisst, ÉN definisjon ──────
//
// Flyttet hit fra app/quizer/page.tsx 26. august 2026 (NONNULL-sveipet, se
// .claude/QK_SVEIP_NONNULL_QUIZDATOER_26AUG.md) slik at /quizer og
// /admin/quizzes leser datofeltene med SAMME regel i stedet for hver sin
// inline-variant — admin-lista hadde en uguardet kopi der NULL ble epoch 1970
// og en quiz uten datoer aldri kunne være «åpen» (B3 i sveipet).
//
// Semantikken er spillestiens (lib/quiz-availability.ts, start-attempt):
//   opens_at  NULL → «har åpnet»    (ingen åpningstid å vente på)
//   closes_at NULL → «stenger aldri»
// En quiz uten datoer er dermed 'åpen' — aldri 'stengt siden 1970'.
//
// For rader med ekte datoer er dette tegn for tegn samme predikat som begge
// forgjengerne: 'åpen' ⟺ opens_at <= now && closes_at >= now (likhet på
// grensen regnes som åpen begge steder, som før).

export type QuizStatus = 'åpen' | 'kommende' | 'stengt'

export function getQuizStatus(opensAt: string | null, closesAt: string | null, now: Date): QuizStatus {
  if (opensAt && new Date(opensAt) > now) return 'kommende'
  if (closesAt && new Date(closesAt) < now) return 'stengt'
  return 'åpen'
}

/**
 * Datovisning for admin-lista: NULL er «ingen tidsgrense» og skal vises som
 * «—», aldri som new Date(null) = «01.01.1970, 01:00».
 */
export function formatQuizDateOrDash(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nb-NO', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}
