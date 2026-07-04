'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { isAdminLoggedIn } from '@/lib/admin-auth'
import { adminFetch } from '@/lib/admin-fetch'
import Link from 'next/link'

type PlayerRow = {
  rank: number
  attemptId: string
  user_id: string | null
  name: string
  nickname: string | null
  correct_answers: number
  total_time_ms: number
}

type QuestionStat = {
  question_id: string
  order_index: number
  question_text: string
  total: number
  correct: number
  correct_pct: number
}

type ResultsData = {
  quiz: { id: string; title: string; opens_at: string | null; closes_at: string | null }
  isOpen: boolean
  total: number
  players: PlayerRow[]
  median: PlayerRow | null
  medianAbove: PlayerRow | null
  medianBelow: PlayerRow | null
  questionStats: QuestionStat[]
  easiest: QuestionStat | null
  hardest: QuestionStat | null
}

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:       #1a1c23;
    --card:     #21242e;
    --border:   #2a2d38;
    --gold:     #c9a84c;
    --gold-bg:  rgba(201,168,76,0.10);
    --gold-bdr: rgba(201,168,76,0.22);
    --white:    #ffffff;
    --body:     #e8e4dd;
    --muted:    #7a7873;
    --green:    #4ade80;
    --yellow:   #facc15;
    --red:      #f87171;
    --radius-card: 20px;
    --radius-btn:  10px;
  }

  body {
    background: var(--bg);
    font-family: 'Instrument Sans', sans-serif;
    color: var(--body);
    min-height: 100vh;
  }

  .res-page { max-width: 800px; margin: 0 auto; padding: 0 20px 80px; }

  .res-header {
    padding: 24px 0 20px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }

  .res-back {
    font-size: 12px;
    color: var(--muted);
    text-decoration: none;
    display: inline-block;
    margin-bottom: 12px;
    transition: color 0.15s;
  }
  .res-back:hover { color: var(--gold); }

  .res-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 26px;
    font-weight: 700;
    color: var(--white);
    letter-spacing: -0.01em;
    margin-bottom: 6px;
  }
  .res-title em { font-style: italic; color: var(--gold); }

  .res-subtitle { font-size: 13px; color: var(--muted); font-style: italic; }

  .res-open-badge {
    display: inline-block;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--green);
    background: rgba(74,222,128,0.12);
    border: 1px solid rgba(74,222,128,0.2);
    border-radius: 20px;
    padding: 3px 10px;
    margin-left: 10px;
    vertical-align: middle;
  }

  .res-rule { width: 100%; height: 1px; background: var(--border); margin: 24px 0; }

  .res-copybtn {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-btn);
    padding: 10px 16px;
    font-size: 13px;
    font-weight: 500;
    color: var(--body);
    cursor: pointer;
    font-family: 'Instrument Sans', sans-serif;
    white-space: nowrap;
    transition: color 0.15s, border-color 0.15s;
    align-self: flex-end;
  }
  .res-copybtn.copied { color: var(--green); border-color: var(--body); }

  .res-section {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 32px 0 14px;
  }
  .res-section-text {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
    white-space: nowrap;
  }
  .res-section-line { flex: 1; height: 1px; background: var(--border); }

  /* Midt-på-treet-kort (median + nabo over/under) */
  .res-mid {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 8px;
    margin-bottom: 8px;
  }
  .res-mid-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
    padding: 10px 14px 8px;
  }
  .res-mid-row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 14px;
    border-radius: 12px;
  }
  .res-mid-row.is-median {
    background: var(--gold-bg);
    border: 1px solid var(--gold-bdr);
  }
  .res-mid-rank {
    font-family: 'Libre Baskerville', serif;
    font-size: 22px;
    font-weight: 700;
    color: var(--muted);
    line-height: 1;
    width: 44px;
    flex-shrink: 0;
  }
  .res-mid-row.is-median .res-mid-rank { color: var(--gold); }
  .res-mid-rank span { font-size: 11px; color: var(--muted); font-weight: 400; }
  .res-mid-main { flex: 1; min-width: 0; }
  .res-mid-name {
    font-family: 'Libre Baskerville', serif;
    font-size: 16px;
    font-weight: 700;
    color: var(--white);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .res-mid-row.is-median .res-mid-name { font-size: 19px; }
  .res-mid-sub { font-size: 12px; color: var(--muted); margin-top: 3px; }

  /* Table */
  .res-table-wrap {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    overflow: hidden;
  }
  .res-table { width: 100%; border-collapse: collapse; }
  .res-table th {
    text-align: left;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    color: var(--muted);
    padding: 14px 16px 12px;
    border-bottom: 1px solid var(--border);
  }
  .res-table td {
    padding: 11px 16px;
    font-size: 13px;
    color: var(--body);
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }
  .res-table tr:last-child td { border-bottom: none; }
  .res-table tr.is-median td { background: var(--gold-bg); }
  .res-rank { color: var(--muted); font-size: 12px; width: 34px; }
  .res-rank.medal { color: var(--gold); font-weight: 700; }
  .res-name { font-weight: 500; color: var(--white); }
  .res-nick { font-size: 11px; color: var(--muted); display: block; margin-top: 1px; }
  .res-num { text-align: right; white-space: nowrap; }

  /* Question stats */
  .res-q {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 14px 18px;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .res-q-main { flex: 1; min-width: 0; }
  .res-q-num { font-size: 10px; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 4px; }
  .res-q-text {
    font-family: 'Libre Baskerville', serif;
    font-size: 14px;
    color: var(--white);
    line-height: 1.4;
    font-weight: 400;
  }
  .res-q-right { text-align: right; flex-shrink: 0; }
  .res-q-pct {
    font-family: 'Libre Baskerville', serif;
    font-size: 22px;
    font-weight: 700;
    line-height: 1;
    margin-bottom: 3px;
  }
  .res-q-diff { font-size: 11px; }
  .res-q-pct.easy, .res-q-diff.easy     { color: var(--green); }
  .res-q-pct.medium, .res-q-diff.medium { color: var(--yellow); }
  .res-q-pct.hard, .res-q-diff.hard     { color: var(--red); }

  .res-callout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 8px;
  }
  .res-callout-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 16px 18px;
  }
  .res-callout-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    margin-bottom: 8px;
  }
  .res-callout-label.easy { color: var(--green); }
  .res-callout-label.hard { color: var(--red); }
  .res-callout-q {
    font-family: 'Libre Baskerville', serif;
    font-size: 13px;
    color: var(--white);
    line-height: 1.4;
    margin-bottom: 6px;
  }
  .res-callout-pct { font-size: 12px; color: var(--muted); }

  /* Empty */
  .res-empty {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 56px 24px;
    text-align: center;
  }
  .res-empty-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 20px;
    color: var(--white);
    margin-bottom: 8px;
  }
  .res-empty-sub { font-size: 13px; color: var(--muted); line-height: 1.6; }

  .res-loading {
    min-height: 100vh;
    background: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .res-loading p {
    font-family: 'Libre Baskerville', serif;
    font-size: 18px;
    color: var(--muted);
    font-style: italic;
  }

  @media (max-width: 520px) {
    .res-callout { grid-template-columns: 1fr; }
  }
`

function formatTime(ms: number): string {
  const sec = Math.round(ms / 1000)
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`
}

function diffClass(pct: number) { return pct >= 70 ? 'easy' : pct >= 40 ? 'medium' : 'hard' }
function diffLabel(pct: number) { return pct >= 70 ? 'Lett' : pct >= 40 ? 'Middels' : 'Vanskelig' }

export default function QuizResults() {
  const params = useParams()
  const router = useRouter()
  const quizId = params.id as string

  const [data, setData] = useState<ResultsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!isAdminLoggedIn()) { router.push('/admin/login'); setLoading(false); return }
    ;(async () => {
      try {
        const res = await adminFetch(`/api/admin/quizzes/${quizId}/results`)
        if (res.ok) setData(await res.json())
      } catch (e) {
        console.error('results fetch feilet:', e)
      } finally {
        setLoading(false)
      }
    })()
  }, [quizId])

  function buildTop10Text(d: ResultsData): string {
    const medals = ['🥇', '🥈', '🥉']
    const dateStr = new Date(d.quiz.closes_at ?? Date.now()).toLocaleDateString('nb-NO', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    })
    const lines: string[] = []
    lines.push(`Resultat ${d.quiz.title} ${dateStr}`)
    lines.push('')
    lines.push(`${d.total} deltakere var med${d.isOpen ? ' så langt' : ''}!`)
    lines.push('')
    if (d.easiest) lines.push(`Ukens letteste: "${d.easiest.question_text}" — ${d.easiest.correct_pct}% visste det.`)
    if (d.hardest) lines.push(`Ukens vanskeligste: "${d.hardest.question_text}" — kun ${d.hardest.correct_pct}% fikk det til.`)
    if (d.easiest || d.hardest) lines.push('')
    d.players.slice(0, 10).forEach((p, i) => {
      const prefix = i < 3 ? medals[i] : `${i + 1}.`
      lines.push(`${prefix} ${p.name} — ${p.correct_answers} riktige · ${formatTime(p.total_time_ms)}`)
    })
    if (d.median) {
      lines.push('')
      lines.push('Midt på treet:')
      // Nabo over → median → nabo under. Kun de som finnes (kantcaser).
      const midGroup = [d.medianAbove, d.median, d.medianBelow].filter((p): p is PlayerRow => !!p)
      midGroup.forEach(p => {
        lines.push(`${p.rank}. ${p.name} — ${p.correct_answers} riktige · ${formatTime(p.total_time_ms)}`)
      })
    }
    return lines.join('\n')
  }

  async function copyTop10() {
    if (!data) return
    try {
      await navigator.clipboard.writeText(buildTop10Text(data))
      setCopied(true)
      setTimeout(() => setCopied(false), 3000)
    } catch { /* clipboard utilgjengelig */ }
  }

  if (loading) return (
    <>
      <style>{STYLES}</style>
      <div className="res-loading"><p>Laster resultater...</p></div>
    </>
  )

  const totalQuestions = data?.questionStats.length ?? 0

  return (
    <>
      <style>{STYLES}</style>
      <div className="res-page">

        <header className="res-header">
          <div>
            <Link href="/admin/quizzes" className="res-back">← Alle quizer</Link>
            <h1 className="res-title">
              Resul<em>tater</em>
              {data?.isOpen && <span className="res-open-badge">● Åpen — tall så langt</span>}
            </h1>
            <p className="res-subtitle">{data?.quiz.title}</p>
          </div>
          {data && data.total > 0 && (
            <button className={`res-copybtn ${copied ? 'copied' : ''}`} onClick={copyTop10}>
              {copied ? 'Kopiert! ✓' : 'Kopier topp 10 (for deling)'}
            </button>
          )}
        </header>

        <div className="res-rule" />

        {!data || data.total === 0 ? (
          <div className="res-empty">
            <p className="res-empty-title">Ingen resultater ennå</p>
            <p className="res-empty-sub">
              Resultater vises her når spillere har fullført quizen.
            </p>
          </div>
        ) : (
          <>
            {/* Spilleren i midten — median + nabo over/under */}
            {data.median && (
              <>
                <div className="res-section">
                  <span className="res-section-text">Spilleren i midten</span>
                  <div className="res-section-line" />
                </div>
                <div className="res-mid">
                  <div className="res-mid-label">Midt på treet — sosialt bevis</div>
                  {[data.medianAbove, data.median, data.medianBelow]
                    .filter((p): p is PlayerRow => !!p)
                    .map(p => {
                      const isMedian = p.attemptId === data.median?.attemptId
                      return (
                        <div key={p.attemptId} className={`res-mid-row ${isMedian ? 'is-median' : ''}`}>
                          <div className="res-mid-rank">{p.rank}.<span> plass</span></div>
                          <div className="res-mid-main">
                            <div className="res-mid-name">{p.nickname?.trim() || p.name}</div>
                            <div className="res-mid-sub">
                              {p.correct_answers}{totalQuestions > 0 ? ` / ${totalQuestions}` : ''} riktige · {formatTime(p.total_time_ms)}
                              {p.nickname?.trim() ? ` · ${p.name}` : ''}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                </div>
              </>
            )}

            {/* Full resultatliste */}
            <div className="res-section">
              <span className="res-section-text">Sluttresultat · {data.total} deltakere</span>
              <div className="res-section-line" />
            </div>

            <div className="res-table-wrap">
              <table className="res-table">
                <thead>
                  <tr>
                    <th className="res-rank">#</th>
                    <th>Navn</th>
                    <th className="res-num">Riktige</th>
                    <th className="res-num">Tid</th>
                  </tr>
                </thead>
                <tbody>
                  {data.players.map(p => {
                    const isMedian = data.median?.attemptId === p.attemptId
                    return (
                      <tr key={p.attemptId} className={isMedian ? 'is-median' : ''}>
                        <td className={`res-rank ${p.rank <= 3 ? 'medal' : ''}`}>{p.rank}</td>
                        <td>
                          {p.nickname?.trim() ? (
                            <>
                              <span className="res-name">{p.nickname.trim()}</span>
                              <span className="res-nick">{p.name}</span>
                            </>
                          ) : (
                            <span className="res-name">{p.name}</span>
                          )}
                        </td>
                        <td className="res-num">{p.correct_answers}{totalQuestions > 0 ? ` / ${totalQuestions}` : ''}</td>
                        <td className="res-num">{formatTime(p.total_time_ms)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Spørsmålsstatistikk */}
            {data.questionStats.length > 0 && (
              <>
                <div className="res-section">
                  <span className="res-section-text">Spørsmålsstatistikk</span>
                  <div className="res-section-line" />
                </div>

                {(data.easiest || data.hardest) && (
                  <div className="res-callout">
                    {data.easiest && (
                      <div className="res-callout-card">
                        <div className="res-callout-label easy">Letteste spørsmål</div>
                        <div className="res-callout-q">{data.easiest.question_text}</div>
                        <div className="res-callout-pct">{data.easiest.correct_pct}% svarte riktig</div>
                      </div>
                    )}
                    {data.hardest && (
                      <div className="res-callout-card">
                        <div className="res-callout-label hard">Vanskeligste spørsmål</div>
                        <div className="res-callout-q">{data.hardest.question_text}</div>
                        <div className="res-callout-pct">{data.hardest.correct_pct}% svarte riktig</div>
                      </div>
                    )}
                  </div>
                )}

                {data.questionStats.map((q, idx) => {
                  const dc = diffClass(q.correct_pct)
                  return (
                    <div key={q.question_id} className="res-q">
                      <div className="res-q-main">
                        <p className="res-q-num">Spørsmål {idx + 1}</p>
                        <p className="res-q-text">{q.question_text}</p>
                      </div>
                      <div className="res-q-right">
                        <p className={`res-q-pct ${dc}`}>{q.correct_pct}%</p>
                        <p className={`res-q-diff ${dc}`}>{diffLabel(q.correct_pct)}</p>
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </>
        )}
      </div>
    </>
  )
}
