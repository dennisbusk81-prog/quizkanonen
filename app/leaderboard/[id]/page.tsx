'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase, Quiz, Attempt } from '@/lib/supabase'
import { rankAttempts, getMedal } from '@/lib/ranking'
import Link from 'next/link'

export default function LeaderboardPage() {
  const params = useParams()
  const quizId = params.id as string
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      const { data: quizData } = await supabase.from('quizzes').select('*').eq('id', quizId).single()
      const { data: attemptData } = await supabase
        .from('attempts').select('*').eq('quiz_id', quizId).limit(200)
      setQuiz(quizData)
      setAttempts(attemptData || [])
      setLoading(false)
    }
    fetchData()
  }, [quizId])

  const isOpen = (q: Quiz) => {
    const now = new Date()
    return new Date(q.opens_at) <= now && new Date(q.closes_at) >= now
  }

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000)
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
  }

  if (loading) return (
    <div className="min-h-screen bg-blue-950 flex items-center justify-center">
      <p className="text-white text-xl animate-pulse">Laster leaderboard...</p>
    </div>
  )

  if (!quiz) return (
    <div className="min-h-screen bg-blue-950 flex items-center justify-center">
      <p className="text-white text-xl">Fant ikke quizen.</p>
    </div>
  )

  if (!quiz.show_leaderboard) return (
    <div className="min-h-screen bg-blue-950 flex items-center justify-center px-4">
      <div className="text-center">
        <p className="text-white text-xl">Leaderboard er ikke aktivert for denne quizen.</p>
        <Link href="/" className="text-blue-300 hover:text-white mt-4 block">← Tilbake</Link>
      </div>
    </div>
  )

  const isHidden = quiz.hide_leaderboard_until_closed && isOpen(quiz)
  const soloAttempts = rankAttempts(attempts.filter(a => !a.is_team))
  const teamAttempts = rankAttempts(attempts.filter(a => a.is_team))

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-950 via-blue-900 to-blue-800 px-4 py-8 sm:py-12">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-6 sm:mb-8">
          <Link href="/" className="text-blue-300 hover:text-white text-sm mb-4 inline-block">← Tilbake</Link>
          <h1 className="text-3xl sm:text-4xl font-black text-white">🏆 Leaderboard</h1>
          <p className="text-blue-200 mt-2 text-sm sm:text-base">{quiz?.title}</p>
        </div>

        {isHidden ? (
          <div className="bg-white/10 rounded-3xl p-8 text-center border border-white/20">
            <p className="text-6xl mb-4">🔒</p>
            <p className="text-white text-xl font-bold">Leaderboardet er skjult</p>
            <p className="text-blue-200 mt-2 text-sm">
              Vises når quizen stenger:<br />
              {new Date(quiz.closes_at).toLocaleString('no-NO')}
            </p>
            <Link href={`/quiz/${quizId}`}
              className="inline-block mt-6 bg-yellow-400 hover:bg-yellow-300 text-blue-950 font-black px-6 py-3 rounded-2xl transition-all">
              Spill quizen! 🎯
            </Link>
          </div>
        ) : attempts.length === 0 ? (
          <div className="bg-white/10 rounded-3xl p-8 text-center border border-white/20">
            <p className="text-white text-xl">Ingen resultater ennå.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Enkeltpersoner */}
            {soloAttempts.length > 0 && (
              <>
                <h2 className="text-white font-bold text-base sm:text-lg px-2">👤 Enkeltpersoner</h2>
                {soloAttempts.map((attempt) => (
                  <div key={attempt.id}
                    className={`rounded-2xl p-3 sm:p-4 border flex items-center gap-3 sm:gap-4 ${attempt.rank === 1 ? 'bg-yellow-400/20 border-yellow-400/40' : 'bg-white/10 border-white/20'}`}>
                    <span className="text-xl sm:text-2xl w-8 sm:w-10 text-center flex-shrink-0">
                      {attempt.isTied ? `${attempt.rank}.` : getMedal(attempt.rank)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-bold text-base sm:text-lg truncate">{attempt.player_name}</p>
                      <p className="text-blue-300 text-xs sm:text-sm">{formatTime(attempt.total_time_ms)} spilletid</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-yellow-400 font-black text-lg sm:text-xl">
                        {attempt.correct_answers}/{attempt.total_questions}
                      </p>
                      <p className="text-blue-300 text-xs">
                        {Math.round((attempt.correct_answers / attempt.total_questions) * 100)}%
                        {attempt.isTied && <span className="ml-1 text-yellow-400">delt</span>}
                      </p>
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* Lag */}
            {teamAttempts.length > 0 && (
              <>
                <h2 className="text-white font-bold text-base sm:text-lg px-2 mt-4">👥 Lag</h2>
                {teamAttempts.map((attempt) => (
                  <div key={attempt.id}
                    className={`rounded-2xl p-3 sm:p-4 border flex items-center gap-3 sm:gap-4 ${attempt.rank === 1 ? 'bg-yellow-400/20 border-yellow-400/40' : 'bg-white/10 border-white/20'}`}>
                    <span className="text-xl sm:text-2xl w-8 sm:w-10 text-center flex-shrink-0">
                      {attempt.isTied ? `${attempt.rank}.` : getMedal(attempt.rank)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-bold text-base sm:text-lg truncate">
                        {attempt.player_name}
                        <span className="text-blue-300 text-xs ml-2">({attempt.team_size} stk)</span>
                      </p>
                      <p className="text-blue-300 text-xs sm:text-sm">{formatTime(attempt.total_time_ms)} spilletid</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-yellow-400 font-black text-lg sm:text-xl">
                        {attempt.correct_answers}/{attempt.total_questions}
                      </p>
                      <p className="text-blue-300 text-xs">
                        {Math.round((attempt.correct_answers / attempt.total_questions) * 100)}%
                        {attempt.isTied && <span className="ml-1 text-yellow-400">delt</span>}
                      </p>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </main>
  )
}