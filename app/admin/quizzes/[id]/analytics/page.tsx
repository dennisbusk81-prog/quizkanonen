'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { isAdminLoggedIn } from '@/lib/admin-auth'
import { supabase, Quiz, Question } from '@/lib/supabase'
import Link from 'next/link'

type AttemptRow = {
  id: string
  correct_answers: number
  total_questions: number
  total_time_ms: number
  completed_at: string
  is_team: boolean
}

type AnswerRow = {
  question_id: string
  is_correct: boolean
  selected_answer: string | null
  time_ms: number
}

type QuestionStat = {
  question: Question
  total_answers: number
  correct_answers: number
  correct_pct: number
  avg_time_ms: number
  option_counts: Record<string, number>
}

export default function QuizAnalytics() {
  const params = useParams()
  const router = useRouter()
  const quizId = params.id as string

  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [attempts, setAttempts] = useState<AttemptRow[]>([])
  const [answers, setAnswers] = useState<AnswerRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isAdminLoggedIn()) { router.push('/admin/login'); return }
    fetchData()
  }, [])

  async function fetchData() {
    const [
      { data: quizData },
      { data: questionData },
      { data: attemptData },
    ] = await Promise.all([
      supabase.from('quizzes').select('*').eq('id', quizId).single(),
      supabase.from('questions').select('*').eq('quiz_id', quizId).order('order_index'),
      supabase.from('attempts').select('*').eq('quiz_id', quizId),
    ])

    setQuiz(quizData)
    setQuestions(questionData || [])
    setAttempts(attemptData || [])

    const ids = (attemptData || []).map((a: { id: string }) => a.id)
    if (ids.length > 0) {
      const { data: answerData } = await supabase
        .from('attempt_answers')
        .select('question_id, is_correct, selected_answer, time_ms')
        .in('attempt_id', ids)
      setAnswers(answerData || [])
    }

    setLoading(false)
  }

  const totalStarts = attempts.length
  const avgScore = totalStarts > 0
    ? Math.round(attempts.reduce((sum, a) => sum + (a.correct_answers / a.total_questions) * 100, 0) / totalStarts)
    : 0
  const avgTimeSec = totalStarts > 0
    ? Math.round(attempts.reduce((sum, a) => sum + a.total_time_ms, 0) / totalStarts / 1000)
    : 0
  const soloCount = attempts.filter(a => !a.is_team).length
  const teamCount = attempts.filter(a => a.is_team).length

  const questionStats: QuestionStat[] = questions.map(q => {
    const qAnswers = answers.filter(a => a.question_id === q.id)
    const correct = qAnswers.filter(a => a.is_correct).length
    const total = qAnswers.length
    const avgTime = total > 0 ? Math.round(qAnswers.reduce((s, a) => s + a.time_ms, 0) / total / 1000) : 0
    const option_counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 }
    qAnswers.forEach(a => {
      if (a.selected_answer && option_counts[a.selected_answer] !== undefined) {
        option_counts[a.selected_answer]++
      }
    })
    return {
      question: q,
      total_answers: total,
      correct_answers: correct,
      correct_pct: total > 0 ? Math.round((correct / total) * 100) : 0,
      avg_time_ms: avgTime,
      option_counts,
    }
  })

  const formatTime = (sec: number) => sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`

  const difficultyColor = (pct: number) => {
    if (pct >= 70) return 'text-green-400'
    if (pct >= 40) return 'text-yellow-400'
    return 'text-red-400'
  }

  const difficultyLabel = (pct: number) => {
    if (pct >= 70) return 'Lett'
    if (pct >= 40) return 'Middels'
    return 'Vanskelig'
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-white animate-pulse">Laster analytics...</p>
    </div>
  )

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <Link href={`/admin/quizzes/${quizId}/questions`}
            className="text-gray-400 hover:text-white text-sm mb-2 inline-block">← Tilbake til spørsmål</Link>
          <h1 className="text-2xl font-black text-white">📊 Analytics</h1>
          <p className="text-gray-400 text-sm mt-1">{quiz?.title}</p>
        </div>

        {totalStarts === 0 ? (
          <div className="bg-gray-900 rounded-2xl p-8 text-center border border-gray-800">
            <p className="text-gray-400 text-lg">Ingen har spilt denne quizen ennå.</p>
            <p className="text-gray-500 text-sm mt-2">Analytics vises her når spillere har fullført quizen.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
              {[
                { label: 'Gjennomspillinger', value: totalStarts, icon: '🎮' },
                { label: 'Gjennomsnittsscore', value: `${avgScore}%`, icon: '🎯' },
                { label: 'Gjennomsnittlig tid', value: formatTime(avgTimeSec), icon: '⏱️' },
                { label: 'Enkeltspillere', value: soloCount, icon: '👤' },
                { label: 'Lag', value: teamCount, icon: '👥' },
              ].map(stat => (
                <div key={stat.label} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                  <p className="text-xl mb-1">{stat.icon}</p>
                  <p className="text-2xl font-black text-white">{stat.value}</p>
                  <p className="text-gray-400 text-xs mt-1">{stat.label}</p>
                </div>
              ))}
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-6">
              <h2 className="text-white font-bold mb-4">Scorefordeling</h2>
              <div className="space-y-2">
                {[
                  { label: '80–100%', min: 0.8, max: 1.01, color: 'bg-green-500' },
                  { label: '60–79%', min: 0.6, max: 0.8, color: 'bg-yellow-500' },
                  { label: '40–59%', min: 0.4, max: 0.6, color: 'bg-orange-500' },
                  { label: '0–39%', min: 0, max: 0.4, color: 'bg-red-500' },
                ].map(bucket => {
                  const count = attempts.filter(a => {
                    const pct = a.correct_answers / a.total_questions
                    return pct >= bucket.min && pct < bucket.max
                  }).length
                  const pct = totalStarts > 0 ? Math.round((count / totalStarts) * 100) : 0
                  return (
                    <div key={bucket.label} className="flex items-center gap-3">
                      <span className="text-gray-400 text-xs w-16 flex-shrink-0">{bucket.label}</span>
                      <div className="flex-1 bg-gray-800 rounded-full h-4 overflow-hidden">
                        <div className={`h-full ${bucket.color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-gray-300 text-xs w-16 text-right flex-shrink-0">{count} ({pct}%)</span>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <h2 className="text-white font-bold mb-4">Statistikk per spørsmål</h2>
              <div className="space-y-4">
                {questionStats.map((qs, idx) => {
                  const numOpts = quiz?.num_options || 4
                  const opts = ['A', 'B', 'C', 'D'].slice(0, numOpts)
                  const maxCount = Math.max(...opts.map(o => qs.option_counts[o] || 0), 1)
                  return (
                    <div key={qs.question.id} className="border border-gray-800 rounded-xl p-4">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-gray-500 text-xs mb-1">Spørsmål {idx + 1}</p>
                          <p className="text-white text-sm font-semibold leading-snug">{qs.question.question_text}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className={`text-2xl font-black ${difficultyColor(qs.correct_pct)}`}>{qs.correct_pct}%</p>
                          <p className={`text-xs ${difficultyColor(qs.correct_pct)}`}>{difficultyLabel(qs.correct_pct)}</p>
                          <p className="text-gray-500 text-xs mt-1">⏱️ {qs.avg_time_ms}s snitt</p>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        {opts.map(opt => {
                          const optKey = opt === 'A' ? 'option_a' : opt === 'B' ? 'option_b' : opt === 'C' ? 'option_c' : 'option_d'
                          const label = qs.question[optKey as keyof Question] as string
                          if (!label) return null
                          const count = qs.option_counts[opt] || 0
                          const pct = qs.total_answers > 0 ? Math.round((count / qs.total_answers) * 100) : 0
                          const isCorrect = qs.question.correct_answer === opt
                          return (
                            <div key={opt} className="flex items-center gap-2">
                              <span className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-black ${isCorrect ? 'bg-green-500 text-white' : 'bg-gray-700 text-gray-300'}`}>{opt}</span>
                              <div className="flex-1 bg-gray-800 rounded-full h-3 overflow-hidden">
                                <div className={`h-full rounded-full ${isCorrect ? 'bg-green-500' : 'bg-gray-600'}`}
                                  style={{ width: `${(count / maxCount) * 100}%` }} />
                              </div>
                              <span className="text-gray-400 text-xs w-24 flex-shrink-0 truncate">{label}</span>
                              <span className="text-gray-300 text-xs w-12 text-right flex-shrink-0">{count} ({pct}%)</span>
                            </div>
                          )
                        })}
                      </div>
                      {qs.total_answers === 0 && (
                        <p className="text-gray-600 text-xs mt-2">Ingen svar registrert ennå.</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  )
}