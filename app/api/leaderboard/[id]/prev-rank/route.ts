import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rankAttempts } from '@/lib/ranking'
import { resolveOrgMembership } from '@/lib/org-membership'
import { getGloballyBlockedSet } from '@/lib/globally-blocked-set'
import { onlyRealQuizzes } from '@/lib/real-quiz-population'
import type { Attempt } from '@/lib/supabase'

// ── Forrige quiz' rangering for «pil opp»-trendmerket ────────────────────────
// Flyttet server-side fordi klient-lesen trengte attempts.user_id, som nå er
// fjernet fra anon/authenticated SELECT (kolonne-lås). Returnerer en map
// (user_id ?? player_name) → rank, som klienten matcher mot dagens leaderboard.
//
// ── P-1, 23. august 2026: nasjonal sti svarer med KUN kallerens egen rad ─────
// Fram til nå leverte ruten HELE forrige quiz' rangering — inntil 500 rader,
// inkludert gjestenes klarnavn — til hvem som helst, uten innlogging. Det var
// en komplett omgåelse av ethvert kutt i hovedruten: rekkefølgen kunne leses
// her i stedet. Et trinn-kutt ville gjort lekkasjen mindre; å svare med én rad
// fjerner den.
//
// Trendmerket trenger ikke alles rangering. Klienten leter etter den største
// forbedringen i kartet den får, så med kun kallerens egen rad kan merket bare
// lande på kallerens egen rad. SVARFORMEN er uendret (`prevRanks` som map), så
// klientkoden er den samme — kartet er bare kortere. Legende-teksten sier
// «Din fremgang» i nasjonal modus, siden «Størst fremgang» ville vært en
// superlativ vi ikke lenger kan belegge.
//
// UNNTAK — org-modus beholder hele kartet: rommet er medlemskaps-gatet rett
// under (verifisert medlem, lukket rom), og «org og liga uendret» er et
// absolutt krav i denne saken. Der betyr merket fortsatt «størst fremgang
// blant kolleger».
//
// Gjester får tomt kart: uten token finnes ingen verifisert identitet å slå
// opp, og å ta imot et navn fra klienten ville vært nøyaktig den
// oppslags-lekkasjen vi lukker.

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: quizId } = await params
  if (!quizId) return NextResponse.json({ prevRanks: {} })

  // ── Org-scoping (valgfritt) ──────────────────────────────────────────────────
  // Når ?org=<slug> er satt: SAMME medlemskaps-gate som hovedruten (token +
  // organization_members). Uten dette kunne ?org brukes til å enumerere org-
  // medlemskap via rank-mappen uten gyldig medlemskap. Uten param: uendret.
  const orgSlug = new URL(request.url).searchParams.get('org')?.trim() || null
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  let orgMemberIdSet: Set<string> | null = null
  if (orgSlug) {
    const gate = await resolveOrgMembership(orgSlug, token)
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
    orgMemberIdSet = new Set(gate.memberIds)
  }

  // Nasjonal sti: hvem SPØR? Uten en verifisert identitet finnes det ingen
  // egen rad å svare med, og da er hele oppslaget bortkastet — vi returnerer
  // før quiz-, attempts- og blokkert-spørringene i det hele tatt kjøres. Det er
  // ikke bare en gate, det er tre færre databasekall for enhver utlogget
  // besøkende på en resultatside.
  let callerId: string | null = null
  if (!orgSlug) {
    if (!token) return NextResponse.json({ prevRanks: {} })
    const { data: authData } = await supabaseAdmin.auth.getUser(token)
    callerId = authData.user?.id ?? null
    if (!callerId) return NextResponse.json({ prevRanks: {} })
  }

  // Finn gjeldende quiz' closes_at for å lokalisere forrige quiz.
  const { data: current } = await supabaseAdmin
    .from('quizzes')
    .select('closes_at')
    .eq('id', quizId)
    .maybeSingle()

  if (!current?.closes_at) return NextResponse.json({ prevRanks: {} })

  // onlyRealQuizzes: «forrige quiz» er sammenligningsgrunnlaget for HELE
  // trendmerket. En testquiz stenger typisk kort tid før den ekte og vinner da
  // `order('closes_at', desc)` — da måles alles fremgang mot en quiz nesten
  // ingen spilte. Merk at det er FORRIGE quiz som gates her, ikke den man ser
  // på: står man på en testquiz' leaderboard, skal forrige EKTE quiz fortsatt
  // være grunnlaget. Se lib/real-quiz-population.ts.
  //
  // Spørringen står i en LOKAL VARIABEL: inlinet som argument til
  // onlyRealQuizzes() ga `next build` TS2589 «Type instantiation is
  // excessively deep». Se lib/real-quiz-population.ts. Ikke inline den tilbake.
  const prevQuizQuery = supabaseAdmin
    .from('quizzes')
    .select('id, season_points_awarded')
    .lt('closes_at', current.closes_at)
    .order('closes_at', { ascending: false })
    .limit(1)

  // .maybeSingle() MÅ komme ETTER helperen: den returnerer en PostgrestBuilder
  // uten .not()/.in(), så filteret kan ikke legges på i etterkant.
  const { data: prevQuiz } = await onlyRealQuizzes(prevQuizQuery).maybeSingle()

  if (!prevQuiz) return NextResponse.json({ prevRanks: {} })

  const { data: prevAttempts } = await supabaseAdmin
    .from('attempts')
    .select('id, quiz_id, player_name, is_team, team_size, correct_answers, total_questions, total_time_ms, correct_streak, user_id, completed_at, leader_display_name')
    .eq('quiz_id', prevQuiz.id)
    .eq('is_team', false)
    .limit(500)

  if (!prevAttempts || prevAttempts.length === 0) {
    return NextResponse.json({ prevRanks: {} })
  }

  // I org-modus: rangér kun blant org-medlemmer så "største fremgang" er
  // relativt til org, i tråd med den org-filtrerte listen på klienten.
  const scopedPrev = orgMemberIdSet
    ? (prevAttempts as Attempt[]).filter(a => a.user_id != null && orgMemberIdSet.has(a.user_id))
    : (prevAttempts as Attempt[])

  // Nasjonal sti: samme globale synlighets-gate som hovedruten — blokkerte
  // (stengt org / eget opt-out) skal heller ikke lekke via rank-mappen for
  // FORRIGE quiz. Settet gjelder forrige quiz' id og oppgjørsstatus, ikke
  // gjeldende. Org-modus gates ikke (intern visning, medlemskap verifisert);
  // gjester (user_id null) berøres aldri. Ruten er allerede solo-only
  // (is_team=false i spørringen over), så lag-forbeholdet i lib-en treffer ikke.
  let visiblePrev = scopedPrev
  if (!orgMemberIdSet) {
    const prevUserIds = [...new Set(
      scopedPrev.map(a => a.user_id).filter((id): id is string => !!id)
    )]
    const blocked = await getGloballyBlockedSet(
      prevQuiz.id,
      prevUserIds,
      (prevQuiz as { season_points_awarded?: boolean }).season_points_awarded === true,
    )
    if (blocked.size > 0) {
      visiblePrev = scopedPrev.filter(a => a.user_id == null || !blocked.has(a.user_id))
    }
  }

  // Rangeringen regnes fortsatt over HELE det synlige feltet — ellers ville
  // kallerens egen plassering vært mot et vilkårlig utsnitt i stedet for mot
  // konkurransen. Det er kun hva som forlater serveren som er begrenset.
  const ranked = rankAttempts(visiblePrev)
  const prevRanks: Record<string, number> = {}
  if (orgMemberIdSet) {
    // Org: hele kartet, som før.
    for (const a of ranked) {
      const key = a.user_id ?? a.player_name
      if (!(key in prevRanks)) prevRanks[key] = a.rank
    }
  } else if (callerId) {
    // Nasjonal: én rad — kallerens egen. En BLOKKERT kaller (stengt org / eget
    // opt-out) er filtrert ut av `visiblePrev` og finnes derfor ikke her, så
    // svaret blir tomt. Det er riktig og bevisst: klienten holder allerede eget
    // offentlig tall tilbake for dem (suppressOwnPublicRank), og et trendmerke
    // utledet av den åpne konkurransen hører ikke hjemme hos noen som står
    // utenfor den.
    const mine = ranked.find(a => a.user_id === callerId)
    if (mine) prevRanks[callerId] = mine.rank
  }

  return NextResponse.json({ prevRanks })
}
