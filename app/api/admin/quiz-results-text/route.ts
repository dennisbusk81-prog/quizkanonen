import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getQuestionStatsByAttempts } from '@/lib/attempt-answer-stats'
import { midtIndeks, midtPlassering } from '@/lib/midt-i-feltet'
import { getPublicSnapshot } from '@/lib/public-snapshot'
import { fetchAllRowsChunked } from '@/lib/paginate'
import { formatTid } from '@/lib/resultat-tid'

// ── Delingsteksten Dennis limer inn i Facebook ──────────────────────────────
//
// ── POPULASJONEN ER ET SAMTYKKESPØRSMÅL, IKKE EN VISNINGSDETALJ ────────────
// Fram til 11. september 2026 talte og rangerte denne ruten RÅTT på `attempts`
// (`.eq('is_team', false)`, ingen dedup, ingen submitted-filter og — det som
// betyr noe — ingen global blokkerings-gate). Den publiserte dermed spillere
// som har meldt seg ut av den åpne konkurransen.
//
// Målt på Fredagsquiz 11.09.2026: teksten sa 67 deltakere der resultatkortet
// og den offentlige lista sa 64. Hele differansen var tre medlemmer av samme
// bedrift med `organization_members.global_league_opt_out = true`, og én av
// dem sto på 7. plass i teksten med fullt navn. Ingen av de tre var sen
// spilling eller manglende oppgjør — verifisert mot prod.
//
// Ruten leser derfor nå `getPublicSnapshot`, samme kilde som bildet
// (app/admin/resultatkort/[quizId]) og den offentlige resultatlista
// (/api/leaderboard/[id]). Den kilden er ALLEREDE filtrert og rangert.
//
// LEGG DERFOR ALDRI ET FILTER OPPÅ ET EGET RÅTT OPPSLAG HER. Da finnes det to
// definisjoner av «det synlige feltet» igjen, og de vil drifte — nøyaktig
// feilklassen `lib/public-snapshot.ts` ble skrevet for å fjerne.
// `lib/quiz-results-text-kilde.test.ts` feller et forsøk på det.
//
// ── NAVN ───────────────────────────────────────────────────────────────────
// Kallenavn foran profilnavn foran navnet ved spilletidspunktet — samme
// rekkefølge som bildet og topplisten. Et kallenavn er et valg om hvordan man
// framstår offentlig; teksten skal ikke oppgi navnet bak det. Ruten viste
// tidligere `display_name`, så vinneren het «Team Domino's» på bildet og
// «Simen Sundt» i teksten under det.
//
// ── TID ────────────────────────────────────────────────────────────────────
// `lib/resultat-tid.ts`, delt med bildet. Her sto en lokal `formatTime` som
// skrev `1:03` der bildet skrev `63.4s`.

type SpillerRad = {
  id: string
  user_id: string | null
  navn: string
  rank: number
  correct_answers: number
  total_time_ms: number
}

// Batch-/kaskade-arbeid: flere eksterne kall, bulk-e-post eller tunge
// slettinger. Samme budsjett som de eksisterende cron-rutene (konvensjon 60).
export const maxDuration = 60

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
    .select('id, title, closes_at, season_points_awarded')
    .eq('id', quizId)
    .single()

  if (!quizRaw) return NextResponse.json({ error: 'Quiz ikke funnet' }, { status: 404 })
  const quiz = quizRaw as {
    id: string
    title: string
    closes_at: string | null
    season_points_awarded: boolean | null
  }

  // 2. DET SYNLIGE FELTET — ferdig filtrert og ferdig rangert.
  // Ingen egen telling, ingen egen sortering, ingen egen `attempts`-spørring.
  // Se toppkommentaren for hvorfor dette er et samtykkespørsmål.
  const { publicSnapshot } = await getPublicSnapshot(quizId, {
    seasonPointsAwarded: quiz.season_points_awarded === true,
  })

  const total = publicSnapshot.length

  // 3. Navn — kallenavn foran profilnavn foran navnet ved spilletidspunktet.
  //
  // CHUNKET: hele id-lista havner i URL-ens query-streng, og den målte grensen
  // ligger rundt 390 id-er (lib/paginate.ts). Høyeste målte deltakertall er 67,
  // så det er lang vei dit — men bruddet er STILLE, og alternativet er at hver
  // spiller faller tilbake på et navn som ser helt riktig ut.
  const userIds = [...new Set(
    publicSnapshot.map(e => e.user_id).filter((id): id is string => !!id)
  )]

  const profileMap = new Map<string, { display_name: string | null; nickname: string | null }>()
  if (userIds.length > 0) {
    let profiler: { id: string; display_name: string | null; nickname: string | null }[] = []
    try {
      profiler = await fetchAllRowsChunked<{ id: string; display_name: string | null; nickname: string | null }>(
        userIds,
        (chunk, from, to) =>
          supabaseAdmin
            .from('profiles')
            .select('id, display_name, nickname')
            .in('id', chunk)
            .order('id', { ascending: true })
            .range(from, to),
      )
    } catch (e) {
      // FAIL-STENGT, samme kontrakt som resultatkortet: å falle tilbake på
      // `player_name` ville avslørt det EKTE navnet til alle som med vilje
      // spiller under kallenavn — i en tekst som limes rett inn på Facebook.
      console.error(
        '[quiz-results-text] profil-oppslag feilet — teksten lages ikke:',
        e instanceof Error ? e.message : e,
      )
      return NextResponse.json(
        { error: 'Kunne ikke hente navnene akkurat nå. Prøv igjen om litt.' },
        { status: 503 },
      )
    }
    for (const p of profiler) profileMap.set(p.id, p)
  }

  const spillere: SpillerRad[] = publicSnapshot.map(e => {
    const profil = e.user_id ? profileMap.get(e.user_id) : undefined
    const kallenavn = profil?.nickname?.trim()
    return {
      id: e.id,
      user_id: e.user_id,
      navn: (kallenavn || profil?.display_name || e.player_name || '?').trim(),
      rank: e.rank,
      correct_answers: e.correct_answers,
      total_time_ms: e.total_time_ms,
    }
  })

  const top10Attempts = spillere.slice(0, 10)

  // 4. Midpoint person
  //
  // Plasseringen kommer fra den DELTE definisjonen (lib/midt-i-feltet.ts), som
  // også resultatkort-bildet leser. Fram til 11. september 2026 lå
  // regnestykket i tre kopier, og bildet hadde en annen formel enn denne —
  // synlig først ved partall antall deltakere, altså annenhver uke.
  //
  // Ingen egen spørring lenger: midtmannen er en INDEKS i det samme feltet.
  // Den gamle `.range(midIdx, midIdx)`-formen var en andre rangering av en
  // annen populasjon, og kunne derfor peke på en annen person enn lista over.
  const midIdx = midtIndeks(total)
  const midAttempt = midIdx === null ? null : (spillere[midIdx] ?? null)
  const midRank = midAttempt ? (midtPlassering(total) ?? 0) : 0

  const nameOf = (a: SpillerRad) => a.navn

  // 5. Easiest / hardest questions (via attempt_answers aggregation)
  //
  // Samme populasjon som lista over — ett forsøk per spiller, blokkerte ute.
  // Prosentene beskriver da det samme feltet som deltakertallet i teksten,
  // i stedet for å blande to populasjoner i ett innlegg.
  const attemptIds = spillere.map(a => a.id)

  let easiestText: string | null = null
  let easiestPct: number | null = null
  let hardestText: string | null = null
  let hardestPct: number | null = null

  if (attemptIds.length >= 2) {
    const statsMap = await getQuestionStatsByAttempts(attemptIds)

    if (statsMap.size > 0) {
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
      ? `${nameOf(winner)} med ${winner.correct_answers} riktige på ${formatTid(winner.total_time_ms)}`
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

    // `clearTimeout` i `finally`, ikke etter await-en. Kaster `fetch` — nede
    // nettverk, DNS-feil, avbrutt kall — hoppet vi rett til catch-blokken og
    // timeren ble ALDRI ryddet: den holdt event-loopen i live i åtte sekunder
    // etterpå. Funnet 11. september 2026 fordi testkjøringen brukte nøyaktig
    // 8 sekunder mer enn arbeidet tok.
    let aiRes: Response
    try {
      aiRes = await fetch('https://api.anthropic.com/v1/messages', {
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
    } finally {
      clearTimeout(timeoutId)
    }

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

  // Plasseringen leses av RADEN, ikke av løkkeindeksen. De er like i dag
  // (feltet er posisjonelt re-ranket til 1..N uten hull), men indeksen er en
  // egenskap ved lista vi løkker over — ranken er en egenskap ved spilleren.
  // Skulle lista noen gang bli filtrert et hakk til, ville indeksen stille
  // begynt å oppgi feil plass.
  top10Attempts.forEach(a => {
    const prefix = a.rank <= 3 ? medals[a.rank - 1] : `${a.rank}.`
    lines.push(`${prefix} ${nameOf(a)} — ${a.correct_answers} riktige · ${formatTid(a.total_time_ms)}`)
  })

  if (midAttempt) {
    lines.push('')
    lines.push(
      `Midt på treet: ${nameOf(midAttempt)} på ${midRank}. plass - ${midAttempt.correct_answers} riktige · ${formatTid(midAttempt.total_time_ms)}`
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
