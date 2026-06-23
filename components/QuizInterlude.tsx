'use client'

import { useMemo, useState, useEffect } from 'react'
import { selectQuizMessage, QuizMessageState } from '@/lib/select-quiz-message'

interface RivalData {
  name: string
  avatarColor: string
  score: number
}

interface PercentileEntry {
  score: number
  percentile: number
}

interface RankingSnapshot {
  top10MinCorrect: number
  leaderName: string
  leaderCorrect: number
  totalPlayers: number
}

interface LiveRanking {
  totalPlayers: number
  userRank: number
  above: { name: string; correct: number } | null
  below: { name: string; correct: number } | null
}

interface QuizInterludeProps {
  phase: 'in' | 'out'
  lastCorrect: boolean | null
  correctAnswerText: string | null
  explanation?: string | null
  score: number               // correct answers so far
  totalQuestions: number
  streak: number
  wrongInARow: number
  questionIndex: number       // 0-based index of question just answered
  low: number | null          // estimated rank range
  high: number | null
  rival: RivalData | null
  percentileData: PercentileEntry[]
  rankingSnapshot?: RankingSnapshot
  isPremium?: boolean
  quizId?: string
  onNext: () => void
}

function RivalAvatar({ rival }: { rival: RivalData }) {
  const initial = (rival.name[0] ?? '?').toUpperCase()
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
      marginBottom: 20,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: '50%',
        background: rival.avatarColor + '22',
        border: `2px solid ${rival.avatarColor}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16, fontWeight: 700, color: rival.avatarColor,
        flexShrink: 0,
      }}>
        {initial}
      </div>
      <div style={{ textAlign: 'left' }}>
        <p style={{ fontSize: 13, color: '#e8e4dd', fontWeight: 600, margin: 0 }}>{rival.name}</p>
        <p style={{ fontSize: 11, color: '#7a7873', margin: 0 }}>
          {rival.score} riktige denne quizen
        </p>
      </div>
    </div>
  )
}

export default function QuizInterlude({
  phase,
  lastCorrect,
  correctAnswerText,
  explanation,
  score,
  totalQuestions,
  streak,
  wrongInARow,
  questionIndex,
  low,
  high,
  rival,
  percentileData,
  rankingSnapshot,
  isPremium,
  quizId,
  onNext,
}: QuizInterludeProps) {
  const [liveRanking, setLiveRanking] = useState<LiveRanking | null>(null)

  useEffect(() => {
    if (!isPremium || !quizId) return
    let cancelled = false
    fetch(`/api/quiz/live-ranking?quiz_id=${encodeURIComponent(quizId)}&current_correct=${score}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: LiveRanking | null) => { if (!cancelled && data) setLiveRanking(data) })
      .catch(() => {/* silent — never block next button */})
    return () => { cancelled = true }
  }, [isPremium, quizId, score])
  // Percentile: beregnes før meldingsvalg slik at scoreIsAboveMedian kan brukes i selectQuizMessage
  const percentileEntry = percentileData.find(p => p.score === score)
  const scoreIsAboveMedian = percentileEntry ? percentileEntry.percentile >= 50 : false

  const msgState: QuizMessageState = {
    streak,
    wrongInARow,
    correctSoFar: score,
    totalQuestions,
    questionIndex,
    rival,
    scoreIsAboveMedian,
  }

  const message = useMemo(() => selectQuizMessage(msgState), [
    streak, wrongInARow, score, totalQuestions, questionIndex,
    rival?.name, scoreIsAboveMedian,
  ])

  const animClass = phase === 'in' ? 'qk-intermediate-in' : 'qk-intermediate-out'

  return (
    <div
      className={animClass}
      style={{
        position: 'fixed', inset: 0, background: '#1a1c23', zIndex: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', overflowY: 'auto',
        padding: '40px 32px',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 360, width: '100%' }}>

        {/* Previous question result pill */}
        {lastCorrect === true ? (
          <div style={{
            display: 'inline-block',
            background: 'rgba(59,109,17,0.15)', border: '1px solid rgba(59,109,17,0.35)',
            borderRadius: 10, padding: '10px 22px', marginBottom: explanation ? 12 : 28,
            color: '#4ade80', fontSize: 15, fontWeight: 600,
          }}>
            ✓ Riktig svar
          </div>
        ) : lastCorrect === false ? (
          <div style={{
            display: 'inline-block',
            background: 'rgba(201,76,76,0.10)', border: '1px solid rgba(201,76,76,0.25)',
            borderRadius: 10, padding: '10px 22px', marginBottom: explanation ? 12 : 28,
            color: '#e8e4dd', fontSize: 14,
          }}>
            Riktig svar var: <strong>{correctAnswerText}</strong>
          </div>
        ) : null}

        {/* Explanation */}
        {explanation && (
          <div style={{
            borderLeft: '3px solid #c9a84c',
            paddingLeft: 12,
            marginBottom: 28,
            textAlign: 'left',
          }}>
            <p style={{ fontSize: 14, color: '#e8e4dd', fontStyle: 'italic', lineHeight: 1.5 }}>
              {explanation}
            </p>
          </div>
        )}

        {/* Dynamic headline */}
        <h2 style={{
          fontFamily: "'Libre Baskerville', serif",
          fontSize: 28, fontWeight: 700, color: '#ffffff',
          lineHeight: 1.2, marginBottom: message.subline ? 10 : 20,
        }}>
          {message.headline}
        </h2>

        {message.subline && (
          <p style={{ fontSize: 14, color: '#e8e4dd', marginBottom: 20, lineHeight: 1.5 }}>
            {message.subline}
          </p>
        )}

        {/* Live ranking — gratis ser estimert spenn, Premium ser eksakt plassering */}
        {!isPremium && low !== null && high !== null && (
          <div style={{ marginBottom: 18 }}>
            <p style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.14em',
              textTransform: 'uppercase', color: '#7a7873', marginBottom: 6,
            }}>
              Din rangering
            </p>
            <p style={{
              fontFamily: "'Libre Baskerville', serif",
              fontSize: 34, fontWeight: 700, color: '#c9a84c', lineHeight: 1,
            }}>
              {low}–{high}
            </p>
          </div>
        )}

        {/* Premium: eksakt plassering som hovedelement, mini-leaderboard som støtte */}
        {isPremium && liveRanking && liveRanking.totalPlayers >= 2 && (
          <div style={{ marginBottom: 18 }}>
            <p style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.14em',
              textTransform: 'uppercase', color: '#7a7873', marginBottom: 6,
            }}>
              Din plassering
            </p>
            <p style={{
              fontFamily: "'Libre Baskerville', serif",
              fontSize: 34, fontWeight: 700, color: '#c9a84c', lineHeight: 1,
            }}>
              {liveRanking.userRank}.<span style={{ fontSize: 18, color: '#7a7873', fontWeight: 400 }}> plass</span>
            </p>
            <p style={{ fontSize: 13, color: '#7a7873', marginTop: 6 }}>
              av {liveRanking.totalPlayers} spillere så langt
            </p>

            {/* Mini-leaderboard — naboer rundt deg. "Du"-raden er hvit (ikke gull)
                så plasseringstallet over forblir det eneste gule elementet. */}
            <div style={{ marginTop: 14, lineHeight: 1.8 }}>
              {liveRanking.above && (
                <p style={{ fontSize: 13, color: '#7a7873', margin: 0 }}>
                  #{liveRanking.userRank - 1} {liveRanking.above.name} · {liveRanking.above.correct} riktige
                </p>
              )}
              <p style={{ fontSize: 14, color: '#ffffff', fontWeight: 600, margin: 0 }}>
                #{liveRanking.userRank} Du · {score} riktige
              </p>
              {liveRanking.below && (
                <p style={{ fontSize: 13, color: '#7a7873', margin: 0 }}>
                  #{liveRanking.userRank + 1} {liveRanking.below.name} · {liveRanking.below.correct} riktige
                </p>
              )}
            </div>
          </div>
        )}

        {/* Rival */}
        {rival && <RivalAvatar rival={rival} />}

        {/* Ranking context — computed from snapshot, no DB calls */}
        {rankingSnapshot && rankingSnapshot.totalPlayers >= 3 && (() => {
          const questionsLeft = totalQuestions - (questionIndex + 1)
          const isInTop10 = score >= rankingSnapshot.top10MinCorrect &&
            (rankingSnapshot.top10MinCorrect > 0 || rankingSnapshot.totalPlayers >= 2)
          const neededForTop10 = rankingSnapshot.top10MinCorrect - score

          if (isInTop10) {
            return (
              <p style={{ fontSize: 13, color: '#c9a84c', marginBottom: 16 }}>
                Du er i topp 10 akkurat nå — hold det gående
              </p>
            )
          }
          if (neededForTop10 > 0 && questionsLeft < 3) {
            return (
              <p style={{ fontSize: 13, color: '#e8e4dd', marginBottom: 16 }}>
                Du trenger {neededForTop10} riktige til for å komme inn i topp 10
              </p>
            )
          }
          if (rival && rival.score === score + 1) {
            return (
              <p style={{ fontSize: 13, color: '#7a7873', marginBottom: 16 }}>
                {rival.name} ligger ett hakk foran deg
              </p>
            )
          }
          return null
        })()}

        {/* Percentile hint — only when above median */}
        {scoreIsAboveMedian && percentileEntry && (
          <p style={{
            fontSize: 12, color: '#7a7873', marginBottom: 16,
          }}>
            Du er bedre enn {percentileEntry.percentile}% av deltakerne
          </p>
        )}

        {/* Score line */}
        {low === null && (
          <p style={{ fontSize: 13, color: '#7a7873', marginBottom: 24 }}>
            {score} av {totalQuestions} riktige
            {streak >= 2 ? ` · ${streak} på rad` : ''}
          </p>
        )}

        {/* Next question button */}
        <button
          onClick={onNext}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: '#c9a84c', color: '#1a1c23',
            fontFamily: "'Instrument Sans', sans-serif",
            fontSize: 15, fontWeight: 600,
            padding: '11px 28px',
            borderRadius: 10, border: 'none',
            cursor: 'pointer',
            transition: 'background 0.15s, transform 0.12s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#d9b85c'; e.currentTarget.style.transform = 'translateY(-1px)' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#c9a84c'; e.currentTarget.style.transform = 'none' }}
          onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.98)' }}
          onMouseUp={e => { e.currentTarget.style.transform = 'translateY(-1px)' }}
        >
          Neste spørsmål
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <path d="M3 2L11 7 3 12V2Z"/>
          </svg>
        </button>

      </div>
    </div>
  )
}
