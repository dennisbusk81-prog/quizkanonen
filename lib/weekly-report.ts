import { supabaseAdmin } from './supabase-admin'

export type WeeklyEntry = { displayName: string; correct: number; total: number }

export type WeeklySummary = {
  quizId: string
  quizTitle: string
  closesAt: string
  winner: WeeklyEntry | null
  top3: WeeklyEntry[]
  participantCount: number
}

type RawAttempt = {
  user_id: string | null
  player_name: string | null
  correct_answers: number
  total_questions: number
  total_time_ms: number
  correct_streak: number | null
}

// Beste forsøk: flest riktige, deretter raskest, deretter lengst streak.
function pickBetter(a: RawAttempt, b: RawAttempt): RawAttempt {
  if (b.correct_answers > a.correct_answers) return b
  if (b.correct_answers === a.correct_answers && b.total_time_ms < a.total_time_ms) return b
  if (
    b.correct_answers === a.correct_answers &&
    b.total_time_ms === a.total_time_ms &&
    (b.correct_streak ?? 0) > (a.correct_streak ?? 0)
  ) return b
  return a
}

// Beregner ukens oppsummering for ÉN organisasjon basert på sist stengte quiz.
// Bare forsøk fra org-medlemmer telles — ingen data fra andre orger lekker.
export async function computeWeeklySummary(orgId: string): Promise<WeeklySummary | null> {
  const { data: orgMembers } = await supabaseAdmin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', orgId)

  const memberIds = (orgMembers ?? []).map(m => m.user_id)
  if (memberIds.length === 0) return null

  const { data: quiz } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, closes_at')
    .lt('closes_at', new Date().toISOString())
    .not('closes_at', 'is', null)
    .order('closes_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!quiz) return null

  const { data: attempts } = await supabaseAdmin
    .from('attempts')
    .select('user_id, player_name, correct_answers, total_questions, total_time_ms, correct_streak')
    .eq('quiz_id', quiz.id)
    .eq('is_team', false)
    .in('user_id', memberIds)
    .not('user_id', 'is', null)

  if (!attempts || attempts.length === 0) return null

  const bestByUser = new Map<string, RawAttempt>()
  for (const a of attempts as RawAttempt[]) {
    if (!a.user_id) continue
    const existing = bestByUser.get(a.user_id)
    bestByUser.set(a.user_id, existing ? pickBetter(existing, a) : a)
  }
  if (bestByUser.size === 0) return null

  const ids = [...bestByUser.keys()]
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name')
    .in('id', ids)

  const nameMap = new Map(
    ((profiles ?? []) as { id: string; display_name: string | null }[]).map(p => [p.id, p.display_name])
  )

  const ranked = [...bestByUser.entries()]
    .map(([uid, a]) => ({
      displayName: nameMap.get(uid) || a.player_name || 'Anonym',
      correct: a.correct_answers,
      total: a.total_questions,
      time: a.total_time_ms,
      streak: a.correct_streak ?? 0,
    }))
    .sort((x, y) => {
      if (y.correct !== x.correct) return y.correct - x.correct
      if (x.time !== y.time) return x.time - y.time
      return y.streak - x.streak
    })

  const top3: WeeklyEntry[] = ranked.slice(0, 3).map(r => ({
    displayName: r.displayName,
    correct: r.correct,
    total: r.total,
  }))

  return {
    quizId: quiz.id,
    quizTitle: quiz.title,
    closesAt: quiz.closes_at,
    winner: top3[0] ?? null,
    top3,
    participantCount: bestByUser.size,
  }
}

// Ferdig tekstblokk for Teams/Slack/e-post. Emoji er bevisst med her fordi
// dette er kopier-innhold ment for eksterne kanaler, ikke app-UI.
export function buildWeeklyShareText(summary: WeeklySummary): string {
  const w = summary.winner
  const firstName = w ? w.displayName.split(' ')[0] : null
  return [
    w
      ? `🏆 Ukens quiz-vinner: ${w.displayName} (${w.correct}/${w.total})`
      : '🏆 Ukens quiz er avgjort!',
    `${summary.participantCount} ansatte kjempet om seieren denne uken.`,
    firstName ? `Kan du slå ${firstName} neste fredag? 👇` : 'Kan du ta seieren neste fredag? 👇',
    'quizkanonen.no',
  ].join('\n')
}
