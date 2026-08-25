import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireUnlockedOrg } from '@/lib/org-lock-guard'
import { onlyRealQuizAttempts, REAL_QUIZ_ATTEMPT_EMBED } from '@/lib/real-quiz-population'

type Params = { params: Promise<{ slug: string }> }

// Rullerende vindu for AKTIV-merket. Bevisst løsrevet fra `period`-fanen:
// merket sitter i medlemslisten, mens fanen står i toppliste-seksjonen langt
// nede — fram til 29. juli endret et fane-bytte stille betydningen av merket
// lenger opp på siden.
const ACTIVE_WINDOW_DAYS = 30

// Én kilde til kolonnenavnene: tom-org-responsen under manglet tidligere
// «Rolle» og ga en 5-kolonners CSV der den vanlige ga 6.
//
// «Aktiv siste 30 dager» og «Sist innlogget eller spilt» er navngitt presist
// fordi de måler to ULIKE ting på samme rad: den første er levert quiz
// (attempts.submitted_at), den andre er profiles.last_seen_at, som også
// settes ved ren innlogging uten at brukeren spiller. De gamle navnene
// («Aktiv denne måneden» / «Sist aktiv») antydet at de hørte sammen.
const CSV_HEADER = 'Navn,Rolle,Aktiv siste 30 dager,Poeng,Antall quizer,Sist innlogget eller spilt'

function getPeriodStart(period: string): string {
  const now = new Date()
  if (period === 'month') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  }
  if (period === 'quarter') {
    const q = Math.floor(now.getUTCMonth() / 3)
    return new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1)).toISOString()
  }
  // year
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString()
}

// GET /api/org/[slug]/members-activity?period=month|quarter|year&format=csv
// Returnerer aktivitetsdata for alle org-medlemmer. Krever org-admin.
// orgId er UUID her, ikke en slug — kun param-navn er endret for Next.js routing-konsistens
// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function GET(request: NextRequest, { params }: Params) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { slug: orgId } = await params
  const { searchParams } = new URL(request.url)
  const period = ['month', 'quarter', 'year'].includes(searchParams.get('period') ?? '')
    ? (searchParams.get('period') as 'month' | 'quarter' | 'year')
    : 'month'
  const format = searchParams.get('format')

  // Verifiser org-admin
  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (membership?.role !== 'admin') {
    return NextResponse.json({ error: 'Kun admins kan se dette.' }, { status: 403 })
  }

  // Låst org: aktivitetsdata, inkludert CSV-eksporten, er det betalte produktet.
  const lock = await requireUnlockedOrg({ id: orgId })
  if (!lock.ok) return NextResponse.json(lock.body, { status: lock.status })

  // Hent alle org-medlemmer
  const { data: orgMembers, error: membersErr } = await supabaseAdmin
    .from('organization_members')
    .select('user_id, role, joined_at')
    .eq('organization_id', orgId)
    .order('joined_at', { ascending: true })

  // Uten denne ble en feilet spørring til «bedriften har ingen ansatte» — en
  // tom liste, eller en CSV med bare overskriftsraden, servert til en
  // betalende kunde som tar beslutninger på tallene.
  if (membersErr) {
    console.error('[members-activity] medlemsoppslag feilet:', membersErr.message)
    return NextResponse.json({ error: 'Kunne ikke hente aktivitetsdata.' }, { status: 500 })
  }

  if (!orgMembers || orgMembers.length === 0) {
    return format === 'csv'
      ? new NextResponse('﻿' + CSV_HEADER + '\n', {
          headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="aktivitet-${period}.csv"` },
        })
      : NextResponse.json({ members: [], period })
  }

  const memberIds = orgMembers.map(m => m.user_id)

  // Hent profiler
  const { data: profiles, error: profilesErr } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, last_seen_at')
    .in('id', memberIds)

  // Samme vakt som attempts-oppslaget lenger nede, og av samme grunn: et tomt
  // sett her er ikke «ingen profiler», det er «vi vet ikke» — og lista ville
  // vist navnløse medlemmer uten et eneste spor.
  if (profilesErr) {
    console.error('[members-activity] profil-oppslag feilet:', profilesErr.message)
    return NextResponse.json({ error: 'Kunne ikke hente aktivitetsdata.' }, { status: 500 })
  }

  const profileMap = new Map((profiles ?? []).map(p => [p.id, p]))

  // Hent ekskluderte brukere
  const { data: excluded, error: excludedErr } = await supabaseAdmin
    .from('excluded_members')
    .select('user_id')
    .eq('scope_type', 'organization')
    .eq('scope_id', orgId)

  // Feiler denne, blir settet tomt og EKSKLUDERTE MEDLEMMER DUKKER OPP IGJEN i
  // lista — en utmelding som stille slutter å gjelde er verre enn en feilmelding.
  if (excludedErr) {
    console.error('[members-activity] excluded_members-oppslag feilet:', excludedErr.message)
    return NextResponse.json({ error: 'Kunne ikke hente aktivitetsdata.' }, { status: 500 })
  }

  const excludedSet = new Set((excluded ?? []).map(e => e.user_id))

  // Hent season_scores for perioden
  const periodStart = getPeriodStart(period)
  const { data: scores, error: scoresErr } = await supabaseAdmin
    .from('season_scores')
    .select('user_id, points, quiz_id')
    .eq('scope_type', 'organization')
    .eq('scope_id', orgId)
    .gte('closes_at', periodStart)
    .in('user_id', memberIds)

  // Den farligste av de tre: et tomt sett gir HELE org-en 0 poeng, og 0 poeng
  // ser helt normalt ut de første dagene i en ny periode. Feilen ville altså
  // vært usynlig nettopp når den er mest sannsynlig å bli trodd — og dette er
  // aktivitetsdata en betalende bedriftskunde tar beslutninger på.
  if (scoresErr) {
    console.error('[members-activity] season_scores-oppslag feilet:', scoresErr.message)
    return NextResponse.json({ error: 'Kunne ikke hente aktivitetsdata.' }, { status: 500 })
  }

  // ── AKTIV-merket: faktisk deltakelse siste 30 dager ─────────────────────────
  // Egen kilde fra poeng-kolonnene over, og med vilje:
  //   season_scores skrives først av `award-season-points` ETTER at en quiz har
  //   stengt, og bare for kalenderperioden fanen står på. Merket arvet begge
  //   svakhetene: 1. i måneden var alle plutselig «inaktive» selv om de spilte
  //   sist fredag, og under en pågående quiz hadde ingen merke i det hele tatt.
  //   attempts.submitted_at er satt i det spilleren leverer, så merket er
  //   korrekt umiddelbart og faller ikke ut ved månedsskifte.
  //
  // `.gte('submitted_at', …)` utelukker uleverte forsøk av seg selv (NULL kan
  // ikke tilfredsstille en sammenligning), men `.not(...)` står eksplisitt her
  // fordi det er en INVARIANT og ikke en bieffekt: et påbegynt, aldri levert
  // forsøk skal ikke telle som spilt. Samme filter som `lib/weekly-report.ts`.
  // is_team = false speiler award-season-points og quiz-scores — et lagforsøk
  // gir heller ikke sesongpoeng, så merket ville ellers vært uenig med lista.
  //
  // onlyRealQuizAttempts: merket sa «har spilt», men målte «har levert et
  // forsøk» — på hvilken som helst quiz-rad. En testkjøring holdt derfor
  // AKTIV-merket i live i 30 dager etter at all ekte deltakelse hadde
  // stanset, og gjorde det på den ene flaten som finnes nettopp for å SE hvem
  // som har falt av. Se lib/real-quiz-population.ts. Embeden MÅ stå i
  // `.select()` — uten den svarer PostgREST 400 PGRST108, altså høylytt og
  // ikke stille.
  //
  // Spørringen står i en LOKAL VARIABEL: inlinet som argument ga `next build`
  // TS2589 «Type instantiation is excessively deep» andre steder i denne
  // saken. Ikke inline den tilbake.
  const activeSince = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const recentQuery = supabaseAdmin
    .from('attempts')
    .select(`user_id, ${REAL_QUIZ_ATTEMPT_EMBED}`)
    .in('user_id', memberIds)
    .eq('is_team', false)
    .not('submitted_at', 'is', null)
    .gte('submitted_at', activeSince)

  const { data: recentAttempts, error: recentErr } = await onlyRealQuizAttempts(recentQuery)

  // Ingen stille degradering: uten dette ville en feilet spørring gitt et tomt
  // sett, og HELE medlemslisten ville vist seg som inaktiv uten et eneste spor.
  if (recentErr) {
    console.error('[members-activity] attempts-oppslag feilet:', recentErr.message)
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

  const members = orgMembers.map(m => {
    const profile = profileMap.get(m.user_id)
    const stats = statsMap.get(m.user_id)
    return {
      userId: m.user_id,
      displayName: profile?.display_name ?? m.user_id.slice(0, 8),
      role: m.role,
      joinedAt: m.joined_at,
      // AKTIV-merket i UI-et. `hasPeriodScore` er bevisst et ANNET felt: det
      // følger perioden fanen står på og styrer kun sorteringen av
      // poeng-kolonnene under, ikke merket.
      activeLast30Days: activeUserIds.has(m.user_id),
      hasPeriodScore: !!stats,
      totalPoints: stats?.points ?? 0,
      quizCount: stats?.quizCount ?? 0,
      lastActiveAt: (profile as { last_seen_at?: string } | undefined)?.last_seen_at ?? null,
      isExcluded: excludedSet.has(m.user_id),
    }
  })

  // Sorter: har poeng i perioden (poeng DESC) → resten (alfabetisk).
  // Bevisst fortsatt periodebasert og ikke 30-dagers: raden under sorteres av
  // Poeng/Antall quizer, som begge er periode-tall.
  members.sort((a, b) => {
    if (a.hasPeriodScore !== b.hasPeriodScore) return a.hasPeriodScore ? -1 : 1
    if (a.hasPeriodScore && b.hasPeriodScore) return b.totalPoints - a.totalPoints
    return a.displayName.localeCompare(b.displayName, 'nb')
  })

  if (format === 'csv') {
    const rows = members.map(m => [
      `"${m.displayName.replace(/"/g, '""')}"`,
      m.role === 'admin' ? 'Admin' : 'Medlem',
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
