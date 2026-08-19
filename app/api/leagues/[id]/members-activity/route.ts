import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { logRateLimitHit } from '@/lib/rate-limit-log'

type Params = { params: Promise<{ id: string }> }

// Rullerende vindu for AKTIV-prikken. Bevisst løsrevet fra `period`-fanen, av
// samme grunn som i org-varianten (se app/api/org/[slug]/members-activity):
// prikken står på medlemsraden, mens fanen styrer poeng-kolonnene — et
// fane-bytte endret stille betydningen av prikken.
const ACTIVE_WINDOW_DAYS = 30

// Én kilde til kolonnenavnene: tom-liga-responsen under skrev «Spilt denne
// perioden» mens den vanlige skrev «Spilt (Måned)» — to navn på samme kolonne.
//
// «Aktiv siste 30 dager» og «Sist innlogget eller spilt» er navngitt presist
// fordi de måler to ULIKE ting på samme rad: den første er levert quiz
// (attempts.submitted_at), den andre er profiles.last_seen_at, som også settes
// ved ren innlogging uten at brukeren spiller.
const CSV_HEADER = 'Navn,Aktiv siste 30 dager,Poeng,Antall quizer,Sist innlogget eller spilt'

function getPeriodStart(period: string): string {
  const now = new Date()
  if (period === 'month') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  }
  if (period === 'quarter') {
    const q = Math.floor(now.getUTCMonth() / 3)
    return new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1)).toISOString()
  }
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString()
}

// GET /api/leagues/[id]/members-activity?period=month|quarter|year&format=csv
// Returnerer aktivitetsdata for alle liga-medlemmer. Krever liga-eierskap.
// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function GET(request: NextRequest, { params }: Params) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rlKey = `league-members-activity:${ip}`
  if (!rateLimit(rlKey, 20, 60_000).success) {
    logRateLimitHit(rlKey, { lag: 'lokal', limit: 20, windowMs: 60_000 })
    return NextResponse.json({ error: 'For mange forespørsler. Prøv igjen om litt.' }, { status: 429 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { id: leagueId } = await params
  const { searchParams } = new URL(request.url)
  const period = ['month', 'quarter', 'year'].includes(searchParams.get('period') ?? '')
    ? (searchParams.get('period') as 'month' | 'quarter' | 'year')
    : 'month'
  const format = searchParams.get('format')

  // Verifiser eierskap
  const { data: league } = await supabaseAdmin
    .from('leagues')
    .select('owner_id')
    .eq('id', leagueId)
    .maybeSingle()

  if (!league) return NextResponse.json({ error: 'Fant ikke ligaen.' }, { status: 404 })
  if (league.owner_id !== user.id) {
    return NextResponse.json({ error: 'Kun eieren kan se dette.' }, { status: 403 })
  }

  // Hent alle liga-medlemmer
  const { data: leagueMembers } = await supabaseAdmin
    .from('league_members')
    .select('user_id, joined_at')
    .eq('league_id', leagueId)
    .order('joined_at', { ascending: true })

  if (!leagueMembers || leagueMembers.length === 0) {
    return format === 'csv'
      ? new NextResponse('﻿' + CSV_HEADER + '\n', {
          headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="aktivitet-${period}.csv"` },
        })
      : NextResponse.json({ members: [], period })
  }

  const memberIds = leagueMembers.map(m => m.user_id)

  // Hent profiler
  const { data: profiles, error: profilesErr } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, last_seen_at')
    .in('id', memberIds)

  // Samme vakt som attempts-oppslaget lenger nede, og av samme grunn: et tomt
  // sett her er ikke «ingen profiler», det er «vi vet ikke» — og lista ville
  // vist navnløse medlemmer uten et eneste spor.
  if (profilesErr) {
    console.error('[league-members-activity] profil-oppslag feilet:', profilesErr.message)
    return NextResponse.json({ error: 'Kunne ikke hente aktivitetsdata.' }, { status: 500 })
  }

  const profileMap = new Map((profiles ?? []).map(p => [p.id, p]))

  // Hent ekskluderte brukere
  const { data: excluded, error: excludedErr } = await supabaseAdmin
    .from('excluded_members')
    .select('user_id')
    .eq('scope_type', 'league')
    .eq('scope_id', leagueId)

  // Feiler denne, blir settet tomt og EKSKLUDERTE MEDLEMMER DUKKER OPP IGJEN i
  // lista — en utmelding som stille slutter å gjelde er verre enn en feilmelding.
  if (excludedErr) {
    console.error('[league-members-activity] excluded_members-oppslag feilet:', excludedErr.message)
    return NextResponse.json({ error: 'Kunne ikke hente aktivitetsdata.' }, { status: 500 })
  }

  const excludedSet = new Set((excluded ?? []).map(e => e.user_id))

  // Hent season_scores for perioden
  const periodStart = getPeriodStart(period)
  const { data: scores, error: scoresErr } = await supabaseAdmin
    .from('season_scores')
    .select('user_id, points, quiz_id')
    .eq('scope_type', 'league')
    .eq('scope_id', leagueId)
    .gte('closes_at', periodStart)
    .in('user_id', memberIds)

  // Den farligste av de tre: et tomt sett gir HELE ligaen 0 poeng, og 0 poeng
  // ser helt normalt ut de første dagene i en ny periode. Feilen ville altså
  // vært usynlig nettopp når den er mest sannsynlig å bli trodd.
  if (scoresErr) {
    console.error('[league-members-activity] season_scores-oppslag feilet:', scoresErr.message)
    return NextResponse.json({ error: 'Kunne ikke hente aktivitetsdata.' }, { status: 500 })
  }

  // ── AKTIV-prikken: faktisk deltakelse siste 30 dager ────────────────────────
  // Egen kilde fra poeng-kolonnene over, og med vilje:
  //   season_scores skrives først av `award-season-points` ETTER at en quiz har
  //   stengt, og bare for kalenderperioden fanen står på. Prikken arvet begge
  //   svakhetene: 1. i måneden var hele ligaen plutselig «inaktiv» selv om alle
  //   spilte sist fredag, og under en pågående quiz hadde ingen prikk i det hele
  //   tatt. attempts.submitted_at settes i det spilleren leverer, så prikken er
  //   korrekt umiddelbart og faller ikke ut ved månedsskifte.
  //
  // `.gte('submitted_at', …)` utelukker uleverte forsøk av seg selv (NULL kan
  // ikke tilfredsstille en sammenligning), men `.not(...)` står eksplisitt her
  // fordi det er en INVARIANT og ikke en bieffekt: et påbegynt, aldri levert
  // forsøk skal ikke telle som spilt. Samme filter som `lib/weekly-report.ts`.
  // is_team = false speiler award-season-points — et lagforsøk gir heller ikke
  // sesongpoeng, så prikken ville ellers vært uenig med lista under.
  const activeSince = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data: recentAttempts, error: recentErr } = await supabaseAdmin
    .from('attempts')
    .select('user_id')
    .in('user_id', memberIds)
    .eq('is_team', false)
    .not('submitted_at', 'is', null)
    .gte('submitted_at', activeSince)

  // Ingen stille degradering: uten dette ville en feilet spørring gitt et tomt
  // sett, og HELE medlemslisten ville vist seg som inaktiv uten et eneste spor.
  if (recentErr) {
    console.error('[league-members-activity] attempts-oppslag feilet:', recentErr.message)
    return NextResponse.json({ error: 'Kunne ikke hente aktivitetsdata.' }, { status: 500 })
  }

  const activeUserIds = new Set((recentAttempts ?? []).map(a => a.user_id))

  type UserStats = { points: number; quizCount: number; quizIds: Set<string> }
  const statsMap = new Map<string, UserStats>()
  for (const s of (scores ?? []) as { user_id: string; points: number; quiz_id: string }[]) {
    const existing = statsMap.get(s.user_id) ?? { points: 0, quizCount: 0, quizIds: new Set<string>() }
    if (!existing.quizIds.has(s.quiz_id)) {
      existing.points += s.points
      existing.quizCount += 1
      existing.quizIds.add(s.quiz_id)
    }
    statsMap.set(s.user_id, existing)
  }

  const joinedAtMap = new Map(leagueMembers.map(m => [m.user_id, m.joined_at]))

  const members = memberIds.map(uid => {
    const profile = profileMap.get(uid)
    const stats = statsMap.get(uid)
    return {
      userId: uid,
      displayName: profile?.display_name ?? uid.slice(0, 8),
      joinedAt: joinedAtMap.get(uid) ?? null,
      // AKTIV-prikken i UI-et. `hasPeriodScore` er bevisst et ANNET felt: det
      // følger perioden fanen står på og styrer kun sorteringen og
      // poeng-linjen under, ikke prikken.
      activeLast30Days: activeUserIds.has(uid),
      hasPeriodScore: !!stats,
      totalPoints: stats?.points ?? 0,
      quizCount: stats?.quizCount ?? 0,
      lastActiveAt: (profile as { last_seen_at?: string } | undefined)?.last_seen_at ?? null,
      isExcluded: excludedSet.has(uid),
    }
  })

  // Sorter: har poeng i perioden (poeng DESC) → resten (alfabetisk).
  // Bevisst fortsatt periodebasert og ikke 30-dagers: linjen under navnet viser
  // Poeng/Antall quizer, som begge er periode-tall.
  members.sort((a, b) => {
    if (a.hasPeriodScore !== b.hasPeriodScore) return a.hasPeriodScore ? -1 : 1
    if (a.hasPeriodScore && b.hasPeriodScore) return b.totalPoints - a.totalPoints
    return a.displayName.localeCompare(b.displayName, 'nb')
  })

  if (format === 'csv') {
    const rows = members.map(m => [
      `"${m.displayName.replace(/"/g, '""')}"`,
      m.activeLast30Days ? 'Ja' : 'Nei',
      m.totalPoints,
      m.quizCount,
      m.lastActiveAt ? new Date(m.lastActiveAt).toLocaleDateString('nb-NO') : '—',
    ].join(','))
    const csv = '﻿' + [CSV_HEADER, ...rows].join('\n')
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="aktivitet-${period}.csv"`,
      },
    })
  }

  return NextResponse.json({ members, period })
}
