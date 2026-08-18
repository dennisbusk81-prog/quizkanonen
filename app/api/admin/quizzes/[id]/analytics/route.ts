import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'
import { fetchAllRowsChunked } from '@/lib/paginate'

type AttemptRaw = {
  id: string
  user_id: string | null
  player_name: string | null
  correct_answers: number
  total_questions: number
  total_time_ms: number
  completed_at: string
  is_team: boolean
}

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const [
    { data: quiz, error: e1 },
    { data: questions, error: e2 },
    { data: attempts, error: e3 },
  ] = await Promise.all([
    supabaseAdmin.from('quizzes').select('*').eq('id', id).single(),
    supabaseAdmin.from('questions').select('*').eq('quiz_id', id).order('order_index'),
    supabaseAdmin.from('attempts').select('*').eq('quiz_id', id).not('submitted_at', 'is', null),
  ])
  const err = e1 ?? e2 ?? e3
  if (err) return NextResponse.json({ error: err.message }, { status: 500 })

  // Kallenavn for alle innloggede spillere i quizen (admin ser hvem som er hvem).
  // Chunket: .in() legger hver id i URL-en og brekker rundt ~390 id-er (målt,
  // se lib/paginate.ts). Facebook-gruppa har 400 medlemmer, så én godt spilt
  // quiz er innenfor rekkevidde — ikke et teoretisk tak.
  // Feiler MYKT med loggspor: kallenavn er en tilleggsopplysning, og et tapt
  // oppslag skal ikke ta ned hele analytics-siden etter en fredagsquiz.
  // Tidligere ble error ikke lest i det hele tatt, så en feil her var helt stille.
  const allUserIds = [...new Set(((attempts ?? []) as AttemptRaw[]).map(a => a.user_id).filter((uid): uid is string => !!uid))]
  const nickByUser = new Map<string, string | null>()
  if (allUserIds.length > 0) {
    try {
      const nickRows = await fetchAllRowsChunked<{ id: string; nickname: string | null }>(
        allUserIds,
        (chunk, from, to) =>
          supabaseAdmin
            .from('profiles')
            .select('id, nickname')
            .in('id', chunk)
            .range(from, to)
      )
      for (const p of nickRows) {
        nickByUser.set(p.id, p.nickname ?? null)
      }
    } catch (nickErr) {
      console.error('analytics: kallenavn-oppslag feilet:', nickErr)
    }
  }

  let answers: unknown[] = []
  const ids = (attempts ?? []).map((a: { id: string }) => a.id)
  if (ids.length > 0) {
    // Trenger hver enkelt rad (selected_answer + time_ms per spiller for
    // "hvem svarte hva"-visningen på analytics-siden) — kan ikke aggregeres
    // bort, derfor paginert full henting i stedet for RPC-aggregering.
    // attempt_answers kan lett passere PostgREST sin stille 1000-rads-grense
    // for én quiz (bekreftet: 1437 rader på 75 forsøk for den mest spilte
    // quizen 26. juli 2026).
    let answerData: { question_id: string; is_correct: boolean; selected_answer: string | null; time_ms: number; attempt_id: string }[]
    try {
      answerData = await fetchAllRowsChunked(
        ids,
        (chunk, from, to) =>
          supabaseAdmin
            .from('attempt_answers')
            .select('question_id, is_correct, selected_answer, time_ms, attempt_id')
            .in('attempt_id', chunk)
            .range(from, to)
      )
    } catch (e4) {
      return NextResponse.json({ error: e4 instanceof Error ? e4.message : 'Kunne ikke hente svar' }, { status: 500 })
    }
    const attemptPlayerMap: Record<string, string> = {}
    const attemptNickMap: Record<string, string | null> = {}
    for (const a of (attempts ?? [])) {
      const row = a as { id: string; player_name: string; user_id: string | null }
      attemptPlayerMap[row.id] = row.player_name || ''
      attemptNickMap[row.id] = row.user_id ? (nickByUser.get(row.user_id) ?? null) : null
    }
    answers = (answerData ?? []).map((a: { question_id: string; is_correct: boolean; selected_answer: string | null; time_ms: number; attempt_id: string }) => ({
      question_id: a.question_id,
      is_correct: a.is_correct,
      selected_answer: a.selected_answer,
      time_ms: a.time_ms,
      player_name: attemptPlayerMap[a.attempt_id] || '',
      nickname: attemptNickMap[a.attempt_id] ?? null,
    }))
  }

  // ALLE solo-deltakere, rangert best først — ikke et utvalg.
  // Lista hadde .slice(0, 50) fram til 18. august 2026. Grensen var en ekte
  // «topp N»-visning da den ble satt (10 → 50 i 7e4cb05, 17. juni), men da
  // radene senere fikk en «Fjern»-knapp ble lista et administrasjonsverktøy:
  // deltaker 51 og nedover kunne ikke fjernes fordi de ikke fantes på skjermen.
  // Målt i prod 18. august: 69 innsendte forsøk, 50 rader synlige — mens
  // «Deltakere totalt» over og Scorefordelingen under begge viste 69, siden de
  // leser attempts uavkortet. Gjeninnfør ikke en grense her uten samtidig å
  // vise brukeren at lista er kuttet.
  const soloRanked = ((attempts ?? []) as AttemptRaw[])
    .filter(a => !a.is_team)
    .sort((a, b) => b.correct_answers - a.correct_answers || a.total_time_ms - b.total_time_ms)

  // Resolve display names from profiles (chunket, samme grunn som kallenavn over)
  const rankedUserIds = [...new Set(soloRanked.map(a => a.user_id).filter((uid): uid is string => !!uid))]
  const profileMap = new Map<string, string>()
  if (rankedUserIds.length > 0) {
    try {
      const profileRows = await fetchAllRowsChunked<{ id: string; display_name: string | null }>(
        rankedUserIds,
        (chunk, from, to) =>
          supabaseAdmin
            .from('profiles')
            .select('id, display_name')
            .in('id', chunk)
            .range(from, to)
      )
      for (const p of profileRows) {
        if (p.display_name) profileMap.set(p.id, p.display_name)
      }
    } catch (nameErr) {
      console.error('analytics: display_name-oppslag feilet:', nameErr)
    }
  }

  // Resolve emails via auth.admin API (service role only).
  // ÉN paginert listUsers, ikke ett getUserById per bruker — samme mønster som
  // app/api/admin/users/route.ts. Det gamle kallet skalerte med deltakerantallet,
  // og .slice(0, 50) over var i praksis det eneste som holdt tallet nede: uten
  // den ville 50 parallelle GoTrue-kall blitt 69, og ~400 ved full oppslutning
  // i Facebook-gruppa — mot maxDuration = 15 øverst i filen.
  // Feiler mykt med loggspor: e-post er en tilleggsopplysning i lista.
  const emailMap = new Map<string, string>()
  if (rankedUserIds.length > 0) {
    const wanted = new Set(rankedUserIds)
    let listPage = 1
    for (;;) {
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers({
        page: listPage,
        perPage: 1000,
      })
      if (authError) { console.error('analytics: auth.admin.listUsers feilet:', authError); break }
      const batch = authData?.users ?? []
      for (const u of batch) {
        if (u.email && wanted.has(u.id)) emailMap.set(u.id, u.email)
      }
      if (batch.length < 1000) break
      listPage++
    }
  }

  const topPlayers = soloRanked.map((a, i) => ({
    rank: i + 1,
    attempt_id: a.id,
    name: (a.user_id && profileMap.get(a.user_id)) ?? a.player_name ?? '?',
    nickname: a.user_id ? (nickByUser.get(a.user_id) ?? null) : null,
    email: a.user_id ? (emailMap.get(a.user_id) ?? null) : null,
    correct_answers: a.correct_answers,
    total_questions: a.total_questions,
    total_time_ms: a.total_time_ms,
    user_id: a.user_id,
  }))

  // Org breakdown — count unique participants who belong to any organization
  const participantUserIds = [...new Set(((attempts ?? []) as AttemptRaw[]).map(a => a.user_id).filter((uid): uid is string => !!uid))]
  let orgCount = 0
  let orgBreakdown: { name: string; count: number }[] = []
  if (participantUserIds.length > 0) {
    // Chunket, samme ~390-grense som oppslagene over. Feiler mykt: uten
    // org-radene vises «Fra bedrifter 0» i stedet for at hele siden faller.
    let orgMembers: { user_id: string; organization_id: string }[] = []
    try {
      orgMembers = await fetchAllRowsChunked<{ user_id: string; organization_id: string }>(
        participantUserIds,
        (chunk, from, to) =>
          supabaseAdmin
            .from('organization_members')
            .select('user_id, organization_id')
            .in('user_id', chunk)
            .range(from, to)
      )
    } catch (orgErr) {
      console.error('analytics: org-medlemsoppslag feilet:', orgErr)
    }
    if (orgMembers.length > 0) {
      const orgUserIds = new Set(orgMembers.map(m => m.user_id as string))
      orgCount = orgUserIds.size
      const orgIds = [...new Set(orgMembers.map(m => m.organization_id as string))]
      const { data: orgs } = await supabaseAdmin.from('organizations').select('id, name').in('id', orgIds)
      const orgNameMap = new Map((orgs ?? []).map(o => [o.id as string, o.name as string]))
      const countByOrg = new Map<string, Set<string>>()
      for (const m of orgMembers) {
        const uid = m.user_id as string
        const oid = m.organization_id as string
        if (!countByOrg.has(oid)) countByOrg.set(oid, new Set())
        countByOrg.get(oid)!.add(uid)
      }
      orgBreakdown = [...countByOrg.entries()]
        .map(([oid, users]) => ({ name: orgNameMap.get(oid) ?? 'Ukjent', count: users.size }))
        .sort((a, b) => b.count - a.count)
    }
  }

  return NextResponse.json({ quiz, questions: questions ?? [], attempts: attempts ?? [], answers, topPlayers, orgCount, orgBreakdown })
}
