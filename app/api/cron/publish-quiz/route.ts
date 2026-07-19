import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { revalidateTag } from 'next/cache'
import { processQuiz } from '@/lib/award-season-points'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Eksplisitt cache-invalidering av forsidens delte data hvert minutt (denne
  // cronen kjører allerede hvert minutt uansett). Forsidens "quiz er åpen"-
  // status styres av opens_at/closes_at-tidsstempler alene (ingen is_active-
  // avhengighet), så unstable_cache sitt 60s revalidate-vindu ALENE holdt ikke
  // dette ferskt i praksis — en kvalifiserende quiz forble usynlig på forsiden
  // i over 12 minutter i en verifisering, til tross for at spørringen fant den
  // korrekt ved direkte DB-oppslag. Mest sannsynlige årsak: unstable_cache sin
  // stale-while-revalidate-bakgrunnsjobb kan bli kuttet før den fullfører på
  // Vercel sin serverless-plattform, siden den ikke kjøres i en garantert
  // waitUntil-kontekst. Fremfor å stole på at den passive tidsbaserte
  // revalideringen faktisk fullfører, tvinger vi en fersk cache hvert minutt
  // her — uavhengig av om noen quiz faktisk endret status denne kjøringen.
  // { expire: 0 } = purg umiddelbart (denne Next.js-versjonen krever en
  // cache-life-profil som andre argument til revalidateTag).
  revalidateTag('home-shared-data', { expire: 0 })
  revalidateTag('home-page-insights', { expire: 0 })

  const now = new Date().toISOString()

  // ── Publiser quizer som er klare til å åpne ───────────────────────────────
  const { data, error } = await supabaseAdmin
    .from('quizzes')
    .update({ is_active: true })
    .eq('is_active', false)
    .lte('scheduled_at', now)
    .not('scheduled_at', 'is', null)
    .select('id, title')

  if (error) {
    console.error('[cron/publish-quiz] error:', error.code, error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const count = data?.length ?? 0
  if (count > 0) {
    console.log('[cron/publish-quiz] published:', data?.map(q => q.title).join(', '))
  }

  // ── Tildel sesongpoeng for quizer som nettopp har stengt ──────────────────
  // Kjøres her slik at poengene er synlige umiddelbart etter closes_at, i stedet
  // for å vente opptil 5 minutter på neste award-season-points-kjøring.
  // award-season-points-cronen er idempotent (season_points_awarded-flagget), så
  // dobbel kjøring er ufarlig.
  const { data: closedQuizzes, error: closedError } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, closes_at')
    .lt('closes_at', now)
    .eq('season_points_awarded', false)
    .order('closes_at', { ascending: true })
    .limit(5)

  if (closedError) {
    console.error('[cron/publish-quiz] closed-quiz lookup error:', closedError.message)
  } else if (closedQuizzes && closedQuizzes.length > 0) {
    const snapshot = closedQuizzes as { id: string; title: string; closes_at: string }[]
    waitUntil(
      (async () => {
        for (const quiz of snapshot) {
          console.log(`[cron/publish-quiz] tildeler sesongpoeng for "${quiz.title}"`)
          const { rows, error: procError } = await processQuiz(quiz.id, quiz.closes_at)
          if (procError) {
            console.error(`[cron/publish-quiz] sesongpoeng feilet for "${quiz.title}":`, procError)
          } else {
            console.log(`[cron/publish-quiz] sesongpoeng OK for "${quiz.title}" — ${rows} rader`)
          }
        }
      })()
    )
  }

  return NextResponse.json({ published: count, quizzes: data })
}
