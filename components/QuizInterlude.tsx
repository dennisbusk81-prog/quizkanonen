'use client'

import { useMemo } from 'react'
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

interface QuizInterludeProps {
  phase: 'in' | 'out'
  lastCorrect: boolean | null
  correctAnswerText: string | null
  score: number               // correct answers so far
  totalQuestions: number
  streak: number
  wrongInARow: number
  questionIndex: number       // 0-based index of question just answered
  low: number | null          // estimated rank range
  high: number | null
  rival: RivalData | null
  percentileData: PercentileEntry[]
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
  score,
  totalQuestions,
  streak,
  wrongInARow,
  questionIndex,
  low,
  high,
  rival,
  percentileData,
  onNext,
}: QuizInterludeProps) {
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
        padding: '0 32px',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 360, width: '100%' }}>

        {/* Previous question result pill */}
        {lastCorrect === true ? (
          <div style={{
            display: 'inline-block',
            background: 'rgba(59,109,17,0.15)', border: '1px solid rgba(59,109,17,0.35)',
            borderRadius: 10, padding: '10px 22px', marginBottom: 28,
            color: '#4caf7d', fontSize: 15, fontWeight: 600,
          }}>
            ✓ Riktig svar
          </div>
        ) : lastCorrect === false ? (
          <div style={{
            display: 'inline-block',
            background: 'rgba(201,76,76,0.10)', border: '1px solid rgba(201,76,76,0.25)',
            borderRadius: 10, padding: '10px 22px', marginBottom: 28,
            color: '#e8e4dd', fontSize: 14,
          }}>
            Riktig svar var: <strong>{correctAnswerText}</strong>
          </div>
        ) : null}

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

        {/* Live ranking */}
        {low !== null && high !== null && (
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

        {/* Rival */}
        {rival && <RivalAvatar rival={rival} />}

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
            background: '#c9a84c', color: '#0f0f10',
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
