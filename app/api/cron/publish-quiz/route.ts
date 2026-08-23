import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { revalidateTag } from 'next/cache'
import { processQuiz } from '@/lib/award-season-points'
import { RESETTLE_SCAN_MS } from '@/lib/late-play-window'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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

  // ── Betinget cache-invalidering av forsidens delte data ───────────────────
  // Forsidens "quiz er åpen"-status styres av opens_at/closes_at-tidsstempler
  // alene (ingen is_active-avhengighet), så unstable_cache sitt 60s
  // revalidate-vindu ALENE holdt ikke dette ferskt i praksis — en
  // kvalifiserende quiz forble usynlig på forsiden i over 12 minutter i en
  // verifisering (se a32dff9). Mest sannsynlige årsak: unstable_cache sin
  // stale-while-revalidate-bakgrunnsjobb kan bli kuttet før den fullfører på
  // Vercel sin serverless-plattform. Derfor tvinger denne cronen (hvert
  // minutt) en fersk cache — men KUN når forsidedataene faktisk kan ha endret
  // seg siden forrige kjøring:
  //   1. UPDATE-en over publiserte minst én quiz, ELLER
  //   2. en ekte quiz er åpen NÅ (participantCount er live sosialt bevis som
  //      tikker mens quizen pågår, og selve overgangen ved opens_at skjer uten
  //      at noen rad skrives), ELLER
  //   3. en ekte quiz stengte i løpet av de siste 10 minuttene (topp 3 fra
  //      sist stengte quiz, månedstopplisten etter processQuiz-poengtildeling
  //      og innsikts-cachen endrer seg alle rett ETTER stengetid).
  // Utenfor disse vinduene — altså mesteparten av uken — får cachen leve, og
  // forsidens tyngste spørringer (nestet embed quizzes→attempts→
  // attempt_answers over inntil 500 forsøk) rekomputeres ikke for hvert
  // bot-/menneskebesøk. Sakte-bevegelige admin-endringer (f.eks. redigert
  // "neste quiz"-tekst) propagerer da via det ordinære 60s-vinduet i stedet.
  // Oppslaget speiler forsidens activeQuiz-filter (is_test=false, opens_at
  // passert, closes_at null eller ikke passert) med stengegrensen skjøvet 10
  // minutter bakover. Ved oppslagsfeil purger vi (fail-open = dagens atferd).
  // { expire: 0 } = purg umiddelbart (denne Next.js-versjonen krever en
  // cache-life-profil som andre argument til revalidateTag).
  const purgeWindowStart = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { data: liveQuizzes, error: liveError } = await supabaseAdmin
    .from('quizzes')
    .select('id')
    .eq('is_test', false)
    .lte('opens_at', now)
    .or(`closes_at.is.null,closes_at.gte.${purgeWindowStart}`)
    .limit(1)

  if (liveError) {
    console.error('[cron/publish-quiz] live-quiz lookup error (purger likevel):', liveError.message)
  }
  if (count > 0 || liveError !== null || (liveQuizzes?.length ?? 0) > 0) {
    revalidateTag('home-shared-data', { expire: 0 })
    revalidateTag('home-page-insights', { expire: 0 })
  }

  // ── Tildel sesongpoeng for quizer som nettopp har stengt ──────────────────
  // Kjøres her slik at poengene er synlige umiddelbart etter closes_at, i stedet
  // for å vente opptil 5 minutter på neste award-season-points-kjøring.
  // award-season-points-cronen er idempotent (season_points_awarded-flagget), så
  // dobbel kjøring er ufarlig.
  // Samme is_test-guard som i award-season-points-cronen — denne ruten kjører
  // hvert minutt og ville ellers gjort opp en testquiz FØR 5-minutters-cronen
  // i det hele tatt så den. is_active bevisst ikke filtrert, samme begrunnelse.
  const { data: closedQuizzes, error: closedError } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, closes_at')
    .lt('closes_at', now)
    .eq('season_points_awarded', false)
    .eq('is_test', false)
    .order('closes_at', { ascending: true })
    .limit(5)

  if (closedError) {
    console.error('[cron/publish-quiz] closed-quiz lookup error:', closedError.message)
  }
  const snapshot = (closedQuizzes ?? []) as { id: string; title: string; closes_at: string }[]

  // Førstegangs-oppgjør og rekjøring i SAMME waitUntil, i den rekkefølgen —
  // to parallelle blokker kunne latt rekjøringen se et halvt oppgjør.
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

      // ── Rekjøringsvinduet (Endring 2, 24. august 2026) ────────────────────
      // Oppgjøret over kjører kl. closes_at som før — men en spiller som var i
      // gang FØR stengetid kan levere i inntil SUBMIT_GRACE_MS etterpå (B-10).
      // Uten dette havnet hun på quiz-topplisten (som leser attempts direkte)
      // uten sesongpoeng, permanent. Her etterjusteres nylig oppgjorte quizer
      // så lenge en sen innsending faktisk finnes.
      //
      // Utvalget ER beskyttelsen mot retroaktiv historieomskriving: processQuiz
      // regner populasjonen fra DAGENS medlemskapstabeller, og upserten er nå
      // en merge som faktisk overskriver (se upsertScores i
      // lib/award-season-points.ts). Innenfor RESETTLE_SCAN_MS rekker
      // medlemskap ikke å drifte; utenfor vinduet skal processQuiz aldri
      // kalles mot en oppgjort quiz. Vaktspørringen speiler sesongpoeng-
      // populasjonen (solo, innlogget — lib/season-attempts.ts): en sen
      // lag-innsending skal ikke utløse rekjøringer den ikke kan påvirke.
      // Kjøringen gjentas hvert minutt så lenge vinduet og den sene
      // innsendingen finnes (maks ~10 kjøringer) — merge gjør det idempotent.
      const scanStart = new Date(Date.now() - RESETTLE_SCAN_MS).toISOString()
      const { data: resettleRows, error: resettleError } = await supabaseAdmin
        .from('quizzes')
        .select('id, title, closes_at')
        .lt('closes_at', now)
        .gte('closes_at', scanStart)
        .eq('season_points_awarded', true)
        .eq('is_test', false)
        .order('closes_at', { ascending: true })
        .limit(5)

      if (resettleError) {
        console.error('[cron/publish-quiz] resettle lookup error:', resettleError.message)
        return
      }
      for (const quiz of (resettleRows ?? []) as { id: string; title: string; closes_at: string }[]) {
        const { data: late, error: lateError } = await supabaseAdmin
          .from('attempts')
          .select('id')
          .eq('quiz_id', quiz.id)
          .eq('is_team', false)
          .not('user_id', 'is', null)
          .gt('submitted_at', quiz.closes_at)
          .limit(1)
          .maybeSingle()
        if (lateError) {
          console.error(`[cron/publish-quiz] resettle-vakt feilet for "${quiz.title}":`, lateError.message)
          continue
        }
        if (!late) continue

        console.log(`[cron/publish-quiz] rekjører sesongpoeng for "${quiz.title}" (sen innsending funnet)`)
        const { rows, error: procError } = await processQuiz(quiz.id, quiz.closes_at)
        if (procError) {
          console.error(`[cron/publish-quiz] rekjøring feilet for "${quiz.title}":`, procError)
        } else {
          console.log(`[cron/publish-quiz] rekjøring OK for "${quiz.title}" — ${rows} rader`)
        }
      }
    })()
  )

  return NextResponse.json({ published: count, quizzes: data })
}
