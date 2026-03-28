'use client'
import { useEffect, useState } from 'react'
import { supabase, Quiz } from '@/lib/supabase'
import Link from 'next/link'

export default function Home() {
  const [quizzes, setQuizzes] = useState<Quiz[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchQuizzes() {
      const now = new Date().toISOString()
      const { data } = await supabase
        .from('quizzes')
        .select('*')
        .eq('is_active', true)
        .lte('opens_at', now)
        .order('opens_at', { ascending: false })
      setQuizzes(data || [])
      setLoading(false)
    }
    fetchQuizzes()
  }, [])

  const isOpen = (quiz: Quiz) => {
    const now = new Date()
    return new Date(quiz.opens_at) <= now && new Date(quiz.closes_at) >= now
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-950 via-blue-900 to-blue-800">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-black text-white mb-2 tracking-tight">
            💥 Quizkanonen
          </h1>
          <p className="text-blue-200 text-lg">Ukentlig quiz — hvem er best?</p>
        </div>

        {loading ? (
          <div className="text-center text-blue-200 text-xl animate-pulse">Laster quizer...</div>
        ) : quizzes.length === 0 ? (
          <div className="bg-blue-800/50 rounded-2xl p-8 text-center">
            <p className="text-blue-200 text-xl">Ingen aktive quizer akkurat nå.</p>
            <p className="text-blue-300 mt-2">Kom tilbake på fredag! 🎯</p>
          </div>
        ) : (
          <div className="space-y-4">
            {quizzes.map(quiz => (
              <div key={quiz.id} className="bg-white/10 backdrop-blur rounded-2xl p-6 border border-white/20">
                <div className="flex items-start justify-between mb-3">
                  <h2 className="text-2xl font-bold text-white">{quiz.title}</h2>
                  <span className={`px-3 py-1 rounded-full text-sm font-semibold ${isOpen(quiz) ? 'bg-green-500 text-white' : 'bg-gray-500 text-white'}`}>
                    {isOpen(quiz) ? '🟢 Åpen' : '🔒 Stengt'}
                  </span>
                </div>
                <p className="text-blue-200 mb-4">{quiz.description}</p>

                {/* Innstillinger vist til bruker */}
                <div className="flex flex-wrap gap-2 mb-4">
                  <span className="text-xs bg-white/10 text-blue-200 px-2 py-1 rounded-full">
                    ⏱️ {quiz.time_limit_seconds}s per spørsmål
                  </span>
                  {quiz.allow_teams && (
                    <span className="text-xs bg-white/10 text-blue-200 px-2 py-1 rounded-full">
                      👥 Lag tillatt
                    </span>
                  )}
                  {quiz.show_live_placement && (
                    <span className="text-xs bg-white/10 text-blue-200 px-2 py-1 rounded-full">
                      📊 Live plassering
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  {isOpen(quiz) ? (
                    <Link href={`/quiz/${quiz.id}`}
                      className="bg-yellow-400 hover:bg-yellow-300 text-blue-950 font-black px-6 py-3 rounded-xl text-lg transition-all transform hover:scale-105">
                      Spill nå! 🎯
                    </Link>
                  ) : (
                    quiz.show_leaderboard ? (
                      <Link href={`/leaderboard/${quiz.id}`}
                        className="bg-white/20 hover:bg-white/30 text-white font-bold px-6 py-3 rounded-xl transition-all">
                        Se leaderboard 🏆
                      </Link>
                    ) : (
                      <span className="text-blue-400 text-sm">Leaderboard ikke tilgjengelig</span>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="text-center mt-12 text-blue-400 text-sm">
          <p>Quizkanonen © 2025</p>
        </div>
      </div>
    </main>
  )
}
