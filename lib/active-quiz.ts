import { unstable_cache } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { onlyRealQuizzes } from '@/lib/real-quiz-population'

// ── Hvilken quiz er ÅPEN NÅ — for «Spill» i den globale topplinjen ──────────
//
// Kalles fra app/layout.tsx (server) én gang per sideforespørsel og gis
// klienten via components/ActiveQuizProvider.tsx. Fram til 6. september 2026
// visste bare forsiden hvilken quiz som var åpen (server-data sendt som prop
// til sin egen lokale <SiteNav quizId>), så «Spill» fantes bare der.
//
// ── SAMME KRITERIER SOM FORSIDENS QUIZ-KORT, MED VILJE ─────────────────────
// Spørringen speiler `activeBase` i app/page.tsx linje for linje:
// `opens_at <= nå`, `closes_at` NULL eller >= nå, nyeste først, og hele
// kjeden inne i `onlyRealQuizzes()` — hvitelisten på quiz_type + is_test-
// vakten som holder arkivkopier og testquizer ute. Forsiden og topplinjen
// kan derfor ikke være uenige om hvilken quiz som er åpen.
//
// IKKE /api/quiz/active. Den ruta mangler hvitelisten og bruker
// `.eq('is_test', false)` (slipper is_test IS NULL forbi). At den ikke
// returnerer en arkivkopi i dag skyldes at kopiene har opens_at NULL — en
// tilfeldighet i dataene, ikke et valg i koden. Bygg ikke mer på den.
//
// ── CACHE OG FEIL ───────────────────────────────────────────────────────────
// Samme revalidate (60 s) og samme tag ('home-shared-data') som forsidens
// bundel, så cron/publish-quiz sin purge når også denne når en quiz åpner
// eller stenger. Feil KASTES inne i den cachede funksjonen — et kast når
// aldri cachen, så en forbigående lesefeil kan ikke fryse «ingen quiz» i
// 60 sekunder for alle (samme lærdom som forsidens v5-bump). Kastet fanges
// UTENFOR, i getActiveQuizId(): rot-layouten skal aldri feile på grunn av
// en pyntelenke. null herfra betyr «vet ikke» og gir ingen «Spill»-lenke —
// en manglende lenke er en degradering, ikke en usann påstand.
async function computeActiveQuizId(): Promise<string | null> {
  const nowIso = new Date().toISOString()
  const base = supabaseAdmin
    .from('quizzes')
    .select('id')
    .lte('opens_at', nowIso)
    .or(`closes_at.is.null,closes_at.gte.${nowIso}`)
    .order('opens_at', { ascending: false })
    .limit(1)
  const { data, error } = await onlyRealQuizzes(base)
  if (error) throw new Error(`[active-quiz] lesefeil: ${error.message}`)
  const rows = (data ?? []) as { id: string }[]
  return rows[0]?.id ?? null
}

const getCachedActiveQuizId = unstable_cache(
  computeActiveQuizId,
  ['active-quiz-id-v1'],
  { revalidate: 60, tags: ['home-shared-data'] },
)

export async function getActiveQuizId(): Promise<string | null> {
  try {
    return await getCachedActiveQuizId()
  } catch (err) {
    console.error('[active-quiz] kunne ikke avgjøre åpen quiz — «Spill» skjules:', err)
    return null
  }
}
