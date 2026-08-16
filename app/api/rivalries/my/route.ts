import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchAllRows } from '@/lib/paginate'
import { isDuelExpired, PENDING_REPLY_WINDOW_MS } from '@/lib/duel-expiry'
import { computePointsByMonth, monthKeyOf, pointsForDuel, type ScoredAttempt } from '@/lib/duel-scoring'

// GET /api/rivalries/my — returns active + pending rivalries, plus declined from this month
// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function GET(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const now = new Date()

  // Utløpsregelen ligger i lib/duel-expiry og deles med POST /api/rivalries og
  // opprydningsjobben. Se den filen for hvorfor pending og active har ulik regel.
  //
  // 'expired' tas med i utvalget: jobben /api/cron/expire-duels materialiserer
  // statusen for gamle pending-rader, og de skal fortsatt vises i historikken
  // som «Utløpt uten svar» — ikke forsvinne. isDuelExpired() svarer likt for en
  // rad uansett om den er materialisert eller ikke.
  const { data: rivalries, error } = await supabaseAdmin
    .from('rivalries')
    .select('id, challenger_id, rival_id, status, created_at, seen_at')
    .or(`challenger_id.eq.${user.id},rival_id.eq.${user.id}`)
    .in('status', ['active', 'pending', 'declined', 'expired'])
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[rivalries/my GET] error:', error.message)
    return NextResponse.json({ error: 'Noe gikk galt.' }, { status: 500 })
  }

  const rows = rivalries ?? []

  if (rows.length === 0) {
    return NextResponse.json({ rivalries: [] })
  }

  // Collect all opponent IDs
  const opponentIds = rows.map(r => r.challenger_id === user.id ? r.rival_id : r.challenger_id)
  const uniqueOpponentIds = [...new Set(opponentIds)]

  // Hvilke måneder trenger vi quizer fra? Nøyaktig de duellene faktisk gikk i
  // (FUNN 4.3). Hentes som ÉN spørring over hele spennet, ikke én per måned.
  // Spennet kan kun beregnes etter at radene er lest, men spørringen er
  // uavhengig av profiloppslaget og kjøres derfor i samme bølge — ruten skal
  // ikke få en ekstra seriell rundtur av denne fiksen.
  const duelMonthStarts = rows.map(r => {
    const d = new Date(r.created_at)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
  })
  const rangeStart = new Date(Math.min(...duelMonthStarts))
  const latestMonthStart = new Date(Math.max(...duelMonthStarts))
  const rangeEnd = new Date(Date.UTC(
    latestMonthStart.getUTCFullYear(),
    latestMonthStart.getUTCMonth() + 1,
    1,
  ))

  // is_test-guarden speiler poeng-cronene: en testquiz i en duellmåned ville
  // ellers telt inn i computePointsByMonth og gitt kunstige duellpoeng.
  const [profilesRes, rangeQuizzesRes] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id, display_name, nickname')
      .in('id', uniqueOpponentIds),
    supabaseAdmin
      .from('quizzes')
      .select('id, closes_at')
      .gte('closes_at', rangeStart.toISOString())
      .lt('closes_at', rangeEnd.toISOString())
      .lte('closes_at', now.toISOString())
      .eq('is_test', false),
  ])

  const { data: profiles, error: profilesError } = profilesRes
  // Profil-feil er ikke fatal: navnefallbacken mot auth.users under dekker
  // alle motstandere når profilkartet er tomt. Men den skal ikke være stille.
  if (profilesError) {
    console.error('[rivalries/my GET] profiles error:', profilesError.message)
  }

  // Quiz-feil ER fatal: uten quizlisten blir monthByQuizId tom og hver duell
  // vises som 0-0 — feil data presentert som fasit. Da skal klienten heller få
  // en feil den kan vise/prøve på nytt, samme håndtering som rivalries-
  // oppslaget øverst i ruten.
  const { data: rangeQuizzes, error: rangeQuizzesError } = rangeQuizzesRes
  if (rangeQuizzesError) {
    console.error('[rivalries/my GET] quiz range error:', rangeQuizzesError.message)
    return NextResponse.json({ error: 'Noe gikk galt.' }, { status: 500 })
  }

  const profileMap = new Map(
    (profiles ?? []).map((p: { id: string; display_name: string | null; nickname: string | null }) => [p.id, p])
  )

  // Fallback: for opponents whose profile row is missing or has no display_name,
  // fetch name from auth.users metadata (e.g. Google full_name). Parallellisert
  // — hvert kall er et eget GoTrue-admin-oppslag, ikke en enkel DB-select, så
  // sekvensiell await i løkke var trolig den treigste enkeltdelen av ruten.
  const missingIds = uniqueOpponentIds.filter(id => !profileMap.get(id)?.display_name)
  if (missingIds.length > 0) {
    const authUsers = await Promise.all(
      missingIds.map(id => supabaseAdmin.auth.admin.getUserById(id))
    )
    missingIds.forEach((id, i) => {
      const authUser = authUsers[i].data.user
      if (authUser) {
        const name =
          (authUser.user_metadata?.full_name as string | undefined) ??
          (authUser.user_metadata?.name as string | undefined) ??
          authUser.email?.split('@')[0] ??
          null
        const existing = profileMap.get(id)
        profileMap.set(id, { id, display_name: name, nickname: existing?.nickname ?? null })
      }
    })
  }

  // Duell-stilling beregnes direkte fra attempts (ikke season_scores), slik at
  // den teller korrekt også for brukere som har valgt seg ut av global liga og
  // derfor mangler season_scores-rader. En duell er en privat, gjensidig avtalt
  // sammenligning og skal alltid vise sanne tall. Bruker samme poengmodell som
  // season_scores (delt i lib/season-points).
  //
  // KRITISK (FUNN 4.3): poengene regnes per KALENDERMÅNED, og hver duell slås
  // opp med sin EGEN måned. Tidligere ble det bygget én tabell fra inneværende
  // måneds quizer som så ble brukt på alle rader — en avsluttet juni-duell
  // viste da juli-tall, og brukerens egen score var identisk på hver
  // historikk-rad og endret seg hver uke. Se lib/duel-scoring.
  const allUserIds = [user.id, ...uniqueOpponentIds]
  const involvedSet = new Set(allUserIds)

  const monthByQuizId = new Map<string, string>(
    (rangeQuizzes ?? []).map((q: { id: string; closes_at: string }) => [q.id, monthKeyOf(q.closes_at)])
  )
  const quizIds = [...monthByQuizId.keys()]

  let pointsByMonth = new Map<string, Map<string, number>>()

  if (quizIds.length > 0) {
    // Uten eksplisitt grense kutter PostgREST stille ved 1000 rader — paginert
    // full henting i stedet.
    const rangeAttempts = await fetchAllRows((from, to) =>
      supabaseAdmin
        .from('attempts')
        .select('user_id, quiz_id, correct_answers, total_time_ms, correct_streak')
        .in('quiz_id', quizIds)
        .eq('is_team', false)
        .not('user_id', 'is', null)
        .not('submitted_at', 'is', null)
        .range(from, to)
    )

    pointsByMonth = computePointsByMonth(
      (rangeAttempts ?? []) as ScoredAttempt[],
      monthByQuizId,
      involvedSet,
    )
  }

  const result = rows
    .map(r => {
      const opponentId = r.challenger_id === user.id ? r.rival_id : r.challenger_id
      const opponentProfile = profileMap.get(opponentId)
      const createdAt = new Date(r.created_at)
      const isExpired = isDuelExpired(r.status, r.created_at, now)
      const isIncoming = r.challenger_id !== user.id
      // En materialisert 'expired'-rad er en ubesvart pending-forespørsel som
      // opprydningsjobben har merket. UI-et skal behandle den nøyaktig som før
      // («Utløpt uten svar»), så den rapporteres videre som pending + isExpired.
      const uiStatus = r.status === 'expired' ? 'pending' : r.status

      // Kun meningsfullt for ubesvarte forespørsler — brukes til å vise en
      // diskret "X dager igjen"-tekst på det innkommende kortet når fristen
      // nærmer seg. null for alt annet (aktive/avslåtte dueller har ikke et
      // svarvindu i denne betydningen).
      const daysLeftToReply = uiStatus === 'pending'
        ? Math.max(0, Math.ceil((createdAt.getTime() + PENDING_REPLY_WINDOW_MS - now.getTime()) / (24 * 60 * 60 * 1000)))
        : null

      return {
        id:             r.id,
        status:         uiStatus as 'active' | 'pending' | 'declined',
        isChallenger:   r.challenger_id === user.id,
        isExpired,
        daysLeftToReply,
        opponentId,
        opponentName:   opponentProfile?.nickname?.trim() || opponentProfile?.display_name || null,
        opponentAvatar: null,
        // Duellens EGEN måned — ikke inneværende. Se FUNN 4.3 over.
        myPoints:       pointsForDuel(pointsByMonth, r.created_at, user.id),
        opponentPoints: pointsForDuel(pointsByMonth, r.created_at, opponentId),
        isUnseen:       isIncoming && uiStatus === 'pending' && !r.seen_at,
      }
    })
    // Fix 4: drop declined rows from previous months — they are no longer actionable
    .filter(r => !(r.status === 'declined' && r.isExpired))

  return NextResponse.json({ rivalries: result })
}
