import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { processQuiz } from '@/lib/award-season-points'

const BATCH_SIZE = 10

// Målt kostnad: ~8 rundturer à ~150 ms per quiz → 1–1,5 s. Full batch på 10
// quizer ≈ 10–15 s ved normal latens. 60 s er altså 4× målt verste tilfelle,
// og samme tall som søsterrutene (publish-quiz, send-*).
//
// Ruten var den eneste i app/api uten dette tallet, og arvet dermed
// plattformdefaulten på 300 s. Ingen av Supabase-kallene har egen frist
// (supabase-js har ingen fetch-timeout), så den defaulten var det ENESTE som
// stoppet en hengende kjøring — fem minutter okkupert funksjon for et svar
// cron-job.org sluttet å lytte etter allerede ved 30 s.
//
// Å bli drept på 60 s er trygt her på en måte det ikke er i e-postrutene:
// processQuiz gjør ÉN samlet upsert og setter season_points_awarded aller
// sist, så en avkuttet kjøring etterlater ingen halvskrevet tilstand — quizen
// plukkes opp igjen ved neste kjøring.
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date().toISOString()

  // Finn ubehandlede quizer som har stengt. is_test-guarden speiler
  // varslingsrutene (notify-subscribers/send-reminders/send-push): uten den
  // får en testquiz som stenges season_scores-rader i global scope, og
  // fixture-brukere havner på forsidens topp 3. is_active filtreres BEVISST
  // ikke — en spilt quiz som skjules i admin etter stenging skal fortsatt
  // gjøres opp, ellers mister spillerne poengene sine.
  const { data: quizzes, error: quizError } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, closes_at')
    .lt('closes_at', now)
    .eq('season_points_awarded', false)
    .eq('is_test', false)
    .order('closes_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (quizError) {
    // 503, ikke 500: den dominerende årsaken er at Supabase ikke svarer (14.
    // august kom Cloudflares 521-side hit, rå HTML i error.message). Samme kode
    // som ved feilede quizer nederst — ruten har ÉN status for «oppstrøms
    // svikta», og en 500 herfra ville dermed betydd noe annet: en ekte,
    // uventet feil i selve ruten.
    console.error('[award-season-points] Klarte ikke hente quizer:', quizError.message)
    return NextResponse.json({ error: quizError.message }, { status: 503 })
  }

  if (!quizzes || quizzes.length === 0) {
    return NextResponse.json({ processed: 0, totalRows: 0, quizzes: [] })
  }

  const results: Array<{ quizId: string; title: string; rows: number; error: string | null }> = []
  let totalRows = 0

  for (const quiz of quizzes as { id: string; title: string; closes_at: string }[]) {
    console.log(`[award-season-points] Behandler: "${quiz.title}" (${quiz.id})`)
    const { rows, error } = await processQuiz(quiz.id, quiz.closes_at)
    totalRows += rows
    results.push({ quizId: quiz.id, title: quiz.title, rows, error })
    if (error) {
      console.error(`[award-season-points] Feil på "${quiz.title}":`, error)
    } else {
      console.log(`[award-season-points] Ferdig: "${quiz.title}" — ${rows} rader totalt`)
    }
  }

  // ── Statuskoden må speile om noe faktisk ble gjort opp ─────────────────────
  // Fram til nå svarte ruten 200 uansett hvor mange quizer som feilet — feilene
  // lå kun i `quizzes[].error` i kroppen, som ingen leser. Bare et brudd på
  // quiz-oppslaget over ga en status noen kunne varsle på. 14. august var det
  // flaks: Supabase falt bort nøyaktig der. Hadde det skjedd tre linjer senere,
  // ville cron-job.org sett 200 OK på 44 kjøringer som ikke delte ut ett
  // eneste poeng.
  //
  // TERSKELEN ER «minst én feilet», ikke «alle feilet». Ved dagens skala er de
  // to identiske — batchen er 0 eller 1 quiz nesten alltid. De skiller lag først
  // ved etterslep, og der er «alle feilet» den dårlige regelen: 9 av 10 feiler,
  // 1 lykkes, ruten svarer 200 og ni quizer står uoppgjort i stillhet. Det er
  // dagens feil med høyere terskel.
  //
  // Ingenting å gjøre → 200 (den normale tilstanden, skal ALDRI varsle).
  // Alt gjort opp → 200. Noe forlatt uoppgjort → 503.
  const failed = results.filter(r => r.error !== null).length

  if (failed > 0) {
    console.error(
      `[award-season-points] ${failed} av ${results.length} quizer feilet — svarer 503 ` +
      `slik at cron-job.org ser det. Quizene beholder season_points_awarded=false ` +
      `og forsøkes på nytt ved neste kjøring.`
    )
  }

  return NextResponse.json(
    { processed: results.length, failed, totalRows, quizzes: results },
    { status: failed > 0 ? 503 : 200 }
  )
}
