'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Admin Dashboard — v1, bevisst smalt scope.
//
// IKKE bygget ennå (se QK_3-backlog):
//   · aktivitetstrakt
//   · utvidet retention (4-/8-ukers, streak-fordeling)
//   · produktbruk-seksjon
//   · økonomi-seksjon (utover enkel MRR)
//   · kvalitet/bugs-seksjon
//   · brukeroversikt med søk/filter
//   · «hvorfor kjøper folk Premium»-rapport
//
// Denne siden er «hvordan går det». /admin er fortsatt driftskonsollen
// (neste quiz-dato, Founders-innstillinger, sesong-nullstilling) — ikke slå
// dem sammen uten å ta stilling til begge rollene.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { isAdminLoggedIn } from '@/lib/admin-auth'
import { adminFetch } from '@/lib/admin-fetch'
import WeeklyActivityChart, { type WeekPoint } from '@/components/WeeklyActivityChart'

type DashboardData = {
  lastQuiz: { id: string; title: string; closesAt: string | null; participants: number } | null
  retention: { pct: number | null; title: string; returned: number | null } | null
  premium: { total: number; personal: number }
  orgs: { active: number; trialing: number; locked: number }
  profiles: { total: number }
  mrr: {
    total: number
    b2b: number
    b2c: number
    b2cCount: number
    trialingValue: number
    trialingByPlan: Record<string, number>
  }
  series: WeekPoint[]
  leagues: { active: number }
  duels: { active: number; pending: number }
}

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:     #1a1c23;
    --card:   #21242e;
    --border: #2a2d38;
    --gold:   #c9a84c;
    --white:  #ffffff;
    --body:   #e8e4dd;
    --hint:   #918f8a;
  }

  body {
    background: var(--bg);
    font-family: 'Instrument Sans', sans-serif;
    color: var(--body);
    min-height: 100vh;
  }

  .dsh-page { flex: 1; max-width: 1100px; margin: 0 auto; padding: 0 20px 80px; }

  .dsh-header {
    padding: 24px 0 28px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .dsh-eyebrow {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--gold);
    margin-bottom: 6px;
  }
  .dsh-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 28px;
    font-weight: 700;
    color: var(--white);
    letter-spacing: -0.01em;
  }
  .dsh-title em { font-style: italic; color: var(--gold); }

  .dsh-back {
    font-size: 13px;
    color: var(--body);
    text-decoration: none;
    border: 0.5px solid var(--border);
    border-radius: 10px;
    padding: 8px 16px;
    transition: border-color 0.15s, color 0.15s;
    white-space: nowrap;
  }
  .dsh-back:hover { border-color: rgba(255,255,255,0.2); color: var(--white); }

  .dsh-rule { width: 100%; height: 1px; background: var(--border); margin-bottom: 24px; }

  /* ── Topplinje: 6 kort ── */
  .dsh-stats {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 10px;
    margin-bottom: 24px;
  }

  .dsh-stat {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 18px 16px;
    min-width: 0;
  }

  .dsh-stat-label {
    font-size: 10px;
    font-weight: 600;
    color: var(--hint);
    text-transform: uppercase;
    letter-spacing: 0.09em;
    line-height: 1.4;
    margin-bottom: 10px;
  }
  .dsh-stat-value {
    font-family: 'Libre Baskerville', serif;
    font-size: 26px;
    font-weight: 700;
    color: var(--white);
    line-height: 1.1;
    letter-spacing: -0.01em;
  }
  .dsh-stat-sub {
    font-size: 11px;
    color: var(--hint);
    line-height: 1.45;
    margin-top: 8px;
    overflow-wrap: anywhere;
  }
  .dsh-stat-value--empty { color: var(--hint); }

  /* ── Kort-seksjoner ── */
  .dsh-section {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 24px 20px;
    margin-bottom: 16px;
  }
  .dsh-section-label {
    font-size: 10px;
    font-weight: 600;
    color: var(--hint);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 4px;
  }
  .dsh-section-note {
    font-size: 12px;
    color: var(--hint);
    line-height: 1.5;
    margin-bottom: 20px;
  }

  .dsh-legend { display: flex; gap: 18px; flex-wrap: wrap; margin-top: 14px; }
  .dsh-legend-item { display: flex; align-items: center; gap: 7px; font-size: 11px; color: var(--hint); }
  .dsh-legend-swatch { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
  .dsh-legend-line { width: 14px; height: 2px; border-radius: 2px; flex-shrink: 0; }

  /* ── Liga / dueller ── */
  .dsh-mini { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

  .dsh-loading {
    min-height: 100vh;
    background: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .dsh-loading p {
    font-family: 'Libre Baskerville', serif;
    font-size: 18px;
    color: var(--hint);
    font-style: italic;
  }

  .dsh-error {
    background: var(--card);
    border: 1px solid rgba(201,76,76,0.3);
    border-radius: 16px;
    padding: 24px 20px;
    font-size: 14px;
    color: var(--body);
    line-height: 1.6;
  }

  @media (max-width: 1000px) {
    .dsh-stats { grid-template-columns: repeat(3, 1fr); }
  }
  @media (max-width: 560px) {
    .dsh-stats { grid-template-columns: 1fr 1fr; }
    .dsh-mini { grid-template-columns: 1fr; }
  }
`

const nf = new Intl.NumberFormat('nb-NO')

const PLAN_LABELS: Record<string, string> = {
  starter: 'Starter',
  standard: 'Standard',
  pro: 'Pro',
  enterprise: 'Enterprise',
}

export default function AdminDashboard() {
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isAdminLoggedIn()) { router.push('/admin/login'); setLoading(false); return }
    ;(async () => {
      try {
        const res = await adminFetch('/api/admin/dashboard')
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          setError(body?.error ?? `Serveren svarte ${res.status}`)
          return
        }
        setData(await res.json())
      } catch {
        setError('Kunne ikke kontakte serveren.')
      } finally {
        setLoading(false)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) return (
    <>
      <style>{STYLES}</style>
      <div className="dsh-loading"><p>Laster...</p></div>
    </>
  )

  const trialingNote = data
    ? Object.entries(data.mrr.trialingByPlan)
        .map(([plan, count]) => `${count} ${PLAN_LABELS[plan] ?? plan}`)
        .join(' · ')
    : ''

  return (
    <>
      <style>{STYLES}</style>
      <div className="dsh-page">

        <header className="dsh-header">
          <div>
            <p className="dsh-eyebrow">Quizkanonen</p>
            <h1 className="dsh-title">Dash<em>board</em></h1>
          </div>
          <Link href="/admin" className="dsh-back">← Adminpanel</Link>
        </header>

        <div className="dsh-rule" />

        {error && <div className="dsh-error">Kunne ikke laste dashboardet: {error}</div>}

        {data && (
          <>
            {/* ── Topplinje ── */}
            <div className="dsh-stats">
              <div className="dsh-stat">
                <p className="dsh-stat-label">Deltakere siste quiz</p>
                <p className={`dsh-stat-value ${data.lastQuiz ? '' : 'dsh-stat-value--empty'}`}>
                  {data.lastQuiz ? nf.format(data.lastQuiz.participants) : '—'}
                </p>
                <p className="dsh-stat-sub">
                  {data.lastQuiz ? data.lastQuiz.title : 'Ingen stengt quiz ennå'}
                </p>
              </div>

              <div className="dsh-stat">
                <p className="dsh-stat-label">Retention</p>
                <p className={`dsh-stat-value ${data.retention ? '' : 'dsh-stat-value--empty'}`}>
                  {data.retention?.pct !== null && data.retention !== null ? `${data.retention.pct} %` : '—'}
                </p>
                <p className="dsh-stat-sub">
                  {data.retention
                    ? `Forrige quiz → siste quiz · ${data.retention.returned ?? 0} kom tilbake`
                    : 'Krever to spilte quizer'}
                </p>
              </div>

              <div className="dsh-stat">
                <p className="dsh-stat-label">Premium</p>
                <p className="dsh-stat-value">{nf.format(data.premium.total)}</p>
                <p className="dsh-stat-sub">
                  Inkl. bedriftsmedlemmer · {nf.format(data.premium.personal)} betalende privat
                </p>
              </div>

              <div className="dsh-stat">
                <p className="dsh-stat-label">Bedrifter</p>
                <p className="dsh-stat-value">{nf.format(data.orgs.active + data.orgs.trialing)}</p>
                <p className="dsh-stat-sub">
                  {nf.format(data.orgs.active)} aktive · {nf.format(data.orgs.trialing)} på trial
                  {data.orgs.locked > 0 && ` · ${nf.format(data.orgs.locked)} sperret`}
                </p>
              </div>

              <div className="dsh-stat">
                <p className="dsh-stat-label">Registrerte</p>
                <p className="dsh-stat-value">{nf.format(data.profiles.total)}</p>
                <p className="dsh-stat-sub">Profiler totalt</p>
              </div>

              <div className="dsh-stat">
                <p className="dsh-stat-label">MRR</p>
                <p className={`dsh-stat-value ${data.mrr.total === 0 ? 'dsh-stat-value--empty' : ''}`}>
                  {nf.format(data.mrr.total)} kr
                </p>
                <p className="dsh-stat-sub">
                  {data.mrr.trialingValue > 0
                    ? `+ ${trialingNote} på trial (${nf.format(data.mrr.trialingValue)})`
                    : 'Kun aktive abonnementer'}
                </p>
              </div>
            </div>

            {/* ── Graf ── */}
            <div className="dsh-section">
              <p className="dsh-section-label">Aktivitet siste 12 uker</p>
              <p className="dsh-section-note">
                Unike innloggede spillere med fullført quiz per uke. Retention måles per quiz
                og plasseres i uken quizen åpnet — uker uten quiz gir brudd i linjen.
              </p>
              <WeeklyActivityChart data={data.series} />
              <div className="dsh-legend">
                <span className="dsh-legend-item">
                  <span className="dsh-legend-swatch" style={{ background: '#c9a84c', opacity: 0.85 }} />
                  Aktive spillere
                </span>
                <span className="dsh-legend-item">
                  <span className="dsh-legend-line" style={{ background: '#e8e4dd', opacity: 0.75 }} />
                  Retention %
                </span>
              </div>
            </div>

            {/* ── Ligaer og dueller ── */}
            <div className="dsh-mini">
              <div className="dsh-stat">
                <p className="dsh-stat-label">Aktive ligaer</p>
                <p className="dsh-stat-value">{nf.format(data.leagues.active)}</p>
                <p className="dsh-stat-sub">Private ligaer med minst ett medlem</p>
              </div>
              <div className="dsh-stat">
                <p className="dsh-stat-label">Aktive dueller</p>
                <p className="dsh-stat-value">{nf.format(data.duels.active)}</p>
                <p className="dsh-stat-sub">
                  Pågående H2H
                  {data.duels.pending > 0 && ` · ${nf.format(data.duels.pending)} venter på svar`}
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
