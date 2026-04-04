'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import UserMenuWrapper from '@/components/UserMenuWrapper'
import type { Session } from '@supabase/supabase-js'

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

type Period = 'month' | 'quarter' | 'year' | 'alltime'
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
}

const PERIOD_LABELS: Record<Period, string> = {
  month: 'Måned',
  quarter: 'Kvartal',
  year: 'År',
  alltime: 'All-time',
}

function formatTime(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}

function getCountdown(period: Period): string | null {
  if (period === 'alltime') return null
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

function assignBadges(entries: Entry[]): Map<string, BadgeKind> {
  const badges = new Map<string, BadgeKind>()

  // krone: rank 1
  if (entries[0]) badges.set(entries[0].userId, 'krone')

  // flamme: highest topStreak ≥ 3, not already badged
  let flamme: Entry | null = null
  for (const e of entries) {
    if (badges.has(e.userId)) continue
    if (e.topStreak >= 3 && (!flamme || e.topStreak > flamme.topStreak)) flamme = e
  }
  if (flamme) badges.set(flamme.userId, 'flamme')

  // lyn: lowest fastestMs, not already badged
  let lyn: Entry | null = null
  for (const e of entries) {
    if (badges.has(e.userId)) continue
    if (e.fastestMs !== null && (!lyn || e.fastestMs < lyn.fastestMs!)) lyn = e
  }
  if (lyn) badges.set(lyn.userId, 'lyn')

  // medalje: ranks 2-3 not already badged
  for (const e of entries) {
    if (e.rank >= 2 && e.rank <= 3 && !badges.has(e.userId)) badges.set(e.userId, 'medalje')
  }

  return badges
}

function BadgeCircle({ badge, size = 18 }: { badge: BadgeKind; size?: number }) {
  const bg = badge === 'krone' ? '#c9a84c' : badge === 'flamme' ? '#E24B4A' : badge === 'lyn' ? '#7ABFFF' : '#639922'
  const iconSize = Math.round(size * 0.65)
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      <svg width={iconSize} height={iconSize} viewBox="0 0 16 16" fill="none">
        {badge === 'krone'  && <path d="M2 8L4 3L8 6L12 3L14 8H2Z" fill="#1a1c23"/>}
        {badge === 'flamme' && <path d="M8 2C8 2 12 5 12 8.5C12 11 10 13 8 14C6 13 4 11 4 8.5C4 5 8 2 8 2Z" fill="white"/>}
        {badge === 'lyn'    && <path d="M10 2L5 9H9L6 14L13 6H9L10 2Z" fill="white"/>}
        {badge === 'medalje'&& <circle cx="8" cy="8" r="4" fill="white"/>}
      </svg>
    </div>
  )
}

const s = {
  wrap:     { minHeight: '100vh', background: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", color: '#e8e4dd' },
  page:     { maxWidth: 640, margin: '0 auto', padding: '0 20px 80px' },
  centered: { minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  spinner:  { fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#7a7873', fontStyle: 'italic' as const },

  back:    { display: 'inline-block', fontSize: 12, color: '#7a7873', textDecoration: 'none', marginBottom: 20, letterSpacing: '0.04em' },
  header:  { padding: '48px 0 32px', textAlign: 'center' as const },
  eyebrow: { fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#c9a84c', marginBottom: 8 },
  title:   { fontFamily: "'Libre Baskerville', serif", fontSize: 'clamp(28px, 6vw, 38px)' as string, fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em', marginBottom: 6 },
  titleEm: { fontStyle: 'italic', color: '#c9a84c' },
  rule:    { width: '100%', height: 1, background: '#2a2d38', marginTop: 28 },

  tabRow:     { display: 'flex', borderBottom: '1px solid #2a2d38', marginBottom: 20, marginTop: 28 },
  tabActive:  { padding: '10px 16px', background: 'none', border: 'none', borderBottom: '2px solid #c9a84c', marginBottom: -1, fontSize: 13, fontWeight: 600, color: '#c9a84c', fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer' },
  tabInactive:{ padding: '10px 16px', background: 'none', border: 'none', borderBottom: '2px solid transparent', marginBottom: -1, fontSize: 13, fontWeight: 600, color: '#7a7873', fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer' },

  countdown: { fontSize: 12, color: '#7a7873', textAlign: 'center' as const, marginBottom: 20, letterSpacing: '0.04em' },

  row:     { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8, position: 'relative' as const, overflow: 'hidden' as const },
  rowGold: { background: 'linear-gradient(135deg, rgba(201,168,76,0.07) 0%, #21242e 60%)', border: '1px solid rgba(201,168,76,0.22)', borderRadius: 20, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8, position: 'relative' as const, overflow: 'hidden' as const },
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

  sectionHeader: { display: 'flex', alignItems: 'center', gap: 10, margin: '28px 0 14px' },
  sectionText:   { fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#7a7873', whiteSpace: 'nowrap' as const },
  sectionLine:   { flex: 1, height: 1, background: '#2a2d38' },

  userCard:    { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '20px 24px', marginTop: 8 },
  userCardGold:{ background: 'rgba(201,168,76,0.04)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 20, padding: '20px 24px', marginTop: 8 },

  ctaText: { fontSize: 14, color: '#7a7873', lineHeight: 1.6, marginBottom: 14 },
  btnGold: { display: 'inline-block', background: '#c9a84c', color: '#0f0f10', fontFamily: "'Instrument Sans', sans-serif", fontSize: 14, fontWeight: 700, padding: '10px 24px', borderRadius: 10, textDecoration: 'none' },
  btnOutline: { display: 'inline-block', background: 'transparent', color: '#c9a84c', border: '0.5px solid #c9a84c', fontFamily: "'Instrument Sans', sans-serif", fontSize: 14, fontWeight: 700, padding: '10px 24px', borderRadius: 10, textDecoration: 'none' },

  prizeCard: { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '24px 28px', marginTop: 28 },
  prizeTitle:{ fontFamily: "'Libre Baskerville', serif", fontSize: 18, fontWeight: 700, color: '#ffffff', marginBottom: 12 },
  prizeText: { fontSize: 14, color: '#7a7873', lineHeight: 1.7 },

  legendCard: { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '18px 20px', marginTop: 12 },
  legendTitle:{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#7a7873', marginBottom: 12 },
  legendRow:  { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, fontSize: 13, color: '#e8e4dd' },

  empty:     { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '56px 32px', textAlign: 'center' as const, marginTop: 12 },
  emptyIcon: { fontSize: 40, marginBottom: 14, opacity: 0.5 },
  emptyTitle:{ fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#ffffff', marginBottom: 8 },
  emptySub:  { fontSize: 13, color: '#7a7873', lineHeight: 1.6 },
}

export default function TopplisterPage() {
  const [period, setPeriod] = useState<Period>('month')
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session === undefined) return
    let cancelled = false
    setLoading(true)

    async function load() {
      const headers: Record<string, string> = {}
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
      try {
        const res = await fetch(`/api/toppliste?period=${period}`, { headers })
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
  }, [period, session])

  const countdown = getCountdown(period)
  const badges = data ? assignBadges(data.entries) : new Map<string, BadgeKind>()

  function renderRow(entry: Entry) {
    const isFirst = entry.rank === 1
    const badge = badges.get(entry.userId)
    const initial = entry.displayName[0]?.toUpperCase() ?? '?'

    return (
      <div key={entry.userId} style={isFirst ? s.rowGold : s.row}>
        {isFirst && <div style={s.goldStripe} />}

        <div style={s.rankCell}>
          <span style={s.rankNum}>#{entry.rank}</span>
        </div>

        <div style={s.avatarWrap}>
          {entry.avatarUrl ? (
            <img src={entry.avatarUrl} alt="" style={s.avatarImg} referrerPolicy="no-referrer" />
          ) : (
            <div style={s.avatarInit}>{initial}</div>
          )}
          {badge && (
            <div style={s.badgePos}>
              <BadgeCircle badge={badge} size={18} />
            </div>
          )}
        </div>

        <div style={s.nameBlock}>
          <div style={s.name}>{entry.displayName}</div>
          <div style={s.nameSub}>{entry.quizCount} {entry.quizCount === 1 ? 'quiz' : 'quizer'}</div>
        </div>

        <div style={s.pointsBlock}>
          <div style={s.points}>{entry.points}</div>
          <div style={s.pointsSub}>POENG</div>
        </div>
      </div>
    )
  }

  function renderUserSection() {
    if (session === undefined) return null

    if (!session) {
      return (
        <div style={s.userCard}>
          <p style={s.ctaText}>Logg inn for å se din plassering på topplisten.</p>
          <Link href="/login?next=/toppliste" style={s.btnGold}>Logg inn</Link>
        </div>
      )
    }

    if (!data) return null

    if (!data.userEntry) {
      return (
        <div style={s.userCard}>
          <p style={s.ctaText}>
            Du er ikke med på listen ennå — spill en quiz i denne perioden for å komme med!
          </p>
        </div>
      )
    }

    if (!data.userIsPremium) {
      return (
        <div style={s.userCard}>
          <p style={{ fontSize: 14, color: '#7a7873', lineHeight: 1.6, marginBottom: 6 }}>
            Du er på plass <strong style={{ color: '#e8e4dd' }}>#{data.userEntry.rank}</strong> — men du trenger Premium for å se fullstendig statistikk.
          </p>
          <Link href="/founders" style={s.btnOutline}>Oppgrader til Premium</Link>
        </div>
      )
    }

    const ue = data.userEntry
    const initial = ue.displayName[0]?.toUpperCase() ?? '?'
    return (
      <div style={s.userCardGold}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={s.rankCell}>
            <span style={{ ...s.rankNum, color: '#c9a84c' }}>#{ue.rank}</span>
          </div>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#2a2d38', border: '1.5px solid rgba(201,168,76,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: '#c9a84c', flexShrink: 0, overflow: 'hidden' }}>
            {ue.avatarUrl ? (
              <img src={ue.avatarUrl} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', display: 'block' }} referrerPolicy="no-referrer" />
            ) : initial}
          </div>
          <div style={s.nameBlock}>
            <div style={s.name}>{ue.displayName}</div>
            <div style={s.nameSub}>{ue.quizCount} {ue.quizCount === 1 ? 'quiz' : 'quizer'}</div>
          </div>
          <div style={s.pointsBlock}>
            <div style={s.points}>{ue.points}</div>
            <div style={s.pointsSub}>POENG</div>
          </div>
        </div>
      </div>
    )
  }

  if (loading && !data) {
    return (
      <>
        <style>{FONT_IMPORT}</style>
        <UserMenuWrapper />
        <div style={s.centered}><p style={s.spinner}>Laster toppliste…</p></div>
      </>
    )
  }

  return (
    <>
      <style>{FONT_IMPORT}</style>
      <UserMenuWrapper />
      <div style={s.wrap}>
        <div style={s.page}>

          <div style={{ paddingTop: 20 }}>
            <Link href="/" style={s.back}>← Tilbake til forsiden</Link>
          </div>

          <div style={s.header}>
            <p style={s.eyebrow}>Quizkanonen · Sesong</p>
            <h1 style={s.title}>
              Sesong<em style={s.titleEm}>topplisten</em>
            </h1>
            <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 14, color: '#7a7873', fontStyle: 'italic' }}>
              Hvem dominerer over tid?
            </p>
            <div style={s.rule} />
          </div>

          {/* Period tabs */}
          <div style={s.tabRow}>
            {(['month', 'quarter', 'year', 'alltime'] as Period[]).map(p => (
              <button
                key={p}
                style={period === p ? s.tabActive : s.tabInactive}
                onClick={() => setPeriod(p)}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>

          {countdown && (
            <p style={s.countdown}>{countdown}</p>
          )}

          {/* Top 10 */}
          {!loading && data?.entries.length === 0 ? (
            <div style={s.empty}>
              <div style={s.emptyIcon}>🏆</div>
              <p style={s.emptyTitle}>Ingen deltakere ennå</p>
              <p style={s.emptySub}>Spill en quiz for å komme på listen!</p>
            </div>
          ) : (
            data?.entries.map(entry => renderRow(entry))
          )}

          {/* Din plassering */}
          <div style={s.sectionHeader}>
            <span style={s.sectionText}>Din plassering</span>
            <div style={s.sectionLine} />
          </div>
          {renderUserSection()}

          {/* Premie-seksjon */}
          <div style={s.prizeCard}>
            <h2 style={s.prizeTitle}>Hva vinnes?</h2>
            <p style={s.prizeText}>
              Toppspillerne på sesong-topplisten får ære, bragd og den gode følelsen av å ha vunnet Quizkanonen for perioden. Premieringer kan komme i fremtiden — følg med!
            </p>
          </div>

          {/* Badge-forklaring */}
          <div style={s.legendCard}>
            <div style={s.legendTitle}>Hva betyr badgene?</div>
            <div style={s.legendRow}>
              <BadgeCircle badge="krone" size={20} />
              <span>Krone — #1 på topplisten denne perioden</span>
            </div>
            <div style={s.legendRow}>
              <BadgeCircle badge="flamme" size={20} />
              <span>Flamme — lengst aktiv streak (minst 3 uker)</span>
            </div>
            <div style={s.legendRow}>
              <BadgeCircle badge="lyn" size={20} />
              <span>Lyn — raskeste fullførte quiz</span>
            </div>
            <div style={{ ...s.legendRow, marginBottom: 0 }}>
              <BadgeCircle badge="medalje" size={20} />
              <span>Medalje — topp 3 denne perioden</span>
            </div>
          </div>

        </div>
      </div>
    </>
  )
}
