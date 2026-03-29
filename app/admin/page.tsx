'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { isAdminLoggedIn, logoutAdmin } from '@/lib/admin-auth'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:       #1a1c23;
    --card:     #21242e;
    --border:   #2a2d38;
    --gold:     #c9a84c;
    --gold-bg:  rgba(201,168,76,0.10);
    --gold-bdr: rgba(201,168,76,0.22);
    --white:    #ffffff;
    --body:     #9a9590;
    --muted:    #6a6860;
    --radius-card: 20px;
    --radius-btn:  10px;
  }

  body {
    background: var(--bg);
    font-family: 'Instrument Sans', sans-serif;
    color: var(--body);
    min-height: 100vh;
  }

  .adm-page { max-width: 800px; margin: 0 auto; padding: 0 20px 80px; }

  .adm-header {
    padding: 48px 0 36px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }

  .adm-eyebrow {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--gold);
    margin-bottom: 6px;
  }

  .adm-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 28px;
    font-weight: 700;
    color: var(--white);
    letter-spacing: -0.01em;
  }

  .adm-title em { font-style: italic; color: var(--gold); }

  .adm-header-actions { display: flex; gap: 8px; align-items: center; padding-top: 4px; }

  .adm-btn-ghost {
    font-size: 13px;
    font-weight: 500;
    color: var(--muted);
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-btn);
    padding: 8px 14px;
    cursor: pointer;
    text-decoration: none;
    transition: color 0.15s, border-color 0.15s;
  }

  .adm-btn-ghost:hover { color: var(--white); border-color: rgba(255,255,255,0.15); }

  .adm-btn-danger {
    font-size: 13px;
    font-weight: 500;
    color: #f87171;
    background: rgba(248,113,113,0.08);
    border: 1px solid rgba(248,113,113,0.18);
    border-radius: var(--radius-btn);
    padding: 8px 14px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .adm-btn-danger:hover { background: rgba(248,113,113,0.14); }

  .adm-rule { width: 100%; height: 1px; background: var(--border); margin-bottom: 32px; }

  /* Stats */
  .adm-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 32px; }

  .adm-stat {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 20px;
  }

  .adm-stat-icon { font-size: 22px; margin-bottom: 10px; }

  .adm-stat-value {
    font-family: 'Libre Baskerville', serif;
    font-size: 28px;
    font-weight: 700;
    color: var(--white);
    margin-bottom: 4px;
  }

  .adm-stat-label { font-size: 12px; color: var(--muted); }

  /* Nav cards */
  .adm-nav { display: flex; flex-direction: column; gap: 8px; }

  .adm-nav-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 20px 24px;
    display: flex;
    align-items: center;
    gap: 16px;
    text-decoration: none;
    transition: border-color 0.15s, transform 0.15s;
  }

  .adm-nav-card:hover {
    border-color: var(--gold-bdr);
    transform: translateX(3px);
  }

  .adm-nav-icon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: var(--gold-bg);
    border: 1px solid var(--gold-bdr);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    flex-shrink: 0;
  }

  .adm-nav-text { flex: 1; }

  .adm-nav-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--white);
    margin-bottom: 2px;
  }

  .adm-nav-desc { font-size: 12px; color: var(--muted); }

  .adm-nav-arrow { font-size: 14px; color: var(--muted); }

  .adm-loading {
    min-height: 100vh;
    background: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .adm-loading p {
    font-family: 'Libre Baskerville', serif;
    font-size: 18px;
    color: var(--muted);
    font-style: italic;
  }

  @media (max-width: 480px) {
    .adm-stats { grid-template-columns: 1fr 1fr; }
    .adm-stat-value { font-size: 24px; }
  }
`

export default function AdminHome() {
  const router = useRouter()
  const [stats, setStats] = useState({ quizzes: 0, attempts: 0, codes: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isAdminLoggedIn()) { router.push('/admin/login'); return }
    fetchStats()
  }, [])

  async function fetchStats() {
    const [{ count: quizzes }, { count: attempts }, { count: codes }] = await Promise.all([
      supabase.from('quizzes').select('*', { count: 'exact', head: true }),
      supabase.from('attempts').select('*', { count: 'exact', head: true }),
      supabase.from('access_codes').select('*', { count: 'exact', head: true }),
    ])
    setStats({ quizzes: quizzes || 0, attempts: attempts || 0, codes: codes || 0 })
    setLoading(false)
  }

  const handleLogout = () => {
    logoutAdmin()
    router.push('/admin/login')
  }

  if (loading) return (
    <>
      <style>{STYLES}</style>
      <div className="adm-loading"><p>Laster...</p></div>
    </>
  )

  return (
    <>
      <style>{STYLES}</style>
      <div className="adm-page">

        <header className="adm-header">
          <div>
            <p className="adm-eyebrow">Quizkanonen</p>
            <h1 className="adm-title">Admin<em>panel</em></h1>
          </div>
          <div className="adm-header-actions">
            <Link href="/" target="_blank" className="adm-btn-ghost">Se siden ↗</Link>
            <button onClick={handleLogout} className="adm-btn-danger">Logg ut</button>
          </div>
        </header>

        <div className="adm-rule" />

        <div className="adm-stats">
          {[
            { label: 'Quizer', value: stats.quizzes, icon: '🎯' },
            { label: 'Gjennomspillinger', value: stats.attempts, icon: '🎮' },
            { label: 'Verdikoder', value: stats.codes, icon: '🎟️' },
          ].map(s => (
            <div key={s.label} className="adm-stat">
              <div className="adm-stat-icon">{s.icon}</div>
              <div className="adm-stat-value">{s.value}</div>
              <div className="adm-stat-label">{s.label}</div>
            </div>
          ))}
        </div>

        <nav className="adm-nav">
          {[
            { href: '/admin/quizzes', icon: '📋', title: 'Administrer quizer', desc: 'Se, rediger og publiser quizer' },
            { href: '/admin/quizzes/new', icon: '➕', title: 'Lag ny quiz', desc: 'Opprett en ny fredagsquiz' },
            { href: '/admin/codes', icon: '🎟️', title: 'Verdikoder', desc: 'Lag og administrer tilgangskoder' },
          ].map(item => (
            <Link key={item.href} href={item.href} className="adm-nav-card">
              <div className="adm-nav-icon">{item.icon}</div>
              <div className="adm-nav-text">
                <p className="adm-nav-title">{item.title}</p>
                <p className="adm-nav-desc">{item.desc}</p>
              </div>
              <span className="adm-nav-arrow">→</span>
            </Link>
          ))}
        </nav>

      </div>
    </>
  )
}