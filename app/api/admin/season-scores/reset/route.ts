import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { onlyRealQuizzes, onlyArtificialQuizzes } from '@/lib/real-quiz-population'
import { fetchAllRows } from '@/lib/paginate'

// POST /api/admin/season-scores/reset
// Body: { scope: 'all' | 'test' }
// Beskyttet med admin-passord.
//
// 'all'  = slett ALLE poengrader og la poeng-cronen gjøre opp de ekte quizene
//          på nytt (admin-panelet lover nettopp dette: «Historiske quizer
//          fylles inn igjen automatisk»). Merk at re-oppgjøret regner org- og
//          liga-scopene fra DAGENS medlemskap — det er prisen for en full
//          rekalkulering, ikke en feil i denne ruten.
// 'test' = slett poengradene som tilhører kunstige quizer (testflagg, test-
//          eller arkivtype). Fram til 25. august 2026 fant denne grenen
//          quizene med ilike('title', '%test%') — en ekte quiz med «test» i
//          tittelen ville mistet poengene sine, og en testquiz uten ordet i
//          tittelen ville beholdt dem. Utvalget er nå komplementet av den
//          delte ekte-quiz-definisjonen (lib/real-quiz-population.ts).
//
// Batch-/kaskade-arbeid: flere eksterne kall eller tunge slettinger. Samme
// budsjett som de eksisterende cron-rutene (konvensjon 60).
export const maxDuration = 60

// Samme målte URL-grense som CHUNK_SIZE i lib/paginate.ts: .in()-lister
// sprekker rundt 390 id-er, halvparten er marginen.
const DELETE_CHUNK_SIZE = 200

export async function POST(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { scope?: string }
  try { body = await request.json() } catch { body = {} }
  const scope = body.scope === 'test' ? 'test' : 'all'

  let deletedRows = 0

  if (scope === 'all') {
    // FLAGGET SENKES FØR RADENE SLETTES — rekkefølgen er hele forsvaret, for
    // de to skrivingene er to separate PostgREST-kall og kan aldri bli
    // atomiske herfra. De to feilretningene er ikke symmetriske:
    //   flagg=false + rader finnes  → poeng-cronen gjør quizen opp på nytt
    //                                 (insert-only utenfor rekjøringsvinduet:
    //                                 eksisterende rader står, flagget settes
    //                                 true igjen) — tilstanden HELER SEG SELV.
    //   rader borte + flagg=true    → cronen hopper over quizen for alltid:
    //                                 den ser gjort opp ut uten ett eneste
    //                                 poeng, stille og permanent.
    // Fram til 25. august 2026 slettet ruten FØRST — en feilet flaggskriving
    // etterlot nøyaktig den permanente tilstanden.
    //
    // KUN EKTE QUIZER får flagget senket. For kunstige quizer betyr
    // season_points_awarded=true «stengt og gjort opp» for leserne
    // (leaderboard-gatene, testquiz-oppskriften setter det bevisst), og
    // poeng-cronen vil aldri gjøre dem opp igjen (hvitelisten i
    // lib/real-quiz-population.ts) — et senket flagg der ville altså vært
    // PERMANENT, ikke et signal om re-oppgjør. Slettingen under tar likevel
    // ALLE poengrader, også eventuelle etterlatte rader fra kunstige quizer.
    //
    // Spørringen står i en LOKAL VARIABEL (TS2589 ved inlining, se helperen).
    const flagQuery = supabaseAdmin
      .from('quizzes')
      .update({ season_points_awarded: false })

    const { error: flagErr } = await onlyRealQuizzes(flagQuery)

    if (flagErr) return NextResponse.json({ error: flagErr.message }, { status: 500 })

    const { count, error: delErr } = await supabaseAdmin
      .from('season_scores')
      .delete({ count: 'exact' })
      .in('scope_type', ['global', 'league', 'organization'])

    // Feiler slettingen HER, er flagget allerede senket: cronen bygger radene
    // opp igjen fra attempts, og admin får se feilen og kan prøve på nytt.
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
    deletedRows = count ?? 0
  } else {
    // Kunstige quizer per DEFINISJON (komplementet av onlyRealQuizzes), ikke
    // per tittel. Paginert: fetchAllRows kaster ved feil — den gamle formen
    // destrukturerte kun `data`, så en feilet spørring ble stille til «ingen
    // testquizer» og ruten svarte ok.
    let artificialIds: string[]
    try {
      const rows = await fetchAllRows<{ id: string }>((from, to) => {
        const q = supabaseAdmin
          .from('quizzes')
          .select('id')
          .order('id', { ascending: true })
          .range(from, to)
        return onlyArtificialQuizzes(q)
      })
      artificialIds = rows.map(r => r.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    // INGEN flaggskriving i denne grenen — med vilje. Poeng-cronen gjør aldri
    // opp kunstige quizer, så flagg=false ville blitt stående for alltid, og
    // testquiz-oppskriften setter bevisst season_points_awarded=true (leserne
    // tolker det som «stengt og gjort opp»). Slett radene, la flagget stå:
    // det ETTERLATER oppskriftens normaltilstand (flagg=true, null rader).
    for (let i = 0; i < artificialIds.length; i += DELETE_CHUNK_SIZE) {
      const chunk = artificialIds.slice(i, i + DELETE_CHUNK_SIZE)
      const { count, error: delErr } = await supabaseAdmin
        .from('season_scores')
        .delete({ count: 'exact' })
        .in('quiz_id', chunk)

      // En feilet chunk etterlater ingen skjev tilstand: flaggene er urørt,
      // og et nytt forsøk sletter resten.
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
      deletedRows += count ?? 0
    }
  }

  // Suksess-spor i Vercel-loggen — admin_actions-raden under er best-effort,
  // så dette er det som beviser at ruten faktisk kjørte og hva den gjorde.
  console.log(`[season-scores/reset] scope=${scope} slettet ${deletedRows} poengrader`)

  // Logg handlingen (ignorer feil hvis tabellen ikke finnes ennå)
  try {
    const { error: logErr } = await supabaseAdmin.from('admin_actions').insert({
      action_type: `season_reset_${scope}`,
      scope_type: 'global',
      scope_id: null,
    })
    if (logErr) console.error('[season-scores/reset] admin_actions-logging feilet', scope, logErr)
  } catch (err) {
    console.error('[season-scores/reset] admin_actions-logging kastet', scope, err)
  }

  return NextResponse.json({ ok: true, scope, deletedRows })
}
