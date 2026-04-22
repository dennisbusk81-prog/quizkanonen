'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { Session } from '@supabase/supabase-js'

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

const EXTRA_STYLES = `
  .tp-tab-row::-webkit-scrollbar { display: none; }
  .tp-tab-row { scrollbar-width: none; -ms-overflow-style: none; }
  .tp-accordion-wrap {
    border: 1px solid #3a3d4a;
    border-radius: 16px;
    overflow: hidden;
    transition: border-color 150ms ease;
  }
  .tp-accordion-wrap:hover { border-color: #c9a84c; }
  .tp-accordion-btn {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 18px;
    cursor: pointer;
    background: #21242e;
    border: none;
    width: 100%;
    text-align: left;
    font-family: 'Instrument Sans', sans-serif;
    transition: background 150ms ease;
  }
  .tp-accordion-btn:hover { background: #262930; }
`

// ── Types ─────────────────────────────────────────────────────────────────────

type Period = 'last_quiz' | 'month' | 'quarter' | 'year' | 'alltime'
type BadgeKind = 'krone' | 'flamme' | 'lyn' | 'medalje'

type Entry = {
  rank: number
  userId: string
  displayName: string
  avatarUrl: string | null
  points: number
  quizCount: number
  topStreak: number
  fastestMs: number | null
}

type UserEntry = {
  rank: number
  displayName: string
  avatarUrl: string | null
  points: number
  quizCount: number
}

type ApiResponse = {
  entries: Entry[]
  userEntry: UserEntry | null
  userIsPremium: boolean
  quizTitle?: string | null
}

type HistoryWinner = {
  displayName: string
  avatarUrl: string | null
  score: number
  scoreLabel: string
}

type HistoryEntry = {
  key: string
  label: string
  closesAt: string
  quizId?: string
  winner: HistoryWinner | null
}

type ExpandedEntry = {
  rank: number
  userId: string
  displayName: string
  avatarUrl: string | null
  points: number
  quizCount: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<Period, string> = {
  last_quiz: 'Siste quiz',
  month:     'Måned',
  quarter:   'Kvartal',
  year:      'År',
  alltime:   'All-time',
}

const HISTORY_TITLE: Record<Exclude<Period, 'alltime'>, string> = {
  last_quiz: 'Tidligere quizer',
  month:     'Tidligere måneder',
  quarter:   'Tidligere kvartaler',
  year:      'Tidligere år',
}

const NB_MONTHS = ['Januar','Februar','Mars','April','Mai','Juni','Juli','August','September','Oktober','November','Desember']

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}

function getCountdown(period: Period): string | null {
  if (period === 'alltime' || period === 'last_quiz') return null
  const now = new Date()
  let end: Date
  if (period === 'month') {
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  } else if (period === 'quarter') {
    const q = Math.floor(now.getMonth() / 3)
    end = new Date(now.getFullYear(), (q + 1) * 3, 0)
  } else {
    end = new Date(now.getFullYear(), 11, 31)
  }
  const days = Math.ceil((end.getTime() - now.getTime()) / 86400000)
  const label = period === 'month' ? 'måneden' : period === 'quarter' ? 'kvartalet' : 'året'
  return `${days} dager igjen av ${label}`
}

function formatHistoryLabel(key: string, period: Period): string {
  if (period === 'month') {
    const [year, month] = key.split('-').map(Number)
    return `${NB_MONTHS[month - 1]} ${year}`
  }
  if (period === 'quarter') {
    const [year, q] = key.split('-Q')
    return `K${q} ${year}`
  }
  return key
}

function getPeriodRange(key: string, period: 'month' | 'quarter' | 'year'): { start: string; end: string } {
  if (period === 'month') {
    const [year, month] = key.split('-').map(Number)
    return {
      start: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
      end:   new Date(Date.UTC(year, month, 1)).toISOString(),
    }
  }
  if (period === 'quarter') {
    const [yearStr, qStr] = key.split('-Q')
    const year = parseInt(yearStr)
    const q = parseInt(qStr) - 1
    return {
      start: new Date(Date.UTC(year, q * 3, 1)).toISOString(),
      end:   new Date(Date.UTC(year, (q + 1) * 3, 1)).toISOString(),
    }
  }
  const year = parseInt(key)
  return {
    start: new Date(Date.UTC(year, 0, 1)).toISOString(),
    end:   new Date(Date.UTC(year + 1, 0, 1)).toISOString(),
  }
}

function assignBadges(entries: Entry[]): Map<string, BadgeKind> {
  const badges = new Map<string, BadgeKind>()
  if (entries[0]) badges.set(entries[0].userId, 'krone')
  let flamme: Entry | null = null
  for (const e of entries) {
    if (badges.has(e.userId)) continue
    if (e.topStreak >= 3 && (!flamme || e.topStreak > flamme.topStreak)) flamme = e
  }
  if (flamme) badges.set(flamme.userId, 'flamme')
  let lyn: Entry | null = null
  for (const e of entries) {
    if (badges.has(e.userId)) continue
    if (e.fastestMs !== null && (!lyn || e.fastestMs < lyn.fastestMs!)) lyn = e
  }
  if (lyn) badges.set(lyn.userId, 'lyn')
  for (const e of entries) {
    if (e.rank >= 2 && e.rank <= 3 && !badges.has(e.userId)) badges.set(e.userId, 'medalje')
  }
  return badges
}

// ── Sub-components ────────────────────────────────────────────────────────────

function BadgeCircle({ badge, size = 18 }: { badge: BadgeKind; size?: number }) {
  const bg = badge === 'krone' ? '#c9a84c' : badge === 'flamme' ? '#E24B4A' : badge === 'lyn' ? '#7ABFFF' : '#639922'
  const iconSize = Math.round(size * 0.65)
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width={iconSize} height={iconSize} viewBox="0 0 16 16" fill="none">
        {badge === 'krone'   && <path d="M2 8L4 3L8 6L12 3L14 8H2Z" fill="#1a1c23"/>}
        {badge === 'flamme'  && <path d="M8 2C8 2 12 5 12 8.5C12 11 10 13 8 14C6 13 4 11 4 8.5C4 5 8 2 8 2Z" fill="white"/>}
        {badge === 'lyn'     && <path d="M10 2L5 9H9L6 14L13 6H9L10 2Z" fill="white"/>}
        {badge === 'medalje' && <circle cx="8" cy="8" r="4" fill="white"/>}
      </svg>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  spinner:  { fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#7a7873', fontStyle: 'italic' as const },
  spinWrap: { padding: '56px 0', textAlign: 'center' as const },

  tabRow:      { display: 'flex', borderBottom: '1px solid #2a2d38', marginBottom: 20, marginTop: 4, overflowX: 'auto' as const, msOverflowStyle: 'none' as const },
  tabActive:   { padding: '10px 16px', background: 'none', border: 'none', borderBottom: '2px solid #c9a84c', marginBottom: -1, fontSize: 13, fontWeight: 600, color: '#c9a84c', fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer', whiteSpace: 'nowrap' as const, flexShrink: 0 },
  tabInactive: { padding: '10px 16px', background: 'none', border: 'none', borderBottom: '2px solid transparent', marginBottom: -1, fontSize: 13, fontWeight: 600, color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer', whiteSpace: 'nowrap' as const, flexShrink: 0 },

  countdown: { fontSize: 12, color: '#7a7873', textAlign: 'center' as const, marginBottom: 20, letterSpacing: '0.04em' },
  quizLabel: { fontSize: 12, color: '#7a7873', textAlign: 'center' as const, marginBottom: 20, letterSpacing: '0.02em' },

  row:        { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8, position: 'relative' as const, overflow: 'hidden' as const },
  rowGold:    { background: 'linear-gradient(135deg, rgba(201,168,76,0.07) 0%, #21242e 60%)', border: '1px solid rgba(201,168,76,0.22)', borderRadius: 20, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8, position: 'relative' as const, overflow: 'hidden' as const },
  goldStripe: { position: 'absolute' as const, left: 0, top: 0, bottom: 0, width: 3, background: '#c9a84c', borderRadius: '3px 0 0 3px' },

  rankCell: { width: 28, textAlign: 'center' as const, flexShrink: 0 },
  rankNum:  { fontFamily: "'Libre Baskerville', serif", fontSize: 15, fontWeight: 700, color: '#7a7873', display: 'block' },

  avatarWrap: { position: 'relative' as const, width: 40, height: 40, flexShrink: 0 },
  avatarImg:  { width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' as const, display: 'block' },
  avatarInit: { width: 40, height: 40, borderRadius: '50%', background: '#2a2d38', border: '1.5px solid rgba(201,168,76,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: '#c9a84c' },
  badgePos:   { position: 'absolute' as const, bottom: -1, right: -1, border: '2px solid #1a1c23', borderRadius: '50%' },

  nameBlock: { flex: 1, minWidth: 0 },
  name:      { fontFamily: "'Libre Baskerville', serif", fontSize: 15, fontWeight: 700, color: '#ffffff', whiteSpace: 'nowrap' as const, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, marginBottom: 2 },
  nameSub:   { fontSize: 11, color: '#7a7873' },

  pointsBlock: { textAlign: 'right' as const, flexShrink: 0 },
  points:      { fontFamily: "'Libre Baskerville', serif", fontSize: 20, fontWeight: 700, color: '#c9a84c', lineHeight: '1', marginBottom: 2 },
  pointsSub:   { fontSize: 10, color: '#7a7873', letterSpacing: '0.04em' },

  sectionHeader: { display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0 10px' },
  sectionText:   { fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#7a7873', whiteSpace: 'nowrap' as const },
  sectionLine:   { flex: 1, height: 1, background: '#2a2d38' },

  userCard:     { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '20px 24px', marginTop: 8 },
  userCardGold: { background: 'rgba(201,168,76,0.04)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 20, padding: '20px 24px', marginTop: 8 },

  ctaText:    { fontSize: 14, color: '#7a7873', lineHeight: 1.6, marginBottom: 14 },
  btnGold:    { display: 'inline-block', background: '#c9a84c', color: '#0f0f10', fontFamily: "'Instrument Sans', sans-serif", fontSize: 14, fontWeight: 700, padding: '10px 24px', borderRadius: 10, textDecoration: 'none' },
  btnOutline: { display: 'inline-block', background: 'transparent', color: '#e8e4dd', border: '0.5px solid #2a2d38', fontFamily: "'Instrument Sans', sans-serif", fontSize: 14, fontWeight: 600, padding: '10px 24px', borderRadius: 10, textDecoration: 'none' },

  legendRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, fontSize: 13, color: '#e8e4dd' },

  empty:      { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '56px 32px', textAlign: 'center' as const, marginTop: 12 },
  emptyTitle: { fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#ffffff', marginBottom: 8 },
  emptySub:   { fontSize: 13, color: '#7a7873', lineHeight: 1.6 },

  // Historikk-accordion
  histAccordion:   { marginTop: 20, overflow: 'hidden' as const },
  histHeaderTitle: { fontSize: 13, fontWeight: 600, color: '#e8e4dd' },
  histHeaderChev:  { fontSize: 11, color: '#c9a84c' },
  histBody:        { background: '#21242e', borderTop: '1px solid #2a2d38' },
  histEmpty:       { padding: '24px 18px', fontSize: 13, color: '#7a7873', textAlign: 'center' as const },

  histRow:         { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: '0.5px solid #2a2d38', cursor: 'pointer' },
  histRowLast:     { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px' },
  histRowQuiz:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderBottom: '0.5px solid #2a2d38' },
  histRowQuizLast: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px' },
  histPeriodLabel: { fontSize: 13, fontWeight: 600, color: '#ffffff', minWidth: 120, flexShrink: 0 },
  histWinner:      { display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
  histWinnerName:  { fontSize: 13, color: '#e8e4dd', overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const },
  histWinnerScore: { fontSize: 12, color: '#c9a84c', fontWeight: 600, flexShrink: 0 },
  histChevron:     { fontSize: 11, color: '#7a7873', flexShrink: 0, marginLeft: 8 },
  histAvatarSm:    { width: 24, height: 24, borderRadius: '50%', background: '#2a2d38', border: '1px solid rgba(201,168,76,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#c9a84c', flexShrink: 0, overflow: 'hidden' as const },

  expandedWrap:  { background: '#1a1c23', borderTop: '0.5px solid #2a2d38', padding: '12px 18px' },
  expandedRow:   { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '0.5px solid rgba(42,45,56,0.6)' },
  expandedRank:  { fontSize: 12, color: '#7a7873', width: 22, flexShrink: 0, textAlign: 'right' as const },
  expandedName:  { fontSize: 13, color: '#e8e4dd', flex: 1, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const },
  expandedScore: { fontSize: 13, fontWeight: 600, color: '#c9a84c', flexShrink: 0 },
  expandedSpin:  { padding: '12px 0', fontSize: 12, color: '#7a7873', textAlign: 'center' as const },
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  scope: 'global' | 'league' | 'organization'
  scopeId?: string | null
  loginHref?: string
  globalLeagueDisabled?: boolean
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SeasonLeaderboard({ scope, scopeId, loginHref = '/login?next=/toppliste', globalLeagueDisabled }: Props) {
  const scopeInfix = scope === 'league' ? ' i ligaen' : scope === 'organization' ? ' i bedriften' : ''
  const notPlayedSuffix = scope !== 'global' ? ' Bli med de andre!' : ''

  const EMPTY_TEXT: Record<Period, { title: string; sub: string }> = {
    last_quiz: { title: 'Ingen avsluttede quizer ennå',                       sub: 'Kom tilbake etter at ukens quiz er stengt.' },
    month:     { title: `Ingen${scopeInfix} har spilt denne måneden ennå`,    sub: 'Spill en quiz for å komme på listen!' },
    quarter:   { title: `Ingen${scopeInfix} har spilt dette kvartalet ennå`,  sub: 'Spill en quiz for å komme på listen!' },
    year:      { title: `Ingen${scopeInfix} har spilt i år ennå`,             sub: 'Spill en quiz for å komme på listen!' },
    alltime:   { title: `Ingen${scopeInfix} har spilt ennå`,                  sub: 'Spill en quiz for å komme på listen!' },
  }

  const NOT_PLAYED_TEXT: Record<Period, string> = {
    last_quiz: 'Du spilte ikke ukens quiz.',
    month:     `Du har ikke spilt ennå denne måneden.${notPlayedSuffix}`,
    quarter:   `Du har ikke spilt ennå dette kvartalet.${notPlayedSuffix}`,
    year:      `Du har ikke spilt ennå i år.${notPlayedSuffix}`,
    alltime:   'Du har ikke spilt ennå.',
  }

  const [period, setPeriod]           = useState<Period>('last_quiz')
  const [data, setData]               = useState<ApiResponse | null>(null)
  const [loading, setLoading]         = useState(true)
  const [session, setSession]         = useState<Session | null | undefined>(undefined)
  const [pointsOpen, setPointsOpen]   = useState(false)

  const [histOpen, setHistOpen]         = useState(false)
  const [histData, setHistData]         = useState<HistoryEntry[] | null>(null)
  const [histLoading, setHistLoading]   = useState(false)
  const [expandedKey, setExpandedKey]   = useState<string | null>(null)
  const [expandedData, setExpandedData] = useState<Map<string, ExpandedEntry[] | 'loading'>>(new Map())

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  // Hent toppliste-data
  useEffect(() => {
    if (session === undefined) return
    let cancelled = false
    setLoading(true)
    setData(null)

    async function load() {
      const headers: Record<string, string> = {}
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
      try {
        let url = `/api/toppliste?period=${period}&scope=${scope}`
        if (scopeId) url += `&scope_id=${encodeURIComponent(scopeId)}`
        const res = await fetch(url, { headers })
        if (cancelled) return
        if (!res.ok) { if (!cancelled) setData(null); return }
        const json = await res.json()
        if (!cancelled) setData(json)
      } catch {
        if (!cancelled) setData(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [period, session, scope, scopeId])

  // Reset historikk når periode bytter
  useEffect(() => {
    setHistOpen(false)
    setHistData(null)
    setExpandedKey(null)
    setExpandedData(new Map())
  }, [period])

  // Hent historikk-data (lat)
  const loadHistory = useCallback(async () => {
    if (histData !== null || period === 'alltime') return
    setHistLoading(true)
    try {
      let url = `/api/toppliste/history?period=${period}&scope=${scope}`
      if (scopeId) url += `&scope_id=${encodeURIComponent(scopeId)}`
      const res = await fetch(url)
      if (res.ok) {
        const json = await res.json()
        setHistData(json.entries ?? [])
      } else {
        setHistData([])
      }
    } catch {
      setHistData([])
    } finally {
      setHistLoading(false)
    }
  }, [histData, period, scope, scopeId])

  const toggleHistory = () => {
    const willOpen = !histOpen
    setHistOpen(willOpen)
    if (willOpen) loadHistory()
  }

  // Hent topp 10 for historisk periode (ved klikk)
  async function loadExpanded(key: string) {
    if (expandedKey === key) { setExpandedKey(null); return }
    setExpandedKey(key)
    if (expandedData.has(key)) return
    setExpandedData(prev => new Map(prev).set(key, 'loading'))
    try {
      const range = getPeriodRange(key, period as 'month' | 'quarter' | 'year')
      let url = `/api/toppliste?scope=${scope}&period_start=${encodeURIComponent(range.start)}&period_end=${encodeURIComponent(range.end)}&period=${period}`
      if (scopeId) url += `&scope_id=${encodeURIComponent(scopeId)}`
      const res = await fetch(url)
      if (!res.ok) throw new Error()
      const json = await res.json()
      const entries: ExpandedEntry[] = (json.entries ?? []).map((e: Entry) => ({
        rank: e.rank, userId: e.userId, displayName: e.displayName,
        avatarUrl: e.avatarUrl, points: e.points, quizCount: e.quizCount,
      }))
      setExpandedData(prev => new Map(prev).set(key, entries))
    } catch {
      setExpandedData(prev => new Map(prev).set(key, []))
    }
  }

  const countdown  = getCountdown(period)
  const badges     = data ? assignBadges(data.entries) : new Map<string, BadgeKind>()
  const isLastQuiz = period === 'last_quiz'
  const showHistory = period !== 'alltime'
  const emptyText  = EMPTY_TEXT[period]

  // ── Row renderers ─────────────────────────────────────────────────────────

  function renderRow(entry: Entry) {
    const isFirst = entry.rank === 1
    const badge   = badges.get(entry.userId)
    const initial = entry.displayName[0]?.toUpperCase() ?? '?'

    return (
      <div key={entry.userId} style={isFirst ? s.rowGold : s.row}>
        {isFirst && <div style={s.goldStripe} />}
        <div style={s.rankCell}><span style={s.rankNum}>#{entry.rank}</span></div>
        <div style={s.avatarWrap}>
          {entry.avatarUrl
            ? <img src={entry.avatarUrl} alt="" style={s.avatarImg} referrerPolicy="no-referrer" />
            : <div style={s.avatarInit}>{initial}</div>
          }
          {badge && <div style={s.badgePos}><BadgeCircle badge={badge} size={18} /></div>}
        </div>
        <div style={s.nameBlock}>
          <div style={s.name}>{entry.displayName}</div>
          <div style={s.nameSub}>
            {isLastQuiz
              ? formatTime(entry.fastestMs ?? 0)
              : `${entry.quizCount} ${entry.quizCount === 1 ? 'quiz' : 'quizer'}`
            }
          </div>
        </div>
        <div style={s.pointsBlock}>
          <div style={s.points}>{entry.points}</div>
          <div style={s.pointsSub}>{isLastQuiz ? 'RIKTIGE' : 'POENG'}</div>
        </div>
      </div>
    )
  }

  function renderUserSection() {
    if (session === undefined) return null
    if (!session) {
      return (
        <>
          <div style={s.sectionHeader}>
            <span style={s.sectionText}>Din plassering</span>
            <div style={s.sectionLine} />
          </div>
          <div style={s.userCard}>
            <p style={s.ctaText}>Logg inn for å se din plassering på topplisten.</p>
            <Link href={loginHref} style={s.btnGold}>Logg inn</Link>
          </div>
        </>
      )
    }
    if (!data) return null

    const ue = data.userEntry
    if (ue && ue.rank <= 10) return null

    if (ue && ue.rank > 10) {
      const initial = ue.displayName[0]?.toUpperCase() ?? '?'
      if (!data.userIsPremium) {
        return (
          <>
            <div style={s.sectionHeader}><span style={s.sectionText}>Din plassering</span><div style={s.sectionLine} /></div>
            <div style={s.userCard}>
              <p style={{ fontSize: 14, color: '#7a7873', lineHeight: 1.6, marginBottom: 6 }}>
                Du er på plass <strong style={{ color: '#e8e4dd' }}>#{ue.rank}</strong> — men du trenger Premium for å se fullstendig statistikk.
              </p>
              <Link href="/founders" style={s.btnOutline}>Oppgrader til Premium</Link>
            </div>
          </>
        )
      }
      return (
        <>
          <div style={s.sectionHeader}><span style={s.sectionText}>Din plassering</span><div style={s.sectionLine} /></div>
          <div style={s.userCardGold}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={s.rankCell}><span style={{ ...s.rankNum, color: '#c9a84c' }}>#{ue.rank}</span></div>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#2a2d38', border: '1.5px solid rgba(201,168,76,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: '#c9a84c', flexShrink: 0, overflow: 'hidden' }}>
                {ue.avatarUrl
                  ? <img src={ue.avatarUrl} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', display: 'block' }} referrerPolicy="no-referrer" />
                  : initial
                }
              </div>
              <div style={s.nameBlock}>
                <div style={s.name}>{ue.displayName}</div>
                <div style={s.nameSub}>{isLastQuiz ? `${ue.points} riktige` : `${ue.quizCount} ${ue.quizCount === 1 ? 'quiz' : 'quizer'}`}</div>
              </div>
              <div style={s.pointsBlock}>
                <div style={s.points}>{ue.points}</div>
                <div style={s.pointsSub}>{isLastQuiz ? 'RIKTIGE' : 'POENG'}</div>
              </div>
            </div>
          </div>
        </>
      )
    }

    return (
      <>
        <div style={s.sectionHeader}><span style={s.sectionText}>Din plassering</span><div style={s.sectionLine} /></div>
        <div style={s.userCard}>
          <p style={{ ...s.ctaText, marginBottom: 12 }}>{NOT_PLAYED_TEXT[period]}</p>
          <a href="/" style={s.btnOutline}>Se ukens quiz →</a>
        </div>
      </>
    )
  }

  function renderHistoryRow(entry: HistoryEntry, isLast: boolean) {
    const label   = isLastQuiz ? entry.label : formatHistoryLabel(entry.key, period)
    const initial = entry.winner?.displayName?.[0]?.toUpperCase() ?? '?'
    const isExpanded = expandedKey === entry.key
    const expanded   = expandedData.get(entry.key)

    if (isLastQuiz) {
      const rowStyle = isLast ? s.histRowQuizLast : s.histRowQuiz
      return (
        <div key={entry.key}>
          <div style={rowStyle}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={s.histPeriodLabel}>{label}</div>
              {entry.winner && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <div style={s.histAvatarSm}>
                    {entry.winner.avatarUrl
                      ? <img src={entry.winner.avatarUrl} alt="" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} referrerPolicy="no-referrer" />
                      : initial
                    }
                  </div>
                  <span style={s.histWinnerName}>{entry.winner.displayName}</span>
                  <span style={s.histWinnerScore}>{entry.winner.score} {entry.winner.scoreLabel}</span>
                </div>
              )}
              {!entry.winner && <div style={{ fontSize: 12, color: '#7a7873', marginTop: 4 }}>Ingen innloggede spillere</div>}
            </div>
            {entry.quizId && (
              <a href={`/leaderboard/${entry.quizId}`} style={{ fontSize: 12, color: '#e8e4dd', textDecoration: 'none', flexShrink: 0, marginLeft: 12 }}>
                Se toppliste →
              </a>
            )}
          </div>
        </div>
      )
    }

    const rowStyle = isLast && !isExpanded ? s.histRowLast : s.histRow
    return (
      <div key={entry.key}>
        <div style={rowStyle} onClick={() => loadExpanded(entry.key)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && loadExpanded(entry.key)}>
          <div style={s.histPeriodLabel}>{label}</div>
          <div style={s.histWinner}>
            {entry.winner ? (
              <>
                <div style={s.histAvatarSm}>
                  {entry.winner.avatarUrl
                    ? <img src={entry.winner.avatarUrl} alt="" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} referrerPolicy="no-referrer" />
                    : initial
                  }
                </div>
                <span style={s.histWinnerName}>{entry.winner.displayName}</span>
                <span style={s.histWinnerScore}>{entry.winner.score} {entry.winner.scoreLabel}</span>
              </>
            ) : (
              <span style={{ fontSize: 12, color: '#7a7873' }}>Ingen data</span>
            )}
          </div>
          <span style={s.histChevron}>{isExpanded ? '↑' : '↓'}</span>
        </div>
        {isExpanded && expanded !== undefined && (
          <div style={s.expandedWrap}>
            {expanded === 'loading' ? (
              <div style={s.expandedSpin}>Laster…</div>
            ) : expanded.length === 0 ? (
              <div style={s.expandedSpin}>Ingen data for denne perioden</div>
            ) : (
              expanded.map((e, i) => (
                <div key={e.userId} style={{ ...s.expandedRow, borderBottom: i === expanded.length - 1 ? 'none' : '0.5px solid rgba(42,45,56,0.6)' }}>
                  <span style={s.expandedRank}>#{e.rank}</span>
                  <span style={s.expandedName}>{e.displayName}</span>
                  <span style={s.expandedScore}>{e.points} poeng</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    )
  }

  function renderHistoryAccordion() {
    if (!showHistory) return null
    const title = HISTORY_TITLE[period as Exclude<Period, 'alltime'>]
    return (
      <div className="tp-accordion-wrap" style={s.histAccordion}>
        <button className="tp-accordion-btn" onClick={toggleHistory}>
          <span style={s.histHeaderTitle}>{title}</span>
          <span style={s.histHeaderChev}>{histOpen ? '↑' : '↓'}</span>
        </button>
        {histOpen && (
          <div style={s.histBody}>
            {histLoading ? (
              <div style={s.histEmpty}>Laster…</div>
            ) : !histData || histData.length === 0 ? (
              <div style={s.histEmpty}>Ingen avsluttede perioder ennå — kom tilbake om en stund</div>
            ) : (
              histData.map((entry, i) => renderHistoryRow(entry, i === histData.length - 1))
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading && !data) {
    return (
      <>
        <style>{FONT_IMPORT + EXTRA_STYLES}</style>
        <div style={s.spinWrap}><p style={s.spinner}>Laster toppliste…</p></div>
      </>
    )
  }

  return (
    <>
      <style>{FONT_IMPORT + EXTRA_STYLES}</style>

      {/* Fane-rad */}
      <div className="tp-tab-row" style={s.tabRow}>
        {(['last_quiz', 'month', 'quarter', 'year', 'alltime'] as Period[]).map(p => (
          <button key={p} style={period === p ? s.tabActive : s.tabInactive} onClick={() => setPeriod(p)}>
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {scope === 'organization' && globalLeagueDisabled && (
        <p style={{ fontSize: 13, color: '#7a7873', textAlign: 'center', margin: '8px 0 4px' }}>
          Global konkurranse er deaktivert for din bedrift.
        </p>
      )}

      {isLastQuiz && data?.quizTitle && (
        <p style={s.quizLabel}>Siste quiz: <em>{data.quizTitle}</em></p>
      )}

      {countdown && <p style={s.countdown}>{countdown}</p>}

      {/* Poengforklaring — skjult for last_quiz */}
      {!isLastQuiz && (
        <div className="tp-accordion-wrap" style={{ marginBottom: 16 }}>
          <button className="tp-accordion-btn" onClick={() => setPointsOpen(o => !o)}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#e8e4dd' }}>Hvordan beregnes poeng?</span>
            <span style={{ fontSize: 11, color: '#c9a84c' }}>{pointsOpen ? '↑' : '↓'}</span>
          </button>
          {pointsOpen && (
            <div style={{ background: '#21242e', borderTop: '1px solid #2a2d38', padding: '14px 18px' }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#7a7873', marginBottom: 10 }}>Poengfordeling per quiz</div>
              {[['1. plass','12 poeng'],['2. plass','10 poeng'],['3. plass','8 poeng'],['4. plass','7 poeng'],['5. plass','6 poeng'],['6. plass','5 poeng'],['7. plass','4 poeng'],['8. plass','3 poeng'],['9. plass','2 poeng'],['10. plass','1 poeng'],['11+ plass','1 poeng']].map(([place, pts]) => (
                <div key={place} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#e8e4dd', padding: '3px 0', borderBottom: '0.5px solid #2a2d38' }}>
                  <span style={{ color: '#7a7873' }}>{place}</span>
                  <span style={{ fontWeight: 600 }}>{pts}</span>
                </div>
              ))}
              <p style={{ fontSize: 11, color: '#7a7873', fontStyle: 'italic', marginTop: 10, marginBottom: 0, lineHeight: 1.5 }}>
                Poengene summeres over alle quizer i perioden. Konsistens belønnes.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Topp 10 */}
      {!loading && data?.entries.length === 0 ? (
        <div style={s.empty}>
          <p style={s.emptyTitle}>{emptyText.title}</p>
          <p style={s.emptySub}>{emptyText.sub}</p>
        </div>
      ) : (
        data?.entries.map(entry => renderRow(entry))
      )}

      {/* Historikk-accordion */}
      {renderHistoryAccordion()}

      {/* Din plassering */}
      {renderUserSection()}

      {/* Badge-forklaring */}
      <div style={{ marginTop: 24, padding: '0 2px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#7a7873', marginBottom: 10 }}>Hva betyr badgene?</div>
        <div style={s.legendRow}><BadgeCircle badge="krone" size={20} /><span>Krone — #1 på topplisten denne perioden</span></div>
        <div style={s.legendRow}><BadgeCircle badge="flamme" size={20} /><span>Flamme — lengst aktiv streak (minst 3 uker)</span></div>
        <div style={s.legendRow}><BadgeCircle badge="lyn" size={20} /><span>Lyn — raskeste fullførte quiz</span></div>
        <div style={{ ...s.legendRow, marginBottom: 0 }}><BadgeCircle badge="medalje" size={20} /><span>Medalje — topp 3 denne perioden</span></div>
      </div>

      <p style={{ fontSize: 12, color: '#7a7873', textAlign: 'center', marginTop: 16, lineHeight: 1.5 }}>
        Lagets sesong-poeng registreres på innlogget lagleder.
      </p>
    </>
  )
}
