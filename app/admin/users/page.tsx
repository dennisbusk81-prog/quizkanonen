'use client'
import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { isAdminLoggedIn } from '@/lib/admin-auth'
import { adminFetch } from '@/lib/admin-fetch'

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:    #1a1c23;
    --card:  #21242e;
    --border:#2a2d38;
    --gold:  #c9a84c;
    --white: #ffffff;
    --body:  #e8e4dd;
    --hint:  #7a7873;
  }

  body {
    background: var(--bg);
    font-family: 'Instrument Sans', sans-serif;
    color: var(--body);
    min-height: 100vh;
  }

  .adm-page { max-width: 800px; margin: 0 auto; padding: 0 20px 80px; }

  .adm-header {
    padding: 24px 0 28px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .adm-eyebrow {
    font-size: 10px; font-weight: 600; letter-spacing: 0.18em;
    text-transform: uppercase; color: var(--gold); margin-bottom: 6px;
  }
  .adm-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 28px; font-weight: 700; color: var(--white); letter-spacing: -0.01em;
  }
  .adm-title em { font-style: italic; color: var(--gold); }

  .adm-btn-ghost {
    font-size: 12px; font-weight: 500; color: var(--hint);
    background: var(--card); border: 0.5px solid var(--border);
    border-radius: 8px; padding: 6px 14px; cursor: pointer;
    text-decoration: none; transition: color 0.15s, border-color 0.15s;
    display: inline-block;
  }
  .adm-btn-ghost:hover { color: var(--white); border-color: rgba(255,255,255,0.15); }

  .adm-rule { width: 100%; height: 1px; background: var(--border); margin-bottom: 24px; }

  .adm-search {
    width: 100%;
    background: var(--card);
    border: 0.5px solid var(--border);
    border-radius: 10px;
    padding: 10px 14px;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 14px;
    color: var(--white);
    outline: none;
    margin-bottom: 16px;
    transition: border-color 0.15s;
  }
  .adm-search::placeholder { color: var(--hint); }
  .adm-search:focus { border-color: rgba(201,168,76,0.4); }

  .adm-count {
    font-size: 11px; color: var(--hint);
    margin-bottom: 10px; letter-spacing: 0.04em;
  }

  .adm-user-row {
    background: var(--card);
    border: 0.5px solid var(--border);
    border-radius: 12px;
    padding: 12px 16px;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 14px;
    transition: border-color 0.12s;
  }
  .adm-user-row:hover { border-color: rgba(201,168,76,0.2); }

  .adm-user-avatar {
    width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
    background: rgba(201,168,76,0.1); border: 1px solid rgba(201,168,76,0.2);
    display: flex; align-items: center; justify-content: center;
    font-family: 'Libre Baskerville', serif;
    font-size: 13px; font-weight: 700; color: var(--gold);
  }

  .adm-user-body { flex: 1; min-width: 0; }
  .adm-user-name { font-size: 14px; font-weight: 600; color: var(--white); margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .adm-user-meta { font-size: 11px; color: var(--hint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .adm-user-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

  .adm-badge-premium {
    font-size: 10px; font-weight: 600;
    color: var(--gold); background: rgba(201,168,76,0.1);
    border: 0.5px solid rgba(201,168,76,0.25);
    border-radius: 999px; padding: 2px 8px; white-space: nowrap;
  }
  .adm-quiz-count {
    font-size: 11px; color: var(--hint); white-space: nowrap;
    min-width: 48px; text-align: right;
  }
  .adm-user-date {
    font-size: 11px; color: var(--hint); white-space: nowrap;
  }

  .adm-loading {
    min-height: 100vh; background: var(--bg);
    display: flex; align-items: center; justify-content: center;
  }
  .adm-loading p {
    font-family: 'Libre Baskerville', serif;
    font-size: 18px; color: var(--hint); font-style: italic;
  }

  .adm-btn-suspend {
    font-size: 11px; font-weight: 600; padding: 4px 10px;
    border-radius: 6px; border: 0.5px solid var(--border);
    background: transparent; color: var(--hint); cursor: pointer;
    white-space: nowrap; font-family: 'Instrument Sans', sans-serif;
    transition: border-color 0.12s, color 0.12s;
  }
  .adm-btn-suspend:hover { border-color: rgba(201,168,76,0.4); color: var(--gold); }

  .adm-btn-delete {
    font-size: 11px; font-weight: 600; padding: 4px 10px;
    border-radius: 6px; border: 0.5px solid rgba(201,76,76,0.3);
    background: transparent; color: #c94c4c; cursor: pointer;
    white-space: nowrap; font-family: 'Instrument Sans', sans-serif;
    transition: border-color 0.12s;
  }
  .adm-btn-delete:hover { border-color: rgba(201,76,76,0.6); }

  .adm-badge-suspended {
    font-size: 10px; font-weight: 600;
    color: #c94c4c; background: rgba(201,76,76,0.08);
    border: 0.5px solid rgba(201,76,76,0.25);
    border-radius: 999px; padding: 2px 8px; white-space: nowrap;
  }

  @media (max-width: 520px) {
    .adm-user-date { display: none; }
  }
`

type UserRow = {
  id: string
  display_name: string | null
  email: string | null
  google_name: string | null
  created_at: string | null
  quiz_count: number
  is_premium: boolean
  suspended_until: string | null
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function initial(name: string | null, email: string | null): string {
  const src = name ?? email ?? '?'
  return src[0]?.toUpperCase() ?? '?'
}

type ConfirmAction = { type: 'suspend' | 'delete'; userId: string; name: string }

export default function AdminUsersPage() {
  const router = useRouter()
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (!isAdminLoggedIn()) { router.push('/admin/login'); return }
    adminFetch('/api/admin/users')
      .then(r => r.ok ? r.json() : { users: [] })
      .then(d => setUsers(d.users ?? []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [router])

  async function handleConfirm() {
    if (!confirm || actionLoading) return
    setActionLoading(true)
    setActionError(null)
    try {
      if (confirm.type === 'suspend') {
        const res = await adminFetch(`/api/admin/users/${confirm.userId}/suspend`, { method: 'PATCH' })
        if (!res.ok) { setActionError('Karantene feilet'); setActionLoading(false); return }
        const json = await res.json()
        setUsers(prev => prev.map(u => u.id === confirm.userId ? { ...u, suspended_until: json.suspended_until } : u))
      } else {
        const res = await adminFetch(`/api/admin/users/${confirm.userId}`, { method: 'DELETE' })
        if (!res.ok) { setActionError('Sletting feilet'); setActionLoading(false); return }
        setUsers(prev => prev.filter(u => u.id !== confirm.userId))
      }
      setConfirm(null)
    } catch {
      setActionError('Noe gikk galt')
    }
    setActionLoading(false)
  }

  const filtered = useMemo(() => {
    if (!query.trim()) return users
    const q = query.toLowerCase()
    return users.filter(u =>
      (u.display_name ?? '').toLowerCase().includes(q) ||
      (u.email ?? '').toLowerCase().includes(q) ||
      (u.google_name ?? '').toLowerCase().includes(q)
    )
  }, [users, query])

  if (loading) return (
    <>
      <style>{STYLES}</style>
      <div className="adm-loading"><p>Laster brukere…</p></div>
    </>
  )

  return (
    <>
      <style>{STYLES}</style>
      <div className="adm-page">

        <header className="adm-header">
          <div>
            <p className="adm-eyebrow">Quizkanonen · Admin</p>
            <h1 className="adm-title">Bruk<em>ere</em></h1>
          </div>
          <div style={{ paddingTop: 6 }}>
            <Link href="/admin" className="adm-btn-ghost">← Tilbake</Link>
          </div>
        </header>

        <div className="adm-rule" />

        <input
          type="search"
          placeholder="Søk på navn eller e-post…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="adm-search"
        />

        <p className="adm-count">
          {filtered.length} av {users.length} brukere
          {users.filter(u => u.is_premium).length > 0 && (
            <> · {users.filter(u => u.is_premium).length} Premium</>
          )}
        </p>

        {filtered.map(u => (
          <div key={u.id} className="adm-user-row">
            <div className="adm-user-avatar">
              {initial(u.display_name, u.email)}
            </div>

            <div className="adm-user-body">
              <div className="adm-user-name">
                {u.display_name ?? <span style={{ color: 'var(--hint)', fontWeight: 400 }}>Intet navn</span>}
              </div>
              <div className="adm-user-meta">
                {[u.google_name, u.email].filter(Boolean).join(' · ')}
              </div>
            </div>

            <div className="adm-user-right">
              {u.suspended_until && new Date(u.suspended_until) > new Date() && (
                <span className="adm-badge-suspended">Karantene</span>
              )}
              {u.is_premium && (
                <span className="adm-badge-premium">Premium</span>
              )}
              <span className="adm-quiz-count">
                {u.quiz_count} {u.quiz_count === 1 ? 'quiz' : 'quizer'}
              </span>
              <span className="adm-user-date">{fmtDate(u.created_at)}</span>
              {!(u.suspended_until && new Date(u.suspended_until) > new Date()) && (
                <button
                  className="adm-btn-suspend"
                  onClick={() => setConfirm({ type: 'suspend', userId: u.id, name: u.display_name ?? u.email ?? u.id })}
                >
                  Karantene
                </button>
              )}
              <button
                className="adm-btn-delete"
                onClick={() => setConfirm({ type: 'delete', userId: u.id, name: u.display_name ?? u.email ?? u.id })}
              >
                Slett
              </button>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--hint)', textAlign: 'center', marginTop: 40 }}>
            Ingen brukere matcher søket.
          </p>
        )}

      </div>

      {/* Bekreftelsesmodal */}
      {confirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px' }}>
          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '28px 24px', maxWidth: 380, width: '100%', fontFamily: "'Instrument Sans', sans-serif" }}>
            <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 18, fontWeight: 700, color: '#ffffff', marginBottom: 10 }}>
              {confirm.type === 'suspend' ? 'Sett i karantene?' : 'Slett bruker?'}
            </p>
            <p style={{ fontSize: 13, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 6 }}>
              <strong style={{ color: '#e8e4dd' }}>{confirm.name}</strong>
            </p>
            <p style={{ fontSize: 13, color: '#7a7873', lineHeight: 1.6, marginBottom: 24 }}>
              {confirm.type === 'suspend'
                ? 'Brukeren kan ikke starte quiz og vises ikke på leaderboard i 30 dager.'
                : 'Er du sikker? Dette kan ikke angres. All data slettes permanent.'}
            </p>
            {actionError && (
              <p style={{ fontSize: 12, color: '#f87171', marginBottom: 12 }}>{actionError}</p>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={handleConfirm}
                disabled={actionLoading}
                style={{ flex: 1, background: confirm.type === 'delete' ? '#c94c4c' : '#c9a84c', color: '#1a1c23', border: 'none', borderRadius: 10, padding: '11px', fontSize: 14, fontWeight: 700, cursor: actionLoading ? 'default' : 'pointer', opacity: actionLoading ? 0.6 : 1, fontFamily: "'Instrument Sans', sans-serif" }}
              >
                {actionLoading ? 'Venter…' : confirm.type === 'suspend' ? 'Sett i karantene' : 'Slett bruker'}
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
    </>
  )
}
