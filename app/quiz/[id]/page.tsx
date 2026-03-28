'use client'
import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { supabase, Quiz, Question } from '@/lib/supabase'
import { calculateStreak } from '@/lib/ranking'

type PlayerInfo = { name: string; isTeam: boolean; teamSize: number; ageConfirmed: boolean }
type AnswerRecord = { questionId: string; selectedAnswer: string | null; isCorrect: boolean; timeMs: number }

// Generer en anonym ID for denne enheten (lagres i localStorage)
function getDeviceId(): string {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem('qk_device_id')
  if (!id) {
    id = 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
    localStorage.setItem('qk_device_id', id)
  }
  return id
}

export default function QuizPage() {
  const params = useParams()
  const quizId = params.id as string

  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [phase, setPhase] = useState<'register' | 'playing' | 'finished' | 'already_played'>('register')
  const [playerInfo, setPlayerInfo] = useState<PlayerInfo>({ name: '', isTeam: false, teamSize: 1, ageConfirmed: false })
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<AnswerRecord[]>([])
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null)
  const [answered, setAnswered] = useState(false)
  const [timeLeft, setTimeLeft] = useState(30)
  const [questionStartTime, setQuestionStartTime] = useState(0)
  const [totalTimeMs, setTotalTimeMs] = useState(0)
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nameInput, setNameInput] = useState('')
  const [isTeamInput, setIsTeamInput] = useState(false)
  const [teamSizeInput, setTeamSizeInput] = useState(2)
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [liveRank, setLiveRank] = useState<number | null>(null)
  const [resumeData, setResumeData] = useState<{ index: number; answers: AnswerRecord[]; totalTime: number } | null>(null)

  useEffect(() => {
    async function fetchData() {
      const { data: quizData } = await supabase.from('quizzes').select('*').eq('id', quizId).single()

      // Sjekk om enheten allerede har spilt
      const deviceId = getDeviceId()
      const { data: played } = await supabase
        .from('played_log')
        .select('id')
        .eq('quiz_id', quizId)
        .eq('identifier', deviceId)
        .single()

      if (played) {
        setPhase('already_played')
        setQuiz(quizData)
        setLoading(false)
        return
      }

      // Sjekk om det finnes delvis fullført quiz i localStorage
      const savedProgress = localStorage.getItem(`qk_progress_${quizId}`)
      if (savedProgress) {
        try {
          const parsed = JSON.parse(savedProgress)
          setResumeData(parsed)
        } catch {}
      }

      let qData: Question[] = []
      if (quizData?.randomize_questions) {
        const { data } = await supabase.from('questions').select('*').eq('quiz_id', quizId)
        qData = (data || []).sort(() => Math.random() - 0.5)
      } else {
        const { data } = await supabase.from('questions').select('*').eq('quiz_id', quizId).order('order_index')
        qData = data || []
      }

      setQuiz(quizData)
      setQuestions(qData)
      setLoading(false)
    }
    fetchData()
  }, [quizId])

  const getTimeLimit = useCallback((question: Question) => {
    return question.time_limit_seconds || quiz?.time_limit_seconds || 30
  }, [quiz])

  // Lagre fremgang til localStorage (for gjenopptak ved internett-brudd)
  const saveProgress = useCallback((index: number, currentAnswers: AnswerRecord[], time: number) => {
    localStorage.setItem(`qk_progress_${quizId}`, JSON.stringify({
      index, answers: currentAnswers, totalTime: time
    }))
  }, [quizId])

  // Timer
  useEffect(() => {
    if (phase !== 'playing' || answered || questions.length === 0) return
    if (timeLeft <= 0) { handleTimeout(); return }
    const timer = setTimeout(() => setTimeLeft(t => t - 1), 1000)
    return () => clearTimeout(timer)
  }, [phase, answered, timeLeft, currentIndex, questions])

  const handleTimeout = useCallback(() => {
    const question = questions[currentIndex]
    const timeMs = getTimeLimit(question) * 1000
    const record: AnswerRecord = { questionId: question.id, selectedAnswer: null, isCorrect: false, timeMs }
    const newAnswers = [...answers, record]
    setAnswers(newAnswers)
    setTotalTimeMs(prev => prev + timeMs)
    setAnswered(true)
    saveProgress(currentIndex, newAnswers, totalTimeMs + timeMs)
  }, [questions, currentIndex, getTimeLimit, answers, totalTimeMs, saveProgress])

  const fetchLiveRank = useCallback(async (correctSoFar: number, timeSoFar: number) => {
    if (!quiz?.show_live_placement) return
    const { data } = await supabase.from('attempts').select('correct_answers, total_time_ms').eq('quiz_id', quizId)
    if (!data) return
    const better = data.filter(a =>
      a.correct_answers > correctSoFar ||
      (a.correct_answers === correctSoFar && a.total_time_ms < timeSoFar)
    )
    setLiveRank(better.length + 1)
  }, [quiz, quizId])

  const startQuiz = async () => {
    if (!nameInput.trim() || !ageConfirmed) return
    const info: PlayerInfo = { name: nameInput.trim(), isTeam: isTeamInput, teamSize: isTeamInput ? teamSizeInput : 1, ageConfirmed: true }
    setPlayerInfo(info)

    const { data } = await supabase.from('attempts').insert({
      quiz_id: quizId, player_name: info.name, is_team: info.isTeam,
      team_size: info.teamSize, total_questions: questions.length,
      correct_answers: 0, total_time_ms: 0
    }).select().single()

    setAttemptId(data?.id || null)

    // Gjenoppta hvis det finnes lagret fremgang
    if (resumeData) {
      setCurrentIndex(resumeData.index)
      setAnswers(resumeData.answers)
      setTotalTimeMs(resumeData.totalTime)
      setTimeLeft(getTimeLimit(questions[resumeData.index]))
    } else {
      setTimeLeft(getTimeLimit(questions[0]))
    }

    setQuestionStartTime(Date.now())
    setPhase('playing')
  }

  const handleAnswer = async (answer: string) => {
    if (answered) return
    const question = questions[currentIndex]
    const timeMs = Date.now() - questionStartTime
    const isCorrect = answer === question.correct_answer
    const record: AnswerRecord = { questionId: question.id, selectedAnswer: answer, isCorrect, timeMs }
    const newAnswers = [...answers, record]
    const newTime = totalTimeMs + timeMs
    setAnswers(newAnswers)
    setTotalTimeMs(newTime)
    setSelectedAnswer(answer)
    setAnswered(true)
    saveProgress(currentIndex, newAnswers, newTime)
    if (quiz?.show_live_placement) {
      const correct = newAnswers.filter(a => a.isCorrect).length
      await fetchLiveRank(correct, newTime)
    }
  }

  const goToNext = async () => {
    const isLast = currentIndex === questions.length - 1
    if (isLast) {
      await finishQuiz()
    } else {
      const nextIndex = currentIndex + 1
      setCurrentIndex(nextIndex)
      setAnswered(false)
      setSelectedAnswer(null)
      setTimeLeft(getTimeLimit(questions[nextIndex]))
      setQuestionStartTime(Date.now())
    }
  }

  const finishQuiz = async () => {
    const correct = answers.filter(a => a.isCorrect).length
    const streak = calculateStreak(answers.map(a => ({ is_correct: a.isCorrect })))
    const deviceId = getDeviceId()

    if (attemptId) {
      await supabase.from('attempts').update({
        correct_answers: correct,
        total_time_ms: totalTimeMs,
        correct_streak: streak
      }).eq('id', attemptId)

      for (const ans of answers) {
        await supabase.from('attempt_answers').insert({
          attempt_id: attemptId, question_id: ans.questionId,
          selected_answer: ans.selectedAnswer, is_correct: ans.isCorrect, time_ms: ans.timeMs
        })
      }

      // Marker som spilt — hindrer dobbeltspilling
      await supabase.from('played_log').insert({
        quiz_id: quizId, identifier: deviceId
      })
    }

    // Slett lagret fremgang
    localStorage.removeItem(`qk_progress_${quizId}`)
    setPhase('finished')
  }

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000)
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
  }

  const optionKeys: Record<string, keyof Question> = {
    A: 'option_a', B: 'option_b', C: 'option_c', D: 'option_d'
  }

  const optionColor = (opt: string) => {
    if (!answered) return 'bg-white/10 hover:bg-white/20 active:bg-white/30 border-white/20 cursor-pointer'
    const question = questions[currentIndex]
    if (opt === question?.correct_answer) return 'bg-green-500/80 border-green-400'
    if (opt === selectedAnswer) return 'bg-red-500/80 border-red-400'
    return 'bg-white/5 border-white/10 opacity-50'
  }

  if (loading) return (
    <div className="min-h-screen bg-blue-950 flex items-center justify-center px-4">
      <p className="text-white text-xl animate-pulse">Laster quiz...</p>
    </div>
  )

  if (!quiz) return (
    <div className="min-h-screen bg-blue-950 flex items-center justify-center px-4">
      <p className="text-white text-xl text-center">Fant ikke quizen.</p>
    </div>
  )

  // ALLEREDE SPILT
  if (phase === 'already_played') return (
    <main className="min-h-screen bg-gradient-to-br from-blue-950 via-blue-900 to-blue-800 flex items-center justify-center px-4">
      <div className="bg-white/10 backdrop-blur rounded-3xl p-8 w-full max-w-md border border-white/20 text-center">
        <div className="text-6xl mb-4">🔒</div>
        <h1 className="text-2xl font-black text-white mb-3">Du har allerede spilt denne quizen!</h1>
        <p className="text-blue-200 mb-6">Kun én gjennomspilling per quiz er tillatt. Kom tilbake neste fredag for en ny quiz!</p>
        {quiz.show_leaderboard && (
          <a href={`/leaderboard/${quizId}`}
            className="block w-full bg-yellow-400 hover:bg-yellow-300 text-blue-950 font-black py-3 rounded-2xl transition-all mb-3">
            🏆 Se leaderboard
          </a>
        )}
        <a href="/" className="block text-blue-300 hover:text-white transition-colors">← Tilbake til forsiden</a>
      </div>
    </main>
  )

  // REGISTRERING
  if (phase === 'register') return (
    <main className="min-h-screen bg-gradient-to-br from-blue-950 via-blue-900 to-blue-800 flex items-center justify-center px-4 py-8">
      <div className="bg-white/10 backdrop-blur rounded-3xl p-6 sm:p-8 w-full max-w-md border border-white/20">
        <h1 className="text-3xl sm:text-4xl font-black text-white text-center mb-1">💥 Quizkanonen</h1>
        <h2 className="text-lg sm:text-xl text-blue-200 text-center mb-6">{quiz.title}</h2>

        {resumeData && (
          <div className="bg-yellow-400/20 border border-yellow-400/30 rounded-2xl p-3 mb-4 text-center">
            <p className="text-yellow-300 text-sm font-semibold">
              🔄 Vi fant en påbegynt quiz — du kan fortsette der du slapp!
            </p>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="text-blue-200 text-sm font-semibold mb-2 block">Navn / Lagnavn</label>
            <input
              type="text"
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              placeholder="Skriv inn navn her..."
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-blue-300 text-base sm:text-lg focus:outline-none focus:border-yellow-400"
              onKeyDown={e => e.key === 'Enter' && startQuiz()}
            />
          </div>

          {quiz.allow_teams && (
            <>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setIsTeamInput(!isTeamInput)}
                  className={`w-12 h-6 rounded-full transition-all flex-shrink-0 ${isTeamInput ? 'bg-yellow-400' : 'bg-white/20'}`}
                >
                  <div className={`w-5 h-5 bg-white rounded-full transition-all transform ${isTeamInput ? 'translate-x-6' : 'translate-x-0.5'}`} />
                </button>
                <span className="text-blue-200 text-sm sm:text-base">Vi spiller som lag 👥</span>
              </div>
              {isTeamInput && (
                <div>
                  <label className="text-blue-200 text-sm font-semibold mb-2 block">Antall på laget</label>
                  <div className="flex gap-2">
                    {[2, 3, 4, 5, 6].map(n => (
                      <button key={n} onClick={() => setTeamSizeInput(n)}
                        className={`flex-1 py-2 rounded-xl font-bold transition-all text-sm ${teamSizeInput === n ? 'bg-yellow-400 text-blue-950' : 'bg-white/10 text-white'}`}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Aldersbekreftelse */}
          <div
            onClick={() => setAgeConfirmed(!ageConfirmed)}
            className="flex items-start gap-3 cursor-pointer group"
          >
            <div className={`w-5 h-5 rounded flex-shrink-0 mt-0.5 border-2 flex items-center justify-center transition-all ${ageConfirmed ? 'bg-yellow-400 border-yellow-400' : 'border-white/40 group-hover:border-yellow-400'}`}>
              {ageConfirmed && <span className="text-blue-950 text-xs font-black">✓</span>}
            </div>
            <span className="text-blue-200 text-sm leading-snug">
              Jeg bekrefter at jeg er 13 år eller eldre og godtar{' '}
              <a href="/personvern" className="text-yellow-400 underline" onClick={e => e.stopPropagation()}>
                personvernerklæringen
              </a>
            </span>
          </div>

          <button
            onClick={startQuiz}
            disabled={!nameInput.trim() || !ageConfirmed}
            className="w-full bg-yellow-400 hover:bg-yellow-300 active:bg-yellow-500 disabled:opacity-40 disabled:cursor-not-allowed text-blue-950 font-black text-lg sm:text-xl py-4 rounded-2xl transition-all transform hover:scale-105 active:scale-95"
          >
            {resumeData ? 'Fortsett quiz! 🔄' : 'Start quiz! 🎯'}
          </button>
        </div>

        <p className="text-blue-400 text-xs sm:text-sm text-center mt-4">
          ⏱️ Maks {quiz.time_limit_seconds} sekunder per spørsmål · Kun én gjennomspilling
        </p>
      </div>
    </main>
  )

  // SPILL
  if (phase === 'playing') {
    const question = questions[currentIndex]
    const limit = getTimeLimit(question)
    const timerPercent = (timeLeft / limit) * 100
    const timerColor = timerPercent > 50 ? 'bg-green-400' : timerPercent > 25 ? 'bg-yellow-400' : 'bg-red-400'
    const correctSoFar = answers.filter(a => a.isCorrect).length
    const availableOptions = ['A', 'B', 'C', 'D'].slice(0, quiz.num_options)

    return (
      <main className="min-h-screen bg-gradient-to-br from-blue-950 via-blue-900 to-blue-800 flex items-start sm:items-center justify-center px-4 py-4 sm:py-8">
        <div className="w-full max-w-lg">

          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-blue-200 text-sm sm:text-base font-semibold">
              {currentIndex + 1} / {questions.length}
            </span>
            <div className="flex items-center gap-2 sm:gap-3">
              {quiz.show_live_placement && liveRank && (
                <span className="text-yellow-400 font-bold text-xs sm:text-sm">📊 #{liveRank}</span>
              )}
              <span className={`text-xl sm:text-2xl font-black ${timeLeft <= 5 ? 'text-red-400 animate-pulse' : 'text-white'}`}>
                ⏱️ {timeLeft}s
              </span>
            </div>
          </div>

          {/* Timer bar */}
          <div className="w-full bg-white/10 rounded-full h-2 mb-2">
            <div className={`h-2 rounded-full transition-all duration-1000 ${timerColor}`} style={{ width: `${timerPercent}%` }} />
          </div>

          <div className="text-right text-blue-300 text-xs sm:text-sm mb-3">
            ✅ {correctSoFar} riktige så langt
          </div>

          {/* Spørsmål */}
          <div className="bg-white/10 backdrop-blur rounded-2xl sm:rounded-3xl p-4 sm:p-6 border border-white/20 mb-3 sm:mb-4">
            <p className="text-white text-lg sm:text-2xl font-bold leading-relaxed">
              {question?.question_text}
            </p>
          </div>

          {/* Svaralternativer */}
          <div className="grid grid-cols-1 gap-2 sm:gap-3 mb-3 sm:mb-4">
            {availableOptions.map(opt => (
              <button
                key={opt}
                onClick={() => handleAnswer(opt)}
                disabled={answered}
                className={`w-full p-3 sm:p-4 rounded-xl sm:rounded-2xl border-2 text-left transition-all ${optionColor(opt)}`}
              >
                <span className="text-yellow-400 font-black mr-2 sm:mr-3 text-sm sm:text-base">{opt}</span>
                <span className="text-white font-semibold text-sm sm:text-base">
                  {question?.[optionKeys[opt]] as string}
                </span>
              </button>
            ))}
          </div>

          {/* Etter svar */}
          {answered && (
            <div className="space-y-2 sm:space-y-3">
              {quiz.show_answer_explanation && question?.explanation && (
                <div className="bg-blue-800/50 rounded-xl sm:rounded-2xl p-3 sm:p-4 border border-blue-500/30">
                  <p className="text-blue-200 text-xs sm:text-sm">💡 {question.explanation}</p>
                </div>
              )}
              <button
                onClick={goToNext}
                className="w-full bg-yellow-400 hover:bg-yellow-300 active:bg-yellow-500 text-blue-950 font-black text-lg sm:text-xl py-3 sm:py-4 rounded-xl sm:rounded-2xl transition-all transform hover:scale-105 active:scale-95"
              >
                {currentIndex === questions.length - 1 ? 'Se resultatet! 🏆' : 'Neste spørsmål →'}
              </button>
            </div>
          )}
        </div>
      </main>
    )
  }

  // RESULTAT
  const correctCount = answers.filter(a => a.isCorrect).length
  const percentage = Math.round((correctCount / questions.length) * 100)
  const streak = calculateStreak(answers.map(a => ({ is_correct: a.isCorrect })))
  const shareText = `Jeg fikk ${correctCount}/${questions.length} (${percentage}%) på ${quiz.title} på Quizkanonen! 🎯 Klarer du bedre?`

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-950 via-blue-900 to-blue-800 flex items-center justify-center px-4 py-8">
      <div className="bg-white/10 backdrop-blur rounded-3xl p-6 sm:p-8 w-full max-w-md border border-white/20 text-center">
        <div className="text-5xl sm:text-6xl mb-4">
          {percentage >= 80 ? '🏆' : percentage >= 60 ? '🎯' : percentage >= 40 ? '💪' : '📚'}
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-white mb-1">
          {playerInfo.name}
          {playerInfo.isTeam && <span className="text-blue-300 text-base ml-2">({playerInfo.teamSize} stk)</span>}
        </h1>
        <p className="text-blue-200 mb-6 text-sm sm:text-base">{quiz.title}</p>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="bg-white/10 rounded-2xl p-3 sm:p-4">
            <p className="text-2xl sm:text-3xl font-black text-yellow-400">{correctCount}/{questions.length}</p>
            <p className="text-blue-300 text-xs mt-1">Riktige svar</p>
          </div>
          <div className="bg-white/10 rounded-2xl p-3 sm:p-4">
            <p className="text-2xl sm:text-3xl font-black text-green-400">{percentage}%</p>
            <p className="text-blue-300 text-xs mt-1">Score</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="bg-white/10 rounded-2xl p-3 sm:p-4">
            <p className="text-2xl sm:text-3xl font-black text-blue-300">{formatTime(totalTimeMs)}</p>
            <p className="text-blue-300 text-xs mt-1">Total spilletid</p>
          </div>
          <div className="bg-white/10 rounded-2xl p-3 sm:p-4">
            <p className="text-2xl sm:text-3xl font-black text-purple-300">{streak}</p>
            <p className="text-blue-300 text-xs mt-1">Beste streak</p>
          </div>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => {
              if (navigator.share) {
                navigator.share({ text: shareText, url: window.location.origin })
              } else {
                navigator.clipboard.writeText(shareText + ' ' + window.location.origin)
                alert('Kopiert! Lim inn og del 😊')
              }
            }}
            className="w-full bg-blue-500 hover:bg-blue-400 active:bg-blue-600 text-white font-bold py-3 rounded-2xl transition-all"
          >
            📤 Del resultatet
          </button>
          {quiz.show_leaderboard && (
            <a href={`/leaderboard/${quizId}`}
              className="block w-full bg-yellow-400 hover:bg-yellow-300 text-blue-950 font-black py-3 rounded-2xl transition-all">
              🏆 Se leaderboard
            </a>
          )}
          <a href="/" className="block text-blue-300 hover:text-white transition-colors text-sm mt-2">
            ← Tilbake til forsiden
          </a>
        </div>
      </div>
    </main>
  )
}