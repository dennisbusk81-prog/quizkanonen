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
    --green:   #4ade80;
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
    border: 0.5px solid #2a2d38;
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
    color: #1a1c23;
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
    color: var(--body);
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
    text-align: center;
    display: block;
    margin-bottom: 6px;
    transform-origin: center;
  }

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
    border: 0.5px solid #2a2d38;
    border-radius: var(--rcard);
    padding: 14px 16px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    text-align: left;
    width: 100%;
  }

  /* ── Mobile touch targets ──────────────────────────────────────────── */
  @media (max-width: 640px) {
    .qk-options { gap: 12px; }
    .qk-option  { min-height: 52px; }
    .qk-next-btn-wrap {
      position: sticky;
      bottom: 0;
      padding: 12px 0 8px;
      /* Fade so content behind the button is legible while scrolling */
      background: linear-gradient(transparent, var(--bg) 28%);
      z-index: 10;
      margin-top: 2px;
    }
  }

  .qk-option:hover:not(:disabled) { border-color: #7a7873; background: #262930; }
  .qk-option:disabled { cursor: default; }
  @keyframes qkButtonPop {
    0%   { transform: scale(1); }
    40%  { transform: scale(1.05); }
    70%  { transform: scale(0.98); }
    100% { transform: scale(1); }
  }

  @keyframes qkShake {
    0%, 100% { transform: translateX(0); }
    20%      { transform: translateX(-5px); }
    40%      { transform: translateX(5px); }
    60%      { transform: translateX(-5px); }
    80%      { transform: translateX(5px); }
  }

  @keyframes qkScorePop {
    0%   { transform: translate(-50%, -50%) scale(0.7); opacity: 1; }
    40%  { transform: translate(-50%, calc(-50% - 40px)) scale(1.3); opacity: 1; }
    100% { transform: translate(-50%, calc(-50% - 80px)) scale(0.9); opacity: 0; }
  }

  @keyframes qkStreakMsg {
    0%   { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
    25%  { transform: translate(-50%, -50%) scale(1.2); opacity: 1; }
    70%  { transform: translate(-50%, -50%) scale(1.05); opacity: 1; }
    100% { transform: translate(-50%, -50%) scale(0.9); opacity: 0; }
  }

  .qk-option.correct { background: rgba(59,109,17,0.12); border-color: #3B6D11; }
  .qk-option.correct .qk-opt-letter { background: #3B6D11; border-color: #3B6D11; color: #fff; }

  .qk-option.correct-self { background: rgba(201,168,76,0.1); border-color: #c9a84c; animation: qkButtonPop 0.4s ease-out; }
  .qk-option.correct-self .qk-opt-letter { background: #c9a84c; border-color: #c9a84c; color: #1a1c23; transform: scale(1.2); transition: transform 0.15s; }
  .qk-option.correct-self .qk-opt-text { color: #c9a84c; font-weight: 600; }

  .qk-option.wrong { background: rgba(201,76,76,0.1); border-color: var(--red); opacity: 0.7; }
  .qk-option.idle { opacity: 0.4; }

  .qk-opt-letter {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: #2a2d38;
    border: 1.5px solid #2a2d38;
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

  /* ANIMATION: timer — 3 eskaleringsnivåer */
  /* Rolig (10-7s): grønn, ingen puls */
  .qk-timer--calm { color: #4ade80; }

  /* Advarsel (6-4s): gul, svak puls */
  @keyframes timerPulseWarning {
    0%, 100% { transform: scale(1.0); }
    50%       { transform: scale(1.1); }
  }
  .qk-timer--warning {
    color: #EF9F27;
    animation: timerPulseWarning 600ms ease-in-out infinite;
  }

  /* Kritisk (3-1s): rød, aggressiv puls */
  @keyframes timerPulseCritical {
    0%, 100% { transform: scale(1.0); }
    50%       { transform: scale(1.2); }
  }
  .qk-timer--critical {
    color: #E24B4A;
    animation: timerPulseCritical 400ms ease-in-out infinite;
  }

  /* Kritisk bakgrunnsglød — pulserer inn og ut på spillskjermen */
  @keyframes qkRedGlow {
    0%, 100% { background-color: rgba(226,75,74,0); }
    50%       { background-color: rgba(226,75,74,0.06); }
  }
  .qk-play-shell--critical { animation: qkRedGlow 400ms ease-in-out infinite; }

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

  /* ANSWER ANIMATIONS */
  @keyframes qkFlash {
    0%   { opacity: 1; }
    100% { opacity: 0; }
  }
  .qk-flash-overlay {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    pointer-events: none; z-index: 9997;
    background: rgba(201,168,76,0.08);
  }

  @keyframes qkRingPulse {
    0%   { transform: translate(-50%,-50%) scale(0.5); opacity: 0.9; }
    100% { transform: translate(-50%,-50%) scale(2.5); opacity: 0; }
  }
  .qk-ring-el {
    position: fixed;
    width: 80px; height: 80px;
    border-radius: 50%;
    border: 2px solid rgba(201,168,76,0.6);
    pointer-events: none; z-index: 10001;
  }

  .qk-score-pop-el {
    position: fixed;
    pointer-events: none; z-index: 10002;
    font-family: 'Libre Baskerville', serif;
    font-size: 32px; font-weight: 700;
    color: #c9a84c;
    text-shadow: 0 0 20px rgba(201,168,76,0.5);
  }

  .qk-streak-msg-el {
    position: fixed;
    left: 50%; top: 40%;
    pointer-events: none; z-index: 10003;
    font-family: 'Libre Baskerville', serif;
    font-size: 24px; font-weight: 700;
    color: #c9a84c;
    text-shadow: 0 0 30px rgba(201,168,76,0.6);
    white-space: nowrap;
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
  const [orgBox, setOrgBox] = useState<{ orgName: string; orgSlug: string; userRank: number | null } | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [isPremium, setIsPremium] = useState(false)
  const [foundersData, setFoundersData] = useState<{ used: number; max: number; remaining: number; daysFree: number; isFounders: boolean } | null>(null)
  const [shareResultCopied, setShareResultCopied] = useState(false)
  const [cardShareState, setCardShareState] = useState<'idle' | 'loading' | 'done'>('idle')
  const [nameConflict, setNameConflict] = useState(false)
  const [questionKey, setQuestionKey] = useState(0)
  const [interPhase, setInterPhase] = useState<'hidden' | 'in' | 'out'>('hidden')
  const [interLow, setInterLow] = useState<number | null>(null)
  const [interHigh, setInterHigh] = useState<number | null>(null)
  const [interQLeft, setInterQLeft] = useState(0)
  const [interLastCorrect, setInterLastCorrect] = useState<boolean | null>(null)
  const [interCorrectAnswerText, setInterCorrectAnswerText] = useState<string | null>(null)
  const [interExplanation, setInterExplanation] = useState<string | null>(null)
  const [interScore, setInterScore] = useState(0)
  const [interStreak, setInterStreak] = useState(0)
  const [interWrongInARow, setInterWrongInARow] = useState(0)
  const [interNextQNum, setInterNextQNum] = useState(1)
  const [pendingNextIndex, setPendingNextIndex] = useState<number | null>(null)
  const [shuffledDisplayOrder, setShuffledDisplayOrder] = useState<string[]>(['A', 'B', 'C', 'D'])
  const [rivalData, setRivalData] = useState<{ name: string; avatarColor: string; score: number } | null>(null)
  const [rankingSnapshot, setRankingSnapshot] = useState<{ top10MinCorrect: number; leaderName: string; leaderCorrect: number; totalPlayers: number } | null>(null)
  const [percentileData, setPercentileData] = useState<Array<{ score: number; percentile: number }>>([])
  const [socialProof, setSocialProof] = useState<{ totalPlayers: number; sampleNames: string[] } | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [finishSaveError, setFinishSaveError] = useState<string | null>(null)
  const questionCardRef      = useRef<HTMLDivElement | null>(null)
  const scoreBadgeRef        = useRef<HTMLSpanElement | null>(null)
  const streakBadgeRef       = useRef<HTMLDivElement | null>(null)
  const timerRef             = useRef<HTMLSpanElement | null>(null)
  const playShellRef         = useRef<HTMLDivElement | null>(null)
  const animationTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const canvasRef            = useRef<HTMLCanvasElement | null>(null)
  const confettiRafRef       = useRef<number | null>(null)
  const flashRef             = useRef<HTMLDivElement | null>(null)
  const ringRefs             = useRef<(HTMLDivElement | null)[]>([null, null, null])
  const scorePopRef          = useRef<HTMLDivElement | null>(null)
  const streakMsgRef         = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        window.location.href = `/login?next=/quiz/${quizId}`
        return
      }
      setIsLoggedIn(true)
      setLoggedInUserId(session.user.id)
      const { data: prof } = await supabaseData
        .from('profiles')
        .select('display_name, age_confirmed_at, premium_status')
        .eq('id', session.user.id)
        .maybeSingle()
      const name = prof?.display_name ?? session.user.email?.split('@')[0] ?? ''
      if (name) { setNameInput(name); setLoggedInDisplayName(name) }
      const isP = prof?.premium_status === true
      setIsPremium(isP)
      // Hent founders-data for CTA — cache 5 min i sessionStorage
      if (!isP) {
        try {
          const CACHE_KEY = 'qk_founders_count'
          const CACHE_TTL = 5 * 60 * 1000
          const cached = sessionStorage.getItem(CACHE_KEY)
          if (cached) {
            const { ts, data } = JSON.parse(cached) as { ts: number; data: typeof foundersData }
            if (Date.now() - ts < CACHE_TTL) { setFoundersData(data); }
            else {
              const r = await fetch('/api/founders/count'); const d = await r.json()
              sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: d }))
              setFoundersData(d)
            }
          } else {
            const r = await fetch('/api/founders/count'); const d = await r.json()
            sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: d }))
            setFoundersData(d)
          }
        } catch { /* founders-data er valgfri */ }
      }
      if (prof?.age_confirmed_at) {
        setAgeAlreadyConfirmed(true)
        setAgeConfirmed(true)
      }
    })
  }, [quizId])

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
        .eq('quiz_id', quizId).eq('identifier', deviceId).maybeSingle()
      if (playedError) console.error('played_log fetch feilet:', playedError)

      // For innloggede: sjekk mot attempts-tabellen (omgår localStorage/deviceId)
      let playedAsUser = false
      if (!played) {
        const { data: { session: currentSession } } = await supabase.auth.getSession()
        if (currentSession?.user?.id) {
          const { data: existingAttempt } = await supabaseData
            .from('attempts')
            .select('id')
            .eq('quiz_id', quizId)
            .eq('user_id', currentSession.user.id)
            .maybeSingle()
          playedAsUser = !!existingAttempt
        }
      }

      if (played || playedAsUser) {
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
    if (phase !== 'finished' || !isLoggedIn) return
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.access_token) return
      try {
        const orgsRes = await fetch('/api/org/my-orgs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: session.access_token }),
        })
        if (!orgsRes.ok) return
        const { orgs } = await orgsRes.json()
        if (!orgs || orgs.length === 0) return
        const first = orgs[0]
        const summaryRes = await fetch(`/api/org/${first.orgSlug}/season-summary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: session.access_token }),
        })
        if (!summaryRes.ok) return
        const summary = await summaryRes.json()
        setOrgBox({ orgName: first.orgName, orgSlug: first.orgSlug, userRank: summary.userRank ?? null })
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

  // Timer-eskalering via CSS-klasser — ingen JS-animasjonslogikk
  useEffect(() => {
    const el = timerRef.current
    const shell = playShellRef.current
    if (!el) return

    el.classList.remove('qk-timer--calm', 'qk-timer--warning', 'qk-timer--critical')
    shell?.classList.remove('qk-play-shell--critical')

    if (answered) return  // stopp eskalering når svart

    if (timeLeft <= 3) {
      el.classList.add('qk-timer--critical')
      shell?.classList.add('qk-play-shell--critical')
    } else if (timeLeft <= 6) {
      el.classList.add('qk-timer--warning')
    } else {
      el.classList.add('qk-timer--calm')
    }
  }, [timeLeft, answered])

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
    const effectiveName = isTeamInput ? nameInput.trim() : (loggedInDisplayName ?? nameInput.trim())
    if (!effectiveName) return

    setStartError(null)
    const info: PlayerInfo = { name: effectiveName, isTeam: isTeamInput, teamSize: isTeamInput ? teamSizeInput : 1, ageConfirmed: true }
    setPlayerInfo(info)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const { data } = await supabaseData.from('attempts').insert({
        quiz_id: quizId, player_name: info.name, is_team: info.isTeam,
        team_size: info.teamSize, total_questions: questions.length, correct_answers: 0, total_time_ms: 0,
        user_id: session?.user?.id ?? null,
        leader_display_name: info.isTeam && loggedInDisplayName ? loggedInDisplayName : null,
      }).select().single()
      setAttemptId(data?.id || null)
      const firstIdx = resumeData ? resumeData.index : 0
      const firstQ = questions[firstIdx]
      const baseOpts = ['A', 'B', 'C', 'D'].slice(0, quiz!.num_options)
      setShuffledDisplayOrder(firstQ?.shuffle_options ? [...baseOpts].sort(() => Math.random() - 0.5) : baseOpts)
      if (resumeData) {
        setCurrentIndex(resumeData.index); setAnswers(resumeData.answers)
        setTotalTimeMs(resumeData.totalTime); setTimeLeft(getTimeLimit(questions[resumeData.index]))
      } else {
        setTimeLeft(getTimeLimit(questions[0]))
      }
      setQuestionStartTime(Date.now()); setPhase('playing')

      // Parallel: fetch rival and percentile data (non-blocking)
      const accessToken = session?.access_token
      if (accessToken) {
        fetch(`/api/quiz/rival?quizId=${quizId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
          .then(r => r.ok ? r.json() : { rival: null, rankingSnapshot: null })
          .then(j => {
            if (j.rival) setRivalData(j.rival)
            if (j.rankingSnapshot) setRankingSnapshot(j.rankingSnapshot)
          })
          .catch(() => {})
      }
      fetch(`/api/quiz/percentile?quizId=${quizId}`)
        .then(r => r.ok ? r.json() : [])
        .then(j => { if (Array.isArray(j)) setPercentileData(j) })
        .catch(() => {})
    } catch {
      setPlayerInfo({ name: '', isTeam: false, teamSize: 1, ageConfirmed: false })
      setStartError('Noe gikk galt. Prøv å laste siden på nytt.')
    }
  }

  const handleAnswer = async (answer: string, buttonEl?: HTMLButtonElement) => {
    if (answered) return
    const question = questions[currentIndex]
    const timeMs = Date.now() - questionStartTime
    const isCorrect = answer === question.correct_answer

    // ANIMASJON FØRST — direkte via refs, ingen React, ingen delay
    if (isCorrect) {
      let currentStreak = 1
      for (let i = answers.length - 1; i >= 0; i--) {
        if (answers[i].isCorrect) currentStreak++; else break
      }
      fireCorrectAnswer(buttonEl, currentStreak)
    } else {
      fireWrongAnswer(buttonEl)
    }

    // REACT STATE ETTERPÅ — re-render skjer etter animasjon er startet
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

  function startConfettiCanvas(cx: number, cy: number) {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (confettiRafRef.current) cancelAnimationFrame(confettiRafRef.current)

    type P = { x: number; y: number; vx: number; vy: number; size: number; color: string; round: boolean; rot: number; rotV: number; opacity: number }
    const COLORS = ['#c9a84c', '#e8c96a', '#f0d878', '#ffffff', '#d4b45a']
    const particles: P[] = []
    for (let i = 0; i < 150; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 3 + Math.random() * 9
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 5,
        size: 3 + Math.random() * 10,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        round: Math.random() > 0.5,
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.25,
        opacity: 0.9,
      })
    }

    const GRAVITY = 0.18
    const DECAY = 0.013

    function loop() {
      if (!ctx || !canvas) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      let alive = false
      for (const p of particles) {
        p.vy += GRAVITY
        p.x += p.vx
        p.y += p.vy
        p.rot += p.rotV
        p.opacity -= DECAY
        if (p.opacity <= 0) continue
        alive = true
        ctx.save()
        ctx.globalAlpha = Math.max(0, p.opacity)
        ctx.fillStyle = p.color
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        if (p.round) {
          ctx.beginPath()
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2)
          ctx.fill()
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
        }
        ctx.restore()
      }
      if (alive) {
        confettiRafRef.current = requestAnimationFrame(loop)
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        confettiRafRef.current = null
      }
    }
    confettiRafRef.current = requestAnimationFrame(loop)
  }

  function triggerEl(el: HTMLDivElement | null, animation: string, hideAfterMs: number, t: (ms: number, fn: () => void) => void) {
    if (!el) return
    el.style.display = 'block'
    el.style.animation = 'none'
    void el.offsetWidth // force reflow — restarter CSS-animasjon
    el.style.animation = animation
    t(hideAfterMs, () => { el.style.display = 'none'; el.style.animation = 'none' })
  }

  function fireCorrectAnswer(buttonEl: HTMLButtonElement | undefined, streak = 0) {
    animationTimeoutsRef.current.forEach(clearTimeout)
    animationTimeoutsRef.current = []

    if (confettiRafRef.current) { cancelAnimationFrame(confettiRafRef.current); confettiRafRef.current = null }
    const canvas = canvasRef.current
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(50)

    const rect = buttonEl?.getBoundingClientRect()
    const cx = rect ? rect.left + rect.width / 2 : (typeof window !== 'undefined' ? window.innerWidth / 2 : 0)
    const cy = rect ? rect.top + rect.height / 2 : (typeof window !== 'undefined' ? window.innerHeight / 2 : 0)

    const t = (ms: number, fn: () => void) => { const id = setTimeout(fn, ms); animationTimeoutsRef.current.push(id) }

    // 1. Bakgrunns-flash — direkte DOM
    triggerEl(flashRef.current, 'qkFlash 0.6s ease-out forwards', 680, t)

    // 2. Tre ringer — direkte DOM, ingen React-render
    ringRefs.current.forEach((ring, i) => {
      if (!ring) return
      ring.style.left = cx + 'px'
      ring.style.top = cy + 'px'
      triggerEl(ring, `qkRingPulse 0.7s cubic-bezier(0.2,0,0.4,1) ${i * 150}ms forwards`, i * 150 + 750, t)
    })

    // 3. Score pop — direkte DOM
    const pop = scorePopRef.current
    if (pop) {
      pop.style.left = cx + 'px'
      pop.style.top = cy + 'px'
      triggerEl(pop, 'qkScorePop 0.9s ease-out forwards', 950, t)
    }

    // 4. Canvas konfetti — starter i samme frame som klikket
    startConfettiCanvas(cx, cy)

    // 5. Streak-melding — direkte DOM
    if (streak >= 2) {
      const msgs: Record<number, string> = { 2: '2 på rad!', 3: '3 på rad!', 4: 'Ustoppelig!' }
      const msg = streak >= 5 ? 'Perfekt!' : (msgs[streak] ?? `${streak} på rad!`)
      const smEl = streakMsgRef.current
      if (smEl) {
        smEl.textContent = msg
        triggerEl(smEl, 'qkStreakMsg 1.1s ease-out forwards', 1200, t)
      }
    }

    // 6. Streak-badge i React-treet fader inn
    const streakBadge = streakBadgeRef.current
    if (streakBadge) {
      streakBadge.style.transition = 'none'
      streakBadge.style.opacity = '0'
      requestAnimationFrame(() => requestAnimationFrame(() => {
        streakBadge.style.transition = 'opacity 400ms cubic-bezier(0.4,0,0.2,1)'
        streakBadge.style.opacity = '1'
      }))
    }
  }

  function fireWrongAnswer(buttonEl?: HTMLButtonElement) {
    if (!buttonEl) return
    buttonEl.style.animation = 'none'
    requestAnimationFrame(() => { buttonEl.style.animation = 'qkShake 0.4s ease-in-out' })
    const id = setTimeout(() => { buttonEl.style.animation = '' }, 450)
    animationTimeoutsRef.current.push(id)
  }

  const goToNext = async () => {
    // Rydd opp alle løpende animasjonstimere og inline-stiler
    animationTimeoutsRef.current.forEach(clearTimeout)
    animationTimeoutsRef.current = []
    if (confettiRafRef.current) { cancelAnimationFrame(confettiRafRef.current); confettiRafRef.current = null }
    const canvas = canvasRef.current
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    // Skjul alle overlay-elementer direkte via refs — ingen React re-render nødvendig
    if (flashRef.current) { flashRef.current.style.display = 'none'; flashRef.current.style.animation = 'none' }
    ringRefs.current.forEach(r => { if (r) { r.style.display = 'none'; r.style.animation = 'none' } })
    if (scorePopRef.current) { scorePopRef.current.style.display = 'none'; scorePopRef.current.style.animation = 'none' }
    if (streakMsgRef.current) { streakMsgRef.current.style.display = 'none'; streakMsgRef.current.style.animation = 'none' }
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
    setInterExplanation(q?.explanation ?? null)
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
    const nextQ = questions[ni]
    const baseOpts = ['A', 'B', 'C', 'D'].slice(0, quiz?.num_options ?? 4)
    setShuffledDisplayOrder(nextQ?.shuffle_options ? [...baseOpts].sort(() => Math.random() - 0.5) : baseOpts)
    setCurrentIndex(ni)
    setAnswered(false)
    setSelectedAnswer(null)
    setTimeLeft(getTimeLimit(questions[ni]))
    setQuestionStartTime(Date.now())
    setQuestionKey(k => k + 1)
    setPendingNextIndex(null)
    setInterPhase('out')
    setTimeout(() => setInterPhase('hidden'), 250)
  }, [pendingNextIndex, questions, getTimeLimit, quiz])

  const finishQuiz = async () => {
    const correct = answers.filter(a => a.isCorrect).length
    const streak = calculateStreak(answers.map(a => ({ is_correct: a.isCorrect })))
    const deviceId = getDeviceId()
    try {
      if (attemptId) {
        await supabaseData.from('attempts').update({ correct_answers: correct, total_time_ms: totalTimeMs, correct_streak: streak }).eq('id', attemptId)
        const { error: answersError } = await supabaseData.from('attempt_answers').insert(
          answers.map(ans => ({
            attempt_id: attemptId, question_id: ans.questionId,
            selected_answer: ans.selectedAnswer, is_correct: ans.isCorrect, time_ms: ans.timeMs,
          }))
        )
        if (answersError) console.error('[finishQuiz] attempt_answers batch insert failed:', answersError)
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
    } catch {
      setFinishSaveError('Resultatet ble ikke lagret — sjekk internettforbindelsen din')
      setTimeout(() => {
        setFinishSaveError(null)
        setPhase('finished')
      }, 4000)
      return
    }
    setPhase('finished')
  }

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000)
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
  }

  const generateAndShareCard = async () => {
    if (cardShareState === 'loading') return
    setCardShareState('loading')
    try {
      await document.fonts.ready

      const cCount = answers.filter(a => a.isCorrect).length
      const topp = isPremium && estimatedPlacement && estimatedPlacement.total > 1
        ? Math.round(((estimatedPlacement.total - estimatedPlacement.low) / estimatedPlacement.total) * 100)
        : null

      const W = 800, H = 420
      const canvas = document.createElement('canvas')
      canvas.width = W * 2
      canvas.height = H * 2
      const ctx = canvas.getContext('2d')!
      ctx.scale(2, 2)

      // Rounded rect path helper
      const rr = (x: number, y: number, w: number, h: number, rad: number) => {
        ctx.beginPath()
        ctx.moveTo(x + rad, y)
        ctx.lineTo(x + w - rad, y)
        ctx.arcTo(x + w, y, x + w, y + rad, rad)
        ctx.lineTo(x + w, y + h - rad)
        ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad)
        ctx.lineTo(x + rad, y + h)
        ctx.arcTo(x, y + h, x, y + h - rad, rad)
        ctx.lineTo(x, y + rad)
        ctx.arcTo(x, y, x + rad, y, rad)
        ctx.closePath()
      }

      // Background
      ctx.fillStyle = '#1a1c23'
      ctx.fillRect(0, 0, W, H)

      // Card
      const pad = 20, r = 16
      const cX = pad, cY = pad, cW = W - pad * 2, cH = H - pad * 2
      ctx.fillStyle = '#21242e'
      rr(cX, cY, cW, cH, r)
      ctx.fill()
      ctx.strokeStyle = 'rgba(201, 168, 76, 0.2)'
      ctx.lineWidth = 1
      rr(cX, cY, cW, cH, r)
      ctx.stroke()

      // Gold top bar (clip to card shape)
      ctx.save()
      rr(cX, cY, cW, cH, r)
      ctx.clip()
      ctx.fillStyle = '#c9a84c'
      ctx.fillRect(cX, cY, cW, 4)
      ctx.restore()

      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      const cx = W / 2

      // Eyebrow
      ctx.font = '600 11px "Instrument Sans", sans-serif'
      ctx.fillStyle = '#c9a84c'
      ctx.fillText('QUIZKANONEN', cx, cY + 40)

      // Player name
      const rawName = playerInfo.name
      const displayName = rawName.length > 26 ? rawName.slice(0, 26) + '…' : rawName
      ctx.font = '700 38px "Libre Baskerville", serif'
      ctx.fillStyle = '#ffffff'
      ctx.fillText(displayName, cx, cY + 90)

      // Quiz title
      const rawTitle = quiz?.title ?? ''
      const displayTitle = rawTitle.length > 50 ? rawTitle.slice(0, 50) + '…' : rawTitle
      ctx.font = '400 13px "Instrument Sans", sans-serif'
      ctx.fillStyle = '#7a7873'
      ctx.fillText(displayTitle, cx, cY + 116)

      // Divider
      ctx.strokeStyle = '#2a2d38'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(cX + 48, cY + 134)
      ctx.lineTo(cX + cW - 48, cY + 134)
      ctx.stroke()

      // Stats
      const statY = cY + 212
      if (topp !== null) {
        // Two columns: score | placement
        const col1x = cx - 130
        const col2x = cx + 130

        ctx.font = '700 52px "Libre Baskerville", serif'
        ctx.fillStyle = '#c9a84c'
        ctx.fillText(`${cCount}/${questions.length}`, col1x, statY)
        ctx.font = '500 11px "Instrument Sans", sans-serif'
        ctx.fillStyle = '#7a7873'
        ctx.fillText('RIKTIGE SVAR', col1x, statY + 28)

        // Column separator
        ctx.strokeStyle = '#2a2d38'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(cx, statY - 46)
        ctx.lineTo(cx, statY + 38)
        ctx.stroke()

        ctx.font = '700 42px "Libre Baskerville", serif'
        ctx.fillStyle = '#c9a84c'
        ctx.fillText(`Topp ${topp}%`, col2x, statY)
        ctx.font = '500 11px "Instrument Sans", sans-serif'
        ctx.fillStyle = '#7a7873'
        ctx.fillText('PLASSERING', col2x, statY + 28)
      } else {
        // Just score centered
        ctx.font = '700 58px "Libre Baskerville", serif'
        ctx.fillStyle = '#c9a84c'
        ctx.fillText(`${cCount}/${questions.length}`, cx, statY)
        ctx.font = '500 16px "Instrument Sans", sans-serif'
        ctx.fillStyle = '#e8e4dd'
        ctx.fillText('riktige svar', cx, statY + 36)
      }

      // Branding
      ctx.font = '400 11px "Instrument Sans", sans-serif'
      ctx.fillStyle = 'rgba(122, 120, 115, 0.45)'
      ctx.textAlign = 'right'
      ctx.fillText('quizkanonen.no', cX + cW - 20, cY + cH - 16)

      // Export
      const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'))
      if (!blob) { setCardShareState('idle'); return }

      const file = new File([blob], 'quizkanonen-resultat.png', { type: 'image/png' })
      const sharePayload = { files: [file], title: 'Quizkanonen', text: `${cCount}/${questions.length} riktige — kan du slå meg?` }

      if (navigator.share && navigator.canShare && navigator.canShare(sharePayload)) {
        await navigator.share(sharePayload)
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'quizkanonen-resultat.png'
        a.click()
        URL.revokeObjectURL(url)
      }

      setCardShareState('done')
      setTimeout(() => setCardShareState('idle'), 3000)
    } catch {
      setCardShareState('idle')
    }
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
      <p style={{color:'#e8e4dd',fontSize:14}}>Fant ikke quizen.</p>
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
        <span className="qk-result-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#7a7873" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </span>
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
      <div className="qk-panel">
      <p className="qk-eyebrow">Quizkanonen</p>
      <h1 className="qk-heading">{quiz.title}</h1>
      {quiz.category && (
        <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#7a7873', marginBottom: 16 }}>{quiz.category}</p>
      )}
      {!isTeamInput && (
        loggedInDisplayName
          ? <p className="qk-sub">Spiller som <strong style={{ color: '#e8e4dd' }}>{loggedInDisplayName}</strong>. Lykke til!</p>
          : <>
              <label className="qk-label">Navn</label>
              <input
                type="text"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                placeholder="Skriv inn navnet ditt..."
                className="qk-input"
                maxLength={30}
                onKeyDown={e => e.key === 'Enter' && startQuiz()}
                autoFocus
              />
              <p style={{ fontSize: 13, color: '#e8e4dd', marginTop: -12, marginBottom: 20 }}>
                Bruk ditt ekte navn — det er det som gjør det morsomt å vinne.
              </p>
            </>
      )}

      {resumeData && (
        <div className="qk-banner">🔄 Vi fant en påbegynt quiz — du fortsetter der du slapp.</div>
      )}

      {socialProof && socialProof.totalPlayers >= 1 && (
        <div className="qk-social-proof-wrap">
          <span className="qk-social-proof-dot" />
          <span style={{
            fontSize: 14, color: '#e8e4dd',
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
              <label className="qk-label">Lagnavn</label>
              <input type="text" value={nameInput} onChange={e => setNameInput(e.target.value)}
                placeholder="Skriv inn lagnavn..." className="qk-input" maxLength={30}
                onKeyDown={e => e.key === 'Enter' && startQuiz()} autoFocus />
              <label className="qk-label">Antall på laget</label>
              <div className="qk-sizes">
                {[2,3,4,5,6].map(n => (
                  <button key={n} onClick={() => setTeamSizeInput(n)}
                    className={`qk-size-btn${teamSizeInput === n ? ' active' : ''}`}>{n}</button>
                ))}
              </div>
              <p style={{ fontSize: 12, color: '#e8e4dd', marginTop: 8, textAlign: 'center' }}>
                Sesong-poeng registreres på deg som er innlogget.
              </p>
            </>
          )}
        </>
      )}

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button onClick={startQuiz} disabled={isTeamInput ? !nameInput.trim() : (!loggedInDisplayName && !nameInput.trim())} className="qk-btn-primary"
          style={{ width: 'auto', padding: '10px 28px', background: '#c9a84c', color: '#1a1c23' }}>
          {resumeData ? 'Fortsett quiz' : 'Start quiz'}
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3 2L11 7 3 12V2Z"/></svg>
        </button>
      </div>
      {startError && (
        <p style={{ textAlign: 'center', fontSize: 13, color: '#e8e4dd', marginTop: 12, lineHeight: 1.5 }}>
          {startError}
        </p>
      )}
      {!resumeData && (
        <p style={{ textAlign: 'center', marginTop: 10, fontSize: 13, color: '#e8e4dd' }}>
          Rangering: flest riktige vinner — ved likt, raskest tid.
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
        <button onClick={() => {
          navigator.clipboard.writeText(window.location.href).then(() => {
            setLinkCopied(true)
            setTimeout(() => setLinkCopied(false), 2000)
          }).catch(() => {})
        }} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 13, color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif",
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
    const timerBarColor = timerPercent > 60 ? '#4ade80' : timerPercent > 40 ? 'var(--gold)' : '#E24B4A'
    const correctSoFar = answers.filter(a => a.isCorrect).length
    const availableOptions = question?.shuffle_options
      ? shuffledDisplayOrder.filter(o => ['A','B','C','D'].slice(0, quiz.num_options).includes(o))
      : ['A','B','C','D'].slice(0, quiz.num_options)

    const getOptionClass = (opt: string) => {
      if (!answered) return ''
      const isCorrectOpt = opt === question?.correct_answer
      const isSelected = opt === selectedAnswer
      if (isCorrectOpt && isSelected) return ' correct-self'
      if (isCorrectOpt) return ' correct'
      if (isSelected) return ' wrong'
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

      {/* Canvas konfetti-overlay */}
      <canvas ref={canvasRef} style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 10000 }} />

      {/* Lagrings-feil ved finishQuiz */}
      {finishSaveError && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#21242e', border: '1px solid #2a2d38', borderRadius: 10, padding: '12px 20px', fontSize: 13, color: '#e8e4dd', zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
          {finishSaveError}
        </div>
      )}

      {/* Overlay-elementer — alltid i DOM, vises/skjules via ref.style.display (ingen React re-render) */}
      <div ref={flashRef} className="qk-flash-overlay" style={{ display: 'none' }} />
      <div ref={el => { ringRefs.current[0] = el }} className="qk-ring-el" style={{ display: 'none' }} />
      <div ref={el => { ringRefs.current[1] = el }} className="qk-ring-el" style={{ display: 'none' }} />
      <div ref={el => { ringRefs.current[2] = el }} className="qk-ring-el" style={{ display: 'none' }} />
      <div ref={scorePopRef} className="qk-score-pop-el" style={{ display: 'none' }}>+1</div>
      <div ref={streakMsgRef} className="qk-streak-msg-el" style={{ display: 'none' }} />

      {/* Intermediate screen */}
      {interPhase !== 'hidden' && (
        <QuizInterlude
          phase={interPhase}
          lastCorrect={interLastCorrect}
          correctAnswerText={interCorrectAnswerText}
          explanation={interExplanation}
          score={interScore}
          totalQuestions={questions.length}
          streak={interStreak}
          wrongInARow={interWrongInARow}
          questionIndex={interNextQNum - 2}
          low={interLow}
          high={interHigh}
          rival={rivalData}
          percentileData={percentileData}
          rankingSnapshot={rankingSnapshot ?? undefined}
          isPremium={isPremium}
          quizId={quizId}
          onNext={handleInterludeNext}
        />
      )}
      <div ref={playShellRef} className="qk-play-shell">
        <div className="qk-play-header">
          <span className="qk-progress-text">{currentIndex + 1} / {questions.length}</span>
          {quiz.category && (
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#7a7873' }}>{quiz.category}</span>
          )}
        </div>

        <span ref={timerRef} className="qk-timer">{timeLeft}s</span>
        <div className="qk-timer-bar-wrap">
          <div className="qk-timer-bar" style={{width:`${timerPercent}%`,background:timerBarColor}}/>
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
              <div className="qk-next-btn-wrap">
                <button onClick={goToNext} className="qk-btn-primary">
                  {currentIndex === questions.length - 1 ? 'Se resultatet' : 'Neste spørsmål'}
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3 2L11 7 3 12V2Z"/></svg>
                </button>
              </div>
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
      </h1>
      <p style={{fontSize:13,color:'#e8e4dd',marginBottom:24}}>{quiz.title}</p>

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

      {(() => {
        const categoryStats: Record<string, { correct: number; total: number }> = {}
        answers.forEach((ans, i) => {
          const q = questions[i]
          if (!q?.category) return
          if (!categoryStats[q.category]) categoryStats[q.category] = { correct: 0, total: 0 }
          categoryStats[q.category].total++
          if (ans.isCorrect) categoryStats[q.category].correct++
        })
        const cats = Object.entries(categoryStats)
        if (cats.length === 0) return null
        return (
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#7a7873', marginBottom: 10, textAlign: 'left' }}>
              Kategorier
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {cats.map(([cat, { correct, total }]) => {
                const pct = Math.round((correct / total) * 100)
                const isGood = pct >= 60
                return (
                  <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, color: '#e8e4dd', flex: 1, textAlign: 'left' }}>{cat}</span>
                    <div style={{ width: 100, height: 4, background: '#2a2d38', borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: isGood ? '#4ade80' : '#c94c4c', borderRadius: 4, transition: 'width 0.6s ease' }} />
                    </div>
                    <span style={{ fontSize: 11, color: isGood ? '#4ade80' : '#c94c4c', fontWeight: 600, width: 36, textAlign: 'right', flexShrink: 0 }}>
                      {correct}/{total}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {estimatedPlacement && estimatedPlacement.total > 1 && (() => {
        const prosent = Math.round(((estimatedPlacement.total - estimatedPlacement.low) / estimatedPlacement.total) * 100)
        const toppX = 100 - prosent
        const tierStart = estimatedPlacement.total <= 10
          ? 1
          : Math.max(1, Math.floor((estimatedPlacement.low - 1) / 10) * 10 + 1)
        const rangeY = estimatedPlacement.total <= 10
          ? estimatedPlacement.total
          : Math.min(estimatedPlacement.total, tierStart + 9)
        if (isPremium) {
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
              <div style={{ fontSize: 11, color: '#e8e4dd', marginTop: 6 }}>
                Plass {estimatedPlacement.low} · av {estimatedPlacement.total} deltakere
              </div>
            </div>
          )
        }
        return (
          <div style={{
            background: '#21242e',
            border: '0.5px solid #2a2d38',
            borderRadius: 16,
            padding: 16,
            textAlign: 'center',
            marginBottom: 14,
          }}>
            <div style={{ fontSize: 15, color: '#e8e4dd', marginBottom: 8 }}>
              Du er et sted mellom plass {tierStart} og {rangeY}
            </div>
            <div style={{ fontSize: 11, color: '#e8e4dd', marginBottom: 12 }}>
              av {estimatedPlacement.total} deltakere
            </div>
            <a href="/founders" style={{
              display: 'inline-block',
              fontSize: 13, fontWeight: 600, color: '#c9a84c',
              textDecoration: 'none',
            }}>
              Oppgrader til Premium for å se nøyaktig plassering →
            </a>
          </div>
        )
      })()}

      {/* ── Rival-kort ── */}
      {isLoggedIn && rivalData && (() => {
        const rivalScore = rivalData.score
        const outcome: 'won' | 'lost' | 'tied' =
          correctCount > rivalScore ? 'won' : correctCount < rivalScore ? 'lost' : 'tied'
        const name = rivalData.name

        const borderColor = outcome === 'won'
          ? 'rgba(76,175,125,0.3)'
          : outcome === 'lost'
            ? 'rgba(201,76,76,0.3)'
            : 'rgba(201,168,76,0.25)'

        const outcomeLabel = outcome === 'won' ? 'Du vant' : outcome === 'lost' ? 'Du tapte' : 'Likt'
        const outcomeLabelColor = outcome === 'won' ? '#4ade80' : outcome === 'lost' ? '#c94c4c' : '#c9a84c'

        const outcomeText = outcome === 'won'
          ? <>Du slo <span style={{ color: '#c9a84c', fontWeight: 600 }}>{name}</span> denne uken — <span style={{ color: '#c9a84c', fontWeight: 600 }}>{name}</span> fikk {rivalScore} riktige.</>
          : outcome === 'lost'
            ? <><span style={{ color: '#c9a84c', fontWeight: 600 }}>{name}</span> slo deg denne uken — <span style={{ color: '#c9a84c', fontWeight: 600 }}>{name}</span> fikk {rivalScore} riktige.</>
            : <>Likt med <span style={{ color: '#c9a84c', fontWeight: 600 }}>{name}</span> — begge fikk {rivalScore} riktige. Tiden avgjør.</>

        return (
          <div style={{
            background: '#21242e',
            border: `0.5px solid ${borderColor}`,
            borderRadius: 16,
            padding: '14px 16px',
            textAlign: 'left',
            marginBottom: 14,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
                textTransform: 'uppercase' as const, color: '#7a7873',
              }}>
                Rival
              </span>
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
                textTransform: 'uppercase' as const, color: outcomeLabelColor,
              }}>
                {outcomeLabel}
              </span>
            </div>
            <p style={{ fontSize: 14, color: '#e8e4dd', lineHeight: 1.5, margin: 0 }}>
              {outcomeText}
            </p>
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
          width:'100%',background:'transparent',border:'0.5px solid #2a2d38',
          borderRadius:10,padding:'8px 20px',fontSize:14,color:'#e8e4dd',
          fontFamily:"'Instrument Sans', sans-serif",cursor:'pointer',
        }}>
          {shareResultCopied ? 'Kopiert!' : 'Del resultatet →'}
        </button>

        {isLoggedIn && (
          <button
            onClick={generateAndShareCard}
            disabled={cardShareState === 'loading'}
            style={{
              width: '100%',
              background: 'transparent',
              border: '0.5px solid #2a2d38',
              borderRadius: 10,
              padding: '8px 20px',
              fontSize: 14,
              color: cardShareState === 'done' ? '#4ade80' : '#e8e4dd',
              fontFamily: "'Instrument Sans', sans-serif",
              cursor: cardShareState === 'loading' ? 'default' : 'pointer',
              opacity: cardShareState === 'loading' ? 0.6 : 1,
              transition: 'color 0.2s, opacity 0.2s',
            }}
          >
            {cardShareState === 'done'
              ? 'Lastet ned!'
              : cardShareState === 'loading'
                ? 'Genererer…'
                : 'Del resultatkort'}
          </button>
        )}

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
            <p style={{fontSize:13,color:'#e8e4dd',textAlign:'center'}}>
              Neste quiz: {displayStr}
            </p>
          )
        })()}


        {isLoggedIn && !isPremium && (
          <div style={{
            background: '#21242e',
            border: '1px solid rgba(201,168,76,0.15)',
            borderRadius: 16,
            padding: 28,
          }}>
            {/* Founders-badge */}
            {foundersData?.isFounders && (
              <div style={{ marginBottom: 12 }}>
                <span style={{
                  display: 'inline-block',
                  background: '#c9a84c',
                  color: '#1a1c23',
                  borderRadius: 20,
                  padding: '4px 12px',
                  fontSize: 12,
                  fontWeight: 700,
                  fontFamily: "'Instrument Sans', sans-serif",
                }}>
                  Founders-tilbud · {foundersData.remaining} plasser igjen
                </span>
              </div>
            )}
            <p style={{
              fontFamily: "'Libre Baskerville', serif",
              fontSize: 18,
              fontWeight: 700,
              color: '#ffffff',
              lineHeight: 1.3,
              marginBottom: 8,
            }}>
              {foundersData
                ? `Prøv Premium gratis i ${foundersData.daysFree} dager`
                : 'Følg fremgangen din uke etter uke'}
            </p>
            <ul style={{ listStyle: 'none', margin: '0 0 20px', padding: 0 }}>
              {[
                'Nøyaktig plassering på topplisten',
                'Historikk fra alle quizer du har spilt',
                'Sesong-leaderboard — konkurrér over tid',
              ].map(txt => (
                <li key={txt} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: '#e8e4dd', marginBottom: 8 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#c9a84c', flexShrink: 0 }} />
                  {txt}
                </li>
              ))}
            </ul>
            <a href="/founders" style={{
              display: 'inline-block',
              padding: '10px 28px',
              background: 'transparent',
              border: '1px solid #e8e4dd',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              color: '#e8e4dd',
              textDecoration: 'none',
            }}>
              {foundersData?.isFounders
                ? `Aktiver ${foundersData.daysFree} dager gratis — ingen kortinfo →`
                : foundersData
                  ? `Start ${foundersData.daysFree} dager gratis →`
                  : 'Prøv gratis i 30 dager →'}
            </a>
            {foundersData?.isFounders && (
              <p style={{ fontSize: 12, color: '#7a7873', marginTop: 10, textAlign: 'center' }}>
                Kun {foundersData.remaining} plasser igjen
              </p>
            )}
            {!foundersData?.isFounders && (
              <p style={{ fontSize: 12, color: '#7a7873', marginTop: 10, textAlign: 'center' }}>
                Ingen kortinfo nødvendig
              </p>
            )}
          </div>
        )}

        {isLoggedIn && (
          <p style={{ textAlign: 'center', marginTop: 4, marginBottom: 8 }}>
            <a href="/liga" style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>
              Spill mot vennene dine → Opprett en liga
            </a>
          </p>
        )}

        {orgBox && (
          <div style={{
            background: 'rgba(201,168,76,0.06)',
            border: '0.5px solid rgba(201,168,76,0.15)',
            borderRadius: 10,
            padding: '12px 16px',
            textAlign: 'left',
          }}>
            <p style={{ fontSize: 13, color: '#e8e4dd', lineHeight: 1.5, marginBottom: 6 }}>
              {orgBox.userRank
                ? `Du er nr. ${orgBox.userRank} blant kollegene dine hos ${orgBox.orgName} denne måneden`
                : `Se hvordan du rangerer blant kollegene dine hos ${orgBox.orgName}`}
            </p>
            <a href={`/org/${orgBox.orgSlug}`} style={{ fontSize: 13, color: '#c9a84c', textDecoration: 'none' }}>
              Se bedriftens toppliste →
            </a>
          </div>
        )}

        <a href="/" className="qk-btn-ghost">← Tilbake til forsiden</a>
      </div>

      {ligaBox && (
        <div style={{ marginTop: 12, background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '16px 20px', textAlign: 'left' }}>
          {ligaBox.type === 'liga' ? (
            <a href={`/liga/${ligaBox.slug}`} style={{ textDecoration: 'none' }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: '#e8e4dd', marginBottom: 3 }}>
                Se hvordan du gjør det mot vennene dine →
              </p>
              <p style={{ fontSize: 12, color: '#e8e4dd' }}>{ligaBox.name}</p>
            </a>
          ) : ligaBox.type === 'multi' ? (
            <a href="/liga" style={{ textDecoration: 'none' }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: '#e8e4dd', marginBottom: 3 }}>
                Se hvordan du gjør det mot vennene dine →
              </p>
              <p style={{ fontSize: 12, color: '#e8e4dd' }}>Se dine ligaer</p>
            </a>
          ) : (
            <a href="/liga" style={{ textDecoration: 'none' }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: '#e8e4dd', marginBottom: 3 }}>
                Konkurrer mot venner
              </p>
              <p style={{ fontSize: 12, color: '#e8e4dd' }}>Opprett en privat liga og inviter vennegjengen</p>
            </a>
          )}
        </div>
      )}
    </div></div></div></>
  )
}