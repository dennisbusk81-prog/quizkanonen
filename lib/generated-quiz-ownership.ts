// ── Eier denne brukeren denne GENERERTE quizen? (I/O) ───────────────────────
//
// Bygget 8. september 2026 sammen med eier-grenen i lib/archive-play-gate.ts.
// Én spørring mot ledgeren `quiz_generations` (migrasjon 20260908000000):
// finnes en rad med (quiz_id, user_id)? Raden skrives kun av
// POST /api/tilfeldig-quiz, én per generering, så «finnes» er eierskap.
//
// Retningen er Loaded, ikke boolean: en lesefeil er «vet ikke», og gaten
// gjør det til 503 — aldri til «ikke eier» (usant avslag) og aldri til
// «eier» (lekkasje). Samme form som getUserPremium i lib/premium-check.ts.
//
// Brukt av BEGGE flatene som deler gaten — start-attempt og
// /api/arkiv/[id]/plassering. Ikke skriv en egen variant i en av dem.
//
// `quiz_generations` har indeks på (user_id, created_at); oppslaget
// filtrerer på user_id og quiz_id, så indeksen bærer user_id-leddet og
// quiz_id-leddet sjekkes på de få radene én bruker har. `.limit(1)` gjør
// maybeSingle trygg om samme quiz skulle stå to ganger (kan ikke skje via
// koden, men et 406 fra PostgREST skal ikke være det som stenger en eier ute).
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { Loaded } from '@/lib/fetch-result'

export async function loadGeneratedQuizOwnership(
  quizId: string,
  userId: string
): Promise<Loaded<boolean>> {
  const { data, error } = await supabaseAdmin
    .from('quiz_generations')
    .select('id')
    .eq('quiz_id', quizId)
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error(
      `[generated-quiz-ownership] kunne ikke lese eierskap for quiz ${quizId}:`,
      error.message
    )
    return { ok: false }
  }
  return { ok: true, value: data !== null }
}
