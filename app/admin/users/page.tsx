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
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' })
}

function initial(name: string | null, email: string | null): string {
  const src = name ?? email ?? '?'
  return src[0]?.toUpperCase() ?? '?'
}

export default function AdminUsersPage() {
  const router = useRouter()
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!isAdminLoggedIn()) { router.push('/admin/login'); return }
    adminFetch('/api/admin/users')
      .then(r => r.ok ? r.json() : { users: [] })
      .then(d => setUsers(d.users ?? []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [router])

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
              {u.is_premium && (
                <span className="adm-badge-premium">Premium</span>
              )}
              <span className="adm-quiz-count">
                {u.quiz_count} {u.quiz_count === 1 ? 'quiz' : 'quizer'}
              </span>
              <span className="adm-user-date">{fmtDate(u.created_at)}</span>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--hint)', textAlign: 'center', marginTop: 40 }}>
            Ingen brukere matcher søket.
          </p>
        )}

      </div>
    </>
  )
}
