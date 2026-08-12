'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { isAdminLoggedIn } from '@/lib/admin-session'
import { adminFetch } from '@/lib/admin-fetch'
import { getAvatarInitial } from '@/lib/avatar-initial'

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

  .up-page { flex: 1; max-width: 800px; margin: 0 auto; padding: 0 20px 80px; }

  .up-header {
    padding: 24px 0 20px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .up-back {
    font-size: 12px; font-weight: 500; color: var(--hint);
    background: var(--card); border: 0.5px solid var(--border);
    border-radius: 8px; padding: 6px 14px; cursor: pointer;
    text-decoration: none; transition: color 0.15s, border-color 0.15s;
    display: inline-block; margin-bottom: 10px;
  }
  .up-back:hover { color: var(--white); border-color: rgba(255,255,255,0.15); }

  .up-name-row { display: flex; align-items: center; gap: 14px; }
  .up-avatar {
    width: 48px; height: 48px; border-radius: 50%; flex-shrink: 0;
    background: rgba(201,168,76,0.1); border: 1px solid rgba(201,168,76,0.2);
    display: flex; align-items: center; justify-content: center;
    font-family: 'Libre Baskerville', serif;
    font-size: 18px; font-weight: 700; color: var(--gold);
  }
  .up-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 24px; font-weight: 700; color: var(--white); letter-spacing: -0.01em;
  }
  .up-subtitle { font-size: 12px; color: var(--hint); margin-top: 2px; }

  .up-rule { width: 100%; height: 1px; background: var(--border); margin-bottom: 20px; }

  .up-section {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 24px 20px;
    margin-bottom: 16px;
  }
  .up-section-label {
    font-size: 10px; font-weight: 600; color: var(--hint);
    text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 16px;
  }

  .up-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 20px; }
  .up-field-label { font-size: 10px; font-weight: 600; color: var(--hint); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
  .up-field-value { font-size: 14px; color: var(--body); line-height: 1.4; }
  .up-field-value--muted { color: var(--hint); }

  .up-badge {
    font-size: 10px; font-weight: 600; letter-spacing: 0.04em;
    padding: 2px 9px; border-radius: 999px; display: inline-block; white-space: nowrap;
  }
  .up-badge-gold { color: var(--gold); background: rgba(201,168,76,0.1); border: 0.5px solid rgba(201,168,76,0.25); }
  .up-badge-hint { color: var(--hint); background: rgba(122,120,115,0.08); border: 0.5px solid var(--border); }
  .up-badge-red { color: #c94c4c; background: rgba(201,76,76,0.08); border: 0.5px solid rgba(201,76,76,0.25); }
  .up-badge-green { color: #4ade80; background: rgba(74,222,128,0.08); border: 0.5px solid rgba(74,222,128,0.2); }

  .up-stat-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 18px; }
  .up-stat-tile { background: var(--bg); border: 0.5px solid var(--border); border-radius: 12px; padding: 12px 14px; }
  .up-stat-value { font-family: 'Libre Baskerville', serif; font-size: 20px; font-weight: 700; color: var(--white); }
  .up-stat-label { font-size: 10px; color: var(--hint); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 2px; }

  .up-quiz-row {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 10px 0; border-bottom: 0.5px solid var(--border);
  }
  .up-quiz-row:last-child { border-bottom: none; padding-bottom: 0; }
  .up-quiz-row:first-of-type { padding-top: 0; }
  .up-quiz-title { font-size: 13px; color: var(--body); }
  .up-quiz-date { font-size: 11px; color: var(--hint); margin-top: 2px; }
  .up-quiz-stats { font-size: 12px; color: var(--hint); white-space: nowrap; text-align: right; }

  .up-list-row {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 9px 0; border-bottom: 0.5px solid var(--border);
  }
  .up-list-row:last-child { border-bottom: none; padding-bottom: 0; }
  .up-list-row:first-of-type { padding-top: 0; }

  .up-empty { font-size: 13px; color: var(--hint); }

  .up-btn-primary {
    font-family: 'Instrument Sans', sans-serif;
    font-size: 14px; font-weight: 600;
    background: var(--gold); color: #1a1c23;
    border: none; border-radius: 10px;
    padding: 10px 28px; cursor: pointer;
    transition: background 0.15s; width: auto;
  }
  .up-btn-primary:hover:not(:disabled) { background: #d9b85c; }
  .up-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

  .up-btn-outline {
    font-family: 'Instrument Sans', sans-serif;
    font-size: 14px; font-weight: 600;
    background: transparent; color: var(--body);
    border: 1px solid var(--border); border-radius: 10px;
    padding: 10px 28px; cursor: pointer;
    transition: border-color 0.15s, color 0.15s; width: auto;
  }
  .up-btn-outline:hover:not(:disabled) { border-color: rgba(255,255,255,0.2); color: var(--white); }
  .up-btn-outline:disabled { opacity: 0.5; cursor: not-allowed; }

  .up-btn-danger {
    font-family: 'Instrument Sans', sans-serif;
    font-size: 14px; font-weight: 600;
    background: transparent; color: #c94c4c;
    border: 1px solid rgba(201,76,76,0.35); border-radius: 10px;
    padding: 10px 28px; cursor: pointer;
    transition: background 0.15s; width: auto;
  }
  .up-btn-danger:hover:not(:disabled) { background: rgba(201,76,76,0.08); }
  .up-btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }

  .up-actions-row { display: flex; gap: 10px; flex-wrap: wrap; }

  .up-feedback { font-size: 12px; margin-top: 10px; }
  .up-feedback--success { color: #4ade80; }
  .up-feedback--error { color: #f87171; }

  .up-loading {
    min-height: 100vh; background: var(--bg);
    display: flex; align-items: center; justify-content: center;
  }
  .up-loading p { font-family: 'Libre Baskerville', serif; font-size: 18px; color: var(--hint); font-style: italic; }

  @media (max-width: 520px) {
    .up-grid-2 { grid-template-columns: 1fr; }
    .up-stat-row { grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
  }
`

type ProfileDetail = {
  id: string
  displayName: string | null
  nickname: string | null
  email: string | null
  googleName: string | null
  hasGoogle: boolean
  hasPassword: boolean
  createdAt: string | null
  lastSeenAt: string | null
  ageConfirmedAt: string | null
  suspendedUntil: string | null
  premium: {
    status: boolean
    source: string | null
    since: string | null
    expiresAt: string | null
    graceUntil: string | null
    stripeDashboardUrl: string | null
  }
}

type QuizActivity = {
  attemptId: string
  quizId: string
  title: string
  opensAt: string | null
  isTeam: boolean
  correctAnswers: number
  totalQuestions: number
  totalTimeMs: number
  correctStreak: number | null
  submittedAt: string | null
  rank: number | null
}

type Membership = {
  organizations: { id: string | null; name: string; slug: string | null; role: string; joinedAt: string | null }[]
  leagues: { id: string | null; name: string; slug: string | null; joinedAt: string | null }[]
  rivalries: { id: string; status: string; createdAt: string; opponentName: string }[]
}

type AdminAction = { id: string; action_type: string; created_at: string }

type DetailResponse = {
  profile: ProfileDetail
  activity: { totalQuizzes: number; currentStreak: number; longestStreak: number; quizzes: QuizActivity[] }
  memberships: Membership
  adminActions: AdminAction[]
}

const PREMIUM_SOURCE_LABELS: Record<string, string> = {
  founders: 'Founders',
  org: 'Bedrift',
  personal: 'Personlig (Stripe)',
  code: 'Verdikode',
}

const RIVALRY_STATUS_LABELS: Record<string, string> = {
  pending: 'Venter',
  active: 'Aktiv',
  cancelled: 'Kansellert',
  declined: 'Avslått',
}

const ADMIN_ACTION_LABELS: Record<string, string> = {
  suspend_user: 'Satt i karantene',
  delete_user: 'Bruker slettet',
  send_password_reset: 'Passord-reset sendt',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtTime(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

type Confirm = null | 'suspend' | 'delete'

export default function UserDetailPage() {
  const router = useRouter()
  const params = useParams()
  const userId = params.id as string

  const [data, setData] = useState<DetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [confirm, setConfirm] = useState<Confirm>(null)
  const [deleteInput, setDeleteInput] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const [resetSending, setResetSending] = useState(false)
  const [resetFeedback, setResetFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    if (!isAdminLoggedIn()) { router.push('/admin/login'); return }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  async function load() {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await adminFetch(`/api/admin/users/${userId}`)
      if (!res.ok) {
        if (res.status === 404) { setLoadError('Bruker ikke funnet.'); return }
        throw new Error(`API svarte ${res.status}`)
      }
      setData(await res.json())
    } catch (e) {
      console.error('load bruker feilet:', e)
      setLoadError('Kunne ikke laste brukeren. Prøv igjen.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSuspend() {
    setActionLoading(true)
    setActionError(null)
    try {
      const res = await adminFetch(`/api/admin/users/${userId}/suspend`, { method: 'PATCH' })
      if (!res.ok) { setActionError('Karantene feilet.'); return }
      const json = await res.json()
      setData(d => d ? { ...d, profile: { ...d.profile, suspendedUntil: json.suspended_until } } : d)
      setConfirm(null)
    } catch {
      setActionError('Noe gikk galt.')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleDelete() {
    if (!data || deleteInput.trim().toLowerCase() !== (data.profile.email ?? '').toLowerCase()) return
    setActionLoading(true)
    setActionError(null)
    try {
      const res = await adminFetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirmEmail: deleteInput.trim() }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        setActionError(d?.error ?? 'Sletting feilet.')
        return
      }
      router.push('/admin/users')
    } catch {
      setActionError('Noe gikk galt.')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleSendReset() {
    setResetSending(true)
    setResetFeedback(null)
    try {
      const res = await adminFetch(`/api/admin/users/${userId}/send-reset`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        setResetFeedback({ type: 'error', msg: d?.error ?? 'Kunne ikke sende e-post.' })
        return
      }
      setResetFeedback({ type: 'success', msg: 'Passord-reset-e-post sendt.' })
    } catch {
      setResetFeedback({ type: 'error', msg: 'Noe gikk galt.' })
    } finally {
      setResetSending(false)
    }
  }

  if (loading) return (
    <>
      <style>{STYLES}</style>
      <div className="up-loading"><p>Laster profil…</p></div>
    </>
  )

  if (loadError || !data) return (
    <>
      <style>{STYLES}</style>
      <div className="up-page">
        <div style={{ paddingTop: 24 }}>
          <Link href="/admin/users" className="up-back">← Alle brukere</Link>
        </div>
        <div className="up-section" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#ffffff', marginBottom: 8 }}>
            {loadError ?? 'Kunne ikke laste brukeren'}
          </p>
        </div>
      </div>
    </>
  )

  const { profile, activity, memberships, adminActions } = data
  const isSuspended = !!profile.suspendedUntil && new Date(profile.suspendedUntil) > new Date()
  const name = profile.nickname?.trim() || profile.displayName || 'Intet navn'
  const canDelete = deleteInput.trim().toLowerCase() === (profile.email ?? '').toLowerCase() && !!profile.email

  return (
    <>
      <style>{STYLES}</style>
      <div className="up-page">

        <header className="up-header">
          <div>
            <Link href="/admin/users" className="up-back">← Alle brukere</Link>
            <div className="up-name-row">
              <div className="up-avatar">{getAvatarInitial(profile.nickname || profile.displayName || profile.email)}</div>
              <div>
                <h1 className="up-title">{name}</h1>
                <p className="up-subtitle">
                  {profile.email ?? 'Ingen e-post'}
                  {isSuspended && <> · <span className="up-badge up-badge-red" style={{ marginLeft: 4 }}>Karantene til {fmtDate(profile.suspendedUntil)}</span></>}
                  {profile.premium.status && <> · <span className="up-badge up-badge-gold" style={{ marginLeft: 4 }}>Premium</span></>}
                </p>
              </div>
            </div>
          </div>
        </header>

        <div className="up-rule" />

        {/* a) IDENTITET */}
        <section className="up-section">
          <p className="up-section-label">Identitet</p>
          <div className="up-grid-2">
            <div>
              <p className="up-field-label">Navn</p>
              <p className="up-field-value">{profile.displayName ?? <span className="up-field-value--muted">Ikke satt</span>}</p>
            </div>
            <div>
              <p className="up-field-label">Kallenavn</p>
              <p className="up-field-value">{profile.nickname ?? <span className="up-field-value--muted">Ikke satt</span>}</p>
            </div>
            <div>
              <p className="up-field-label">Innloggingsmetode</p>
              <p className="up-field-value">
                {profile.hasGoogle && <span className="up-badge up-badge-hint" style={{ marginRight: 6 }}>Google</span>}
                {profile.hasPassword && <span className="up-badge up-badge-hint">Passord</span>}
                {!profile.hasGoogle && !profile.hasPassword && <span className="up-field-value--muted">Ukjent</span>}
              </p>
            </div>
            <div>
              <p className="up-field-label">Aldersbekreftelse</p>
              <p className="up-field-value">
                {profile.ageConfirmedAt
                  ? <span className="up-badge up-badge-green">Bekreftet {fmtDate(profile.ageConfirmedAt)}</span>
                  : <span className="up-field-value--muted">Ikke bekreftet</span>}
              </p>
            </div>
            <div>
              <p className="up-field-label">Opprettet</p>
              <p className="up-field-value">{fmtDate(profile.createdAt)}</p>
            </div>
            <div>
              <p className="up-field-label">Sist aktiv</p>
              <p className="up-field-value">{fmtDate(profile.lastSeenAt)}</p>
            </div>
          </div>
        </section>

        {/* b) AKTIVITET */}
        <section className="up-section">
          <p className="up-section-label">Aktivitet</p>
          <div className="up-stat-row">
            <div className="up-stat-tile">
              <div className="up-stat-value">{activity.totalQuizzes}</div>
              <div className="up-stat-label">Quizer spilt</div>
            </div>
            <div className="up-stat-tile">
              <div className="up-stat-value">{activity.currentStreak}</div>
              <div className="up-stat-label">Nåværende streak</div>
            </div>
            <div className="up-stat-tile">
              <div className="up-stat-value">{activity.longestStreak}</div>
              <div className="up-stat-label">Lengste streak</div>
            </div>
          </div>

          {activity.quizzes.length === 0 ? (
            <p className="up-empty">Har ikke spilt noen quiz ennå.</p>
          ) : (
            <div>
              {activity.quizzes.map(q => (
                <div key={q.attemptId} className="up-quiz-row">
                  <div style={{ minWidth: 0 }}>
                    <p className="up-quiz-title">{q.title}{q.isTeam && <span className="up-field-value--muted"> · lag</span>}</p>
                    <p className="up-quiz-date">{fmtDate(q.opensAt ?? q.submittedAt)}</p>
                  </div>
                  <div className="up-quiz-stats">
                    {q.correctAnswers}/{q.totalQuestions} riktige · {fmtTime(q.totalTimeMs)}
                    {q.rank !== null && <> · #{q.rank}</>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* c) PREMIUM OG BETALING */}
        <section className="up-section">
          <p className="up-section-label">Premium og betaling</p>
          {!profile.premium.status ? (
            <p className="up-empty">Gratis bruker — ingen aktivt Premium.</p>
          ) : (
            <div className="up-grid-2">
              <div>
                <p className="up-field-label">Kilde</p>
                <p className="up-field-value">{PREMIUM_SOURCE_LABELS[profile.premium.source ?? ''] ?? profile.premium.source ?? '—'}</p>
              </div>
              <div>
                <p className="up-field-label">Premium siden</p>
                <p className="up-field-value">{fmtDate(profile.premium.since)}</p>
              </div>

              {profile.premium.source === 'personal' && (
                <div>
                  <p className="up-field-label">Stripe-abonnement</p>
                  {profile.premium.stripeDashboardUrl ? (
                    <a
                      href={profile.premium.stripeDashboardUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="up-btn-outline"
                      style={{ display: 'inline-block', padding: '7px 18px', fontSize: 13, textDecoration: 'none' }}
                    >
                      Åpne i Stripe →
                    </a>
                  ) : (
                    <p className="up-field-value--muted" style={{ fontSize: 13 }}>Ingen Stripe-kunde registrert</p>
                  )}
                  <p className="up-field-value--muted" style={{ fontSize: 11, marginTop: 6 }}>
                    Fornyelsesdato vises i Stripe, ikke lagret lokalt.
                  </p>
                </div>
              )}

              {profile.premium.source === 'org' && (
                <div>
                  <p className="up-field-label">Dekning</p>
                  <p className="up-field-value--muted" style={{ fontSize: 13 }}>Dekket av bedriftens abonnement</p>
                  {profile.premium.graceUntil && new Date(profile.premium.graceUntil) > new Date() && (
                    <p className="up-field-value" style={{ fontSize: 12, marginTop: 4 }}>
                      Beholder tilgang (grace) til {fmtDate(profile.premium.graceUntil)}
                    </p>
                  )}
                </div>
              )}

              {(profile.premium.source === 'code' || profile.premium.source === 'founders') && (
                <div>
                  <p className="up-field-label">Utløper</p>
                  <p className="up-field-value">{profile.premium.expiresAt ? fmtDate(profile.premium.expiresAt) : 'Ingen utløpsdato (permanent)'}</p>
                </div>
              )}
            </div>
          )}
        </section>

        {/* d) TILHØRIGHET */}
        <section className="up-section">
          <p className="up-section-label">Tilhørighet</p>

          <div style={{ marginBottom: 16 }}>
            <p className="up-field-label" style={{ marginBottom: 8 }}>Bedrifter</p>
            {memberships.organizations.length === 0 ? (
              <p className="up-empty">Ingen bedriftstilhørighet.</p>
            ) : memberships.organizations.map((o, i) => (
              <div key={i} className="up-list-row">
                <span className="up-field-value">{o.name}</span>
                <span className="up-badge up-badge-hint">{o.role === 'admin' ? 'Admin' : 'Medlem'}</span>
              </div>
            ))}
          </div>

          <div style={{ marginBottom: 16 }}>
            <p className="up-field-label" style={{ marginBottom: 8 }}>Ligaer</p>
            {memberships.leagues.length === 0 ? (
              <p className="up-empty">Ingen liga-medlemskap.</p>
            ) : memberships.leagues.map((l, i) => (
              <div key={i} className="up-list-row">
                <span className="up-field-value">{l.name}</span>
                <span className="up-field-value--muted" style={{ fontSize: 11 }}>{fmtDate(l.joinedAt)}</span>
              </div>
            ))}
          </div>

          <div>
            <p className="up-field-label" style={{ marginBottom: 8 }}>Dueller</p>
            {memberships.rivalries.length === 0 ? (
              <p className="up-empty">Ingen dueller.</p>
            ) : memberships.rivalries.map(r => (
              <div key={r.id} className="up-list-row">
                <span className="up-field-value">{r.opponentName}</span>
                <span className="up-badge up-badge-hint">{RIVALRY_STATUS_LABELS[r.status] ?? r.status}</span>
              </div>
            ))}
          </div>
        </section>

        {/* e) ADMIN-HISTORIKK */}
        <section className="up-section">
          <p className="up-section-label">Admin-historikk</p>
          {adminActions.length === 0 ? (
            <p className="up-empty">Ingen registrerte handlinger på denne brukeren.</p>
          ) : (
            <div>
              {adminActions.map(a => (
                <div key={a.id} className="up-list-row">
                  <span className="up-field-value">{ADMIN_ACTION_LABELS[a.action_type] ?? a.action_type}</span>
                  <span className="up-field-value--muted" style={{ fontSize: 11 }}>{fmtDateTime(a.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* f) HANDLINGER */}
        <section className="up-section">
          <p className="up-section-label">Handlinger</p>
          <div className="up-actions-row">
            <button
              className="up-btn-outline"
              onClick={handleSendReset}
              disabled={resetSending || !profile.email}
            >
              {resetSending ? 'Sender…' : 'Send passord-reset-e-post'}
            </button>

            {!isSuspended && (
              <button className="up-btn-outline" onClick={() => setConfirm('suspend')}>
                Sett i karantene
              </button>
            )}

            <button className="up-btn-danger" onClick={() => { setConfirm('delete'); setDeleteInput('') }}>
              Slett bruker
            </button>
          </div>
          {resetFeedback && (
            <p className={`up-feedback up-feedback--${resetFeedback.type}`}>{resetFeedback.msg}</p>
          )}
        </section>

      </div>

      {/* Karantene-bekreftelse */}
      {confirm === 'suspend' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px' }}>
          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '28px 24px', maxWidth: 380, width: '100%', fontFamily: "'Instrument Sans', sans-serif" }}>
            <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 18, fontWeight: 700, color: '#ffffff', marginBottom: 10 }}>
              Sett i karantene?
            </p>
            <p style={{ fontSize: 13, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 6 }}>
              <strong>{name}</strong>
            </p>
            <p style={{ fontSize: 13, color: '#918f8a', lineHeight: 1.6, marginBottom: 24 }}>
              Brukeren kan ikke starte quiz og vises ikke på leaderboard i 30 dager.
            </p>
            {actionError && <p style={{ fontSize: 12, color: '#f87171', marginBottom: 12 }}>{actionError}</p>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={handleSuspend}
                disabled={actionLoading}
                style={{ flex: 1, background: '#c9a84c', color: '#1a1c23', border: 'none', borderRadius: 10, padding: '11px', fontSize: 14, fontWeight: 700, cursor: actionLoading ? 'default' : 'pointer', opacity: actionLoading ? 0.6 : 1, fontFamily: "'Instrument Sans', sans-serif" }}
              >
                {actionLoading ? 'Venter…' : 'Sett i karantene'}
              </button>
              <button
                onClick={() => { setConfirm(null); setActionError(null) }}
                disabled={actionLoading}
                style={{ flex: 1, background: 'transparent', color: '#e8e4dd', border: '1px solid #2a2d38', borderRadius: 10, padding: '11px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif" }}
              >
                Avbryt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Slett-bekreftelse — krever brukerens e-post skrevet inn */}
      {confirm === 'delete' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px' }}>
          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '28px 24px', maxWidth: 420, width: '100%', fontFamily: "'Instrument Sans', sans-serif" }}>
            <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 18, fontWeight: 700, color: '#ffffff', marginBottom: 10 }}>
              Slett {name}?
            </p>
            <p style={{ fontSize: 13, color: '#918f8a', lineHeight: 1.6, marginBottom: 20 }}>
              Dette kan ikke angres. All data slettes permanent, inkludert medlemskap, dueller og
              sesong-poeng. Eventuelt aktivt personlig Stripe-abonnement kanselleres.
            </p>
            <p style={{ fontSize: 12, color: '#e8e4dd', marginBottom: 8 }}>
              Skriv <strong style={{ color: '#e8e4dd' }}>{profile.email ?? '(ingen e-post registrert)'}</strong> for å bekrefte:
            </p>
            <input
              type="text"
              value={deleteInput}
              onChange={e => setDeleteInput(e.target.value)}
              placeholder={profile.email ?? ''}
              autoFocus
              disabled={!profile.email}
              onKeyDown={e => { if (e.key === 'Enter' && canDelete) handleDelete() }}
              style={{ width: '100%', background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 8, padding: '10px 12px', fontSize: 14, color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif", outline: 'none', marginBottom: 8, boxSizing: 'border-box' }}
            />
            {actionError && <p style={{ fontSize: 12, color: '#f87171', marginBottom: 8 }}>{actionError}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                onClick={() => { setConfirm(null); setActionError(null); setDeleteInput('') }}
                disabled={actionLoading}
                style={{ fontSize: 13, fontWeight: 600, color: '#e8e4dd', background: 'transparent', border: '1px solid #2a2d38', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif" }}
              >
                Avbryt
              </button>
              <button
                onClick={handleDelete}
                disabled={!canDelete || actionLoading}
                style={{
                  fontSize: 13, fontWeight: 600,
                  color: canDelete ? '#1a1c23' : '#918f8a',
                  background: canDelete ? '#f87171' : '#2a2d38',
                  border: 'none', borderRadius: 8, padding: '8px 20px',
                  cursor: canDelete && !actionLoading ? 'pointer' : 'not-allowed',
                  fontFamily: "'Instrument Sans', sans-serif",
                }}
              >
                {actionLoading ? 'Sletter…' : 'Slett bruker'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
