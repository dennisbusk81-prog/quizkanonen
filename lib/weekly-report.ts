import { supabaseAdmin } from './supabase-admin'
import { fetchAllRows, fetchAllRowsChunked } from './paginate'

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

export type LatestClosedQuiz = { id: string; title: string; closes_at: string }

// Sist stengte ekte quiz — ett billig én-rads-oppslag. Delt av
// computeWeeklySummary (selve beregningen) og cron/weekly-report (som billig
// duplikatvakt FØR den tunge beregningen kalles i det hele tatt). Én kilde,
// slik at vakten og beregningen aldri kan peke på hver sin quiz.
//
// is_test-guarden speiler varslingsrutene: «sist stengte quiz» ville ellers
// blitt en testquiz som stengte sist, org-medlemmene har ingen forsøk på den,
// og hele ukesrapporten undertrykkes stille (return null i beregningen).
export async function getLatestClosedQuiz(): Promise<LatestClosedQuiz | null> {
  const { data: quiz } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, closes_at')
    .lt('closes_at', new Date().toISOString())
    .not('closes_at', 'is', null)
    .eq('is_test', false)
    .order('closes_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return (quiz as LatestClosedQuiz | null) ?? null
}

// Beregner ukens oppsummering for ÉN organisasjon basert på sist stengte quiz.
// Bare forsøk fra org-medlemmer telles — ingen data fra andre orger lekker.
export async function computeWeeklySummary(orgId: string): Promise<WeeklySummary | null> {
  // Paginert, ikke ett rått .select(): PostgREST kutter stille på 1000 rader,
  // og medlemslisten er IKKE strukturelt begrenset — cron-ruten filtrerer på
  // plan='standard' (maks 50), men org-admin-ruten (weekly-summary) gater ikke
  // på plan, og Pro/Enterprise har memberLimit: null i lib/org-plan.ts.
  const orgMembers = await fetchAllRows<{ user_id: string }>((from, to) =>
    supabaseAdmin
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', orgId)
      .order('user_id', { ascending: true })
      .range(from, to)
  )

  const memberIds = orgMembers.map(m => m.user_id)
  if (memberIds.length === 0) return null

  const quiz = await getLatestClosedQuiz()
  if (!quiz) return null

  // Chunket: `.in()` legger hver id i URL-en og brekker rundt 390 id-er — en
  // LAVERE grense enn radtaket på 1000, altså den vi treffer først. Samme
  // mønster som send-reminders; se lib/paginate.ts.
  const attempts = await fetchAllRowsChunked<RawAttempt>(memberIds, (chunk, from, to) =>
    supabaseAdmin
      .from('attempts')
      .select('user_id, player_name, correct_answers, total_questions, total_time_ms, correct_streak')
      .eq('quiz_id', quiz.id)
      .eq('is_team', false)
      .in('user_id', chunk)
      .not('user_id', 'is', null)
      // Samme filter som percentile-ruten (commit 859e529, 25. juli): uten dette
      // teller en påbegynt, aldri innsendt quiz med i «X ansatte deltok»-tallet i
      // den ukentlige B2B-e-posten — kunstig oppblåst sosialt-bevis-tall.
      .not('submitted_at', 'is', null)
      .order('id', { ascending: true })
      .range(from, to)
  )

  if (attempts.length === 0) return null

  const bestByUser = new Map<string, RawAttempt>()
  for (const a of attempts) {
    if (!a.user_id) continue
    const existing = bestByUser.get(a.user_id)
    bestByUser.set(a.user_id, existing ? pickBetter(existing, a) : a)
  }
  if (bestByUser.size === 0) return null

  // Samme .in()-tak som attempts-oppslaget over: id-listen er avledet av
  // medlemslisten og kan være like lang.
  const ids = [...bestByUser.keys()]
  const profiles = await fetchAllRowsChunked<{ id: string; display_name: string | null }>(
    ids,
    (chunk, from, to) =>
      supabaseAdmin
        .from('profiles')
        .select('id, display_name')
        .in('id', chunk)
        .order('id', { ascending: true })
        .range(from, to)
  )

  const nameMap = new Map(profiles.map(p => [p.id, p.display_name]))

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
      ? `🏆 Quiz-vinner: ${w.displayName} (${w.correct}/${w.total})`
      : '🏆 Quizen er avgjort!',
    `${summary.participantCount} ansatte kjempet om seieren.`,
    firstName ? `Kan du slå ${firstName} i neste quiz? 👇` : 'Kan du ta seieren i neste quiz? 👇',
    'quizkanonen.no',
  ].join('\n')
}
