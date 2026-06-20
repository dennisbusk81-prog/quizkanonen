import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

// ── Service-role attempt-opprettelse ─────────────────────────────────────────
// Erstatter den gamle klient-INSERT-en i app/quiz/[id]/page.tsx (startQuiz).
// Etter at RLS låser INSERT/UPDATE/DELETE på attempts til service_role, er dette
// den eneste lovlige veien til å opprette en attempt-rad. Klienten kan ikke
// lenger sette vilkårlige score-verdier direkte i databasen.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`start-attempt:${ip}`, 10, 600_000).success) {
    return NextResponse.json({ error: 'For mange forsøk. Vent litt og prøv igjen.' }, { status: 429 })
  }

  let body: {
    quizId?: unknown
    playerName?: unknown
    isTeam?: unknown
    teamSize?: unknown
    leaderDisplayName?: unknown
  }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  // ── Validering ──────────────────────────────────────────────────────────────
  const quizId = typeof body.quizId === 'string' ? body.quizId : ''
  if (!UUID_RE.test(quizId)) {
    return NextResponse.json({ error: 'Ugyldig quiz-id' }, { status: 400 })
  }

  const playerName = typeof body.playerName === 'string' ? body.playerName.trim() : ''
  if (!playerName || playerName.length > 100) {
    return NextResponse.json({ error: 'Ugyldig navn' }, { status: 400 })
  }

  const isTeam = body.isTeam === true
  const teamSize = isTeam
    ? (typeof body.teamSize === 'number' && body.teamSize > 0 ? Math.floor(body.teamSize) : 1)
    : 1
  const leaderDisplayName = typeof body.leaderDisplayName === 'string' && body.leaderDisplayName.trim()
    ? body.leaderDisplayName.trim()
    : null

  // ── Sesjon (valgfri — anonyme spillere er tillatt) ───────────────────────────
  let userId: string | null = null
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (token) {
    const { data: authData } = await supabaseAdmin.auth.getUser(token)
    userId = authData.user?.id ?? null
  }

  // ── Suspensjonssperre ─────────────────────────────────────────────────────────
  // Tidligere håndhevet av RLS INSERT-policyen. service_role omgår RLS, så vi må
  // sjekke eksplisitt her etter at INSERT er låst til service_role.
  if (userId) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('suspended_until')
      .eq('id', userId)
      .maybeSingle()
    if (profile?.suspended_until && new Date(profile.suspended_until) > new Date()) {
      return NextResponse.json({ error: 'Kontoen er suspendert', suspended: true }, { status: 403 })
    }
  }

  // ── Quizen må finnes og være åpen ─────────────────────────────────────────────
  const { data: quiz } = await supabaseAdmin
    .from('quizzes')
    .select('id, opens_at, closes_at')
    .eq('id', quizId)
    .maybeSingle()

  if (!quiz) {
    return NextResponse.json({ error: 'Quizen finnes ikke' }, { status: 404 })
  }

  const now = Date.now()
  const opensAt = quiz.opens_at ? new Date(quiz.opens_at).getTime() : null
  const closesAt = quiz.closes_at ? new Date(quiz.closes_at).getTime() : null
  if ((opensAt !== null && now < opensAt) || (closesAt !== null && now > closesAt)) {
    return NextResponse.json({ error: 'Quizen er ikke åpen' }, { status: 403 })
  }

  // ── Replay-sperre for innloggede ──────────────────────────────────────────────
  // Et levert forsøk (submitted_at satt) betyr at brukeren allerede har spilt.
  // Uferdige forsøk (avbrutt før innsending) blokkerer ikke — da kan man starte på nytt.
  if (userId) {
    const { data: existing } = await supabaseAdmin
      .from('attempts')
      .select('id')
      .eq('quiz_id', quizId)
      .eq('user_id', userId)
      .not('submitted_at', 'is', null)
      .limit(1)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ error: 'Du har allerede spilt denne quizen', alreadyPlayed: true }, { status: 409 })
    }

    // Gjenbruk eksisterende UFERDIG forsøk (submitted_at NULL) i stedet for å
    // opprette en ny rad. Dette hindrer duplikate attempts-rader når brukeren
    // laster siden på nytt / fortsetter etter en hang. limit(1) gjør maybeSingle
    // trygg selv om historiske duplikater finnes.
    const { data: unfinished } = await supabaseAdmin
      .from('attempts')
      .select('id')
      .eq('quiz_id', quizId)
      .eq('user_id', userId)
      .is('submitted_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (unfinished) {
      return NextResponse.json({ attemptId: unfinished.id, reused: true })
    }
  }

  // ── Antall spørsmål (settes ved opprettelse, brukes i resultatvisning) ─────────
  const { count: questionCount } = await supabaseAdmin
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .eq('quiz_id', quizId)

  // ── Opprett attempt ─────────────────────────────────────────────────────────
  // correct_streak settes bevisst IKKE her — NULL er markøren for "ikke ferdig
  // scoret" som historikk/ranking filtrerer på. submit/route.ts setter den ved
  // innsending. submitted_at settes til NULL av samme grunn.
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('attempts')
    .insert({
      quiz_id: quizId,
      player_name: playerName,
      is_team: isTeam,
      team_size: teamSize,
      total_questions: questionCount ?? 0,
      correct_answers: 0,
      total_time_ms: 0,
      user_id: userId,
      leader_display_name: isTeam ? leaderDisplayName : null,
      submitted_at: null,
    })
    .select('id')
    .single()

  if (insertError || !inserted) {
    // Unik constraint (attempts_user_quiz_unique) traff pga. samtidig forespørsel
    // — hent og gjenbruk den eksisterende uferdige raden i stedet for å feile.
    if (insertError?.code === '23505' && userId) {
      const { data: race } = await supabaseAdmin
        .from('attempts')
        .select('id')
        .eq('quiz_id', quizId)
        .eq('user_id', userId)
        .is('submitted_at', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (race) return NextResponse.json({ attemptId: race.id, reused: true })
    }
    console.error('[start-attempt] insert feilet:', insertError?.message)
    return NextResponse.json({ error: 'Kunne ikke starte forsøket' }, { status: 500 })
  }

  return NextResponse.json({ attemptId: inserted.id })
}
