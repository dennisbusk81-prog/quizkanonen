import { supabaseAdmin } from '@/lib/supabase-admin'
import SiteNav from '@/components/SiteNav'
import Link from 'next/link'
import { describeQuestionTimeLimit } from '@/lib/quiz-time-limit'
import { fetchParticipantCounts } from '@/lib/quiz-participant-counts'
import { fetchAllRowsChunked } from '@/lib/paginate'

export const dynamic = 'force-dynamic'

type QuizRow = {
  id: string
  title: string

  requires_access_code: boolean
  time_limit_seconds: number | null
  opens_at: string | null
  closes_at: string | null
  questions: { count: number }[]
  attempts: { count: number }[]
}

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: #1a1c23;
    font-family: 'Instrument Sans', sans-serif;
    color: #e8e4dd;
    min-height: 100vh;
  }

  .qz-page {
    max-width: 720px;
    margin: 0 auto;
    padding: 40px 20px 80px;
    flex: 1;
  }

  .qz-back {
    display: inline-block;
    font-size: 12px;
    color: #e8e4dd;
    text-decoration: none;
    letter-spacing: 0.04em;
    margin-bottom: 28px;
    transition: color 0.15s;
  }

  .qz-back:hover { color: #ffffff; }

  .qz-header { margin-bottom: 28px; }

  .qz-eyebrow {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #c9a84c;
    margin-bottom: 8px;
  }

  .qz-title {
    font-family: 'Libre Baskerville', serif;
    font-size: clamp(24px, 5vw, 32px);
    font-weight: 700;
    color: #ffffff;
    letter-spacing: -0.01em;
  }

  .qz-card {
    background: #21242e;
    border: 1px solid #2a2d38;
    border-radius: 16px;
    padding: 14px 18px;
    margin-bottom: 8px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    transition: border-color 0.18s;
  }

  .qz-card:hover { border-color: rgba(201,168,76,0.3); }

  .qz-card-left { flex: 1; min-width: 0; }

  .qz-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }

  .qz-tag {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 3px 9px;
    border-radius: 20px;
    background: rgba(201,168,76,0.10);
    color: #c9a84c;
    border: 1px solid rgba(201,168,76,0.22);
  }

  .qz-tag-muted {
    background: rgba(106,104,96,0.12);
    color: #918f8a;
    border: 1px solid rgba(106,104,96,0.18);
  }

  .qz-tag-kommende {
    background: rgba(99,179,237,0.08);
    color: #e8e4dd;
    border: 1px solid rgba(99,179,237,0.2);
  }

  .qz-tag-stengt {
    background: rgba(106,104,96,0.10);
    color: #918f8a;
    border: 1px solid rgba(106,104,96,0.15);
  }

  .qz-status-time {
    font-size: 12px;
    color: #918f8a;
    margin-top: 4px;
  }

  .qz-quiz-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 19px;
    font-weight: 700;
    color: #ffffff;
    line-height: 1.25;
    margin-bottom: 10px;
    letter-spacing: -0.01em;
  }

  .qz-details { display: flex; flex-wrap: wrap; gap: 12px; }
  .qz-detail { font-size: 12px; color: #918f8a; }

  .qz-card-right {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
  }

  .qz-btn-outline {
    display: inline-flex;
    align-items: center;
    background: transparent;
    color: #e8e4dd;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 13px;
    font-weight: 600;
    padding: 9px 18px;
    border-radius: 10px;
    border: 0.5px solid #918f8a;
    text-decoration: none;
    white-space: nowrap;
    transition: border-color 0.15s, color 0.15s;
  }

  .qz-btn-outline:hover { border-color: #e8e4dd; color: #ffffff; }

  .qz-btn-ghost {
    font-size: 12px;
    font-weight: 500;
    color: #e8e4dd;
    text-decoration: none;
    transition: color 0.15s;
    padding: 4px 0;
  }

  .qz-btn-ghost:hover { color: #c9a84c; }

  .qz-empty {
    background: #21242e;
    border: 1px solid #2a2d38;
    border-radius: 16px;
    padding: 48px 32px;
    text-align: center;
    font-size: 14px;
    color: #918f8a;
    line-height: 1.6;
  }

  @media (max-width: 520px) {
    .qz-card { flex-direction: column; gap: 16px; }
    .qz-card-right { flex-direction: row; width: 100%; justify-content: flex-start; }
  }
`

// Denne siden er en server-komponent (force-dynamic). new Date(iso).getHours()
// leser SERVERENS lokale tidssone, ikke Oslo — på Vercel er serverklokka UTC,
// så uten eksplisitt konvertering ville "Stenger fredag ... kl. X" vist feil
// klokkeslett i produksjon (1-2 timer bak, avhengig av sommer-/vintertid).
// Samme mønster som formatNextQuiz i app/page.tsx og nowOslo i quiz/[id]/page.tsx.
function formatNorDate(iso: string): string {
  const d = new Date(iso)
  const oslo = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Oslo' }))
  const days = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag']
  const months = ['jan.', 'feb.', 'mars', 'apr.', 'mai', 'juni', 'juli', 'aug.', 'sep.', 'okt.', 'nov.', 'des.']
  const hh = String(oslo.getHours()).padStart(2, '0')
  const mm = String(oslo.getMinutes()).padStart(2, '0')
  return `${days[oslo.getDay()]} ${oslo.getDate()}. ${months[oslo.getMonth()]} kl. ${hh}.${mm} (norsk tid)`
}

type QuizStatus = 'åpen' | 'kommende' | 'stengt'

function getQuizStatus(opensAt: string | null, closesAt: string | null, now: Date): QuizStatus {
  if (opensAt && new Date(opensAt) > now) return 'kommende'
  if (closesAt && new Date(closesAt) < now) return 'stengt'
  return 'åpen'
}

export default async function QuizerPage() {
  const { data: quizzes } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, requires_access_code, time_limit_seconds, opens_at, closes_at, questions(count), attempts(count)')
    .eq('is_active', true)
    .eq('is_test', false)
    .order('opens_at', { ascending: false, nullsFirst: false })

  const quizList = (quizzes as QuizRow[] | null) ?? []

  // Antall deltakere — delt tellelogikk i lib/quiz-participant-counts.ts,
  // paginert forbi både URL-taket på .in() (~390 id-er) og 1000-radstaket.
  const quizIds = quizList.map(q => q.id)
  const participantCounts = await fetchParticipantCounts(quizIds)

  // ── Effektiv tidsgrense per quiz (7. august 2026) ────────────────────────────
  // Kortet skrev tidligere `quiz.time_limit_seconds` rett ut, men spillingen
  // bruker spørsmål-nivået med quiz-raden kun som fallback. Nivåene har
  // divergert i prod (Fredagsquiz 19.06.2026: quiz=10, alle spørsmål=15), så
  // lista lovet 10 sekunder på en quiz som ble spilt med 15.
  //
  // Dette er en serverkomponent med service_role, så grensene leses direkte —
  // ingen ny rute. Feiler spørringen, faller hvert kort tilbake på quiz-nivået
  // (samme tall som før), i stedet for at hele sida ryker.
  const timeLimitLabels = new Map<string, string | null>()
  if (quizIds.length > 0) {
    // quizIds er lista over aktive quizer (13 i dag) — godt under .in()-taket
    // på ~390 id-er. Men RADENE er det bindende taket her, ikke id-lista: dette
    // henter alle spørsmål på tvers av alle aktive quizer, altså ~20 rader per
    // quiz. Rundt 50 aktive quizer passeres 1000-radstaket, og PostgREST kutter
    // stille — kortene lenger nede i lista ville da fått tidsgrense-etiketten
    // regnet ut fra et TOMT spørsmålssett og falt tilbake på quiz-nivået, som er
    // nettopp tallet fiksen 7. august fantes for å slutte å vise.
    //
    // fetchAllRowsChunked dekker begge takene i samme kall. Feiler den, beholdes
    // fallbacken under: hvert kort faller tilbake på quiz-nivået i stedet for at
    // hele sida ryker.
    let questionRows: { quiz_id: string; time_limit_seconds: number | null }[] = []
    try {
      questionRows = await fetchAllRowsChunked<{ quiz_id: string; time_limit_seconds: number | null }>(
        quizIds,
        (chunk, from, to) =>
          supabaseAdmin
            .from('questions')
            .select('quiz_id, time_limit_seconds')
            .in('quiz_id', chunk)
            .order('id', { ascending: true })
            .range(from, to)
      )
    } catch (questionError) {
      console.error('[quizer] questions time limit query error:', questionError)
    }
    const perQuizLimits = new Map<string, (number | null)[]>()
    for (const r of questionRows) {
      if (!perQuizLimits.has(r.quiz_id)) perQuizLimits.set(r.quiz_id, [])
      perQuizLimits.get(r.quiz_id)!.push(r.time_limit_seconds)
    }
    for (const quiz of quizList) {
      timeLimitLabels.set(
        quiz.id,
        describeQuestionTimeLimit(perQuizLimits.get(quiz.id) ?? [], quiz.time_limit_seconds),
      )
    }
  }

  return (
    <>
      <style>{css}</style>
      <SiteNav />
      <div className="qz-page">
        <header className="qz-header">
          <p className="qz-eyebrow">Quizkanonen</p>
          <h1 className="qz-title">Alle quizer</h1>
        </header>

        {quizList.length === 0 ? (
          <div className="qz-empty">
            Ingen quizer ennå — kom tilbake på fredag.
          </div>
        ) : (() => {
          const now = new Date()
          return (
            <div>
              {quizList.map(quiz => {
                const questionCount = quiz.questions[0]?.count ?? 0
                const participantCount = participantCounts.get(quiz.id) ?? 0
                const timeLimitLabel = timeLimitLabels.get(quiz.id) ?? null
                const status = getQuizStatus(quiz.opens_at, quiz.closes_at, now)
                const statusLabel = status === 'åpen' ? '● Åpen' : status === 'kommende' ? '○ Kommende' : '○ Stengt'
                const statusClass = status === 'åpen' ? 'qz-tag' : status === 'kommende' ? 'qz-tag qz-tag-kommende' : 'qz-tag qz-tag-stengt'
                const timeNote =
                  status === 'kommende' && quiz.opens_at
                    ? `Åpner ${formatNorDate(quiz.opens_at)}`
                    : status === 'åpen' && quiz.closes_at
                      ? `Stenger ${formatNorDate(quiz.closes_at)}`
                      : null
                return (
                  <div key={quiz.id} className="qz-card">
                    <div className="qz-card-left">
                      <div className="qz-tags">
                        <span className={statusClass}>{statusLabel}</span>

                        {quiz.requires_access_code && <span className="qz-tag qz-tag-muted">Kode</span>}
                      </div>
                      <h2 className="qz-quiz-title">{quiz.title}</h2>
                      <div className="qz-details">
                        {questionCount > 0 && <span className="qz-detail">{questionCount} spørsmål</span>}
                        {participantCount > 0 && <span className="qz-detail">{participantCount} deltakere</span>}
                        {timeLimitLabel && <span className="qz-detail">{timeLimitLabel} per spørsmål</span>}
                      </div>
                      {timeNote && <p className="qz-status-time">{timeNote}</p>}
                    </div>
                    <div className="qz-card-right">
                      {status !== 'kommende' && (
                        <Link href={`/quiz/${quiz.id}`} className="qz-btn-outline">
                          {status === 'åpen' ? 'Spill nå' : 'Se quiz'}
                        </Link>
                      )}
                      <Link href={`/leaderboard/${quiz.id}`} className="qz-btn-ghost">Ukens resultater →</Link>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })()}
      </div>
    </>
  )
}
