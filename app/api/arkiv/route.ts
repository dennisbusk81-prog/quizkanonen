import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getUserPremium } from '@/lib/premium-check'
import { rateLimit } from '@/lib/rate-limit'
import { logRateLimitHit } from '@/lib/rate-limit-log'
import { fetchAllRows, fetchAllRowsChunked } from '@/lib/paginate'
import { onlyRealQuizzes } from '@/lib/real-quiz-population'
import {
  buildArchiveCopy,
  type ArchiveSourceQuestion,
} from '@/lib/archive-copy'
import {
  ARCHIVE_CREATED_ACTION,
  ARCHIVE_CREATE_WINDOW_MS,
  MAX_ARCHIVE_QUESTION_IDS,
  MAX_ARCHIVE_TITLE_LENGTH,
  decideArchiveCreateQuota,
  decideArchiveSourceEligibility,
  type ArchiveSourceParentQuiz,
} from '@/lib/archive-create-rules'

// ── POST /api/arkiv — opprett en arkivquiz fra en liste spørsmåls-id-er ─────
//
// Første ikke-admin quiz-opprettelse i kodebasen (kartlagt i
// .claude/QK_KARTLEGGING_ARKIV_KOPIRUTE_26AUG.md, 731b383) — ingen gate å
// arve, så alt står eksplisitt her:
//
//   auth → premium-gate → kvote → les kilder → kildegate → buildArchiveCopy
//   → insert quiz (INAKTIV) → insert spørsmål → aktiver → bokfør kvote → svar
//
// Inngangen er en LISTE MED SPØRSMÅLS-ID-ER, ikke en kilde-quiz-id: «spill
// quiz 47 på nytt» er id-ene fra quiz 47, en generert quiz er femten id-er
// fra et filter. Samme rute. Alt INNHOLD i kopien bestemmes av den rene
// buildArchiveCopy — ruten gjør kun I/O og gjentar ingen av reglene.
//
// ── DELVIS OPPRETTELSE ER FORBUDT — «aktiver sist» ──────────────────────────
// Importruten (app/api/admin/quizzes/import) setter quizen inn AKTIV og
// rydder med delete hvis spørsmålsinnsettet feiler — men feiler også
// ryddingen, står det igjen en tom, SPILLBAR quiz. Her settes quiz-raden
// derfor inn med is_active=false, og buildArchiveCopy sin is_active-verdi
// skrives først ETTER at spørsmålsinnsettet er bekreftet. Spillestiens
// anon-lesing krever is_active=true (samme grunn som i
// .claude/QK_TESTQUIZ_OPPSKRIFT.md), så det finnes ikke noe vindu — heller
// ikke ved dobbel feil — der en tom quiz er synlig eller spillbar.
// Spørsmålsinnsettet er ÉN batch-INSERT (én transaksjon), så «noen av
// radene» er ikke en mulig tilstand.
//
// ── KILDEBUMPEN ARVES IKKE ──────────────────────────────────────────────────
// classics/copy bumper kildens usage_count/last_used_at per kopi. Denne ruten
// skriver ALDRI mot kilderadene — «minst brukt / sist brukt» er sorteringen
// Dennis styrer etter med 5000 spørsmål, og den skal ikke forurenses av
// arkivspilling. Kildequizen og dens spørsmål er urørlige her; de eneste
// skrivingene er de to nye radsettene + kvotebokføringen.
// Testdekket i lib/arkiv-create-route.test.ts.

// Lese-/lettskriv-rute: kun egen DB. 15 s dekker kald start med god margin og
// dreper et hengende Supabase-kall tidlig — samme budsjett som /api/historikk.
export const maxDuration = 15

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Kolonnene buildArchiveCopy trenger + forelder-quizen kildegaten trenger. */
const SOURCE_SELECT =
  'id, question_text, option_a, option_b, option_c, option_d, ' +
  'correct_answer, correct_answers, explanation, category, ' +
  'time_limit_seconds, shuffle_options, quiz:quizzes(closes_at, is_test)'

type SourceRow = ArchiveSourceQuestion & { quiz: ArchiveSourceParentQuiz }

export async function POST(request: NextRequest) {
  // Lag 1: billig in-memory IP-brems foran auth- og DB-arbeidet. Den
  // autoritative grensen er døgnkvoten i admin_actions lenger ned (lag 3) —
  // husregelen sier at flater med lag 3 ikke også skal ha delt Upstash-teller.
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rlKey = `arkiv-create:${ip}`
  const rl = rateLimit(rlKey, 5, 60_000)
  if (!rl.success) {
    logRateLimitHit(rlKey, { lag: 'lokal', limit: 5, windowMs: 60_000 })
    return NextResponse.json({ error: 'For mange forespørsler. Vent litt.' }, { status: 429 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  // ── Premium-gate ──────────────────────────────────────────────────────────
  // Delt sjekk (lib/premium-check.ts): dekker org-medlemmer (cachen settes
  // ved innmelding) og begge karensperiodene. RETNINGEN er bevisst valgt:
  // «vet ikke» er 503, aldri en dom — start-attempt sin «vet ikke → ikke
  // premium» gjelder et VISNINGSKRAV der feil retning koster en pyntedetalj;
  // her er det porten til en betalt skriveflate, og en transient DB-feil skal
  // ikke avvise en betalende kunde som gratisbruker (samme linje som
  // /api/historikk).
  const premium = await getUserPremium(user.id)
  if (!premium.ok) {
    return NextResponse.json(
      { error: 'Kunne ikke bekrefte tilgangen din akkurat nå. Prøv igjen om litt.' },
      { status: 503 }
    )
  }
  if (!premium.value) {
    return NextResponse.json({ error: 'Arkivet krever Premium.' }, { status: 403 })
  }

  // ── Inngang ───────────────────────────────────────────────────────────────
  let body: { title?: unknown; question_ids?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Ugyldig forespørsel.' }, { status: 400 })
  }

  const title = typeof body.title === 'string' ? body.title : ''
  if (title.length > MAX_ARCHIVE_TITLE_LENGTH) {
    return NextResponse.json({ error: 'Tittelen er for lang.' }, { status: 400 })
  }

  const questionIds = Array.isArray(body.question_ids) ? body.question_ids : null
  if (!questionIds || questionIds.length === 0) {
    return NextResponse.json({ error: 'Mangler spørsmål.' }, { status: 400 })
  }
  if (questionIds.length > MAX_ARCHIVE_QUESTION_IDS) {
    return NextResponse.json({ error: 'For mange spørsmål i én quiz.' }, { status: 400 })
  }
  // Eksplisitt UUID-validering FØR verdiene brukes i noe oppslag — samme
  // begrunnelse som rival_id i /api/rivalries (FUNN 5.5): sikkerheten skal
  // ikke hvile på at et senere oppslag tilfeldigvis feiler først.
  for (const id of questionIds) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Ugyldig spørsmåls-id.' }, { status: 400 })
    }
  }
  const ids = questionIds as string[]

  // ── Døgnkvote (autoritativ telling i admin_actions, lib/archive-create-rules) ──
  const since = new Date(Date.now() - ARCHIVE_CREATE_WINDOW_MS).toISOString()
  const { count: createdLastDay, error: quotaCountError } = await supabaseAdmin
    .from('admin_actions')
    .select('id', { count: 'exact', head: true })
    .eq('action_type', ARCHIVE_CREATED_ACTION)
    .eq('user_id', user.id)
    .gte('created_at', since)

  // Fail-closed: kan vi ikke lese forbruket, vet vi ikke om dette er quiz
  // nr. 2 eller nr. 200 — en DB-feil skal ikke være omveien rundt grensen
  // (samme linje som duel-kvoten i /api/rivalries).
  if (quotaCountError) {
    console.error('[arkiv POST] kunne ikke telle opprettelser:', quotaCountError.message)
    return NextResponse.json(
      { error: 'Kunne ikke opprette arkivquiz akkurat nå. Prøv igjen om litt.' },
      { status: 503 }
    )
  }

  const quota = decideArchiveCreateQuota({ createdLastDay: createdLastDay ?? 0 })
  if (!quota.allowed) {
    return NextResponse.json({ error: quota.message }, { status: 429 })
  }

  // ── Les kildespørsmålene (med forelder-quiz for kildegaten) ───────────────
  const { data: sourceRows, error: sourceError } = await supabaseAdmin
    .from('questions')
    .select(SOURCE_SELECT)
    .in('id', ids)

  if (sourceError) {
    console.error('[arkiv POST] kunne ikke lese kildespørsmål:', sourceError.message)
    return NextResponse.json(
      { error: 'Kunne ikke opprette arkivquiz akkurat nå. Prøv igjen om litt.' },
      { status: 503 }
    )
  }

  // Embed-formen er verifisert husviten: quiz_id → quizzes er many-to-one,
  // så `quiz` kommer som OBJEKT (eller null for quiz-løse rader), aldri array.
  const rows = (sourceRows ?? []) as unknown as SourceRow[]

  // ── Kildegate: forelder-quiz må være stengt og ikke test ──────────────────
  // Uten denne kunne id-ene til FREDAGENS uåpnede/åpne quiz gitt en spillbar
  // kopi med fasit før quizen stenger. Se lib/archive-create-rules.ts.
  const gate = decideArchiveSourceEligibility(
    rows.map((r) => ({ id: r.id, quiz: r.quiz })),
    new Date()
  )
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'Ett eller flere spørsmål tilhører en quiz som ikke kan arkiveres ennå.' },
      { status: 403 }
    )
  }

  // ── Innholdet bestemmes av den rene buildArchiveCopy — uendret ────────────
  // Ukjente id-er (bestilt, men ikke funnet i oppslaget) avvises HER, før noe
  // er skrevet. sourceQuiz sendes med kun for å beviselig ikke arves.
  const sourceQuestions: ArchiveSourceQuestion[] = rows.map(
    ({ quiz: _quiz, ...question }) => question
  )
  const built = buildArchiveCopy({
    title,
    questionIds: ids,
    sourceQuestions,
    sourceQuiz: rows[0]?.quiz ?? null,
  })
  if (!built.ok) {
    const messages: Record<typeof built.error, string> = {
      'tom-tittel': 'Mangler tittel.',
      'tom-liste': 'Mangler spørsmål.',
      'duplikat-id': 'Samme spørsmål er med flere ganger.',
      'ukjent-id': 'Ett eller flere spørsmål finnes ikke.',
    }
    return NextResponse.json({ error: messages[built.error] }, { status: 400 })
  }

  // ── Skriving 1: quiz-raden, INAKTIV (se «aktiver sist» i filhodet) ────────
  const { data: createdQuiz, error: quizInsertError } = await supabaseAdmin
    .from('quizzes')
    .insert({ ...built.quiz, is_active: false })
    .select('id')
    .single()

  if (quizInsertError || !createdQuiz) {
    console.error('[arkiv POST] quiz-insert feilet:', quizInsertError?.message)
    return NextResponse.json({ error: 'Noe gikk galt. Prøv igjen.' }, { status: 500 })
  }

  // ── Skriving 2: spørsmålsradene (én atomisk batch) ────────────────────────
  const { error: questionsInsertError } = await supabaseAdmin
    .from('questions')
    .insert(built.questions.map((q) => ({ ...q, quiz_id: createdQuiz.id })))

  if (questionsInsertError) {
    console.error('[arkiv POST] spørsmåls-insert feilet:', questionsInsertError.message)
    const { error: cleanupError } = await supabaseAdmin
      .from('quizzes')
      .delete()
      .eq('id', createdQuiz.id)
    if (cleanupError) {
      // Ikke et hull: raden er fortsatt is_active=false og dermed hverken
      // synlig eller spillbar. Loggen finnes så restene kan ryddes manuelt.
      console.error(
        `[arkiv POST] opprydding feilet — INAKTIV tom quiz ${createdQuiz.id} står igjen:`,
        cleanupError.message
      )
    }
    return NextResponse.json({ error: 'Noe gikk galt. Prøv igjen.' }, { status: 500 })
  }

  // ── Skriving 3: aktiver — først nå blir quizen synlig/spillbar ────────────
  const { error: activateError } = await supabaseAdmin
    .from('quizzes')
    .update({ is_active: built.quiz.is_active })
    .eq('id', createdQuiz.id)

  if (activateError) {
    console.error('[arkiv POST] aktivering feilet:', activateError.message)
    // Rydd begge radsettene eksplisitt (antar ikke kaskade); feiler det, står
    // quizen komplett men inaktiv — usynlig, og trygg å rydde manuelt.
    const { error: cleanupQuestionsError } = await supabaseAdmin
      .from('questions')
      .delete()
      .eq('quiz_id', createdQuiz.id)
    const { error: cleanupQuizError } = cleanupQuestionsError
      ? { error: cleanupQuestionsError }
      : await supabaseAdmin.from('quizzes').delete().eq('id', createdQuiz.id)
    if (cleanupQuizError) {
      console.error(
        `[arkiv POST] opprydding etter aktiveringsfeil — INAKTIV quiz ${createdQuiz.id} står igjen:`,
        cleanupQuizError.message
      )
    }
    return NextResponse.json({ error: 'Noe gikk galt. Prøv igjen.' }, { status: 500 })
  }

  // ── Bokfør kvoten — først ETTER bekreftet opprettelse ─────────────────────
  // Et rullet-tilbake forsøk skal ikke koste kvote. Feiler bokføringen, er
  // kvoten for SLAPP for neste kall — riktig feilretning, men den logges så
  // den ikke blir usynlig (samme som duel- og invite-kvoten).
  const { error: quotaLogError } = await supabaseAdmin.from('admin_actions').insert({
    action_type: ARCHIVE_CREATED_ACTION,
    scope_type: 'quiz',
    scope_id: createdQuiz.id,
    user_id: user.id,
  })
  if (quotaLogError) {
    console.error('[arkiv POST] kvote-bokføring feilet:', quotaLogError.message)
  }

  return NextResponse.json({ quizId: createdQuiz.id }, { status: 201 })
}

// ── GET /api/arkiv — listen over quizer som kan spilles på nytt ─────────────
//
// UGATET MED VILJE (Dennis-beslutning 27. august): gratisbrukere SKAL se at
// arkivet finnes — ikke skjult, ikke smakebit. Konvertering er primærmålet
// med funksjonen. Gaten sitter på SKRIVEFLATENE: POST over (opprettelse) og
// spill-porten (start-attempt). Listen avslører kun titler, stengetider og
// spørsmåls-ID-ER — aldri innhold eller fasit (spørsmålsdata krever
// attempt-token, og et attempt på en arkivkopi krever Premium).
// Ingen rate-limit — samme linje som /api/toppliste, den tyngre ugatede
// leseruten: ren lesing mot egen DB, grensen ville kun vært kostnadsdemping.
//
// PAGINERT FRA FØRSTE LINJE. Ved ~300 stengte quizer og ~5000 spørsmål biter
// PostgREST sitt stille 1000-radskutt i spørsmålsoppslaget fra dag én —
// bygges dette for ti quizer og gjøres om senere, er det en omskriving, ikke
// en utvidelse. Derfor fetchAllRows (quizene) + fetchAllRowsChunked
// (spørsmålene — .in()-lister brekker ved ~390 id-er, en LAVERE grense enn
// radtaket). Begge spørringene har eksplisitt .order() med TOTALORDNING
// (unik halerekkefølge): et paginert kutt uten totalordning gir
// ikke-reproduserbare resultatsett — side 2 kan gjenta side 1 (husregel, og
// kartleggingen 27. august fant fem season_scores-spørringer med nettopp
// det hullet; det mønsteret skal ikke gjenoppstå i ny kode).
//
// Populasjonen speiler kildegaten i POST (decideArchiveSourceEligibility):
// ekte quiz (onlyRealQuizzes — arkivkopier og testquizer faller ut med
// vilje), synlig (is_active=true, admin-«Skjul» skal gjelde her også) og
// STENGT (closes_at <= nå; NULL matcher aldri en lte og faller riktig ut).
// Listen skal aldri vise en quiz POST ville avvist.

/** Kvizfelter listen trenger — closes_at er «når den gikk», visningsfeltet. */
type ArchiveListQuizRow = { id: string; title: string; closes_at: string | null }

type ArchiveListQuestionRow = { id: string; quiz_id: string; order_index: number }

export async function GET() {
  const nowIso = new Date().toISOString()

  let quizzes: ArchiveListQuizRow[]
  try {
    quizzes = await fetchAllRows<ArchiveListQuizRow>((from, to) => {
      // SPØRRINGEN i en lokal variabel og helperen påført ETTERPÅ — inlinet
      // som argument gir TS2589 i `next build` (regelen i
      // lib/real-quiz-population.ts; samme form som app/page.tsx).
      const base = supabaseAdmin
        .from('quizzes')
        .select('id, title, closes_at')
        .eq('is_active', true)
        .lte('closes_at', nowIso)
      const query = onlyRealQuizzes(base)
      // Totalordning: nyeste først, id som unik tiebreaker (closes_at er ikke
      // garantert unik — to quizer kan dele stengetid).
      return query
        .order('closes_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to)
    })
  } catch (e) {
    console.error('[arkiv GET] kunne ikke lese quizlisten:', e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: 'Kunne ikke hente arkivet akkurat nå. Prøv igjen om litt.' },
      { status: 503 }
    )
  }

  // Spørsmåls-ID-ene per quiz er selve NYTTELASTEN: «spill quiz 47 på nytt» er
  // nøyaktig denne id-listen sendt til POST over. Klienten har ingen egen
  // lesevei til questions (ingen anon-policy), så listen må bære dem.
  let questionRows: ArchiveListQuestionRow[]
  try {
    questionRows = await fetchAllRowsChunked<ArchiveListQuestionRow>(
      quizzes.map((q) => q.id),
      (chunk, from, to) =>
        supabaseAdmin
          .from('questions')
          .select('id, quiz_id, order_index')
          .in('quiz_id', chunk)
          // Totalordning innad i biten: (quiz_id, order_index) er UNIQUE
          // (migrasjon 20260729000000). order_index-rekkefølgen ER
          // spillerekkefølgen kopien skal gjenskape.
          .order('quiz_id', { ascending: true })
          .order('order_index', { ascending: true })
          .range(from, to)
    )
  } catch (e) {
    console.error('[arkiv GET] kunne ikke lese spørsmåls-id-ene:', e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: 'Kunne ikke hente arkivet akkurat nå. Prøv igjen om litt.' },
      { status: 503 }
    )
  }

  const idsByQuiz = new Map<string, string[]>()
  for (const row of questionRows) {
    const ids = idsByQuiz.get(row.quiz_id)
    if (ids) ids.push(row.id)
    else idsByQuiz.set(row.quiz_id, [row.id])
  }

  return NextResponse.json({
    quizzes: quizzes.flatMap((q) => {
      const questionIds = idsByQuiz.get(q.id)
      // En quiz uten spørsmål kan ikke spilles (POST ville svart 'tom-liste')
      // — den skal heller ikke vises som spillbar.
      if (!questionIds || questionIds.length === 0) return []
      return [{ id: q.id, title: q.title, closesAt: q.closes_at, questionIds }]
    }),
  })
}
