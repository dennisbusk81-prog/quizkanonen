import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'
import { fetchAllRowsChunked } from '@/lib/paginate'
import {
  onlyRealQuizAttempts,
  erEkteQuiz,
  REAL_QUIZ_ATTEMPT_EMBED,
} from '@/lib/real-quiz-population'
import Stripe from 'stripe'

// `quiz_type`/`is_test` er ikke visningsfelt — de mater `erEkteQuiz` lenger
// nede, som avgjør om raden i loggen faktisk telte med i flisene over den.
type QuizRow = {
  id: string
  title: string
  opens_at: string | null
  quiz_type: string | null
  is_test: boolean | null
}

// Samme vakt som start-attempt/questions/cleanup-orgs: id-en kommer rått fra
// URL-stien, og en ikke-UUID (f.eks. en e-postadresse limt inn i adressefeltet)
// ville ellers nådd Postgres som 22P02 — sett i prod-loggen 15. august 2026.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Batch-/kaskade-arbeid: flere eksterne kall, bulk-e-post eller tunge
// slettinger. Samme budsjett som de eksisterende cron-rutene (konvensjon 60).
export const maxDuration = 60

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Ugyldig bruker-id' }, { status: 400 })

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select(`
      id, display_name, nickname, avatar_color, created_at, last_seen_at,
      age_confirmed_at,
      premium_status, premium_source, premium_since, premium_expires_at,
      stripe_customer_id, personal_stripe_subscription_id, org_premium_grace_until,
      suspended_until
    `)
    .eq('id', id)
    .maybeSingle()

  if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 })
  if (!profile) return NextResponse.json({ error: 'Bruker ikke funnet' }, { status: 404 })

  // auth.users — henter kun DENNE brukeren (ikke listUsers-løkken som resten
  // av admin/users bruker for hele listen). getUserById er billig og trenger
  // ingen paginering for én enkelt bruker.
  const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.getUserById(id)
  if (authErr) console.error('[users/[id]] getUserById feilet:', authErr.message)
  const authUser = authData?.user ?? null
  const meta = authUser?.user_metadata ?? {}
  const appMeta = authUser?.app_metadata ?? {}
  // Samme kilde som /api/auth/check-email: identities-arrayet er tomt i denne
  // Supabase-versjonen, providers i app_metadata er den pålitelige kilden.
  const providers: string[] = appMeta.providers ?? (appMeta.provider ? [appMeta.provider] : [])
  const hasGoogle = providers.includes('google')

  // «Passord»-merket er avledet fra auth.users.encrypted_password, ikke lest fra
  // profiles. Merk at providers her IKKE kan brukes til det samme: en magic
  // link-bruker har også provider 'email' uten å ha noe passord.
  const { data: hasPasswordRaw, error: hasPasswordErr } = await supabaseAdmin
    .rpc('auth_has_password', { p_user_id: id })
  if (hasPasswordErr) console.error('[users/[id]] auth_has_password feilet:', hasPasswordErr.message)

  // ── Aktivitet ────────────────────────────────────────────────────────────
  // TO SPØRRINGER, MED VILJE — de to flatene under stiller ulike spørsmål, og
  // ett filter på én spørring kan ikke svare på begge:
  //
  //   LOGGEN (`attempts`)      = «hva har brukeren faktisk gjort?». Skal vise
  //     ALT, arkiv-/treningsrunder inkludert. Filtreres den, blir admin blind
  //     for at brukeren i det hele tatt spilte en arkivquiz — og det er
  //     nettopp dét man åpner denne siden for å finne ut.
  //   FLISENE (`realAttempts`) = «hvor står brukeren i konkurransen?». Det er
  //     PÅSTANDER («Lengste streak»), og må regnes over ekte quizer alene.
  //     Samme gulv som getPlayerStats legger på /historikk (lib/history.ts).
  //
  // Radene loggen viser men flisene ikke teller, merkes `countsInStats: false`
  // lenger ned. Uten den markøren ser «3 quizer spilt» over en seks rader lang
  // liste ut som en feil, i stedet for som to ulike spørsmål.
  //
  // Én bruker har et beskjedent antall forsøk (attempts_user_quiz_unique
  // hindrer duplikater per quiz for individuelle forsøk) — ingen paginering
  // nødvendig for én enkelt profil, i motsetning til listesiden.
  //
  // Lokal variabel før helper-kallet, ikke inlinet som argument — TS2589-regelen
  // fra lib/real-quiz-population.ts. `.order()` før helperen er greit; det er
  // `.single()`/`.maybeSingle()` som må komme ETTER.
  const listQuery = supabaseAdmin
    .from('attempts')
    .select('id, quiz_id, is_team, correct_answers, total_questions, total_time_ms, correct_streak, submitted_at, completed_at')
    .eq('user_id', id)
    .order('completed_at', { ascending: false })

  const statsBase = supabaseAdmin
    .from('attempts')
    .select(`correct_streak, completed_at, ${REAL_QUIZ_ATTEMPT_EMBED}`)
    .eq('user_id', id)
    .order('completed_at', { ascending: false })
  const statsQuery = onlyRealQuizAttempts(statsBase)

  const [
    { data: attempts, error: attemptsErr },
    { data: realAttempts, error: realAttemptsErr },
  ] = await Promise.all([listQuery, statsQuery])

  if (attemptsErr) return NextResponse.json({ error: attemptsErr.message }, { status: 500 })
  // Egen sjekk, ikke slått sammen med den over: feiler kun denne, ville flisene
  // ellers vist 0/0/0 for en bruker med full historikk — et målt tall som i
  // virkeligheten betyr «hentingen feilet».
  if (realAttemptsErr) return NextResponse.json({ error: realAttemptsErr.message }, { status: 500 })

  // Kommentaren over gjelder RADTAKET og stemmer fortsatt: én profil har få
  // forsøk. .in()-taket er en annen grense — hele id-lista havner i URL-en, og
  // den brekker rundt 390 id-er. Én quiz i uka betyr at en trofast spiller
  // passerer det etter ~7,5 år, og feilen er stille her: `data` blir undefined,
  // og HVER quiz-tittel i brukerens historikk faller til null uten spor.
  const quizIds = [...new Set((attempts ?? []).map(a => a.quiz_id))].filter(Boolean)
  let quizRows: QuizRow[] = []
  try {
    quizRows = await fetchAllRowsChunked<QuizRow>(quizIds, (chunk, from, to) =>
      supabaseAdmin
        .from('quizzes')
        .select('id, title, opens_at, quiz_type, is_test')
        .in('id', chunk)
        .order('id', { ascending: true })
        .range(from, to)
    )
  } catch (e) {
    console.error('[users/[id]] quiz-oppslag feilet:', e instanceof Error ? e.message : e)
  }
  const quizMap = new Map(quizRows.map(q => [q.id, q]))

  // Rangering per (quiz, rom) — gjenbruker RPC-en /leaderboard/[id] allerede
  // bruker. Ett kall per DISTINKT (quiz_id, is_team)-par brukeren har spilt i,
  // ikke per forsøk — attempts_user_quiz_unique gjør at det i praksis er
  // samme tall for individuelle forsøk.
  const rankKeys = [...new Set((attempts ?? []).map(a => `${a.quiz_id}::${a.is_team}`))]
  const rankResults = await Promise.all(
    rankKeys.map(async key => {
      const [quizId, isTeamStr] = key.split('::')
      const { data } = await supabaseAdmin.rpc('quiz_leaderboard_user_stats', {
        p_quiz_id: quizId,
        p_is_team: isTeamStr === 'true',
        p_user_id: id,
      })
      return { key, rank: data?.[0]?.rank ?? null, totalCount: null as number | null }
    })
  )
  const rankMap = new Map(rankResults.map(r => [r.key, r.rank]))

  const quizzes = (attempts ?? []).map(a => {
    const quiz = quizMap.get(a.quiz_id)
    return {
      attemptId: a.id,
      quizId: a.quiz_id,
      title: quiz?.title ?? 'Slettet quiz',
      opensAt: quiz?.opens_at ?? null,
      isTeam: a.is_team,
      correctAnswers: a.correct_answers,
      totalQuestions: a.total_questions,
      totalTimeMs: a.total_time_ms,
      correctStreak: a.correct_streak,
      submittedAt: a.submitted_at,
      rank: rankMap.get(`${a.quiz_id}::${a.is_team}`) ?? null,
      // Speiler `onlyRealQuizAttempts` på rad-nivå — se paritetsavsnittet over
      // `erEkteQuiz` i lib/real-quiz-population.ts: predikatet er bygget på
      // SAMME `REAL_QUIZ_TYPES`, og deler `not.is.true`-semantikken, slik at en
      // rad som passerer det er nøyaktig den raden filteret ville sluppet
      // gjennom. Ikke skriv sjekken på nytt her.
      //
      // En quiz som ikke finnes i `quizMap` (slettet quiz, eller et feilet
      // quiz-oppslag i catch-en over) gir `false` — og det er riktig i begge
      // retninger: `!inner`-joinen i statsQuery dropper nøyaktig de samme
      // radene, så markøren og flisene er enige uansett.
      countsInStats: erEkteQuiz(quiz),
    }
  })

  // "Nåværende" streak = siste forsøks correct_streak (`realAttempts` er
  // sortert nyest først). "Lengste" = MAX over alle forsøk. Dette er
  // svar-streak INNAD i én quiz (attempts.correct_streak), ikke en
  // uke-til-uke spille-streak — det konseptet finnes ikke i skjemaet.
  //
  // Begge leser `realAttempts`, ikke `attempts`: en treningsrunde på en
  // arkivquiz er ikke en konkurransestreak. Fram til 29. august 2026 leste de
  // hele loggen, og for en konto som nettopp hadde spilt arkiv viste
  // "Nåværende streak" da resultatet av en treningsrunde.
  const currentStreak = realAttempts?.[0]?.correct_streak ?? 0
  const longestStreak = (realAttempts ?? []).reduce((max, a) => Math.max(max, a.correct_streak ?? 0), 0)

  // ── Premium og betaling ──────────────────────────────────────────────────
  // Rå Stripe-ID vises ALDRI i UI — kun en ferdigbygd dashboard-URL herfra.
  // Kun for premium_source='personal': org-abonnement tilhører organisasjonen,
  // ikke denne profilen, og har ingen egen kunde-id på profiles-raden.
  const stripeDashboardUrl = profile.premium_source === 'personal' && profile.stripe_customer_id
    ? `https://dashboard.stripe.com/customers/${profile.stripe_customer_id}`
    : null

  // ── Tilhørighet ──────────────────────────────────────────────────────────
  const [{ data: orgRows }, { data: leagueRows }, { data: rivalryRows }] = await Promise.all([
    supabaseAdmin
      .from('organization_members')
      .select('role, joined_at, organizations(id, name, slug)')
      .eq('user_id', id),
    supabaseAdmin
      .from('league_members')
      .select('joined_at, leagues(id, name, slug)')
      .eq('user_id', id),
    supabaseAdmin
      .from('rivalries')
      .select('id, challenger_id, rival_id, status, created_at')
      .or(`challenger_id.eq.${id},rival_id.eq.${id}`),
  ])

  const opponentIds = [...new Set(
    (rivalryRows ?? []).map(r => (r.challenger_id === id ? r.rival_id : r.challenger_id))
  )]
  const { data: opponentProfiles } = opponentIds.length > 0
    ? await supabaseAdmin.from('profiles').select('id, display_name, nickname').in('id', opponentIds)
    : { data: [] as { id: string; display_name: string | null; nickname: string | null }[] }
  const opponentMap = new Map((opponentProfiles ?? []).map(p => [p.id, p]))

  const rivalries = (rivalryRows ?? []).map(r => {
    const opponentId = r.challenger_id === id ? r.rival_id : r.challenger_id
    const opponent = opponentMap.get(opponentId)
    return {
      id: r.id,
      status: r.status,
      createdAt: r.created_at,
      opponentName: opponent?.nickname?.trim() || opponent?.display_name || 'Ukjent bruker',
    }
  })

  // ── Admin-historikk ──────────────────────────────────────────────────────
  const { data: adminActionRows } = await supabaseAdmin
    .from('admin_actions')
    .select('id, action_type, created_at')
    .eq('scope_type', 'user')
    .eq('scope_id', id)
    .order('created_at', { ascending: false })

  return NextResponse.json({
    profile: {
      id: profile.id,
      displayName: profile.display_name,
      nickname: profile.nickname,
      email: authUser?.email ?? null,
      googleName: (meta.full_name ?? meta.name ?? null) as string | null,
      hasGoogle,
      hasPassword: hasPasswordRaw === true,
      createdAt: profile.created_at,
      lastSeenAt: profile.last_seen_at,
      ageConfirmedAt: profile.age_confirmed_at,
      suspendedUntil: profile.suspended_until,
      premium: {
        status: profile.premium_status === true,
        source: profile.premium_source,
        since: profile.premium_since,
        // Kun meningsfullt for code/founders — personal sin fornyelsesdato
        // ligger i Stripe, org sitt abonnement tilhører organisasjonen.
        expiresAt: profile.premium_expires_at,
        graceUntil: profile.org_premium_grace_until,
        stripeDashboardUrl,
      },
    },
    activity: {
      // `realAttempts.length`, IKKE `quizzes.length`: flisen heter «Quizer
      // spilt» og står ved siden av to streak-tall som alle tre er påstander om
      // konkurransen. `quizzes` er loggen og er med vilje lengre — differansen
      // er nøyaktig radene som bærer `countsInStats: false`.
      totalQuizzes: realAttempts?.length ?? 0,
      currentStreak,
      longestStreak,
      quizzes,
    },
    memberships: {
      organizations: (orgRows ?? []).map(o => {
        const org = o.organizations as unknown as { id: string; name: string; slug: string } | null
        return { id: org?.id ?? null, name: org?.name ?? 'Ukjent', slug: org?.slug ?? null, role: o.role, joinedAt: o.joined_at }
      }),
      leagues: (leagueRows ?? []).map(l => {
        const league = l.leagues as unknown as { id: string; name: string; slug: string } | null
        return { id: league?.id ?? null, name: league?.name ?? 'Ukjent', slug: league?.slug ?? null, joinedAt: l.joined_at }
      }),
      rivalries,
    },
    adminActions: adminActionRows ?? [],
  })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Ugyldig bruker-id' }, { status: 400 })

  // Server-side bekreftelse, ikke bare en klient-side skriv-for-å-bekrefte-
  // sperre: klienten sender e-posten admin skrev inn, og vi validerer den mot
  // FAKTISK e-post på kontoen før noe slettes. En sperre kun i UI-et hadde
  // vært en hastighetsdemper, ikke en reell sikring mot feilklikk/scripting.
  let body: { confirmEmail?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Mangler bekreftelse' }, { status: 400 })
  }

  const { data: authData, error: authLookupErr } = await supabaseAdmin.auth.admin.getUserById(id)
  if (authLookupErr || !authData?.user) {
    return NextResponse.json({ error: 'Bruker ikke funnet' }, { status: 404 })
  }
  const actualEmail = authData.user.email?.trim().toLowerCase()
  const providedEmail = body.confirmEmail?.trim().toLowerCase()
  if (!actualEmail || !providedEmail || providedEmail !== actualEmail) {
    return NextResponse.json({ error: 'E-posten stemmer ikke — sletting avbrutt' }, { status: 400 })
  }

  // Cancel Stripe subscription if any
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', id)
    .maybeSingle()

  if (profile?.stripe_customer_id) {
    try {
      const subs = await stripe.subscriptions.list({ customer: profile.stripe_customer_id, status: 'active' })
      await Promise.all(subs.data.map(s => stripe.subscriptions.cancel(s.id)))
    } catch (err) {
      console.error('[admin/users DELETE] Stripe cancel failed:', err)
    }
  }

  // Quiz-historikk: attempts har ingen FK til auth.users, så deleteUser rører
  // den ikke. Fram til nå slettet admin-ruten IKKE attempt_answers/attempts i
  // det hele tatt (i motsetning til profile/delete, som en bruker bruker for å
  // slette sin egen konto) — brukerens spillehistorikk ble stående for alltid
  // med en user_id som pekte på en slettet auth-bruker, samme GDPR art. 17-brudd
  // som profile/delete sin kommentar advarer mot. Hentes før cascade-løkken slik
  // at attempt_answers/attempts kan tas med som ordinære steg, barn før foreldre.
  const { data: userAttempts, error: attemptsFetchErr } = await supabaseAdmin
    .from('attempts')
    .select('id')
    .eq('user_id', id)
  if (attemptsFetchErr) {
    console.error('[admin/users DELETE] kunne ikke hente forsøk for cascade', id, attemptsFetchErr)
    return NextResponse.json({ error: 'Sletting feilet (attempts-oppslag). Prøv igjen.' }, { status: 500 })
  }
  const attemptIds = (userAttempts ?? []).map(a => a.id)

  // Cascade delete related data. Sekvensiell for-løkke, ikke ubevoktede await-
  // kall: en skriving som feiler skal stoppe HELE slettingen før deleteUser
  // kalles, ikke bare passere stille — ellers slettes kontoen likevel med data
  // stående igjen. Samme steg-array + feilsjekk-mønster som profile/delete og
  // app/api/org/[slug]/delete/route.ts.
  const cascadeSteps: { table: string; run: () => PromiseLike<{ error: { message: string } | null }> }[] = [
    { table: 'rivalries', run: () => supabaseAdmin.from('rivalries').delete()
        .or(`challenger_id.eq.${id},rival_id.eq.${id}`) },
    { table: 'league_members', run: () => supabaseAdmin.from('league_members').delete()
        .eq('user_id', id) },
    { table: 'season_scores', run: () => supabaseAdmin.from('season_scores').delete()
        .eq('user_id', id) },
    { table: 'organization_members', run: () => supabaseAdmin.from('organization_members').delete()
        .eq('user_id', id) },
    ...(attemptIds.length > 0
      ? [
          { table: 'attempt_answers', run: () => supabaseAdmin.from('attempt_answers').delete()
              .in('attempt_id', attemptIds) },
          { table: 'attempts', run: () => supabaseAdmin.from('attempts').delete()
              .eq('user_id', id) },
        ]
      : []),
  ]

  for (const step of cascadeSteps) {
    const { error: stepErr } = await step.run()
    if (stepErr) {
      console.error(`[admin/users DELETE] sletting feilet på steg "${step.table}"`, id, stepErr)
      return NextResponse.json(
        { error: `Sletting feilet (${step.table}). Prøv igjen.` },
        { status: 500 },
      )
    }
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(id)
  if (error) {
    console.error('[admin/users DELETE] deleteUser failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Logges etter selve slettingen — scope_id er en fri uuid uten FK mot
  // profiles, så det er trygt at raden den peker på ikke lenger finnes.
  // Loggen er et historisk sportelegg, ikke en referanse som må holde.
  try {
    const { error: logErr } = await supabaseAdmin.from('admin_actions').insert({
      action_type: 'delete_user',
      scope_type: 'user',
      scope_id: id,
    })
    if (logErr) console.error('[admin/users DELETE] admin_actions-logging feilet', id, logErr)
  } catch (err) {
    console.error('[admin/users DELETE] admin_actions-logging kastet', id, err)
  }

  return NextResponse.json({ ok: true })
}
