'use client'
import { useEffect, useState } from 'react'

type TimeLeft = {
  dager: number
  timer: number
  minutter: number
  sekunder: number
}

function getTimeLeft(target: Date): TimeLeft {
  const diff = target.getTime() - Date.now()
  if (diff <= 0) return { dager: 0, timer: 0, minutter: 0, sekunder: 0 }
  return {
    dager: Math.floor(diff / (1000 * 60 * 60 * 24)),
    timer: Math.floor((diff / (1000 * 60 * 60)) % 24),
    minutter: Math.floor((diff / (1000 * 60)) % 60),
    sekunder: Math.floor((diff / 1000) % 60),
  }
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

export default function QuizCountdown({ initialDate }: { initialDate: string | null }) {
  const [target] = useState<Date | null>(() => (initialDate ? new Date(initialDate) : null))
  const [timeLeft, setTimeLeft] = useState<TimeLeft | null>(null)
  const [quizOpen, setQuizOpen] = useState(false)

  useEffect(() => {
    if (!target) return
    setTimeLeft(getTimeLeft(target))
    setQuizOpen(target.getTime() <= Date.now())
    const interval = setInterval(() => {
      setTimeLeft(getTimeLeft(target))
      setQuizOpen(target.getTime() <= Date.now())
    }, 1000)
    return () => clearInterval(interval)
  }, [target])

  if (!target) return null

  if (quizOpen) {
    return (
      <div style={{
        background: '#21242e',
        border: '1px solid #c9a84c44',
        borderRadius: '20px',
        padding: '1.5rem 2rem',
        textAlign: 'center',
        marginBottom: '2rem',
      }}>
        <p style={{ color: '#c9a84c', fontWeight: 700, fontSize: '1rem', marginBottom: '0.25rem' }}>
          🎯 Ukas quiz er åpen nå!
        </p>
        <p style={{ color: '#8a8d9a', fontSize: '0.875rem' }}>
          Bla ned og trykk Spill nå
        </p>
      </div>
    )
  }

  const dateStr = target.toLocaleDateString('no-NO', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
  const timeStr = target.toLocaleTimeString('no-NO', {
    hour: '2-digit', minute: '2-digit',
  })

  return (
    <div style={{
      background: '#21242e',
      border: '1px solid #2a2d38',
      borderRadius: '20px',
      padding: '1.75rem 2rem',
      marginBottom: '2rem',
      textAlign: 'center',
    }}>
      <p style={{
        color: '#c9a84c',
        fontSize: '0.75rem',
        fontWeight: 600,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        marginBottom: '0.75rem',
      }}>
        Neste quiz
      </p>

      {timeLeft && (
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginBottom: '1rem' }}>
          {[
            { label: 'Dager', value: timeLeft.dager },
            { label: 'Timer', value: timeLeft.timer },
            { label: 'Min', value: timeLeft.minutter },
            { label: 'Sek', value: timeLeft.sekunder },
          ].map(({ label, value }) => (
            <div key={label} style={{ textAlign: 'center' }}>
              <div style={{
                background: '#1a1c23',
                border: '1px solid #2a2d38',
                borderRadius: '12px',
                padding: '0.625rem 0.875rem',
                minWidth: '3.5rem',
              }}>
                <span style={{
                  color: '#e8e0d0',
                  fontSize: '1.75rem',
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                  fontFamily: "'Libre Baskerville', serif",
                }}>
                  {pad(value)}
                </span>
              </div>
              <p style={{ color: '#4a4d5a', fontSize: '0.7rem', marginTop: '0.375rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {label}
              </p>
            </div>
          ))}
        </div>
      )}

      <p style={{ color: '#8a8d9a', fontSize: '0.875rem' }}>
        {dateStr.charAt(0).toUpperCase() + dateStr.slice(1)} kl. {timeStr}
      </p>
    </div>
  )
}
