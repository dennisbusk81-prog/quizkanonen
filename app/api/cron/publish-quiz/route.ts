import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { revalidateTag } from 'next/cache'
import { processQuiz } from '@/lib/award-season-points'
import { RESETTLE_SCAN_MS } from '@/lib/late-play-window'
import { onlyRealQuizzes } from '@/lib/real-quiz-population'

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
  // Oppslaget speiler forsidens activeQuiz-filter (samme populasjon, opens_at
  // passert, closes_at null eller ikke passert) med stengegrensen skjøvet 10
  // minutter bakover. Ved oppslagsfeil purger vi (fail-open = dagens atferd).
  // { expire: 0 } = purg umiddelbart (denne Next.js-versjonen krever en
  // cache-life-profil som andre argument til revalidateTag).
  //
  // POPULASJONEN er den DELTE definisjonen (lib/real-quiz-population), ikke
  // `.eq('is_test', false)`. Speilingen er hele poenget: gaten og forsidens
  // activeQuiz må svare på NØYAKTIG samme spørsmål — «finnes det en ekte quiz
  // forsiden kan vise akkurat nå?». Det gamle filteret svarte feil i begge
  // retninger samtidig: det matchet ikke `is_test IS NULL` (en slik quiz sto på
  // forsiden uten at cachen ble frisknet — deltakertallet stod stille), og det
  // hadde ingen quiz_type-vakt (en arkivquiz purget begge forside-cachene hvert
  // minutt den var «live»). Kortet og denne gaten skal derfor alltid endres i
  // samme runde; lib/home-real-quiz-population.test.ts feller det hvis ikke.
  //
  // `count > 0`-grenen under er BEVISST ikke populasjonsgatet: publiseres en
  // testquiz, purger vi én gang for mye. Retningen er valgt med vilje — å purge
  // for ofte koster en rekompute, å purge for sjelden viser en løgn.
  //
  // Spørringen står i en LOKAL VARIABEL (TS2589 ved inlining), som nedenfor.
  const purgeWindowStart = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const liveBase = supabaseAdmin
    .from('quizzes')
    .select('id')
    .lte('opens_at', now)
    .or(`closes_at.is.null,closes_at.gte.${purgeWindowStart}`)
    .limit(1)

  const { data: liveQuizzes, error: liveError } = await onlyRealQuizzes(liveBase)

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
  // Samme populasjonsgulv som i award-season-points-cronen, og av samme grunn:
  // denne ruten kjører hvert minutt og ville ellers gjort opp en kunstig quiz
  // FØR 30-minutters-cronen i det hele tatt så den. Gulvet er nå den DELTE
  // definisjonen (lib/real-quiz-population.ts) i stedet for `.eq('is_test',
  // false)`, som hverken matchet `is_test IS NULL` eller sa noe om
  // `quiz_type` — se den fyldige begrunnelsen i award-season-points-ruten.
  // is_active bevisst ikke filtrert, samme begrunnelse som der.
  //
  // Spørringen står i en LOKAL VARIABEL (TS2589 ved inlining).
  const closedQuery = supabaseAdmin
    .from('quizzes')
    .select('id, title, closes_at')
    .lt('closes_at', now)
    .eq('season_points_awarded', false)
    .order('closes_at', { ascending: true })
    .limit(5)

  const { data: closedQuizzes, error: closedError } = await onlyRealQuizzes(closedQuery)

  if (closedError) {
    console.error('[cron/publish-quiz] closed-quiz lookup error:', closedError.message)
  }
  const snapshot = (closedQuizzes ?? []) as { id: string; title: string; closes_at: string }[]

  // ── Observerbarhet (N-13, 4. september 2026) ──────────────────────────────
  // Ruten logget fra før KUN når noe skjedde: publisering (over), oppgjør og
  // rekjøring (begge i waitUntil under). Den vanlige kjøringen — «ingenting å
  // gjøre», altså 1439 av 1440 kjøringer i døgnet — var helt taus. Da er
  // stillhet tvetydig, og den kan bety tre helt ulike ting: ruten kjørte og
  // fant ingenting, ruten kjørte ikke, eller ruten logget og linja ble ikke
  // fanget. QK_0 ba 23. august om at rekjøringsvinduet skulle verifiseres i
  // prod ved å grep-e loggen; det gikk ikke, fordi den grenen kun sier fra
  // når den GRIPER INN. 28. august ble «null treff» lest som riktig utfall —
  // men det holdt bare fordi en positiv kontroll ble kjørt først.
  //
  // Linjen under og summeringslinjen i waitUntil fyrer derfor UBETINGET, én
  // av hver per kjøring. Da bærer et nulltall informasjon i seg selv, og
  // fravær av linje er et signal i stedet for en mangel på et.
  //
  // TO linjer, ikke én, fordi de har ULIK GARANTI. Denne skrives i
  // request-scope, før responsen sendes. Selve oppgjøret er først kjent inne
  // i waitUntil — arbeid som per definisjon kjører etter at responsen er ute,
  // og det er nettopp den fangsten som er mistenkt for å ha sviktet
  // 4. september (8 eksterne kall og 3 POST i sporet, tom Messages-kolonne).
  // Linje A svarer «kjørte ruten, og hadde den noe å gjøre?», linje B «hva
  // ble faktisk gjort?». Kommer B aldri fram mens A gjør det, er DET svaret
  // på hvor loggen blir av — og de to kan ikke skille lag på annen måte.
  //
  // Nøklene er ASCII med vilje (`kandidater=`, `gjort_opp=`, `rekjort=`):
  // de er selve grep-ankeret, og et ø i søkestrengen er en unødvendig felle
  // på Windows-siden av verktøykjeden. Kun tall passerer her — ingen
  // spillernavn, e-poster eller bruker-id-er.
  console.log(`[cron/publish-quiz] kjorte: publisert=${count} kandidater=${snapshot.length}`)

  // Tellerne er rene observatører — ingen av dem leses av kontrollflyten. De
  // står UTENFOR closuren slik at summeringen kan henges på som `.finally()`
  // i stedet for som en try-blokk rundt kroppen: en try ville tvunget fram
  // reinnrykk av seksti linjer uendret kode, og da drukner selve endringen i
  // whitespace neste gang noen leser diffen.
  let gjortOpp = 0
  let rader = 0
  let skannet = 0
  let rekjort = 0
  let raderRekjort = 0
  let feil = 0

  // Førstegangs-oppgjør og rekjøring i SAMME waitUntil, i den rekkefølgen —
  // to parallelle blokker kunne latt rekjøringen se et halvt oppgjør.
  waitUntil(
    (async () => {
      for (const quiz of snapshot) {
        console.log(`[cron/publish-quiz] tildeler sesongpoeng for "${quiz.title}"`)
        const { rows, error: procError } = await processQuiz(quiz.id, quiz.closes_at)
        if (procError) {
          feil++
          console.error(`[cron/publish-quiz] sesongpoeng feilet for "${quiz.title}":`, procError)
        } else {
          gjortOpp++
          rader += rows
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
      //
      // Populasjonsgulvet MÅ stå her også, ikke bare i førstegangs-utvalget
      // over: dette utvalget spør på `season_points_awarded = true`, altså på
      // rader det andre utvalget aldri ser igjen. Uten gulvet begge steder
      // ville en kunstig quiz som allerede HAR fått poeng (f.eks. skrevet før
      // denne fiksen, eller av en manuell kjøring) blitt rekjørt hvert minutt
      // i hele skannevinduet. Samme delte definisjon, samme grunn.
      const scanStart = new Date(Date.now() - RESETTLE_SCAN_MS).toISOString()
      const resettleQuery = supabaseAdmin
        .from('quizzes')
        .select('id, title, closes_at')
        .lt('closes_at', now)
        .gte('closes_at', scanStart)
        .eq('season_points_awarded', true)
        .order('closes_at', { ascending: true })
        .limit(5)

      const { data: resettleRows, error: resettleError } = await onlyRealQuizzes(resettleQuery)

      if (resettleError) {
        feil++
        console.error('[cron/publish-quiz] resettle lookup error:', resettleError.message)
        return
      }
      // Lokal variabel kun for å kunne telle kandidatene. `skannet` er
      // halvparten av rekjøringsbeviset: uten den kan «rekjort=0» like gjerne
      // bety at utvalget aldri kjørte som at det kjørte og korrekt lot være.
      const resettleKandidater = (resettleRows ?? []) as { id: string; title: string; closes_at: string }[]
      skannet = resettleKandidater.length
      for (const quiz of resettleKandidater) {
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
          feil++
          console.error(`[cron/publish-quiz] resettle-vakt feilet for "${quiz.title}":`, lateError.message)
          continue
        }
        if (!late) continue

        console.log(`[cron/publish-quiz] rekjører sesongpoeng for "${quiz.title}" (sen innsending funnet)`)
        const { rows, error: procError } = await processQuiz(quiz.id, quiz.closes_at)
        if (procError) {
          feil++
          console.error(`[cron/publish-quiz] rekjøring feilet for "${quiz.title}":`, procError)
        } else {
          rekjort++
          raderRekjort += rows
          console.log(`[cron/publish-quiz] rekjøring OK for "${quiz.title}" — ${rows} rader`)
        }
      }
    })().finally(() => {
      // Linje B. `.finally()` og ikke slutten av kroppen: resettle-grenen over
      // har en `return`, og et uventet kast ville ellers tatt summeringen med
      // seg i fallet — nettopp i den kjøringen man mest trenger den.
      // upsertScores i lib/award-season-points.ts kaster faktisk videre
      // (`if (error) throw error`), og processQuiz sin egen try dekker kun
      // attempt-hentingen, så den stien er nåbar og ikke hypotetisk.
      //
      // `.finally()` endrer ingenting for kalleren: promisen den returnerer
      // resolver med samme verdi og forkaster med samme grunn, så waitUntil
      // ser nøyaktig samme utfall som før.
      //
      // Tre tilstander, ett grep, én linje:
      //   ingenting å gjøre → gjort_opp=0 rader=0 rekjort=0 (skannet kan godt
      //                       være >0: vinduet ble evaluert og lot være — det
      //                       er nettopp den negative kontrollen som manglet)
      //   gjorde opp        → gjort_opp>=1 med rader=N
      //   rekjørte          → rekjort>=1 med rader_rekjort=N
      console.log(
        `[cron/publish-quiz] oppgjor: gjort_opp=${gjortOpp} rader=${rader} ` +
        `skannet=${skannet} rekjort=${rekjort} rader_rekjort=${raderRekjort} feil=${feil}`
      )
    })
  )

  return NextResponse.json({ published: count, quizzes: data })
}
