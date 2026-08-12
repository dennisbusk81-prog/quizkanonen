'use client'
import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { isAdminLoggedIn, adminLoginPath } from '@/lib/admin-session'
import { adminFetch } from '@/lib/admin-fetch'
import { getAvatarInitial } from '@/lib/avatar-initial'

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
    --hint:  #918f8a;
  }

  body {
    background: var(--bg);
    font-family: 'Instrument Sans', sans-serif;
    color: var(--body);
    min-height: 100vh;
  }

  .adm-page { flex: 1; max-width: 800px; margin: 0 auto; padding: 0 20px 80px; }

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
    margin-bottom: 12px;
    transition: border-color 0.15s;
  }
  .adm-search::placeholder { color: var(--hint); }
  .adm-search:focus { border-color: rgba(201,168,76,0.4); }

  .adm-filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }

  .adm-select {
    background: var(--card);
    border: 0.5px solid var(--border);
    border-radius: 8px;
    padding: 7px 10px;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 12px;
    color: var(--body);
    outline: none;
    cursor: pointer;
    transition: border-color 0.15s;
  }
  .adm-select:focus { border-color: rgba(201,168,76,0.4); }

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
    text-decoration: none;
  }
  .adm-user-row:hover { border-color: rgba(201,168,76,0.3); }

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
  .adm-user-arrow { font-size: 13px; color: var(--hint); flex-shrink: 0; }

  .adm-loading {
    min-height: 100vh; background: var(--bg);
    display: flex; align-items: center; justify-content: center;
  }
  .adm-loading p {
    font-family: 'Libre Baskerville', serif;
    font-size: 18px; color: var(--hint); font-style: italic;
  }

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
  nickname: string | null
  email: string | null
  google_name: string | null
  created_at: string | null
  last_seen_at: string | null
  quiz_count: number
  is_premium: boolean
  premium_source: string | null
  suspended_until: string | null
  has_org_membership: boolean
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function initial(name: string | null, email: string | null): string {
  return getAvatarInitial(name ?? email)
}

function isSuspended(u: UserRow): boolean {
  return !!u.suspended_until && new Date(u.suspended_until) > new Date()
}

type PremiumFilter = 'all' | 'premium' | 'free'
type SourceFilter = 'all' | 'founders' | 'org' | 'personal' | 'code'
type StatusFilter = 'all' | 'active' | 'suspended'
type AffiliationFilter = 'all' | 'org' | 'b2c'
type SortKey = 'newest' | 'oldest' | 'last_active_desc' | 'last_active_asc' | 'most_quizzes' | 'fewest_quizzes' | 'name'

export default function AdminUsersPage() {
  const router = useRouter()
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  // loadError skiller en MISLYKKET henting fra et bekreftet tomt resultat. Uten
  // dette ble enhver feil (nettverk, cold-start, engangs 401/5xx) vist som
  // "Ingen brukere matcher søket" — villedende når det finnes brukere.
  const [loadError, setLoadError] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [query, setQuery] = useState('')

  const [premiumFilter, setPremiumFilter] = useState<PremiumFilter>('all')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [affiliationFilter, setAffiliationFilter] = useState<AffiliationFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('newest')

  useEffect(() => {
    if (!isAdminLoggedIn()) { router.replace(adminLoginPath()); return }
    loadInitial()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  // Ett enkelt henteforsøk. Kaster ved feil ELLER uventet svarformat, slik at
  // kalleren kan skille "feilet" fra et gyldig, faktisk tomt resultat.
  async function fetchUsersOnce(): Promise<UserRow[]> {
    const res = await adminFetch('/api/admin/users')
    if (!res.ok) throw new Error(`API svarte ${res.status}`)
    const data = await res.json()
    if (!data || !Array.isArray(data.users)) throw new Error('Uventet svarformat fra serveren')
    return data.users as UserRow[]
  }

  // Førstegangslasting: ett automatisk retry etter kort delay dekker transiente
  // hikke (f.eks. deploy-cutover) uten at brukeren merker det. Feiler begge →
  // loadError (feilkort med "Prøv igjen"), ALDRI den villedende tom-tilstanden.
  async function loadInitial() {
    setLoading(true)
    setLoadError(false)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        setUsers(await fetchUsersOnce())
        setLoading(false)
        return
      } catch (e) {
        if (attempt === 0) { await new Promise(r => setTimeout(r, 1500)); continue }
        console.error('loadInitial (brukere) feilet:', e)
        setLoadError(true)
        setLoading(false)
      }
    }
  }

  // Manuelt "Prøv igjen" fra feilkortet — beholder feilkortet synlig ved ny feil.
  async function retryLoad() {
    setRetrying(true)
    try {
      setUsers(await fetchUsersOnce())
      setLoadError(false)
    } catch (e) {
      console.error('retryLoad (brukere) feilet:', e)
      setLoadError(true)
    } finally {
      setRetrying(false)
    }
  }

  // "Kun gratis" gjør premium-kilde-filteret meningsløst — skjul det i stedet
  // for å la et valgt kilde-filter stille undertrykke ALLE resultater.
  useEffect(() => {
    if (premiumFilter === 'free' && sourceFilter !== 'all') setSourceFilter('all')
  }, [premiumFilter, sourceFilter])

  // Filtrering + sortering — client-side. 144 brukere i dag; trygt og raskest
  // å bygge slik. Server-side sortering/filtrering bør vurderes hvis
  // brukerbasen vokser til et sted i tusentalls.
  const filtered = useMemo(() => {
    let list = users

    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter(u =>
        (u.display_name ?? '').toLowerCase().includes(q) ||
        (u.nickname ?? '').toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q) ||
        (u.google_name ?? '').toLowerCase().includes(q)
      )
    }

    if (premiumFilter === 'premium') list = list.filter(u => u.is_premium)
    else if (premiumFilter === 'free') list = list.filter(u => !u.is_premium)

    if (sourceFilter !== 'all') list = list.filter(u => u.premium_source === sourceFilter)

    if (statusFilter === 'active') list = list.filter(u => !isSuspended(u))
    else if (statusFilter === 'suspended') list = list.filter(u => isSuspended(u))

    if (affiliationFilter === 'org') list = list.filter(u => u.has_org_membership)
    else if (affiliationFilter === 'b2c') list = list.filter(u => !u.has_org_membership)

    const sorted = [...list]
    const byDate = (iso: string | null) => iso ? new Date(iso).getTime() : 0
    switch (sortKey) {
      case 'newest':
        sorted.sort((a, b) => byDate(b.created_at) - byDate(a.created_at)); break
      case 'oldest':
        sorted.sort((a, b) => byDate(a.created_at) - byDate(b.created_at)); break
      case 'last_active_desc':
        sorted.sort((a, b) => byDate(b.last_seen_at) - byDate(a.last_seen_at)); break
      case 'last_active_asc':
        sorted.sort((a, b) => byDate(a.last_seen_at) - byDate(b.last_seen_at)); break
      case 'most_quizzes':
        sorted.sort((a, b) => b.quiz_count - a.quiz_count); break
      case 'fewest_quizzes':
        sorted.sort((a, b) => a.quiz_count - b.quiz_count); break
      case 'name':
        sorted.sort((a, b) => {
          const an = (a.nickname?.trim() || a.display_name || '').toLowerCase()
          const bn = (b.nickname?.trim() || b.display_name || '').toLowerCase()
          return an.localeCompare(bn, 'nb-NO')
        }); break
    }
    return sorted
  }, [users, query, premiumFilter, sourceFilter, statusFilter, affiliationFilter, sortKey])

  const filteredPremiumCount = useMemo(() => filtered.filter(u => u.is_premium).length, [filtered])
  const filtersActive = premiumFilter !== 'all' || sourceFilter !== 'all' || statusFilter !== 'all' || affiliationFilter !== 'all'

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

        {loadError ? (
          <div style={{
            background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20,
            padding: '56px 32px', textAlign: 'center',
          }}>
            <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 20, color: '#ffffff', marginBottom: 8 }}>
              Kunne ikke laste brukere
            </p>
            <p style={{ fontSize: 13, color: '#918f8a', lineHeight: 1.6, marginBottom: 24 }}>
              Noe gikk galt under henting av brukerne. Dataene ligger trygt i
              databasen — dette er kun et lasteproblem. Prøv igjen.
            </p>
            <button
              onClick={retryLoad}
              disabled={retrying}
              style={{
                background: 'transparent',
                border: '1px solid #2a2d38',
                borderRadius: 10,
                padding: '10px 20px',
                fontSize: 13,
                fontWeight: 500,
                color: '#e8e4dd',
                cursor: retrying ? 'not-allowed' : 'pointer',
                fontFamily: "'Instrument Sans', sans-serif",
                opacity: retrying ? 0.6 : 1,
              }}
            >
              {retrying ? 'Prøver igjen…' : 'Prøv igjen'}
            </button>
          </div>
        ) : (
        <>
        <input
          type="search"
          placeholder="Søk på navn eller e-post…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="adm-search"
        />

        <div className="adm-filters">
          <select className="adm-select" value={premiumFilter} onChange={e => setPremiumFilter(e.target.value as PremiumFilter)}>
            <option value="all">Alle (Premium)</option>
            <option value="premium">Kun Premium</option>
            <option value="free">Kun gratis</option>
          </select>

          {premiumFilter !== 'free' && (
            <select className="adm-select" value={sourceFilter} onChange={e => setSourceFilter(e.target.value as SourceFilter)}>
              <option value="all">Alle kilder</option>
              <option value="founders">Founders</option>
              <option value="org">Bedrift</option>
              <option value="personal">Personlig</option>
              <option value="code">Kode</option>
            </select>
          )}

          <select className="adm-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="all">Alle (status)</option>
            <option value="active">Aktive</option>
            <option value="suspended">Karantene</option>
          </select>

          <select className="adm-select" value={affiliationFilter} onChange={e => setAffiliationFilter(e.target.value as AffiliationFilter)}>
            <option value="all">Alle (tilhørighet)</option>
            <option value="org">Kun org-medlemmer</option>
            <option value="b2c">Kun rene B2C</option>
          </select>

          <select className="adm-select" value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)} style={{ marginLeft: 'auto' }}>
            <option value="newest">Nyeste registrert</option>
            <option value="oldest">Eldste registrert</option>
            <option value="last_active_desc">Sist aktiv (nyest)</option>
            <option value="last_active_asc">Sist aktiv (eldst)</option>
            <option value="most_quizzes">Flest quizer spilt</option>
            <option value="fewest_quizzes">Færrest quizer spilt</option>
            <option value="name">Navn A-Å</option>
          </select>
        </div>

        <p className="adm-count">
          {filtered.length} av {users.length} brukere
          {filteredPremiumCount > 0 && <> · {filteredPremiumCount} Premium</>}
          {filtersActive && filtered.length !== users.length && (
            <> · <span style={{ color: '#c9a84c' }}>filtrert</span></>
          )}
        </p>

        {filtered.map(u => (
          <Link key={u.id} href={`/admin/users/${u.id}`} className="adm-user-row">
            <div className="adm-user-avatar">
              {initial(u.display_name, u.email)}
            </div>

            <div className="adm-user-body">
              <div className="adm-user-name">
                {u.nickname?.trim()
                  ? <>{u.nickname.trim()} <span style={{ color: 'var(--hint)', fontWeight: 400 }}>({u.display_name ?? 'Intet navn'})</span></>
                  : (u.display_name ?? <span style={{ color: 'var(--hint)', fontWeight: 400 }}>Intet navn</span>)}
              </div>
              <div className="adm-user-meta">
                {[u.google_name, u.email].filter(Boolean).join(' · ')}
              </div>
            </div>

            <div className="adm-user-right">
              {isSuspended(u) && (
                <span className="adm-badge-suspended">Karantene</span>
              )}
              {u.is_premium && (
                <span className="adm-badge-premium">Premium</span>
              )}
              <span className="adm-quiz-count">
                {u.quiz_count} {u.quiz_count === 1 ? 'quiz' : 'quizer'}
              </span>
              <span className="adm-user-date">{fmtDate(u.created_at)}</span>
              <span className="adm-user-arrow">→</span>
            </div>
          </Link>
        ))}

        {filtered.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--hint)', textAlign: 'center', marginTop: 40 }}>
            Ingen brukere matcher søket/filtrene.
          </p>
        )}
        </>
        )}

      </div>
    </>
  )
}
