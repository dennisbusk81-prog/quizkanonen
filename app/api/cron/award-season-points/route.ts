import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { processQuiz } from '@/lib/award-season-points'
import { onlyRealQuizzes } from '@/lib/real-quiz-population'
import { sendHeartbeat } from '@/lib/cron-heartbeat'

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

  // Finn ubehandlede quizer som har stengt.
  //
  // POPULASJONEN ER DELT (lib/real-quiz-population.ts) — ikke et inline-filter.
  // Her sto tidligere `.eq('is_test', false)` alene, med nøyaktig de to hullene
  // helperen lukker: `.eq` matcher IKKE `is_test IS NULL` (kolonnen er
  // nullable), og det fantes ingen `quiz_type`-vakt i det hele tatt. En
  // arkivquiz (`quiz_type='archive'`, `is_test=false`) ville altså fått
  // sesongpoeng.
  //
  // HVORFOR HVITELISTEN ER RIKTIG GULV AKKURAT HER — dette er en SKRIVESTI.
  // En leser som tar feil skjuler noe, og retter seg selv i det koden rettes.
  // En skriver som tar feil legger rader i `season_scores` som må ryddes
  // MANUELT, og de radene renner videre inn i hver eneste leser (toppliste,
  // forsidens topp 3, org- og ligatopplister) — alle sammen trygge i dag KUN
  // fordi denne spørringen holder kunstige quizer ute.
  //
  // Hviteliste er derfor riktig retning å ta feil i: en ukjent `quiz_type` får
  // ingen poeng, men `season_points_awarded` forblir false, så quizen gjøres
  // opp korrekt og AUTOMATISK ved neste kjøring straks typen legges til i
  // REAL_QUIZ_TYPES (upserten er insert-only utenfor rekjøringsvinduet og
  // finner da ingen rader å kollidere med). Motsatt vei finnes ingen
  // automatisk rydding. Se FALLGRUVE-avsnittet i .claude/CLAUDE.md: legger du
  // til en ny quiz_type, må hvitelisten oppdateres i SAMME runde — ellers er
  // symptomet stille (quizen forsvinner bare ut av utvalget, ingen feilmelding).
  //
  // is_active filtreres BEVISST ikke — en spilt quiz som skjules i admin etter
  // stenging skal fortsatt gjøres opp, ellers mister spillerne poengene sine.
  //
  // Spørringen står i en LOKAL VARIABEL: inlinet som argument til
  // onlyRealQuizzes() ga `next build` TS2589 «Type instantiation is
  // excessively deep».
  const settleQuery = supabaseAdmin
    .from('quizzes')
    .select('id, title, closes_at')
    .lt('closes_at', now)
    .eq('season_points_awarded', false)
    .order('closes_at', { ascending: true })
    .limit(BATCH_SIZE)

  const { data: quizzes, error: quizError } = await onlyRealQuizzes(settleQuery)

  if (quizError) {
    // 503, ikke 500: den dominerende årsaken er at Supabase ikke svarer (14.
    // august kom Cloudflares 521-side hit, rå HTML i error.message). Samme kode
    // som ved feilede quizer nederst — ruten har ÉN status for «oppstrøms
    // svikta», og en 500 herfra ville dermed betydd noe annet: en ekte,
    // uventet feil i selve ruten.
    console.error('[award-season-points] Klarte ikke hente quizer:', quizError.message)
    return NextResponse.json({ error: quizError.message }, { status: 503 })
  }

  // ── Observerbarhet (N-14, 5. september 2026) ──────────────────────────────
  // Ruten logget fra før KUN når noe skjedde: feil (over og under), og
  // per-quiz-linjene inne i løkken. Normalveien — «ingenting å gjøre», som er
  // svaret nesten hver eneste kjøring — returnerte rett under uten et ord.
  // Da kan Messages-kolonnen ikke skille «gjorde opp 60 rader» fra «hadde
  // ingenting» fra «kjørte aldri». Og det var DENNE ruta, ikke publish-quiz,
  // som faktisk gjorde opp 4. september kl. 22:00:36 UTC — publish-quiz kom
  // åtte sekunder senere og fant ingenting. Nøyaktig samme tvetydighet som
  // 32a7c7b lukket i publish-quiz.
  //
  // Én linje per kjøring, UBETINGET, fra begge utgangene: da bærer et
  // nulltall informasjon, og fravær av linje er et signal. Samme prefiks-form
  // som publish-quiz (`[cron/…] oppgjor:`) slik at begge kan grep-es sammen,
  // og ASCII-nøkler så grep ikke krever ø. Kun tall — ingen titler, id-er
  // eller spillernavn. `quizer` teller FORSØKTE (feilede inkludert); `feil`
  // sier hvor mange av dem som ikke gikk. Ingen waitUntil her, så én linje
  // holder — begge utgangene er i request-scope.
  //
  // Feiler selve quiz-oppslaget (503 over), fyrer den ikke: den grenen har
  // allerede en error-linje, og en «oppgjor: quizer=0» der ville sett ut som
  // en frisk kjøring.
  const loggOppgjor = (quizer: number, rader: number, feil: number) =>
    console.log(`[cron/award-season-points] oppgjor: quizer=${quizer} rader=${rader} feil=${feil}`)

  if (!quizzes || quizzes.length === 0) {
    loggOppgjor(0, 0, 0)
    // Ingenting å gjøre er en vellykket kjøring — kanarien skal pinge her
    // også, ellers ville den vært stille 47 av 48 kjøringer i døgnet. Se
    // kommentaren ved den andre utgangen under.
    waitUntil(sendHeartbeat('award-season-points'))
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

  loggOppgjor(results.length, totalRows, failed)

  // ── Kanari (5. september 2026) ──────────────────────────────────────────
  // Heartbeat til healthchecks.io — SIST, etter summeringslinja, og KUN når
  // alt ble gjort opp. Denne ruta er den som mest sannsynlig dør ALENE:
  // 503-svaret under er riktig for en leser, men cron-job.org slår jobben av
  // etter >25 feil på rad, og publish-quiz ville kjørt videre med 200. Derfor
  // egen kanari, og derfor pinger hverken denne grenen ved feil eller
  // 503-grenen ved oppslagsfeil lenger opp — et ping fra en kjøring som lot
  // en quiz stå uoppgjort ville skjult nøyaktig det kanarien finnes for.
  // I waitUntil så cron-job.org aldri venter på pinget; helperen kaster
  // aldri og hopper stille over uten env. Se lib/cron-heartbeat.ts.
  if (failed === 0) waitUntil(sendHeartbeat('award-season-points'))

  return NextResponse.json(
    { processed: results.length, failed, totalRows, quizzes: results },
    { status: failed > 0 ? 503 : 200 }
  )
}
