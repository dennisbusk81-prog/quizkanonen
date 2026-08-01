import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rankQuizAttempts } from '@/lib/ranking'
import { resolveOrgMembership } from '@/lib/org-membership'
import { isUserPremium } from '@/lib/premium-check'

// ── Server-side rangering for ukens quiz-leaderboard ─────────────────────────
// Bruker den delte rangerings-helperen (lib/ranking): submitted-filter, dedup
// per spiller (user_id, ellers player_name for gjester), 4-nøkkels tiebreak.
// Gjester inkluderes. Identisk #1 som Topp 3 og toppliste. Separate rom via
// is_team. RPC-stien er fjernet bevisst — den dedup'et ikke og ga duplikate
// rader + ulik vinner.

type LbEntry = {
  rank: number
  id: string
  userId: string | null
  playerName: string
  nickname: string | null
  correctAnswers: number
  totalQuestions: number
  totalTimeMs: number
  correctStreak: number | null
  isTeam: boolean
  teamSize: number
  leaderDisplayName: string | null
}

type RawRow = {
  id: string
  user_id: string | null
  player_name: string
  correct_answers: number
  total_questions: number
  total_time_ms: number
  correct_streak: number | null
  is_team: boolean
  team_size: number
  leader_display_name: string | null
  submitted_at: string | null
}

const SELECT_COLS =
  'id, user_id, player_name, correct_answers, total_questions, total_time_ms, correct_streak, is_team, team_size, leader_display_name, submitted_at'

function toEntry(r: RawRow & { rank: number }, nickname: string | null = null): LbEntry {
  return {
    rank: r.rank,
    id: r.id,
    userId: r.user_id,
    playerName: r.player_name,
    nickname,
    correctAnswers: r.correct_answers,
    totalQuestions: r.total_questions,
    totalTimeMs: r.total_time_ms,
    correctStreak: r.correct_streak,
    isTeam: r.is_team,
    teamSize: r.team_size,
    leaderDisplayName: r.leader_display_name,
  }
}

// Henter kallenavn (nickname) for et sett user_id-er via service role (omgår
// kolonne-grants på profiles som ellers kan blokkere anon-lesing av nickname).
async function fetchNicknames(entries: LbEntry[]): Promise<void> {
  const ids = [...new Set(entries.map(e => e.userId).filter((id): id is string => !!id))]
  if (ids.length === 0) return
  const { data } = await supabaseAdmin.from('profiles').select('id, nickname').in('id', ids)
  const map = new Map<string, string | null>()
  for (const p of (data ?? []) as { id: string; nickname: string | null }[]) {
    map.set(p.id, p.nickname ?? null)
  }
  for (const e of entries) {
    if (e.userId) e.nickname = map.get(e.userId) ?? null
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: quizId } = await context.params
  if (!quizId) return NextResponse.json({ error: 'Mangler quiz-id' }, { status: 400 })

  const { searchParams } = new URL(request.url)
  const isTeam = searchParams.get('is_team') === 'true'
  const orgSlug = searchParams.get('org')?.trim() || null

  const pageParamRaw = searchParams.get('page')
  const searchRaw = (searchParams.get('search') ?? '').trim()
  const isBrowse = pageParamRaw !== null || searchRaw !== ''
  const search = searchRaw === '' ? null : searchRaw
  const page = Math.max(1, parseInt(pageParamRaw ?? '1', 10) || 1)

  // Klassisk visning: topp `limit` (default 50, maks 200). Browse: 20/side.
  const limitRaw = parseInt(searchParams.get('limit') ?? '50', 10)
  const classicLimit = Math.min(200, Math.max(1, Number.isNaN(limitRaw) ? 50 : limitRaw))
  const pageSize = isBrowse ? 20 : classicLimit

  // Identifiser bruker + premium-status
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  let userId: string | null = null
  let userIsPremium = false
  if (token) {
    const { data: authData } = await supabaseAdmin.auth.getUser(token)
    userId = authData.user?.id ?? null
  }

  // ── Org-scoping (valgfritt) ──────────────────────────────────────────────────
  // Når ?org=<slug> er satt: krev at innlogget bruker er medlem av org-en, og
  // begrens rangeringen til org-medlemmene. Uten param: nasjonal sti, uendret.
  let orgMemberIds: string[] | null = null
  if (orgSlug) {
    const gate = await resolveOrgMembership(orgSlug, token)
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
    orgMemberIds = gate.memberIds
  }

  // Gjest-estimat ("et sted mellom X og Y") — kun for uinnloggede med lagret score
  const myCorrectRaw = searchParams.get('my_correct')
  const myTimeRaw = searchParams.get('my_time')
  const guestScore =
    !userId && myCorrectRaw !== null && myTimeRaw !== null
      ? { correct: parseInt(myCorrectRaw, 10), timeMs: parseInt(myTimeRaw, 10) }
      : null

  // ── Delt rangerings-helper (service role) ────────────────────────────────────
  // Henter alle rader for rommet (solo/lag), filtrerer på submitted, dedup'er per
  // spiller og rangerer med 4-nøkkels tiebreak. Søk/paginering skjer i JS etterpå.
  const { data: allRowsRaw } = await supabaseAdmin
    .from('attempts')
    .select(SELECT_COLS)
    .eq('quiz_id', quizId)
    .eq('is_team', isTeam)
    .limit(5000)

  // I org-modus: behold kun forsøk fra org-medlemmer (gjester droppes). Rank
  // regnes automatisk om relativt til org-undersettet av den delte helperen.
  const memberIdSet = orgMemberIds ? new Set(orgMemberIds) : null
  const scopedRows = memberIdSet
    ? ((allRowsRaw ?? []) as RawRow[]).filter(r => r.user_id != null && memberIdSet.has(r.user_id))
    : ((allRowsRaw ?? []) as RawRow[])

  const ranked = rankQuizAttempts(scopedRows, {
    includeGuests: orgMemberIds ? false : true,
    requireSubmitted: true,
  })
  const totalAll = ranked.length

  // Premium-status — samme delte sjekk som resten av Premium-gatingen
  // (lib/premium-check.ts), inkludert grace-perioden etter tapt org-Premium.
  // Var tidligere en lokal `premium_status`-spørring her, som IKKE tok grace
  // med: en bruker i grace ville dermed mistet sin egen eksakte plassering.
  if (userId) {
    userIsPremium = await isUserPremium(userId)
  }

  // ── Brukerens egen plassering — Premium-gate håndheves server-side ──────────
  // EKSAKT plassering er en Premium-funksjon. Fram til 1. august 2026 lå det
  // eksakte tallet i svaret til enhver innlogget bruker, og kun klienten valgte
  // å ikke vise det — altså lesbart i nettverksfanen for alle.
  //
  // Premium: `userRank` (eksakt) + hele raden.
  // Gratis:  `userRank` utelates HELT. Raden beholdes, men `rank` grovmales til
  //          starten av 10-båndet — nøyaktig det tallet gratis-visningen selv
  //          utleder («Du er et sted mellom plass 11 og 20», både her og i
  //          resultatskjermen). Det eksakte tallet finnes dermed ikke i svaret.
  //
  // Raden selv er IKKE premium-data: score, tid, antall spørsmål og streak er
  // brukerens egne resultater, og resultatkortet på /leaderboard/[id] viser dem
  // til gratisbrukere (eneste kilde når de spilte på en annen enhet, eller
  // ligger utenfor topp 50). Å fjerne raden ville tatt bort «12 av 15», streak
  // og delings-knappen for gratisbrukere — ikke en paywall, bare et tap.
  const RANK_BAND = 10
  let userEntry: LbEntry | null = null
  let userRank: number | null = null
  if (userId) {
    const mine = ranked.find(r => r.user_id === userId)
    if (mine) {
      if (userIsPremium) {
        userRank = mine.rank
        userEntry = toEntry(mine)
      } else {
        const bandStart = Math.floor((mine.rank - 1) / RANK_BAND) * RANK_BAND + 1
        userEntry = { ...toEntry(mine), rank: bandStart }
      }
    }
  }

  // Gjest-estimat
  let guestRank: number | null = null
  if (guestScore && !Number.isNaN(guestScore.correct) && !Number.isNaN(guestScore.timeMs)) {
    const better = ranked.filter(r =>
      r.correct_answers > guestScore.correct ||
      (r.correct_answers === guestScore.correct && r.total_time_ms < guestScore.timeMs)
    ).length
    guestRank = better + 1
  }

  // Søk + paginering i JS
  const filtered = search
    ? ranked.filter(r => r.player_name.toLowerCase().includes(search.toLowerCase()))
    : ranked
  const totalCount = search ? filtered.length : totalAll
  const start = isBrowse ? (page - 1) * pageSize : 0
  const slice = filtered.slice(start, start + pageSize)
  const entries: LbEntry[] = slice.map(r => toEntry(r))

  await fetchNicknames(userEntry ? [...entries, userEntry] : entries)

  return NextResponse.json({
    entries, totalCount, userEntry, userRank, guestRank,
    userIsPremium, page, pageSize, isTeam,
  })
}
