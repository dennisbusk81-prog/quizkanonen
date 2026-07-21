import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

function formatTime(ms: number): string {
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}:${(s % 60).toString().padStart(2, '0')}` : `${s}s`
}

type AttemptRow = {
  id: string
  user_id: string | null
  player_name: string
  correct_answers: number
  total_time_ms: number
}

export async function POST(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { quizId?: unknown }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const quizId = typeof body.quizId === 'string' ? body.quizId : null
  if (!quizId) return NextResponse.json({ error: 'quizId mangler' }, { status: 400 })

  // 1. Quiz info
  const { data: quizRaw } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, closes_at')
    .eq('id', quizId)
    .single()

  if (!quizRaw) return NextResponse.json({ error: 'Quiz ikke funnet' }, { status: 404 })
  const quiz = quizRaw as { id: string; title: string; closes_at: string | null }

  // 2. Total count (non-team attempts)
  const { count: totalCount } = await supabaseAdmin
    .from('attempts')
    .select('*', { count: 'exact', head: true })
    .eq('quiz_id', quizId)
    .eq('is_team', false)

  const total = totalCount ?? 0

  // 3. Top 10 players (sorted by correct DESC, time ASC)
  const { data: top10Raw } = await supabaseAdmin
    .from('attempts')
    .select('id, user_id, player_name, correct_answers, total_time_ms')
    .eq('quiz_id', quizId)
    .eq('is_team', false)
    .order('correct_answers', { ascending: false })
    .order('total_time_ms', { ascending: true })
    .limit(10)

  const top10Attempts = (top10Raw ?? []) as AttemptRow[]

  // 4. Midpoint person
  let midAttempt: AttemptRow | null = null
  let midRank = 0
  if (total >= 3) {
    const midIdx = Math.floor(total / 2)
    midRank = midIdx + 1
    const { data: midRaw } = await supabaseAdmin
      .from('attempts')
      .select('id, user_id, player_name, correct_answers, total_time_ms')
      .eq('quiz_id', quizId)
      .eq('is_team', false)
      .order('correct_answers', { ascending: false })
      .order('total_time_ms', { ascending: true })
      .range(midIdx, midIdx)
    midAttempt = ((midRaw ?? []) as AttemptRow[])[0] ?? null
  }

  // Resolve display names via profiles (separate query — no direct FK in PostgREST)
  const allAttempts = midAttempt
    ? [...top10Attempts, midAttempt]
    : top10Attempts
  const userIds = [...new Set(allAttempts.map(a => a.user_id).filter((id): id is string => !!id))]

  const profileMap = new Map<string, string>()
  if (userIds.length > 0) {
    const { data: profileRows } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name')
      .in('id', userIds)
    for (const p of (profileRows ?? []) as { id: string; display_name: string | null }[]) {
      if (p.display_name) profileMap.set(p.id, p.display_name)
    }
  }

  const nameOf = (a: AttemptRow) =>
    (a.user_id && profileMap.get(a.user_id)) ?? a.player_name ?? '?'

  // 5. Easiest / hardest questions (via attempt_answers aggregation)
  const { data: attemptIdRows } = await supabaseAdmin
    .from('attempts')
    .select('id')
    .eq('quiz_id', quizId)
    .eq('is_team', false)

  const attemptIds = ((attemptIdRows ?? []) as { id: string }[]).map(a => a.id)

  let easiestText: string | null = null
  let easiestPct: number | null = null
  let hardestText: string | null = null
  let hardestPct: number | null = null

  if (attemptIds.length >= 2) {
    const { data: answers } = await supabaseAdmin
      .from('attempt_answers')
      .select('question_id, is_correct')
      .in('attempt_id', attemptIds)

    if (answers && answers.length > 0) {
      const statsMap = new Map<string, { total: number; correct: number }>()
      for (const a of answers as { question_id: string; is_correct: boolean }[]) {
        const s = statsMap.get(a.question_id) ?? { total: 0, correct: 0 }
        s.total++
        if (a.is_correct) s.correct++
        statsMap.set(a.question_id, s)
      }

      const qualified = [...statsMap.entries()]
        .filter(([, s]) => s.total >= 2)
        .map(([qId, s]) => ({ questionId: qId, pct: Math.round((s.correct / s.total) * 100) }))
        .sort((a, b) => b.pct - a.pct)

      if (qualified.length >= 1) {
        const { data: questionRows } = await supabaseAdmin
          .from('questions')
          .select('id, question_text')
          .in('id', qualified.map(q => q.questionId))

        const textMap = new Map(
          ((questionRows ?? []) as { id: string; question_text: string }[]).map(q => [q.id, q.question_text])
        )
        const withText = qualified
          .map(q => ({ text: textMap.get(q.questionId) ?? '', pct: q.pct }))
          .filter(q => q.text)

        if (withText.length >= 1) { easiestText = withText[0].text; easiestPct = withText[0].pct }
        if (withText.length >= 2) {
          easiestText = withText[0].text; easiestPct = withText[0].pct
          hardestText = withText[withText.length - 1].text; hardestPct = withText[withText.length - 1].pct
        }
      }
    }
  }

  // Format closing date
  const closedDate = quiz.closes_at ? new Date(quiz.closes_at) : new Date()
  const dateStr = closedDate.toLocaleDateString('nb-NO', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Oslo',
  })

  // 6. AI-generated intro and outro
  const FALLBACK_INTRO = 'Takk til alle som deltok i dag!'
  const FALLBACK_OUTRO = 'Gratulerer til vinnerne! Ha en fantastisk helg! 🎉'
  let aiIntro = FALLBACK_INTRO
  let aiOutro  = FALLBACK_OUTRO

  try {
    const winner = top10Attempts[0]
    const winnerDesc = winner
      ? `${nameOf(winner)} med ${winner.correct_answers} riktige på ${formatTime(winner.total_time_ms)}`
      : 'ukjent'
    const easiestPart = easiestText && easiestPct !== null
      ? `Letteste spørsmål: '${easiestText}' (${easiestPct}% riktige).`
      : ''
    const hardestPart = hardestText && hardestPct !== null
      ? `Vanskeligste spørsmål: '${hardestText}' (${hardestPct}% riktige).`
      : ''
    const userPrompt = [
      `Quiz: ${quiz.title}. Deltakere: ${total}.`,
      easiestPart,
      hardestPart,
      `Vinner: ${winnerDesc}.`,
    ].filter(Boolean).join(' ')

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000)

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 200,
        system: 'Du er quizmaster for Quizkanonen, en norsk fredagsquiz med hundrevis av deltakere. Skriv en kort, vennlig og engasjerende intro (2-3 setninger) og en avslutning (1 setning) til et Facebook-innlegg med quizresultater. Varier tonen — noen ganger entusiastisk, noen ganger humoristisk, noen ganger imponert over deltakertallet eller resultater. Skriv alltid på norsk. Returner KUN JSON: { "intro": string, "outro": string }',
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (aiRes.ok) {
      const aiJson = await aiRes.json()
      const raw = (aiJson?.content?.[0]?.text ?? '') as string
      const jsonStr = raw.replace(/```json\n?|\n?```/g, '').trim()
      const parsed = JSON.parse(jsonStr) as { intro?: string; outro?: string }
      if (parsed.intro) aiIntro = parsed.intro
      if (parsed.outro) aiOutro  = parsed.outro
    } else {
      console.error('Anthropic API feil:', aiRes.status)
    }
  } catch (err) {
    console.error('AI-generert intro/outro feilet:', err)
  }

  // Build text
  const medals = ['🥇', '🥈', '🥉']
  const lines: string[] = []

  lines.push(`Resultat ${quiz.title} ${dateStr}`)
  lines.push('')
  lines.push(aiIntro)
  lines.push('')
  lines.push(`${total} deltakere var med i dag!`)
  lines.push('')

  if (easiestText !== null && easiestPct !== null) {
    lines.push(`Ukens letteste: "${easiestText}" — ${easiestPct}% visste det.`)
  }
  if (hardestText !== null && hardestPct !== null) {
    lines.push(`Ukens vanskeligste: "${hardestText}" — kun ${hardestPct}% fikk det til.`)
  }
  if (easiestText !== null || hardestText !== null) {
    lines.push('')
  }

  top10Attempts.forEach((a, i) => {
    const prefix = i < 3 ? medals[i] : `${i + 1}.`
    lines.push(`${prefix} ${nameOf(a)} — ${a.correct_answers} riktige · ${formatTime(a.total_time_ms)}`)
  })

  if (midAttempt) {
    lines.push('')
    lines.push(
      `Midt på treet: ${nameOf(midAttempt)} på ${midRank}. plass - ${midAttempt.correct_answers} riktige · ${formatTime(midAttempt.total_time_ms)}`
    )
  }

  lines.push('')
  lines.push(aiOutro)

  // Fast, korrekt lenke for returnerende spillere. Bevisst en STABIL linje (ikke
  // AI-generert) så den alltid er med og alltid peker til forsiden — der en
  // innlogget spiller lander med aktiv sesjon og kan spille direkte. /founders
  // er forbeholdt ny-bruker-kampanjer.
  lines.push('')
  lines.push('Bli med igjen neste fredag: quizkanonen.no')

  return NextResponse.json({ text: lines.join('\n') })
}
