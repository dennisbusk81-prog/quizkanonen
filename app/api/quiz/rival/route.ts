import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchAllRows } from '@/lib/paginate'
import { getGloballyBlockedSet } from '@/lib/globally-blocked-set'

// ── BLOKKERT-GATEN, lagt på 23. august 2026 (P-2, krav 4) ────────────────────
// Denne ruten navngir andre spillere tre steder — lederen, rivalen og
// duell-forslagene — og hadde INGEN synlighetsgate. En bruker i en org med
// allow_global_league=false, eller med eget global_league_opt_out, kunne derfor
// vises som «I tet» eller som foreslått motstander for hvem som helst. Det er
// en personvernbug, ikke en premium-sak: løftet til bedriftskundene er at
// resultatene deres kan holdes interne, og et navn er ikke et tall.
//
// Gaten er den samme delte som /standings, /leaderboard/[id], prev-rank og
// social-proof bruker (lib/globally-blocked-set.ts), og den er FAIL-STENGT:
// klarer den ikke avgjøre hvem som er blokkert, returnerer den hele den spurte
// lista, og da står bare gjestene igjen. Her betyr det ingen rival og ingen
// leder i inntil ett kall — en tom rute, ikke en lekk.
//
// BEVISST getGloballyBlockedSet direkte, IKKE lib/public-snapshot.ts — samme
// valg og samme begrunnelse som social-proof: populasjonen her er en ANNEN enn
// snapshotens. findRival dropper 0-scorere (`.gt('correct_answers', 0)`), og
// navnene løses via nickname/display_name fra profiles, ikke via snapshotens
// `player_name`. Å hente populasjonen fra snapshot-helperen ville stille endret
// både hvem som kan bli rival og hva de heter.
//
// ── INNLOGGING KREVES (samme runde) ──────────────────────────────────────────
// Ruten svarte tidligere på et kall UTEN token med `{ rival: null,
// rankingSnapshot }` — altså lederens navn og score til en hvilken som helst
// anonym kaller. Verifisert mot prod 23. august, ikke antatt: et curl uten
// Authorization ga `leaderName: "…", leaderCorrect: 15, top10MinCorrect: 13`.
//
// Grenen var død som KLIENTSTI (klienten kaller kun med token, og man kan ikke
// spille uten å være innlogget siden bced92d/80dbab4), men fullt levende som
// API. Den er derfor gjort om til et avslag, ikke slettet som «ubrukt kode» —
// forskjellen på de to er nettopp at den var nåbar.
function avatarColor(seed: string): string {
  const palette = ['#c9a84c', '#4ade80', '#4c94c9', '#c9a84c', '#4ade80']
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Kandidater å foreslå å utfordre på quiz-resultatskjermen — bevisst ANDRE
// spillere enn rival-en (poenget er å oppdage nye folk, ikke gjenta rivalen).
// Gjenbruker samme attempts+profiles-mønster som findRival/buildRankingSnapshot
// i denne filen i stedet for en ny, tyngre spørring. Eksisterende duell-
// motstandere ekskluderes klient-side (samme datakilde/mønster som
// leaderboard/[id] allerede bruker via /api/rivalries/my) — denne funksjonen
// vet ikke noe om brukerens rivalries.
async function buildSuggestions(quizId: string, excludeUserId: string, blocked: Set<string>) {
  const { data: attempts } = await supabaseAdmin
    .from('attempts')
    .select('user_id, correct_answers')
    .eq('quiz_id', quizId)
    .eq('is_team', false)
    .not('user_id', 'is', null)
    // Kun leverte — en som bare har STARTET skal ikke foreslås som
    // duell-motstander med 0 riktige (samme filter som resten av filen).
    .not('submitted_at', 'is', null)
    .neq('user_id', excludeUserId)
    .limit(60)

  const seen = new Set<string>()
  const unique: { user_id: string; correct_answers: number }[] = []
  for (const a of attempts ?? []) {
    if (!a.user_id || seen.has(a.user_id)) continue
    // Blokkerte skal ikke kunne foreslås som duell-motstander — forslaget er en
    // navnepille, og det er nøyaktig det gaten finnes for å hindre.
    if (blocked.has(a.user_id)) continue
    seen.add(a.user_id)
    unique.push({ user_id: a.user_id, correct_answers: a.correct_answers ?? 0 })
  }
  if (unique.length === 0) return []

  const picked = shuffle(unique).slice(0, 3)
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, nickname')
    .in('id', picked.map(u => u.user_id))
  const profileMap = new Map(
    (profiles ?? []).map((p: { id: string; display_name: string | null; nickname: string | null }) => [p.id, p])
  )

  return picked.map(u => {
    const p = profileMap.get(u.user_id)
    const name = p?.nickname?.trim() || p?.display_name || 'Ukjent'
    return { userId: u.user_id, name, avatarColor: avatarColor(u.user_id), score: u.correct_answers }
  })
}

async function buildRankingSnapshot(quizId: string, blocked: Set<string>) {
  // KUN LEVERTE forsøk — samme ferdig-definisjon som getOrBuildSnapshot
  // (lib/ranking-snapshot.ts) og findRival under. Manglet her fra fødselen
  // (10f7c6b): start-attempt oppretter raden med correct_answers=0 og
  // submitted_at=null, og submit skriver tallet først ved innsending. Uten
  // filteret ble en spiller som bare hadde STARTET «I tet … 0 riktige» i
  // sidepanelet — synlig hver fredag kveld før første innlevering, og
  // gjennom hele quizen for en spiller alene. totalPlayers/top10MinCorrect
  // telles fra samme leverte felt, så mellomskjermens «Du er i topp 10»
  // regnes ikke lenger mot uferdige nuller.
  // ÉN paginert spørring der det før sto to (limit(11) + en count).
  // Grunnen er gaten, ikke ryddetrang: en `.limit(11)` FØR filtrering er feil —
  // er lederen blokkert, sitter man igjen med ti og «topp 10»-terskelen leses
  // av feil rad. Filtreringen må skje før avkortingen, og da må hele det
  // ordnede feltet hentes. `totalPlayers` blir samtidig riktig av seg selv, i
  // stedet for å telles i en egen ufiltrert spørring.
  //
  // fetchAllRows fordi PostgREST kutter stille på 1000 rader (i dag ~67
  // spillere, så det er polstring, ikke et akutt behov).
  //
  // BEVISST ATFERDSENDRING: fetchAllRows KASTER på lesefeil, der
  // `const { data: top11 }` før svelget den og lot ruten svare
  // «totalPlayers: 0» — altså «ingen har spilt ennå», som er en helt normal
  // melding tidlig fredag kveld og derfor umulig å skille fra sannheten.
  // Et feilsvar er «vet ikke», aldri en verdi. Konsekvensen for spilleren er
  // uendret (klienten henter denne ruten fire-and-forget og skjuler kortet
  // ved feil), men feilen får nå et spor i Sentry i stedet for å bli borte.
  const allRows = await fetchAllRows<{ user_id: string | null; correct_answers: number | null; total_time_ms: number | null }>(
    (from, to) => supabaseAdmin
      .from('attempts')
      .select('user_id, correct_answers, total_time_ms')
      .eq('quiz_id', quizId)
      .eq('is_team', false)
      .not('submitted_at', 'is', null)
      .order('correct_answers', { ascending: false })
      .order('total_time_ms', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  )
  // Gjester (user_id null) kan ikke blokkeres og berøres aldri av gaten.
  const visible = allRows.filter(r => !r.user_id || !blocked.has(r.user_id))
  const totalCount = visible.length
  const top11List = visible.slice(0, 11)
  const top10MinCorrect = top11List.length >= 10 ? (top11List[9]?.correct_answers ?? 0) : 0
  let leaderName = 'Ukjent'
  let leaderCorrect = 0

  if (top11List.length > 0) {
    leaderCorrect = top11List[0].correct_answers ?? 0
    const leaderUserId = top11List[0].user_id
    if (leaderUserId) {
      const { data: lp } = await supabaseAdmin
        .from('profiles')
        .select('display_name, nickname')
        .eq('id', leaderUserId)
        .maybeSingle()
      leaderName = lp?.nickname?.trim() || lp?.display_name || 'Ukjent'
    }
  }

  return {
    top10MinCorrect,
    leaderName,
    leaderCorrect,
    totalPlayers: totalCount ?? 0,
  }
}

// Finn rival = personen nærmest OVER brukeren i quizens rangering (ikke toppen).
// - Har brukeren et fullført forsøk: personen rett over i rangeringen.
//   På 1. plass: personen rett under (eller ingen hvis alene).
// - Har ikke spilt ennå (vanlig under quiz): bruk median-plasseringen som
//   referanse og match mot personen rett over medianen — aldri toppen.
async function findRival(
  quizId: string,
  userId: string,
  blocked: Set<string>,
): Promise<{ user_id: string; correct_answers: number } | null> {
  const { data: attempts } = await supabaseAdmin
    .from('attempts')
    .select('user_id, correct_answers, total_time_ms')
    .eq('quiz_id', quizId)
    .eq('is_team', false)
    .not('user_id', 'is', null)
    .not('submitted_at', 'is', null) // kun fullførte forsøk
    .gt('correct_answers', 0)        // ignorer 0-scorere
    .order('correct_answers', { ascending: false })
    .order('total_time_ms', { ascending: true })

  const ranked = attempts ?? []
  if (ranked.length === 0) return null

  // Behold beste forsøk per bruker (første forekomst = best, siden sortert)
  const seen = new Set<string>()
  const unique: { user_id: string; correct_answers: number }[] = []
  for (const a of ranked) {
    if (!a.user_id || seen.has(a.user_id)) continue
    // Blokkerte fjernes FØR rangeringen brukes, ikke etter: rivalen velges på
    // POSISJON (indeksen over/under brukeren, eller rundt medianen), så en
    // blokkert rad som ligger igjen i lista forskyver hvem naboen er selv når
    // den ikke velges selv. Kalleren beholdes uansett — brukeren skal finne
    // SIN EGEN posisjon i lista, også når de selv er blokkert.
    if (a.user_id !== userId && blocked.has(a.user_id)) continue
    seen.add(a.user_id)
    unique.push({ user_id: a.user_id, correct_answers: a.correct_answers ?? 0 })
  }
  if (unique.length === 0) return null

  const userIdx = unique.findIndex(a => a.user_id === userId)

  let rivalIdx: number
  if (userIdx === 0) {
    // Brukeren er på 1. plass — vis personen rett under (eller ingen)
    rivalIdx = unique.length > 1 ? 1 : -1
  } else if (userIdx > 0) {
    // Personen med nest høyeste score rett over brukeren
    rivalIdx = userIdx - 1
  } else {
    // Brukeren har ikke spilt ennå — median som referanse, personen rett over den
    const medianIdx = Math.floor(unique.length / 2)
    rivalIdx = Math.max(0, medianIdx - 1)
  }

  if (rivalIdx < 0 || rivalIdx >= unique.length) return null
  const rival = unique[rivalIdx]
  if (rival.user_id === userId) return null // sikkerhetsnett
  return rival
}

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const quizId = searchParams.get('quizId')

  if (!quizId) {
    return NextResponse.json({ rival: null, rankingSnapshot: null }, {
      headers: { 'Cache-Control': 'private, max-age=60' },
    })
  }

  // ── Innlogging kreves (23. august 2026) ─────────────────────────────────────
  // Begge de to tidligere «ingen/ugyldig token»-grenene returnerte lederens navn
  // og score. Se toppkommentaren: grenen var nåbar, og den svarte.
  //
  // 401 og ikke 403: dette er «du er ikke innlogget», ikke «du har ikke lov».
  // Samme statuskode og samme betydning som start-attempt bruker (80dbab4).
  // Klienten kaller uansett kun med token og behandler et feilsvar som «ingen
  // rival-data» — kortet vises da ikke, som før.
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) {
    return NextResponse.json({ error: 'Innlogging kreves.', needsLogin: true }, { status: 401 })
  }

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) {
    return NextResponse.json({ error: 'Innlogging kreves.', needsLogin: true }, { status: 401 })
  }

  // FIX 5 — userId comes from the verified token, not from query params
  const userId = user.id

  // ── Synlighetsgaten, hentet ÉN gang og delt av alle tre byggerne ────────────
  // Ett sett per forespørsel, ikke ett per bygger: settet er 30s-cachet per
  // quiz i lib-en, men tre kall ville uansett vært tre sjanser til å få tre
  // ulike svar innenfor samme respons — nøyaktig den interne inkonsistensen
  // /standings ble bygget om for å unngå.
  //
  // `season_points_awarded` avgjør om gaten leses historisk (fra season_scores,
  // for en gjort-opp quiz) eller live (fra org-medlemskapene). Under spilling —
  // som er når denne ruten faktisk kalles — er den alltid false.
  const { data: quizRow } = await supabaseAdmin
    .from('quizzes')
    .select('season_points_awarded')
    .eq('id', quizId)
    .maybeSingle()

  const { data: playerRows } = await supabaseAdmin
    .from('attempts')
    .select('user_id')
    .eq('quiz_id', quizId)
    .eq('is_team', false)
    .not('user_id', 'is', null)
  const playerIds = [...new Set(
    (playerRows ?? []).map(r => r.user_id).filter((id): id is string => !!id)
  )]
  const blocked = playerIds.length > 0
    ? await getGloballyBlockedSet(quizId, playerIds, quizRow?.season_points_awarded === true)
    : new Set<string>()

  // Rival = personen nærmest over brukeren i rangeringen (ikke toppen)
  const rivalRow = await findRival(quizId, userId, blocked)

  if (!rivalRow) {
    const [rankingSnapshot, suggestions] = await Promise.all([
      buildRankingSnapshot(quizId, blocked),
      buildSuggestions(quizId, userId, blocked),
    ])
    return NextResponse.json(
      { rival: null, rankingSnapshot, suggestions },
      { headers: { 'Cache-Control': 'private, max-age=60' } }
    )
  }

  const [profileResult, rankingSnapshot, suggestions] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('display_name, nickname')
      .eq('id', rivalRow.user_id)
      .maybeSingle(),
    buildRankingSnapshot(quizId, blocked),
    buildSuggestions(quizId, userId, blocked),
  ])

  // Kallenavn vises i stedet for ekte navn hvis satt (rival vises i løpende tekst)
  const rivalName = profileResult.data?.nickname?.trim()
    || profileResult.data?.display_name
    || 'Ukjent'

  return NextResponse.json(
    {
      rival: { name: rivalName, avatarColor: avatarColor(rivalRow.user_id), score: rivalRow.correct_answers },
      rankingSnapshot,
      suggestions,
    },
    { headers: { 'Cache-Control': 'private, max-age=60' } }
  )
}
