'use client'
import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { supabase, supabaseData, Quiz, Question } from '@/lib/supabase'
import { calculateStreak } from '@/lib/ranking'

type PlayerInfo = { name: string; isTeam: boolean; teamSize: number; ageConfirmed: boolean }
type AnswerRecord = { questionId: string; selectedAnswer: string | null; isCorrect: boolean; timeMs: number }

function getDeviceId(): string {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem('qk_device_id')
  if (!id) {
    id = 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
    localStorage.setItem('qk_device_id', id)
  }
  return id
}

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:      #1a1c23;
    --card:    #21242e;
    --border:  #2a2d38;
    --gold:    #c9a84c;
    --white:   #ffffff;
    --body:    #9a9590;
    --muted:   #6a6860;
    --green:   #4caf7d;
    --red:     #c94c4c;
    --rcard:   20px;
    --rbtn:    10px;
  }

  body {
    background: var(--bg);
    font-family: 'Instrument Sans', sans-serif;
    color: var(--body);
    min-height: 100vh;
  }

  .qk-shell {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 20px;
  }

  .qk-box { width: 100%; max-width: 480px; }

  .qk-panel {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--rcard);
    padding: 36px 32px;
  }

  @media (max-width: 480px) {
    .qk-panel { padding: 28px 22px; }
  }

  .qk-eyebrow {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--gold);
    margin-bottom: 10px;
  }

  .qk-heading {
    font-family: 'Libre Baskerville', serif;
    font-size: 26px;
    font-weight: 700;
    color: var(--white);
    line-height: 1.2;
    letter-spacing: -0.01em;
    margin-bottom: 6px;
  }

  .qk-sub {
    font-size: 14px;
    color: var(--muted);
    line-height: 1.5;
    margin-bottom: 28px;
  }

  .qk-divider { height: 1px; background: var(--border); margin: 24px 0; }

  .qk-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 8px;
    display: block;
  }

  .qk-input {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--rbtn);
    padding: 13px 16px;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 15px;
    color: var(--white);
    outline: none;
    transition: border-color 0.15s;
    margin-bottom: 20px;
  }

  .qk-input::placeholder { color: var(--muted); }
  .qk-input:focus { border-color: rgba(201,168,76,0.5); }

  .qk-toggle-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
    cursor: pointer;
  }

  .qk-toggle {
    width: 44px;
    height: 24px;
    border-radius: 12px;
    background: var(--border);
    position: relative;
    flex-shrink: 0;
    transition: background 0.2s;
  }

  .qk-toggle.on { background: var(--gold); }

  .qk-toggle-thumb {
    width: 18px;
    height: 18px;
    background: var(--white);
    border-radius: 50%;
    position: absolute;
    top: 3px;
    left: 3px;
    transition: transform 0.2s;
  }

  .qk-toggle.on .qk-toggle-thumb { transform: translateX(20px); }
  .qk-toggle-label { font-size: 14px; color: var(--body); }

  .qk-sizes { display: flex; gap: 8px; margin-bottom: 20px; }

  .qk-size-btn {
    flex: 1;
    padding: 8px 4px;
    border-radius: var(--rbtn);
    font-family: 'Instrument Sans', sans-serif;
    font-size: 14px;
    font-weight: 600;
    background: var(--bg);
    color: var(--muted);
    border: 1px solid var(--border);
    cursor: pointer;
    transition: all 0.15s;
  }

  .qk-size-btn.active {
    background: rgba(201,168,76,0.12);
    color: var(--gold);
    border-color: rgba(201,168,76,0.35);
  }

  .qk-check-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    cursor: pointer;
    margin-bottom: 24px;
  }

  .qk-check-box {
    width: 20px;
    height: 20px;
    border-radius: 6px;
    border: 1.5px solid var(--border);
    flex-shrink: 0;
    margin-top: 1px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
    background: var(--bg);
  }

  .qk-check-box.checked { background: var(--gold); border-color: var(--gold); }
  .qk-check-text { font-size: 13px; color: var(--muted); line-height: 1.5; }
  .qk-check-text a { color: var(--gold); text-decoration: underline; }

  .qk-btn-primary {
    width: 100%;
    background: var(--gold);
    color: #0f0f10;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 15px;
    font-weight: 600;
    padding: 14px;
    border-radius: var(--rbtn);
    border: none;
    cursor: pointer;
    transition: background 0.15s, transform 0.12s, opacity 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    text-decoration: none;
  }

  .qk-btn-primary:hover:not(:disabled) { background: #d9b85c; transform: translateY(-1px); }
  .qk-btn-primary:active:not(:disabled) { transform: scale(0.98); }
  .qk-btn-primary:disabled { opacity: 0.35; cursor: not-allowed; }

  .qk-btn-secondary {
    width: 100%;
    background: transparent;
    color: var(--body);
    font-family: 'Instrument Sans', sans-serif;
    font-size: 14px;
    font-weight: 500;
    padding: 12px;
    border-radius: var(--rbtn);
    border: 1px solid var(--border);
    cursor: pointer;
    transition: all 0.15s;
    text-decoration: none;
    display: block;
    text-align: center;
  }

  .qk-btn-secondary:hover { border-color: rgba(201,168,76,0.3); color: var(--white); }

  .qk-btn-ghost {
    display: block;
    text-align: center;
    font-size: 13px;
    color: var(--muted);
    text-decoration: none;
    padding: 10px 0;
    transition: color 0.15s;
    cursor: pointer;
    background: none;
    border: none;
    width: 100%;
  }

  .qk-btn-ghost:hover { color: var(--gold); }

  .qk-banner {
    background: rgba(201,168,76,0.08);
    border: 1px solid rgba(201,168,76,0.2);
    border-radius: var(--rbtn);
    padding: 12px 16px;
    margin-bottom: 24px;
    font-size: 13px;
    color: var(--gold);
    line-height: 1.5;
  }

  .qk-hint {
    font-size: 12px;
    color: var(--muted);
    text-align: center;
    margin-top: 16px;
    line-height: 1.6;
  }

  /* PLAYING */
  .qk-play-shell {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    padding: 20px;
    max-width: 560px;
    margin: 0 auto;
  }

  .qk-play-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
    padding-top: 8px;
  }

  .qk-progress-text {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .qk-timer {
    font-family: 'Libre Baskerville', serif;
    font-size: 22px;
    font-weight: 700;
    color: var(--white);
    transition: color 0.3s;
    min-width: 52px;
    text-align: right;
  }

  .qk-timer.urgent { color: var(--red); }

  .qk-timer-bar-wrap {
    background: var(--border);
    border-radius: 4px;
    height: 3px;
    margin-bottom: 20px;
    overflow: hidden;
  }

  .qk-timer-bar { height: 3px; border-radius: 4px; transition: width 1s linear, background-color 0.5s; }

  .qk-score-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }

  .qk-score-pill {
    font-size: 12px;
    font-weight: 600;
    color: var(--green);
    background: rgba(76,175,125,0.1);
    border: 1px solid rgba(76,175,125,0.2);
    padding: 4px 10px;
    border-radius: 20px;
  }

  .qk-rank-pill {
    font-size: 12px;
    font-weight: 600;
    color: var(--gold);
    background: rgba(201,168,76,0.1);
    border: 1px solid rgba(201,168,76,0.2);
    padding: 4px 10px;
    border-radius: 20px;
  }

  .qk-question-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--rcard);
    padding: 28px 24px;
    margin-bottom: 14px;
  }

  .qk-question-text {
    font-family: 'Libre Baskerville', serif;
    font-size: 19px;
    font-weight: 400;
    color: var(--white);
    line-height: 1.5;
  }

  @media (max-width: 400px) { .qk-question-text { font-size: 17px; } }

  .qk-options { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }

  .qk-option {
    display: flex;
    align-items: center;
    gap: 14px;
    background: var(--card);
    border: 1.5px solid var(--border);
    border-radius: var(--rcard);
    padding: 14px 18px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s, transform 0.1s;
    text-align: left;
    width: 100%;
  }

  .qk-option:hover:not(:disabled) { border-color: rgba(201,168,76,0.4); transform: translateX(3px); }
  .qk-option:disabled { cursor: default; }
  .qk-option.correct { background: rgba(76,175,125,0.1); border-color: var(--green); }
  .qk-option.wrong { background: rgba(201,76,76,0.1); border-color: var(--red); opacity: 0.7; }
  .qk-option.idle { opacity: 0.4; }

  .qk-opt-letter {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--bg);
    border: 1.5px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    color: var(--muted);
    flex-shrink: 0;
    transition: all 0.15s;
  }

  .qk-option.correct .qk-opt-letter { background: var(--green); border-color: var(--green); color: #fff; }
  .qk-option.wrong .qk-opt-letter { background: var(--red); border-color: var(--red); color: #fff; }

  .qk-opt-text { font-size: 14px; font-weight: 500; color: var(--white); line-height: 1.4; }

  .qk-explanation {
    background: rgba(201,168,76,0.06);
    border: 1px solid rgba(201,168,76,0.15);
    border-radius: var(--rbtn);
    padding: 12px 16px;
    font-size: 13px;
    color: var(--body);
    line-height: 1.6;
    margin-bottom: 12px;
  }

  /* RESULT */
  .qk-result-icon { font-size: 52px; margin-bottom: 16px; display: block; text-align: center; }

  .qk-stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }

  .qk-stat {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--rbtn);
    padding: 16px 14px;
    text-align: center;
  }

  .qk-stat-value {
    font-family: 'Libre Baskerville', serif;
    font-size: 24px;
    font-weight: 700;
    color: var(--white);
    line-height: 1;
    margin-bottom: 5px;
  }

  .qk-stat-value.gold { color: var(--gold); }
  .qk-stat-value.green { color: var(--green); }
  .qk-stat-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; }

  /* LOADING */
  .qk-loading { min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .qk-loading-dot {
    width: 6px; height: 6px; background: var(--gold); border-radius: 50%;
    animation: qkpulse 1.2s ease-in-out infinite; margin: 0 3px; display: inline-block;
  }
  .qk-loading-dot:nth-child(2) { animation-delay: 0.2s; }
  .qk-loading-dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes qkpulse {
    0%, 100% { opacity: 0.2; transform: scale(0.8); }
    50%       { opacity: 1;   transform: scale(1.2); }
  }
`

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
  const [nextQuizAt, setNextQuizAt] = useState<string | null>(null)
  const [estimatedPlacement, setEstimatedPlacement] = useState<{ low: number; high: number; total: number } | null>(null)

  useEffect(() => {
    async function fetchData() {
      const { data: quizData } = await supabaseData.from('quizzes').select('*').eq('id', quizId).single()
      const deviceId = getDeviceId()
      const { data: played } = await supabaseData
        .from('played_log').select('id')
        .eq('quiz_id', quizId).eq('identifier', deviceId).single()

      if (played) {
        setPhase('already_played')
        setQuiz(quizData)
        const { data: setting } = await supabaseData.from('site_settings').select('value').eq('key', 'next_quiz_at').single()
        if (setting?.value) setNextQuizAt(setting.value)
        setLoading(false)
        return
      }

      const savedProgress = localStorage.getItem(`qk_progress_${quizId}`)
      if (savedProgress) { try { setResumeData(JSON.parse(savedProgress)) } catch {} }

      let qData: Question[] = []
      if (quizData?.randomize_questions) {
        const { data } = await supabaseData.from('questions').select('*').eq('quiz_id', quizId)
        qData = (data || []).sort(() => Math.random() - 0.5)
      } else {
        const { data } = await supabaseData.from('questions').select('*').eq('quiz_id', quizId).order('order_index')
        qData = data || []
      }

      setQuiz(quizData); setQuestions(qData); setLoading(false)
    }
    fetchData()
  }, [quizId])

  const getTimeLimit = useCallback((question: Question) =>
    question.time_limit_seconds || quiz?.time_limit_seconds || 30, [quiz])

  const saveProgress = useCallback((index: number, currentAnswers: AnswerRecord[], time: number) => {
    localStorage.setItem(`qk_progress_${quizId}`, JSON.stringify({ index, answers: currentAnswers, totalTime: time }))
  }, [quizId])

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
    setAnswers(newAnswers); setTotalTimeMs(prev => prev + timeMs)
    setAnswered(true); saveProgress(currentIndex, newAnswers, totalTimeMs + timeMs)
  }, [questions, currentIndex, getTimeLimit, answers, totalTimeMs, saveProgress])

  const fetchLiveRank = useCallback(async (correctSoFar: number, timeSoFar: number) => {
    if (!quiz?.show_live_placement) return
    const { data } = await supabaseData.from('attempts').select('correct_answers, total_time_ms').eq('quiz_id', quizId)
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
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const { data } = await supabaseData.from('attempts').insert({
        quiz_id: quizId, player_name: info.name, is_team: info.isTeam,
        team_size: info.teamSize, total_questions: questions.length, correct_answers: 0, total_time_ms: 0,
        user_id: session?.user?.id ?? null,
      }).select().single()
      setAttemptId(data?.id || null)
      if (resumeData) {
        setCurrentIndex(resumeData.index); setAnswers(resumeData.answers)
        setTotalTimeMs(resumeData.totalTime); setTimeLeft(getTimeLimit(questions[resumeData.index]))
      } else {
        setTimeLeft(getTimeLimit(questions[0]))
      }
      setQuestionStartTime(Date.now()); setPhase('playing')
    } catch {
      setPlayerInfo({ name: '', isTeam: false, teamSize: 1, ageConfirmed: false })
    }
  }

  const handleAnswer = async (answer: string) => {
    if (answered) return
    const question = questions[currentIndex]
    const timeMs = Date.now() - questionStartTime
    const isCorrect = answer === question.correct_answer
    const record: AnswerRecord = { questionId: question.id, selectedAnswer: answer, isCorrect, timeMs }
    const newAnswers = [...answers, record]
    const newTime = totalTimeMs + timeMs
    setAnswers(newAnswers); setTotalTimeMs(newTime)
    setSelectedAnswer(answer); setAnswered(true)
    saveProgress(currentIndex, newAnswers, newTime)
    if (quiz?.show_live_placement) {
      await fetchLiveRank(newAnswers.filter(a => a.isCorrect).length, newTime)
    }
  }

  const goToNext = async () => {
    if (currentIndex === questions.length - 1) {
      await finishQuiz()
    } else {
      const nextIndex = currentIndex + 1
      setCurrentIndex(nextIndex); setAnswered(false); setSelectedAnswer(null)
      setTimeLeft(getTimeLimit(questions[nextIndex])); setQuestionStartTime(Date.now())
    }
  }

  const finishQuiz = async () => {
    const correct = answers.filter(a => a.isCorrect).length
    const streak = calculateStreak(answers.map(a => ({ is_correct: a.isCorrect })))
    const deviceId = getDeviceId()
    try {
      if (attemptId) {
        await supabaseData.from('attempts').update({ correct_answers: correct, total_time_ms: totalTimeMs, correct_streak: streak }).eq('id', attemptId)
        for (const ans of answers) {
          await supabaseData.from('attempt_answers').insert({
            attempt_id: attemptId, question_id: ans.questionId,
            selected_answer: ans.selectedAnswer, is_correct: ans.isCorrect, time_ms: ans.timeMs
          })
        }
        await supabaseData.from('played_log').insert({ quiz_id: quizId, identifier: deviceId })
      }
      localStorage.removeItem(`qk_progress_${quizId}`)
      localStorage.setItem(`qk_result_${quizId}`, JSON.stringify({ correct_answers: correct, total_time_ms: totalTimeMs }))
      const { data: allAttempts } = await supabaseData
        .from('attempts')
        .select('correct_answers, total_time_ms')
        .eq('quiz_id', quizId)
      if (allAttempts && allAttempts.length > 0) {
        const total = allAttempts.length
        const better = allAttempts.filter(a =>
          a.correct_answers > correct ||
          (a.correct_answers === correct && a.total_time_ms < totalTimeMs)
        ).length
        const strictlyWorse = allAttempts.filter(a =>
          a.correct_answers < correct ||
          (a.correct_answers === correct && a.total_time_ms > totalTimeMs)
        ).length
        setEstimatedPlacement({ low: better + 1, high: total - strictlyWorse, total })
      }
    } catch {}
    finally {
      setPhase('finished')
    }
  }

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000)
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
  }

  const optionKeys: Record<string, keyof Question> = { A: 'option_a', B: 'option_b', C: 'option_c', D: 'option_d' }

  if (loading) return (
    <><style>{styles}</style>
    <div className="qk-loading">
      <span className="qk-loading-dot"/><span className="qk-loading-dot"/><span className="qk-loading-dot"/>
    </div></>
  )

  if (!quiz) return (
    <><style>{styles}</style>
    <div className="qk-shell"><div className="qk-box"><div className="qk-panel" style={{textAlign:'center'}}>
      <p style={{color:'var(--muted)',fontSize:14}}>Fant ikke quizen.</p>
      <a href="/" style={{color:'var(--gold)',fontSize:13,marginTop:16,display:'block'}}>← Tilbake</a>
    </div></div></div></>
  )

  // ALLEREDE SPILT
  if (phase === 'already_played') {
    const nextDate = nextQuizAt ? new Date(nextQuizAt) : null
    const nextDateStr = nextDate
      ? nextDate.toLocaleString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
      : null
    return (
      <><style>{styles}</style>
      <div className="qk-shell"><div className="qk-box"><div className="qk-panel" style={{textAlign:'center'}}>
        <span className="qk-result-icon">🔒</span>
        <p className="qk-eyebrow" style={{textAlign:'center'}}>Allerede fullført</p>
        <h1 className="qk-heading" style={{textAlign:'center',marginBottom:8}}>Du har spilt denne quizen</h1>
        <p className="qk-sub" style={{textAlign:'center'}}>Én gjennomspilling per quiz.</p>
        {nextDateStr && (
          <div style={{
            margin:'16px 0 0',
            padding:'12px 16px',
            background:'rgba(201,168,76,0.08)',
            border:'1px solid rgba(201,168,76,0.2)',
            borderRadius:10,
            fontSize:13,
            color:'var(--gold)',
          }}>
            Neste quiz: <strong>{nextDateStr}</strong>
          </div>
        )}
        <div className="qk-divider"/>
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {quiz.show_leaderboard && (
            <a href={`/leaderboard/${quizId}`} className="qk-btn-primary">Se topplisten</a>
          )}
          <a href="/" className="qk-btn-ghost">← Tilbake til forsiden</a>
        </div>
      </div></div></div></>
    )
  }

  // REGISTRERING
  if (phase === 'register') return (
    <><style>{styles}</style>
    <div className="qk-shell"><div className="qk-box"><div className="qk-panel">
      <p className="qk-eyebrow">Quizkanonen</p>
      <h1 className="qk-heading">{quiz.title}</h1>
      <p className="qk-sub">Fyll inn navn og trykk start. Lykke til!</p>

      {resumeData && (
        <div className="qk-banner">🔄 Vi fant en påbegynt quiz — du fortsetter der du slapp.</div>
      )}

      <label className="qk-label">Navn / Lagnavn</label>
      <input type="text" value={nameInput} onChange={e => setNameInput(e.target.value)}
        placeholder="Skriv inn navn..." className="qk-input"
        onKeyDown={e => e.key === 'Enter' && startQuiz()} autoFocus />

      {quiz.allow_teams && (
        <>
          <div className="qk-toggle-row" onClick={() => setIsTeamInput(!isTeamInput)}>
            <div className={`qk-toggle${isTeamInput ? ' on' : ''}`}>
              <div className="qk-toggle-thumb"/>
            </div>
            <span className="qk-toggle-label">Vi spiller som lag</span>
          </div>
          {isTeamInput && (
            <>
              <label className="qk-label">Antall på laget</label>
              <div className="qk-sizes">
                {[2,3,4,5,6].map(n => (
                  <button key={n} onClick={() => setTeamSizeInput(n)}
                    className={`qk-size-btn${teamSizeInput === n ? ' active' : ''}`}>{n}</button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <div className="qk-check-row" onClick={() => setAgeConfirmed(!ageConfirmed)}>
        <div className={`qk-check-box${ageConfirmed ? ' checked' : ''}`}>
          {ageConfirmed && (
            <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
              <path d="M1 4L4 7L10 1" stroke="#0f0f10" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </div>
        <span className="qk-check-text">
          Jeg er 13 år eller eldre og godtar{' '}
          <a href="/personvern" onClick={e => e.stopPropagation()}>personvernerklæringen</a>
        </span>
      </div>

      <button onClick={startQuiz} disabled={!nameInput.trim() || !ageConfirmed} className="qk-btn-primary">
        {resumeData ? 'Fortsett quiz' : 'Start quiz'}
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3 2L11 7 3 12V2Z"/></svg>
      </button>

      <p className="qk-hint">{quiz.time_limit_seconds}s per spørsmål · Kun én gjennomspilling</p>
    </div></div></div></>
  )

  // SPILL
  if (phase === 'playing') {
    const question = questions[currentIndex]
    const limit = getTimeLimit(question)
    const timerPercent = (timeLeft / limit) * 100
    const timerColor = timerPercent > 50 ? 'var(--green)' : timerPercent > 25 ? 'var(--gold)' : 'var(--red)'
    const correctSoFar = answers.filter(a => a.isCorrect).length
    const availableOptions = ['A','B','C','D'].slice(0, quiz.num_options)

    const getOptionClass = (opt: string) => {
      if (!answered) return ''
      if (opt === question?.correct_answer) return ' correct'
      if (opt === selectedAnswer) return ' wrong'
      return ' idle'
    }

    return (
      <><style>{styles}</style>
      <div className="qk-play-shell">
        <div className="qk-play-header">
          <span className="qk-progress-text">{currentIndex + 1} / {questions.length}</span>
          <span className={`qk-timer${timeLeft <= 5 ? ' urgent' : ''}`}>{timeLeft}s</span>
        </div>

        <div className="qk-timer-bar-wrap">
          <div className="qk-timer-bar" style={{width:`${timerPercent}%`,background:timerColor}}/>
        </div>

        <div className="qk-score-row">
          <span className="qk-score-pill">✓ {correctSoFar} riktige</span>
          {quiz.show_live_placement && liveRank && <span className="qk-rank-pill">#{liveRank}</span>}
        </div>

        <div className="qk-question-card">
          <p className="qk-question-text">{question?.question_text}</p>
        </div>

        <div className="qk-options">
          {availableOptions.map(opt => (
            <button key={opt} onClick={() => handleAnswer(opt)} disabled={answered}
              className={`qk-option${getOptionClass(opt)}`}>
              <span className="qk-opt-letter">{opt}</span>
              <span className="qk-opt-text">{question?.[optionKeys[opt]] as string}</span>
            </button>
          ))}
        </div>

        {answered && (
          <div>
            {quiz.show_answer_explanation && question?.explanation && (
              <div className="qk-explanation">💡 {question.explanation}</div>
            )}
            <button onClick={goToNext} className="qk-btn-primary">
              {currentIndex === questions.length - 1 ? 'Se resultatet' : 'Neste spørsmål'}
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3 2L11 7 3 12V2Z"/></svg>
            </button>
          </div>
        )}
      </div></>
    )
  }

  // RESULTAT
  const correctCount = answers.filter(a => a.isCorrect).length
  const percentage = Math.round((correctCount / questions.length) * 100)
  const streak = calculateStreak(answers.map(a => ({ is_correct: a.isCorrect })))
  const shareText = `Jeg fikk ${correctCount}/${questions.length} (${percentage}%) på ${quiz.title} på Quizkanonen! 🎯 Klarer du bedre?`

  return (
    <><style>{styles}</style>
    <div className="qk-shell"><div className="qk-box"><div className="qk-panel" style={{textAlign:'center'}}>
      <span className="qk-result-icon">
        {percentage >= 80 ? '🏆' : percentage >= 60 ? '🎯' : percentage >= 40 ? '💪' : '📚'}
      </span>
      <p className="qk-eyebrow" style={{textAlign:'center'}}>Resultat</p>
      <h1 className="qk-heading" style={{textAlign:'center'}}>
        {playerInfo.name}
      </h1>
      <p style={{fontSize:13,color:'var(--muted)',marginBottom:24}}>{quiz.title}</p>

      <div className="qk-stat-grid">
        <div className="qk-stat">
          <div className="qk-stat-value gold">{correctCount}/{questions.length}</div>
          <div className="qk-stat-label">Riktige svar</div>
        </div>
        <div className="qk-stat">
          <div className="qk-stat-value green">{percentage}%</div>
          <div className="qk-stat-label">Score</div>
        </div>
        <div className="qk-stat">
          <div className="qk-stat-value">{formatTime(totalTimeMs)}</div>
          <div className="qk-stat-label">Spilletid</div>
        </div>
        <div className="qk-stat">
          <div className="qk-stat-value">{streak}</div>
          <div className="qk-stat-label">Beste streak</div>
        </div>
      </div>

      <div className="qk-divider"/>

      {estimatedPlacement && (
        <div style={{marginBottom:16}}>
          <div style={{
            background:'rgba(201,168,76,0.08)',
            border:'1px solid rgba(201,168,76,0.2)',
            borderRadius:10,
            padding:'14px 16px',
            textAlign:'center',
            marginBottom:12,
          }}>
            <div style={{fontSize:11,fontWeight:600,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--muted)',marginBottom:6}}>
              Estimert plassering
            </div>
            <div style={{fontFamily:'Libre Baskerville, serif',fontSize:22,fontWeight:700,color:'var(--gold)',marginBottom:2}}>
              {estimatedPlacement.total <= 10
                ? `Mellom plass 1 og ${estimatedPlacement.total}`
                : (() => {
                    const tierStart = Math.floor((estimatedPlacement.low - 1) / 10) * 10 + 1
                    const rangeX = Math.max(1, tierStart)
                    const rangeY = Math.min(estimatedPlacement.total, tierStart + 9)
                    return `Mellom plass ${rangeX} og ${rangeY}`
                  })()}
            </div>
            <div style={{fontSize:12,color:'var(--muted)'}}>av {estimatedPlacement.total} deltakere</div>
          </div>

          <div style={{
            display:'flex',
            alignItems:'center',
            gap:10,
            padding:'12px 16px',
            background:'rgba(255,255,255,0.03)',
            border:'1px solid rgba(255,255,255,0.07)',
            borderRadius:10,
            opacity:0.5,
            cursor:'not-allowed',
            userSelect:'none',
          }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908C16.658 14.131 17.64 11.862 17.64 9.2z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
              <path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.962L3.964 6.294C4.672 4.169 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            <span style={{fontSize:14,color:'var(--body)',flex:1}}>Logg inn med Google</span>
          </div>
        </div>
      )}

      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        <button onClick={() => {
          if (navigator.share) {
            navigator.share({ text: shareText, url: window.location.origin })
          } else {
            navigator.clipboard.writeText(shareText + ' ' + window.location.origin)
            alert('Kopiert! Lim inn og del 😊')
          }
        }} className="qk-btn-secondary">Del resultatet 📤</button>

        {quiz.show_leaderboard && (
          <a href={`/leaderboard/${quizId}`} className="qk-btn-primary">Se topplisten</a>
        )}

        <a href="/" className="qk-btn-ghost">← Tilbake til forsiden</a>
      </div>
    </div></div></div></>
  )
}