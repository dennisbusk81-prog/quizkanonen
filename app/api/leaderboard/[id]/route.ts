import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rankQuizAttempts } from '@/lib/ranking'
import { resolveOrgMembership } from '@/lib/org-membership'
import { isUserPremium } from '@/lib/premium-check'
import { isQuizClosed } from '@/lib/standings-cache'

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

  // Bla/søk er ØNSKET her, ikke innvilget — se browse-gaten lenger nede.
  const pageParamRaw = searchParams.get('page')
  const searchRaw = (searchParams.get('search') ?? '').trim()
  const browseRequested = pageParamRaw !== null || searchRaw !== ''
  const searchRequested = searchRaw === '' ? null : searchRaw
  const pageRequested = Math.max(1, parseInt(pageParamRaw ?? '1', 10) || 1)

  // Klassisk visning: topp `limit` (default 50, maks 200). Browse: 20/side.
  const limitRaw = parseInt(searchParams.get('limit') ?? '50', 10)
  const classicLimit = Math.min(200, Math.max(1, Number.isNaN(limitRaw) ? 50 : limitRaw))

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
  // Henter rader for rommet (solo/lag), filtrerer på submitted, dedup'er per
  // spiller og rangerer med 4-nøkkels tiebreak. Søk/paginering skjer i JS etterpå.
  // OBS: PostgREST kutter stille ved 1000 rader (db-max-rows) — det gamle
  // .limit(5000) gjorde ingenting, og «alle rader» stemmer kun opp til 1000
  // attempts per quiz. Spørringen er IKKE beskyttet mot vekst.
  // TODO(paginering): bruk fetchAllRows fra lib/paginate.ts.
  const [{ data: allRowsRaw }, quizRes] = await Promise.all([
    supabaseAdmin
      .from('attempts')
      .select(SELECT_COLS)
      .eq('quiz_id', quizId)
      .eq('is_team', isTeam),
    supabaseAdmin
      .from('quizzes')
      .select('closes_at, hide_leaderboard_until_closed, show_leaderboard')
      .eq('id', quizId)
      .maybeSingle(),
  ])

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

  // Forsøket til den som spør — grunnlaget for både «har spilt» (skjult
  // leaderboard) og brukerens egen plassering lenger nede.
  const mine = userId ? ranked.find(r => r.user_id === userId) ?? null : null

  // ── Når stillingen holdes tilbake — håndheves server-side ───────────────────
  // TO ULIKE quiz-innstillinger fører hit, og fram til 2. august 2026 lå begge
  // KUN i klienten. Ruten leste aldri quizzes-tabellen, så hele stillingen
  // kunne hentes rått fra API-et uansett hva UI-et valgte å tegne.
  //
  //   1. `show_leaderboard = false` — «Ukens resultater» er skrudd AV for
  //      quizen. PERMANENT: ingen tidsgrense, ingen unntak. Klienten returnerer
  //      hele siden tidlig («Ukens resultater er ikke aktivert for denne
  //      quizen», app/leaderboard/[id]/page.tsx) — før faner, liste og
  //      plasseringskort i det hele tatt vurderes.
  //
  //   2. `hide_leaderboard_until_closed = true` — stillingen er MIDLERTIDIG
  //      skjult mens quizen er åpen. To ting løfter den: at quizen stenger, og
  //      at en Premium-bruker HAR spilt. Klienten viser en låseskjerm
  //      («Publiseres for alle når quizen stenger») i stedet for listen.
  //
  // De er altså ikke samme regel — den ene er permanent og unntaksfri, den
  // andre tidsbegrenset med to unntak. Men VIRKNINGEN på svaret er identisk,
  // og med vilje: begge tømmer `entries` og rører ingenting annet. Å gi dem
  // hver sin variant ville laget to kodestier rundt samme invariant.
  //
  // «Stengt» avgjøres av den delte `isQuizClosed()` (lib/standings-cache) mot
  // `closes_at` — samme signal som /api/quiz/[id]/standings bruker, ikke et nytt.
  //
  // HVA SOM HOLDES TILBAKE: kun `entries` — de ANDRE spillernes rader, altså
  // selve det skjulte. Svaret er redusert, ikke en 403. Grunnen er konkret:
  // både resultatskjermen i app/quiz/[id] og `loadSoloPlacement` på
  // leaderboard-siden kaller denne ruten nettopp mens quizen er åpen, for å
  // vise spillerens EGEN plassering («Du er et sted mellom plass 11 og 20»).
  // En 403 ville brutt det kortet for alle som spiller en skjult quiz — en
  // legitim klient som spør før den vet at leaderboardet er skjult skal få
  // sitt eget resultat, bare ikke andres. `userEntry`, `userRank` (Premium),
  // `guestRank` og `totalCount` er derfor uendret; ingen av dem er andres
  // rangering, og `totalCount` er tallet spennet regnes ut fra.
  //
  // Dette gjelder også `show_leaderboard = false`: resultatskjermen etter en
  // spilt quiz viser plasseringen sin uavhengig av innstillingen (den er gated
  // på `show_live_placement`, et EGET felt), og henter den herfra når
  // /standings ikke svarer. Egen plassering og offentlig stilling er to ulike
  // funksjoner, og kun den siste skrus av her.
  //
  // Fail-safe: kan vi ikke lese quiz-raden (feil eller ingen rad), regnes
  // stillingen som holdt tilbake. En blipp mot databasen skal ikke kunne åpne
  // en skjult stilling; en quiz som ikke finnes har uansett ingen forsøk.
  const quizRow = quizRes.data as {
    closes_at: string | null
    hide_leaderboard_until_closed: boolean
    show_leaderboard: boolean
  } | null
  const quizIsClosed = quizRow ? isQuizClosed(quizRow.closes_at, Date.now()) : false

  // Permanent av — inkluderer fail-safe-stien (uten quiz-rad kan vi ikke
  // bekrefte at stillingen er slått PÅ, og da leverer vi den ikke).
  const leaderboardDisabled = !quizRow || !quizRow.show_leaderboard
  // Midlertidig skjult mens quizen er åpen.
  const hiddenUntilClosed = !!quizRow
    && quizRow.hide_leaderboard_until_closed
    && !quizIsClosed
    && !(userIsPremium && !!mine)

  // Ett felt for invarianten «ble radene holdt tilbake?» — det er dette som
  // faktisk styrer `entries`, og et svar der `leaderboardHidden` er false mens
  // listen er tom skal ikke kunne oppstå.
  const leaderboardHidden = leaderboardDisabled || hiddenUntilClosed
  // ...og årsaken separat, fordi de to tilstandene betyr ULIKE ting for en
  // bruker: «finnes ikke for denne quizen» vs. «kommer når quizen stenger».
  // Dagens klient leser riktignok quiz-raden selv og utleder teksten derfra,
  // så feltet er ikke i bruk ennå — men uten det kan en API-konsument ikke
  // skille de to uten et ekstra oppslag, og ville stått igjen med å gjette.
  const hiddenReason: 'disabled' | 'until_closed' | null =
    leaderboardDisabled ? 'disabled' : hiddenUntilClosed ? 'until_closed' : null

  // ── Bla og søk er Premium — håndheves server-side ───────────────────────────
  // Klienten viste kontrollene kun til Premium (`showBrowseControls`), men ruten
  // svarte på ?page=/?search= for hvem som helst. En gratisbruker kunne dermed
  // bla seg fram til sin egen eksakte rad og lese det nøyaktige tallet som
  // Premium-gaten over holder tilbake.
  //
  // Ikke-Premium får IKKE en feil: parameterne ignoreres, og svaret blir det
  // samme som uten dem (klassisk topp-`limit`). Ingen ekstra data, ingen ny
  // feilsti å håndtere for en klient som spør i god tro.
  const isBrowse = browseRequested && userIsPremium && !leaderboardHidden
  const search = isBrowse ? searchRequested : null
  const page = isBrowse ? pageRequested : 1
  const pageSize = isBrowse ? 20 : classicLimit

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
  // Holdt tilbake (deaktivert ELLER skjult til stengetid): ingen av de andre
  // spillernes rader forlater serveren.
  const entries: LbEntry[] = leaderboardHidden
    ? []
    : filtered.slice(start, start + pageSize).map(r => toEntry(r))

  await fetchNicknames(userEntry ? [...entries, userEntry] : entries)

  return NextResponse.json({
    entries, totalCount, userEntry, userRank, guestRank,
    userIsPremium, page, pageSize, isTeam, leaderboardHidden, hiddenReason,
  })
}
