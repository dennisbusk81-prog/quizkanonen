'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { supabase, supabaseData, Quiz, Question } from '@/lib/supabase'
import { calculateStreak } from '@/lib/ranking'
import QuizInterlude from '@/components/QuizInterlude'

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
    --body:     #e8e4dd;
    --muted:   #7a7873;
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
    color: var(--body);
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

  .qk-sizes { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }

  .qk-size-btn {
    flex: 1;
    padding: 6px 14px;
    border-radius: var(--rbtn);
    font-family: 'Instrument Sans', sans-serif;
    font-size: 13px;
    font-weight: 600;
    background: transparent;
    color: var(--muted);
    border: 0.5px solid #3a3d4a;
    cursor: pointer;
    transition: all 0.15s;
  }

  .qk-size-btn.active {
    background: #c9a84c;
    color: #1a1c23;
    border-color: #c9a84c;
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
  .qk-check-text { font-size: 13px; color: var(--body); line-height: 1.5; }
  .qk-check-text a { color: var(--gold); text-decoration: underline; }

  .qk-btn-primary {
    width: 100%;
    background: var(--gold);
    color: #0f0f10;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 15px;
    font-weight: 600;
    padding: 11px;
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
    padding: 10px;
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
    font-size: 20px;
    font-weight: 700;
    color: var(--white);
    transition: color 0.3s;
    text-align: center;
    display: block;
    margin-bottom: 6px;
  }

  .qk-timer.urgent { color: var(--red); }

  .qk-timer-bar-wrap {
    background: var(--border);
    border-radius: 4px;
    height: 4px;
    margin-bottom: 20px;
    overflow: hidden;
  }

  .qk-timer-bar { height: 4px; border-radius: 4px; transition: width 1s linear, background-color 0.5s; }

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
    border-radius: 16px;
    padding: 28px 24px;
    margin-bottom: 14px;
  }

  .qk-question-text {
    font-family: 'Libre Baskerville', serif;
    font-size: 18px;
    font-weight: 400;
    color: #ffffff;
    line-height: 1.5;
  }

  @media (max-width: 400px) { .qk-question-text { font-size: 16px; } }

  .qk-options { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }

  .qk-option {
    display: flex;
    align-items: center;
    gap: 14px;
    background: var(--card);
    border: 0.5px solid #3a3d4a;
    border-radius: var(--rcard);
    padding: 14px 16px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    text-align: left;
    width: 100%;
  }

  .qk-option:hover:not(:disabled) { border-color: #4a4d5a; background: #262930; }
  .qk-option:disabled { cursor: default; }
  @keyframes qkcorrectpulse {
    0%   { transform: scale(1); }
    50%  { transform: scale(1.02); }
    100% { transform: scale(1); }
  }

  .qk-option.correct { background: rgba(76,175,125,0.1); border-color: var(--green); animation: qkcorrectpulse 300ms ease-out; }
  .qk-option.wrong { background: rgba(201,76,76,0.1); border-color: var(--red); opacity: 0.7; }
  .qk-option.idle { opacity: 0.4; }

  .qk-opt-letter {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: #2a2d38;
    border: 1.5px solid #3a3d4a;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    color: #e8e4dd;
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
    color: #c9a84c;
    line-height: 1;
    margin-bottom: 5px;
  }

  .qk-stat-label { font-size: 11px; color: #7a7873; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 400; }

  @keyframes qkstreakfade {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .qk-streak-badge {
    font-size: 12px;
    font-weight: 700;
    color: #c9a84c;
    text-align: center;
    margin-bottom: 10px;
    animation: qkstreakfade 300ms ease-out;
  }

  /* ANIMATION: question slide-in */
  @keyframes questionIn {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .qk-animate-in {
    animation: questionIn 200ms ease-out both;
  }

  /* ANIMATION: timer pulse when urgent */
  @keyframes timerPulse {
    0%   { transform: scale(1); }
    50%  { transform: scale(1.05); }
    100% { transform: scale(1); }
  }
  .qk-timer.pulse { animation: timerPulse 600ms ease-in-out infinite; }

  /* ANIMATION: intermediate screen fade */
  @keyframes qkFadeIn  { from { opacity: 0; } to { opacity: 1; } }
  @keyframes qkFadeOut { from { opacity: 1; } to { opacity: 0; } }
  .qk-intermediate-in  { animation: qkFadeIn  150ms ease-out both; }
  .qk-intermediate-out { animation: qkFadeOut 250ms ease-in  both; }

  /* SOCIAL PROOF */
  .qk-social-proof-wrap {
    background: rgba(201,168,76,0.04);
    border: 0.5px solid rgba(201,168,76,0.15);
    border-radius: 12px;
    padding: 12px 16px;
    margin: 16px 0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 10px;
  }

  .qk-social-proof-dot {
    width: 6px;
    height: 6px;
    background: var(--gold);
    border-radius: 50%;
    flex-shrink: 0;
    animation: qkpulse 2s ease-in-out infinite;
  }

  .qk-social-proof-pills {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
  }

  @media (max-width: 480px) {
    .qk-social-proof-wrap { flex-direction: column; gap: 8px; }
  }

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
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [loggedInUserId, setLoggedInUserId] = useState<string | null>(null)
  const [loggedInDisplayName, setLoggedInDisplayName] = useState<string | null>(null)
  const [ageAlreadyConfirmed, setAgeAlreadyConfirmed] = useState(false)
  const [ligaBox, setLigaBox] = useState<{ type: 'liga'; name: string; slug: string } | { type: 'multi' } | { type: 'cta' } | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [isPremium, setIsPremium] = useState(false)
  const [shareResultCopied, setShareResultCopied] = useState(false)
  const [nameConflict, setNameConflict] = useState(false)
  const [questionKey, setQuestionKey] = useState(0)
  const [interPhase, setInterPhase] = useState<'hidden' | 'in' | 'out'>('hidden')
  const [interLow, setInterLow] = useState<number | null>(null)
  const [interHigh, setInterHigh] = useState<number | null>(null)
  const [interQLeft, setInterQLeft] = useState(0)
  const [interLastCorrect, setInterLastCorrect] = useState<boolean | null>(null)
  const [interCorrectAnswerText, setInterCorrectAnswerText] = useState<string | null>(null)
  const [interScore, setInterScore] = useState(0)
  const [interStreak, setInterStreak] = useState(0)
  const [interWrongInARow, setInterWrongInARow] = useState(0)
  const [interNextQNum, setInterNextQNum] = useState(1)
  const [pendingNextIndex, setPendingNextIndex] = useState<number | null>(null)
  const [rivalData, setRivalData] = useState<{ name: string; avatarColor: string; score: number } | null>(null)
  const [percentileData, setPercentileData] = useState<Array<{ score: number; percentile: number }>>([])
  const [socialProof, setSocialProof] = useState<{ totalPlayers: number; sampleNames: string[] } | null>(null)
  const questionCardRef      = useRef<HTMLDivElement | null>(null)
  const scoreBadgeRef        = useRef<HTMLSpanElement | null>(null)
  const streakBadgeRef       = useRef<HTMLDivElement | null>(null)
  const animationTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setIsLoggedIn(!!session)
      if (session?.user) {
        setLoggedInUserId(session.user.id)
        const { data: prof } = await supabaseData
          .from('profiles')
          .select('display_name, age_confirmed_at, premium_status')
          .eq('id', session.user.id)
          .maybeSingle()
        const name = prof?.display_name ?? session.user.email?.split('@')[0] ?? ''
        if (name) { setNameInput(name); setLoggedInDisplayName(name) }
        setIsPremium(prof?.premium_status === true)
        if (prof?.age_confirmed_at) {
          setAgeAlreadyConfirmed(true)
          setAgeConfirmed(true)
        }
      }
    })
  }, [])

  useEffect(() => {
    async function fetchData() {
      // Social proof hentes parallelt — ikke-blokkerende
      fetch(`/api/quiz/social-proof?quizId=${quizId}`)
        .then(r => r.ok ? r.json() : { totalPlayers: 0, sampleNames: [] })
        .then(d => setSocialProof(d))
        .catch(() => {})

      const { data: quizData, error: quizError } = await supabaseData.from('quizzes').select('*').eq('id', quizId).single()
      if (quizError) console.error('Quiz fetch feilet:', quizError)
      const deviceId = getDeviceId()
      const { data: played, error: playedError } = await supabaseData
        .from('played_log').select('id')
        .eq('quiz_id', quizId).eq('identifier', deviceId).single()
      if (playedError && playedError.code !== 'PGRST116') console.error('played_log fetch feilet:', playedError)

      if (played) {
        setPhase('already_played')
        setQuiz(quizData)
        const { data: setting, error: settingError } = await supabaseData.from('site_settings').select('value').eq('key', 'next_quiz_at').single()
        if (settingError && settingError.code !== 'PGRST116') console.error('site_settings fetch feilet:', settingError)
        if (setting?.value) setNextQuizAt(setting.value)
        setLoading(false)
        return
      }

      const savedProgress = localStorage.getItem(`qk_progress_${quizId}`)
      if (savedProgress) { try { setResumeData(JSON.parse(savedProgress)) } catch {} }

      let qData: Question[] = []
      if (quizData?.randomize_questions) {
        const { data, error: qError } = await supabaseData.from('questions').select('*').eq('quiz_id', quizId)
        if (qError) console.error('Questions fetch feilet:', qError)
        qData = (data || []).sort(() => Math.random() - 0.5)
      } else {
        const { data, error: qError } = await supabaseData.from('questions').select('*').eq('quiz_id', quizId).order('order_index')
        if (qError) console.error('Questions fetch feilet:', qError)
        qData = data || []
      }

      setQuiz(quizData); setQuestions(qData); setLoading(false)
    }
    fetchData()
  }, [quizId])

  useEffect(() => {
    if (phase !== 'finished') return
    supabaseData.from('site_settings').select('value').eq('key', 'next_quiz_at').single()
      .then(({ data: setting }) => { if (setting?.value) setNextQuizAt(setting.value) })
  }, [phase])

  useEffect(() => {
    if (phase !== 'finished' || !isLoggedIn) return
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.access_token) return
      try {
        const res = await fetch('/api/leagues', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!res.ok) return
        const json = await res.json()
        const leagues: { name: string; slug: string }[] = json.leagues ?? []
        if (leagues.length === 0) {
          setLigaBox({ type: 'cta' })
        } else if (leagues.length === 1) {
          setLigaBox({ type: 'liga', name: leagues[0].name, slug: leagues[0].slug })
        } else {
          setLigaBox({ type: 'multi' })
        }
      } catch { /* ikke kritisk */ }
    })
  }, [phase, isLoggedIn])

  useEffect(() => {
    return () => {
      animationTimeoutsRef.current.forEach(clearTimeout)
      document.body.style.backgroundColor = ''
      document.body.style.transition = ''
      document.getElementById('qk-glow-overlay')?.remove()
      document.querySelectorAll('.qk-spark').forEach(s => s.remove())
    }
  }, [])

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
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(200)
  }, [questions, currentIndex, getTimeLimit, answers, totalTimeMs, saveProgress])

  const fetchLiveRank = useCallback(async (correctSoFar: number, timeSoFar: number) => {
    if (!quiz?.show_live_placement) return
    try {
      const res = await fetch(
        `/api/quiz/${quizId}/ranking-snapshot?question=${currentIndex}&correct=${correctSoFar}&time=${timeSoFar}`
      )
      if (!res.ok) return
      const data: { rank: number } = await res.json()
      setLiveRank(data.rank)
    } catch { /* ikke kritisk */ }
  }, [quiz, quizId, currentIndex])

  const fetchRankingSnapshot = useCallback(async (
    questionIndex: number,
    correctSoFar: number,
    timeSoFar: number
  ): Promise<{ rank: number; total: number; low: number; high: number } | null> => {
    try {
      const res = await fetch(
        `/api/quiz/${quizId}/ranking-snapshot?question=${questionIndex}&correct=${correctSoFar}&time=${timeSoFar}`
      )
      if (!res.ok) return null
      return await res.json()
    } catch { return null }
  }, [quizId])

  const startQuiz = async () => {
    if (!nameInput.trim() || !ageConfirmed) return

    // Sjekk navnekonflikt kun for ikke-innloggede brukere
    if (!isLoggedIn) {
      const { data: conflict } = await supabaseData
        .from('attempts')
        .select('id')
        .eq('quiz_id', quizId)
        .ilike('player_name', nameInput.trim())
        .is('user_id', null)
        .limit(1)
      if (conflict && conflict.length > 0) {
        setNameConflict(true)
        return
      }
    }
    setNameConflict(false)

    const info: PlayerInfo = { name: nameInput.trim(), isTeam: isTeamInput, teamSize: isTeamInput ? teamSizeInput : 1, ageConfirmed: true }
    setPlayerInfo(info)

    // Lagre aldersbekreftelse i bakgrunnen hvis dette er første gang
    if (loggedInUserId && loggedInDisplayName && !ageAlreadyConfirmed) {
      const { data: { session: sess } } = await supabase.auth.getSession()
      if (sess?.access_token) {
        fetch('/api/profile/upsert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.access_token}` },
          body: JSON.stringify({ id: loggedInUserId, display_name: loggedInDisplayName, age_confirmed_at: new Date().toISOString() }),
        }).catch(() => { /* ikke kritisk */ })
      }
    }

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

      // Parallel: fetch rival and percentile data (non-blocking)
      const uid = session?.user?.id
      if (uid) {
        fetch(`/api/quiz/rival?quizId=${quizId}&userId=${uid}`)
          .then(r => r.ok ? r.json() : { rival: null })
          .then(j => { if (j.rival) setRivalData(j.rival) })
          .catch(() => {})
      }
      fetch(`/api/quiz/percentile?quizId=${quizId}`)
        .then(r => r.ok ? r.json() : [])
        .then(j => { if (Array.isArray(j)) setPercentileData(j) })
        .catch(() => {})
    } catch {
      setPlayerInfo({ name: '', isTeam: false, teamSize: 1, ageConfirmed: false })
    }
  }

  const handleAnswer = async (answer: string, buttonEl?: HTMLButtonElement) => {
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
    if (isCorrect) {
      fireCorrectAnswer(buttonEl)
    }
  }

  function fireCorrectAnswer(buttonEl?: HTMLButtonElement) {
    animationTimeoutsRef.current.forEach(clearTimeout)
    animationTimeoutsRef.current = []
    if (typeof document !== 'undefined') {
      document.getElementById('qk-glow-overlay')?.remove()
      document.querySelectorAll('.qk-spark').forEach(s => s.remove())
    }

    const t = (ms: number, fn: () => void) => {
      const id = setTimeout(fn, ms)
      animationTimeoutsRef.current.push(id)
    }

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(50)

    // Senterpunkt for partikler og gradient — bruk knappens posisjon
    const rect = buttonEl?.getBoundingClientRect()
    const cx = rect ? rect.left + rect.width / 2 : (typeof window !== 'undefined' ? window.innerWidth / 2 : 0)
    const cy = rect ? rect.top + rect.height / 2 : (typeof window !== 'undefined' ? window.innerHeight / 2 : 0)
    const bxPct = typeof window !== 'undefined' ? ((cx / window.innerWidth) * 100).toFixed(1) + '%' : '50%'
    const byPct = typeof window !== 'undefined' ? ((cy / window.innerHeight) * 100).toFixed(1) + '%' : '50%'

    // 0ms: Knapp tennes — sterk glow, 800ms inn
    if (buttonEl) {
      buttonEl.style.transition = 'box-shadow 800ms cubic-bezier(0.4, 0, 0.2, 1), border-color 800ms cubic-bezier(0.4, 0, 0.2, 1)'
      requestAnimationFrame(() => {
        buttonEl.style.boxShadow = '0 0 220px 120px rgba(201,168,76,0.30)'
        buttonEl.style.borderColor = '#c9a84c'
      })
      // 1700ms: Knapp slukner — 700ms ut
      t(1700, () => {
        buttonEl.style.transition = 'box-shadow 700ms cubic-bezier(0.4, 0, 0.2, 1), border-color 700ms cubic-bezier(0.4, 0, 0.2, 1)'
        buttonEl.style.boxShadow = ''
        buttonEl.style.borderColor = ''
      })
    }

    // 0ms: 100 gullpartikler spres organisk utover fra knapp-senteret
    if (typeof document !== 'undefined') {
      const sparks: HTMLElement[] = []
      for (let i = 0; i < 100; i++) {
        const angle = (i / 100) * Math.PI * 2 + (Math.random() - 0.5) * (Math.PI / 12) // ±15 grader avvik
        const dist = 60 + Math.random() * 220                                            // 60–280px
        const size = 3 + Math.random() * 5                                               // 3–8px
        const dur = Math.round(700 + Math.random() * 400)                                // 700–1100ms
        const spark = document.createElement('div')
        spark.className = 'qk-spark'
        spark.style.cssText = [
          'position:fixed',
          `left:${cx.toFixed(1)}px`,
          `top:${cy.toFixed(1)}px`,
          `width:${size.toFixed(1)}px`,
          `height:${size.toFixed(1)}px`,
          'border-radius:50%',
          'background:#c9a84c',
          'pointer-events:none',
          'z-index:10000',
          'transform:translate(-50%,-50%)',
          'opacity:0',
          `transition:transform ${dur}ms cubic-bezier(0.2,0,0.4,1),opacity 300ms ease-out`,
        ].join(';')
        document.body.appendChild(spark)
        sparks.push(spark)
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            spark.style.opacity = '0.85'
            spark.style.transform = `translate(calc(-50% + ${(Math.cos(angle) * dist).toFixed(1)}px), calc(-50% + ${(Math.sin(angle) * dist).toFixed(1)}px))`
          })
        })
      }
      // 900ms: partikler fader ut
      t(900, () => {
        sparks.forEach(s => {
          s.style.transition = 'opacity 400ms ease-out'
          s.style.opacity = '0'
        })
      })
      // 1350ms: fjern fra DOM
      t(1350, () => sparks.forEach(s => s.remove()))
    }

    if (typeof document !== 'undefined') {
      // 150ms: Full-screen bakgrunnsglow sentrert på knappen, 800ms inn
      t(150, () => {
        document.body.style.transition = 'background-color 800ms cubic-bezier(0.4, 0, 0.2, 1)'
        const overlay = document.createElement('div')
        overlay.id = 'qk-glow-overlay'
        overlay.style.cssText = [
          'position:fixed', 'top:0', 'left:0', 'width:100%', 'height:100%',
          'pointer-events:none', 'z-index:9999',
          `background:radial-gradient(ellipse at ${bxPct} ${byPct},rgba(201,168,76,0.22) 0%,rgba(201,168,76,0.08) 40%,transparent 72%)`,
          'opacity:0',
          'transition:opacity 800ms cubic-bezier(0.4,0,0.2,1)',
        ].join(';')
        document.body.appendChild(overlay)
        requestAnimationFrame(() => {
          document.body.style.backgroundColor = '#2a1f00'
          overlay.style.opacity = '1'
        })
      })
      // 1500ms: Bakgrunn + overlay fader ut over 900ms
      t(1500, () => {
        document.body.style.transition = 'background-color 900ms cubic-bezier(0.4, 0, 0.2, 1)'
        document.body.style.backgroundColor = '#1a1c23'
        const overlay = document.getElementById('qk-glow-overlay')
        if (overlay) {
          overlay.style.transition = 'opacity 900ms cubic-bezier(0.4, 0, 0.2, 1)'
          overlay.style.opacity = '0'
        }
      })
      // 2500ms: Rydd opp body inline styles og fjern overlay fra DOM
      t(2500, () => {
        document.body.style.transition = ''
        document.body.style.backgroundColor = ''
        document.getElementById('qk-glow-overlay')?.remove()
      })
    }

    // Streak-badge fader mykt inn — opacity 0→1 over 400ms (uendret)
    const streak = streakBadgeRef.current
    if (streak) {
      streak.style.animation = 'none'
      streak.style.transition = 'none'
      streak.style.opacity = '0'
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          streak.style.transition = 'opacity 400ms cubic-bezier(0.4, 0, 0.2, 1)'
          streak.style.opacity = '1'
        })
      })
    }
  }

  const goToNext = async () => {
    // Rydd opp alle løpende animasjonstimere og inline-stiler
    animationTimeoutsRef.current.forEach(clearTimeout)
    animationTimeoutsRef.current = []
    if (typeof document !== 'undefined') {
      document.body.style.transition = ''
      document.body.style.backgroundColor = ''
      document.getElementById('qk-glow-overlay')?.remove()
      document.querySelectorAll('.qk-spark').forEach(s => s.remove())
      const correctBtn = document.querySelector('.qk-option.correct') as HTMLButtonElement | null
      if (correctBtn) {
        correctBtn.style.transition = ''
        correctBtn.style.boxShadow = ''
        correctBtn.style.borderColor = ''
      }
    }
    if (streakBadgeRef.current) {
      streakBadgeRef.current.style.animation = ''
      streakBadgeRef.current.style.transition = ''
      streakBadgeRef.current.style.opacity = ''
    }

    const isLast = currentIndex === questions.length - 1
    if (isLast) {
      await finishQuiz()
      return
    }

    const nextIndex = currentIndex + 1
    const qLeft = questions.length - nextIndex
    const correctSoFar = answers.filter(a => a.isCorrect).length

    // Hent snapshot-rangering kun for innloggede — ikke blokker quizen ved feil
    let low: number | null = null
    let high: number | null = null
    if (isLoggedIn) {
      const result = await fetchRankingSnapshot(currentIndex, correctSoFar, totalTimeMs)
      if (result && result.total > 1) {
        low = result.low
        high = result.high
      }
    }

    const lastAns = answers[answers.length - 1]
    const optMap: Record<string, keyof Question> = { A: 'option_a', B: 'option_b', C: 'option_c', D: 'option_d' }
    const q = questions[currentIndex]
    const correctText = q ? (q[optMap[q.correct_answer]] as string) || q.correct_answer : ''
    const streak = (() => {
      let s = 0
      for (let i = answers.length - 1; i >= 0; i--) {
        if (answers[i].isCorrect) s++; else break
      }
      return s
    })()
    const wrongInARow = (() => {
      let s = 0
      for (let i = answers.length - 1; i >= 0; i--) {
        if (!answers[i].isCorrect) s++; else break
      }
      return s
    })()

    setInterLastCorrect(lastAns?.isCorrect ?? null)
    setInterCorrectAnswerText(correctText)
    setInterScore(correctSoFar)
    setInterStreak(streak)
    setInterWrongInARow(wrongInARow)
    setInterNextQNum(nextIndex + 1)
    setInterLow(low)
    setInterHigh(high)
    setInterQLeft(qLeft)
    setPendingNextIndex(nextIndex)
    setInterPhase('in')
  }

  const handleInterludeNext = useCallback(() => {
    if (pendingNextIndex === null) return
    const ni = pendingNextIndex
    // Oppdater spørsmålsstatus umiddelbart så nytt spørsmål rendres
    // under den uthviskende interluden (unngår visuell flash)
    setCurrentIndex(ni)
    setAnswered(false)
    setSelectedAnswer(null)
    setTimeLeft(getTimeLimit(questions[ni]))
    setQuestionStartTime(Date.now())
    setQuestionKey(k => k + 1)
    setPendingNextIndex(null)
    // Start utvisningstransisjon (250ms) etter at nytt spørsmål er klart
    setInterPhase('out')
    setTimeout(() => setInterPhase('hidden'), 250)
  }, [pendingNextIndex, questions, getTimeLimit])

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
      // Hent rangering fra snapshot-endepunkt; fallback til direkte spørring
      let placementSet = false
      try {
        const snapshotRes = await fetch(
          `/api/quiz/${quizId}/ranking-snapshot?question=${questions.length - 1}&correct=${correct}&time=${totalTimeMs}`
        )
        if (snapshotRes.ok) {
          const snapData: { rank: number; total: number; low: number; high: number } = await snapshotRes.json()
          if (snapData.total > 1) {
            setEstimatedPlacement({ low: snapData.low, high: snapData.high, total: snapData.total })
            placementSet = true
          }
        }
      } catch { /* snapshot feilet — fall through til fallback */ }
      if (!placementSet) {
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
      <p style={{color:'#7a7873',fontSize:14}}>Fant ikke quizen.</p>
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
    <div className="qk-shell"><div className="qk-box">
      <a href="/" style={{ display: 'inline-block', fontSize: 12, color: '#7a7873', textDecoration: 'none', marginBottom: 14, letterSpacing: '0.04em' }}>← Tilbake til forsiden</a>
      <div className="qk-panel">
      <p className="qk-eyebrow">Quizkanonen</p>
      <h1 className="qk-heading">{quiz.title}</h1>
      {quiz.category && (
        <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#7a7873', marginBottom: 16 }}>{quiz.category}</p>
      )}
      <p className="qk-sub">Fyll inn navn og trykk start. Lykke til!</p>

      {resumeData && (
        <div className="qk-banner">🔄 Vi fant en påbegynt quiz — du fortsetter der du slapp.</div>
      )}

      <label className="qk-label">Navn / Lagnavn</label>
      <input type="text" value={nameInput} onChange={e => { setNameInput(e.target.value); setNameConflict(false) }}
        placeholder="Skriv inn navn..." className="qk-input" maxLength={30}
        onKeyDown={e => e.key === 'Enter' && startQuiz()} autoFocus />
      {nameConflict && (
        <p style={{ fontSize: 12, color: '#e8e4dd', marginTop: -14, marginBottom: 16 }}>
          Dette navnet er allerede i bruk på denne quizen, velg et annet.
        </p>
      )}

      {socialProof && socialProof.totalPlayers >= 1 && (
        <div className="qk-social-proof-wrap">
          <span className="qk-social-proof-dot" />
          <span style={{
            fontSize: 14, color: '#7a7873',
            fontFamily: "'Instrument Sans', sans-serif",
            whiteSpace: 'nowrap',
          }}>
            <span style={{ color: '#e8e4dd', fontWeight: 600 }}>{socialProof.totalPlayers}</span>
            {' '}
            {socialProof.totalPlayers <= 2 ? 'har allerede spilt denne uken' : 'spiller denne uken'}
          </span>
          {socialProof.totalPlayers >= 3 && socialProof.sampleNames.length > 0 && (
            <div className="qk-social-proof-pills">
              {socialProof.sampleNames.map(name => (
                <span key={name} style={{
                  background: '#21242e',
                  border: '0.5px solid #2a2d38',
                  borderRadius: 999,
                  padding: '4px 10px',
                  fontSize: 11,
                  color: '#e8e4dd',
                  fontFamily: "'Instrument Sans', sans-serif",
                  whiteSpace: 'nowrap',
                }}>
                  {name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

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

      {!ageAlreadyConfirmed && (
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
      )}

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button onClick={startQuiz} disabled={!nameInput.trim() || !ageConfirmed} className="qk-btn-primary"
          style={{ width: 'auto', padding: '10px 28px', background: '#c9a84c', color: '#1a1c23' }}>
          {resumeData ? 'Fortsett quiz' : 'Start quiz'}
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3 2L11 7 3 12V2Z"/></svg>
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
        <button onClick={() => {
          navigator.clipboard.writeText(window.location.href).then(() => {
            setLinkCopied(true)
            setTimeout(() => setLinkCopied(false), 2000)
          }).catch(() => {})
        }} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 13, color: '#c9a84c', fontFamily: "'Instrument Sans', sans-serif",
          padding: '4px 0',
        }}>
          {linkCopied ? 'Lenke kopiert!' : 'Utfordre en venn →'}
        </button>
      </div>

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

    const currentStreak = (() => {
      let s = 0
      for (let i = answers.length - 1; i >= 0; i--) {
        if (answers[i].isCorrect) s++
        else break
      }
      return s
    })()

    return (
      <><style>{styles}</style>
      {/* Intermediate screen */}
      {interPhase !== 'hidden' && (
        <QuizInterlude
          phase={interPhase}
          lastCorrect={interLastCorrect}
          correctAnswerText={interCorrectAnswerText}
          score={interScore}
          totalQuestions={questions.length}
          streak={interStreak}
          wrongInARow={interWrongInARow}
          questionIndex={interNextQNum - 2}
          low={interLow}
          high={interHigh}
          rival={rivalData}
          percentileData={percentileData}
          onNext={handleInterludeNext}
        />
      )}
      <div className="qk-play-shell">
        <div className="qk-play-header">
          <span className="qk-progress-text">{currentIndex + 1} / {questions.length}</span>
          {quiz.category && (
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#7a7873' }}>{quiz.category}</span>
          )}
        </div>

        <span className={`qk-timer${timeLeft <= 5 ? ' urgent' : ''}${timeLeft <= 3 && !answered ? ' pulse' : ''}`}>{timeLeft}s</span>
        <div className="qk-timer-bar-wrap">
          <div className="qk-timer-bar" style={{width:`${timerPercent}%`,background:timerColor}}/>
        </div>

        <div className="qk-score-row">
          <span ref={scoreBadgeRef} className="qk-score-pill">{correctSoFar > 0 ? '\u2713' : '\u2013'} {correctSoFar} riktige</span>
          {quiz.show_live_placement && liveRank && <span className="qk-rank-pill">#{liveRank}</span>}
        </div>

        <div ref={questionCardRef} style={{
          minHeight: 420,
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
        }}>
          <div key={questionKey} className="qk-question-card qk-animate-in">
            <p className="qk-question-text">{question?.question_text}</p>
          </div>

          {currentStreak >= 2 && (
            <div ref={streakBadgeRef} className="qk-streak-badge">{currentStreak} på rad!</div>
          )}

          {answered && selectedAnswer === null && (
            <div style={{
              background: 'rgba(201,76,76,0.12)', border: '1px solid var(--red)',
              borderRadius: 8, padding: '10px 14px', marginBottom: 12,
              fontSize: 13, fontWeight: 600, color: '#f87171', textAlign: 'center',
            }}>
              Tiden er ute
            </div>
          )}

          <div className="qk-options">
            {availableOptions.map((opt, i) => (
              <button
                key={`${questionKey}-${opt}`}
                onClick={e => handleAnswer(opt, e.currentTarget as HTMLButtonElement)}
                disabled={answered}
                style={{ animationDelay: `${i * 50}ms` }}
                className={`qk-option qk-animate-in${getOptionClass(opt)}`}
              >
                <span className="qk-opt-letter">{opt}</span>
                <span className="qk-opt-text">{question?.[optionKeys[opt]] as string}</span>
              </button>
            ))}
          </div>

          {answered && (
            <div>
              {quiz.show_answer_explanation && question?.explanation && (
                <div className="qk-explanation">{question.explanation}</div>
              )}
              <button onClick={goToNext} className="qk-btn-primary">
                {currentIndex === questions.length - 1 ? 'Se resultatet' : 'Neste spørsmål'}
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3 2L11 7 3 12V2Z"/></svg>
              </button>
            </div>
          )}
        </div>
      </div></>
    )
  }

  // RESULTAT
  const correctCount = answers.filter(a => a.isCorrect).length
  const percentage = Math.round((correctCount / questions.length) * 100)
  const streak = calculateStreak(answers.map(a => ({ is_correct: a.isCorrect })))
  const toppPercent = estimatedPlacement && estimatedPlacement.total > 1
    ? Math.round(((estimatedPlacement.total - estimatedPlacement.low) / estimatedPlacement.total) * 100)
    : null
  const shareResultText = toppPercent !== null
    ? `Jeg er topp ${toppPercent}% på Quizkanonen denne uken! Kan du slå meg? quizkanonen.no`
    : `Jeg spilte Quizkanonen denne uken! Kan du slå meg? quizkanonen.no`

  return (
    <><style>{styles}</style>
    <div className="qk-shell"><div className="qk-box"><div className="qk-panel" style={{textAlign:'center'}}>
      <p className="qk-eyebrow" style={{textAlign:'center'}}>Bra jobbet, {playerInfo.name.split(' ')[0]}!</p>
      <h1 className="qk-heading" style={{textAlign:'center', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
        {playerInfo.name.length > 20 ? playerInfo.name.slice(0, 20) + '…' : playerInfo.name}
        {!isLoggedIn && <span style={{ fontSize: 15, color: '#7a7873', fontWeight: 400, marginLeft: 8 }}>(guest)</span>}
      </h1>
      <p style={{fontSize:13,color:'#7a7873',marginBottom:24}}>{quiz.title}</p>

      <div style={{display:'grid',gridTemplateColumns:'repeat(4, 1fr)',gap:6,marginBottom:10}}>
        {[
          { val: `${correctCount}/${questions.length}`, label: 'Riktige' },
          { val: `${percentage}%`, label: 'Score' },
          { val: formatTime(totalTimeMs), label: 'Tid' },
          { val: String(streak), label: 'Streak' },
        ].map(({ val, label }) => (
          <div key={label} style={{background:'#21242e',border:'0.5px solid #2a2d38',borderRadius:10,padding:'8px 4px',textAlign:'center'}}>
            <div style={{fontSize:14,fontWeight:500,color:'#c9a84c',lineHeight:1.2}}>{val}</div>
            <div style={{fontSize:8,color:'#7a7873',textTransform:'uppercase',letterSpacing:'0.06em',marginTop:3}}>{label}</div>
          </div>
        ))}
      </div>

      <div className="qk-divider"/>

      {estimatedPlacement && estimatedPlacement.total > 1 && (() => {
        const prosent = Math.round(((estimatedPlacement.total - estimatedPlacement.low) / estimatedPlacement.total) * 100)
        const toppX = 100 - prosent
        const tierStart = estimatedPlacement.total <= 10
          ? 1
          : Math.max(1, Math.floor((estimatedPlacement.low - 1) / 10) * 10 + 1)
        const rangeY = estimatedPlacement.total <= 10
          ? estimatedPlacement.total
          : Math.min(estimatedPlacement.total, tierStart + 9)
        return (
          <div style={{
            background: '#1e1a0e',
            border: '0.5px solid rgba(201,168,76,0.3)',
            borderRadius: 16,
            padding: 16,
            textAlign: 'center',
            marginBottom: 14,
          }}>
            <div style={{ fontSize: 22, fontWeight: 500, color: '#c9a84c' }}>
              Topp {toppX}%
            </div>
            <div style={{ fontSize: 13, color: '#e8e4dd', marginTop: 4 }}>
              Du er bedre enn {prosent}% av deltakerne
            </div>
            <div style={{ fontSize: 11, color: '#7a7873', marginTop: 6 }}>
              Estimert mellom plass {tierStart} og {rangeY} · av {estimatedPlacement.total} deltakere
            </div>
          </div>
        )
      })()}

      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        <button onClick={async () => {
          const shareText = toppPercent !== null
            ? `Jeg er topp ${toppPercent}% på Quizkanonen denne uken! Kan du slå meg?`
            : `Jeg spilte Quizkanonen denne uken! Kan du slå meg?`
          const shareData = { title: 'Quizkanonen', text: shareText, url: 'https://quizkanonen.no' }
          if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
            await navigator.share(shareData)
          } else {
            navigator.clipboard.writeText(shareText + ' quizkanonen.no').then(() => {
              setShareResultCopied(true)
              setTimeout(() => setShareResultCopied(false), 2000)
            }).catch(() => {})
          }
        }} style={{
          width:'100%',background:'transparent',border:'0.5px solid #3a3d4a',
          borderRadius:10,padding:'8px 20px',fontSize:14,color:'#e8e4dd',
          fontFamily:"'Instrument Sans', sans-serif",cursor:'pointer',
        }}>
          {shareResultCopied ? 'Kopiert!' : 'Del resultatet →'}
        </button>

        {quiz.show_leaderboard && (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <a href={`/leaderboard/${quizId}`} className="qk-btn-primary" style={{ width: 'auto', padding: '10px 28px' }}>Se topplisten</a>
          </div>
        )}

        {(() => {
          let displayStr: string | null = null
          if (nextQuizAt) {
            const d = new Date(nextQuizAt)
            if (d > new Date()) {
              displayStr = d.toLocaleString('nb-NO', { timeZone: 'Europe/Oslo', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
            }
          }
          if (!displayStr) {
            const nowOslo = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Oslo' }))
            const day = nowOslo.getDay()
            let daysUntil = (5 - day + 7) % 7
            if (daysUntil === 0 && nowOslo.getHours() >= 12) daysUntil = 7
            const nextFri = new Date()
            nextFri.setDate(new Date().getDate() + daysUntil)
            const dateStr = nextFri.toLocaleDateString('nb-NO', { timeZone: 'Europe/Oslo', day: 'numeric', month: 'long' })
            displayStr = `fredag ${dateStr} kl. 12:00`
          }
          return (
            <p style={{fontSize:13,color:'#7a7873',textAlign:'center'}}>
              Neste quiz: {displayStr}
            </p>
          )
        })()}

        {!isLoggedIn && (
          <a href="/login" style={{
            display:'block',textAlign:'center',fontSize:13,color:'#c9a84c',
            textDecoration:'none',
          }}>
            Få påminnelse på e-post →
          </a>
        )}

        {!isLoggedIn && (
          <div style={{
            background:'#21242e',
            border:'0.5px solid #2a2d38',
            borderRadius:16,
            padding:16,
            textAlign:'left',
          }}>
            <p style={{fontSize:13,color:'#e8e4dd',lineHeight:1.5,marginBottom:12}}>
              Logg inn for å se nøyaktig plassering og lagre historikken din.
            </p>
            <a href="/login" style={{
              display:'flex',alignItems:'center',gap:10,
              background:'#2a2d38',borderRadius:8,padding:'10px 14px',
              textDecoration:'none',transition:'background 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = '#32353f' }}
            onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = '#2a2d38' }}
            >
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908C16.658 14.131 17.64 11.862 17.64 9.2z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
                <path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.962L3.964 6.294C4.672 4.169 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              <span style={{fontSize:13,color:'#e8e4dd',fontFamily:"'Instrument Sans', sans-serif"}}>Logg inn med Google</span>
            </a>
          </div>
        )}

        {isLoggedIn && !isPremium && (
          <div style={{
            background:'#21242e',
            border:'0.5px solid #2a2d38',
            borderRadius:16,
            padding:16,
            textAlign:'left',
          }}>
            <p style={{fontSize:13,color:'#e8e4dd',lineHeight:1.5,marginBottom:12}}>
              Oppgrader til Premium for å se historikken din og følge fremgangen uke etter uke.
            </p>
            <a href="/founders" style={{
              display:'block',textAlign:'center',
              background:'transparent',border:'1px solid rgba(201,168,76,0.35)',
              borderRadius:8,padding:'10px 14px',
              fontSize:13,fontWeight:600,color:'#c9a84c',
              textDecoration:'none',transition:'border-color 0.15s, background 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(201,168,76,0.65)'; (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(201,168,76,0.06)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(201,168,76,0.35)'; (e.currentTarget as HTMLAnchorElement).style.background = 'transparent' }}
            >
              Oppgrader til Premium →
            </a>
          </div>
        )}

        <a href="/" className="qk-btn-ghost">← Tilbake til forsiden</a>
      </div>

      {ligaBox && (
        <div style={{ marginTop: 12, background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '16px 20px', textAlign: 'left' }}>
          {ligaBox.type === 'liga' ? (
            <a href={`/liga/${ligaBox.slug}`} style={{ textDecoration: 'none' }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: '#c9a84c', marginBottom: 3 }}>
                Se hvordan du gjør det mot vennene dine →
              </p>
              <p style={{ fontSize: 12, color: '#7a7873' }}>{ligaBox.name}</p>
            </a>
          ) : ligaBox.type === 'multi' ? (
            <a href="/liga" style={{ textDecoration: 'none' }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: '#c9a84c', marginBottom: 3 }}>
                Se hvordan du gjør det mot vennene dine →
              </p>
              <p style={{ fontSize: 12, color: '#7a7873' }}>Se dine ligaer</p>
            </a>
          ) : (
            <a href="/liga" style={{ textDecoration: 'none' }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: '#c9a84c', marginBottom: 3 }}>
                Konkurrer mot venner
              </p>
              <p style={{ fontSize: 12, color: '#7a7873' }}>Opprett en privat liga og inviter vennegjengen</p>
            </a>
          )}
        </div>
      )}
    </div></div></div></>
  )
}