'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { isAdminLoggedIn } from '@/lib/admin-auth'
import { adminFetch } from '@/lib/admin-fetch'
import Link from 'next/link'

type TrialCode = {
  id: string
  code: string
  package: string
  trial_days: number
  created_at: string
  used_at: string | null
  used_by_org_id: string | null
  created_by_note: string | null
}

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
    --body:     #e8e4dd;
    --muted:    #7a7873;
    --green:    #4ade80;
    --green-bg: rgba(74,222,128,0.10);
    --green-bdr:rgba(74,222,128,0.20);
    --radius-card: 20px;
    --radius-btn:  10px;
  }

  body {
    background: var(--bg);
    font-family: 'Instrument Sans', sans-serif;
    color: var(--body);
    min-height: 100vh;
  }

  .tc-page { max-width: 680px; margin: 0 auto; padding: 0 20px 80px; }

  .tc-header {
    padding: 48px 0 28px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }

  .tc-back {
    font-size: 12px;
    color: var(--body);
    text-decoration: none;
    display: block;
    margin-bottom: 8px;
    transition: color 0.15s;
  }
  .tc-back:hover { color: var(--gold); }

  .tc-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 26px;
    font-weight: 700;
    color: var(--white);
    letter-spacing: -0.01em;
  }
  .tc-title em { font-style: italic; color: var(--gold); }

  .tc-btn-add {
    font-size: 13px;
    font-weight: 600;
    color: #1a1c23;
    background: var(--gold);
    border: none;
    border-radius: var(--radius-btn);
    padding: 10px 18px;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }
  .tc-btn-add:hover { background: #d9b85c; }

  .tc-rule { width: 100%; height: 1px; background: var(--border); margin-bottom: 20px; }

  .tc-feedback {
    border-radius: var(--radius-btn);
    padding: 11px 16px;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 16px;
  }
  .tc-feedback.success { background: var(--green-bg); color: var(--green); border: 1px solid var(--green-bdr); }
  .tc-feedback.error   { background: rgba(248,113,113,0.08); color: #f87171; border: 1px solid rgba(248,113,113,0.18); }

  .tc-form {
    background: var(--card);
    border: 1px solid var(--gold-bdr);
    border-radius: var(--radius-card);
    padding: 24px;
    margin-bottom: 16px;
  }

  .tc-form-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 15px;
    font-weight: 700;
    color: var(--white);
    margin-bottom: 20px;
  }

  .tc-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
    display: block;
    margin-bottom: 7px;
  }

  .tc-input, .tc-select {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-btn);
    padding: 11px 14px;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 14px;
    color: var(--white);
    outline: none;
    transition: border-color 0.15s;
  }
  .tc-input.mono { font-family: 'Courier New', monospace; letter-spacing: 0.08em; }
  .tc-input::placeholder { color: var(--muted); }
  .tc-input:focus, .tc-select:focus { border-color: var(--gold); }
  .tc-select { color-scheme: dark; }

  .tc-field { margin-bottom: 14px; }
  .tc-field:last-of-type { margin-bottom: 0; }
  .tc-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

  .tc-btn-save {
    width: 100%;
    background: var(--gold);
    color: #1a1c23;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 14px;
    font-weight: 600;
    padding: 11px;
    border-radius: var(--radius-btn);
    border: none;
    cursor: pointer;
    margin-top: 16px;
    transition: background 0.15s, opacity 0.15s;
  }
  .tc-btn-save:hover { background: #d9b85c; }
  .tc-btn-save:disabled { opacity: 0.35; cursor: not-allowed; }

  .tc-hint { font-size: 11px; color: var(--muted); margin-top: 6px; line-height: 1.5; }

  .tc-code-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 18px 20px;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    transition: opacity 0.15s;
  }
  .tc-code-card.used { opacity: 0.5; }

  .tc-code-left { flex: 1; min-width: 0; }

  .tc-code-top {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 5px;
  }

  .tc-code-value {
    font-family: 'Courier New', monospace;
    font-size: 17px;
    font-weight: 700;
    color: var(--gold);
    letter-spacing: 0.06em;
  }

  .tc-badge {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: 20px;
  }
  .tc-badge.active { background: var(--green-bg); color: var(--green); border: 1px solid var(--green-bdr); }
  .tc-badge.used   { background: var(--border); color: var(--muted); }
  .tc-badge.plan   { background: var(--gold-bg); color: var(--gold); border: 1px solid var(--gold-bdr); }

  .tc-code-desc { font-size: 13px; color: var(--body); margin-bottom: 4px; }
  .tc-code-meta { font-size: 11px; color: var(--muted); }

  .tc-copy-btn {
    font-size: 12px;
    font-weight: 500;
    padding: 7px 14px;
    border-radius: var(--radius-btn);
    border: 0.5px solid var(--border);
    background: transparent;
    color: var(--body);
    cursor: pointer;
    flex-shrink: 0;
    font-family: 'Instrument Sans', sans-serif;
    transition: border-color 0.15s, color 0.15s;
  }
  .tc-copy-btn:hover { border-color: rgba(255,255,255,0.2); color: var(--white); }

  .tc-empty {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 48px 24px;
    text-align: center;
  }
  .tc-empty p { font-size: 14px; color: var(--muted); }

  .tc-loading {
    min-height: 100vh;
    background: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .tc-loading p {
    font-family: 'Libre Baskerville', serif;
    font-size: 18px;
    color: var(--muted);
    font-style: italic;
  }
`

const PACKAGE_LABELS: Record<string, string> = { starter: 'Starter', standard: 'Standard', pro: 'Pro' }

export default function AdminOrgTrialCodes() {
  const router = useRouter()
  const [codes, setCodes] = useState<TrialCode[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [form, setForm] = useState({ package: 'standard', trial_days: '14', code: '', note: '' })
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TrialCode | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!isAdminLoggedIn()) { router.push('/admin/login'); setLoading(false); return }
    fetchCodes()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function showFeedback(type: 'success' | 'error', msg: string) {
    setFeedback({ type, msg })
    setTimeout(() => setFeedback(null), 3500)
  }

  async function fetchCodes() {
    try {
      const res = await adminFetch('/api/admin/org-trial-codes')
      if (!res.ok) throw new Error(`API svarte ${res.status}`)
      setCodes(await res.json())
    } catch (e) {
      console.error('fetchCodes feilet:', e)
      showFeedback('error', 'Kunne ikke hente koder.')
    } finally {
      setLoading(false)
    }
  }

  async function generateCode() {
    setSaving(true)
    try {
      const res = await adminFetch('/api/admin/org-trial-codes/generate', {
        method: 'POST',
        body: JSON.stringify({
          package: form.package,
          trial_days: parseInt(form.trial_days) || 14,
          code: form.code.trim() || undefined,
          note: form.note.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        showFeedback('error', data.error ?? 'Kunne ikke generere kode.')
      } else {
        showFeedback('success', 'Kode opprettet: ' + data.code)
        setForm({ package: 'standard', trial_days: '14', code: '', note: '' })
        setShowForm(false)
        fetchCodes()
      }
    } catch {
      showFeedback('error', 'Uventet feil ved generering.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteCode(id: string) {
    setDeleting(true)
    try {
      const res = await adminFetch(`/api/admin/org-trial-codes/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        showFeedback('error', data.error ?? 'Kunne ikke slette koden.')
      } else {
        showFeedback('success', 'Kode slettet.')
        fetchCodes()
      }
    } catch {
      showFeedback('error', 'Uventet feil ved sletting.')
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  async function copyCode(id: string, code: string) {
    try {
      await navigator.clipboard.writeText(code)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch { /* clipboard unavailable */ }
  }

  const formatDate = (d: string) => new Date(d).toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' })

  if (loading) return (
    <>
      <style>{STYLES}</style>
      <div className="tc-loading"><p>Laster...</p></div>
    </>
  )

  return (
    <>
      <style>{STYLES}</style>
      <div className="tc-page">

        <header className="tc-header">
          <div>
            <Link href="/admin" className="tc-back">← Admin</Link>
            <h1 className="tc-title">Bedrifts<em>koder</em></h1>
          </div>
          <button
            onClick={() => { setShowForm(!showForm); setForm({ package: 'standard', trial_days: '14', code: '', note: '' }) }}
            className="tc-btn-add"
          >
            {showForm ? 'Avbryt' : '+ Ny kode'}
          </button>
        </header>

        <div className="tc-rule" />

        {feedback && (
          <div className={`tc-feedback ${feedback.type}`}>{feedback.msg}</div>
        )}

        {showForm && (
          <div className="tc-form">
            <p className="tc-form-title">Ny engangskode for bedrifts-trial</p>

            <div className="tc-field tc-grid-2">
              <div>
                <label className="tc-label">Pakke</label>
                <select
                  value={form.package}
                  onChange={e => setForm(f => ({ ...f, package: e.target.value }))}
                  className="tc-select"
                >
                  <option value="starter">Starter</option>
                  <option value="standard">Standard</option>
                  <option value="pro">Pro</option>
                </select>
              </div>
              <div>
                <label className="tc-label">Trial-dager</label>
                <select
                  value={form.trial_days}
                  onChange={e => setForm(f => ({ ...f, trial_days: e.target.value }))}
                  className="tc-select"
                >
                  <option value="14">14 dager</option>
                  <option value="30">30 dager</option>
                  <option value="60">60 dager</option>
                </select>
              </div>
            </div>

            <div className="tc-field">
              <label className="tc-label">Egendefinert kode (valgfritt)</label>
              <input
                type="text"
                value={form.code}
                onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="F.eks. PILOT-ELKJOP"
                className="tc-input mono"
              />
              <p className="tc-hint">La stå tom for å generere en tilfeldig 8-tegns kode.</p>
            </div>

            <div className="tc-field">
              <label className="tc-label">Notat (valgfritt)</label>
              <input
                type="text"
                value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                placeholder="F.eks. Pilot — Elkjøp Lørenskog"
                className="tc-input"
              />
            </div>

            <button onClick={generateCode} disabled={saving} className="tc-btn-save">
              {saving ? 'Genererer...' : 'Generér kode'}
            </button>
          </div>
        )}

        <div>
          {codes.length === 0 ? (
            <div className="tc-empty">
              <p>Ingen bedriftskoder ennå. Lag din første!</p>
            </div>
          ) : codes.map(code => {
            const used = !!code.used_at
            return (
              <div key={code.id} className={`tc-code-card ${used ? 'used' : ''}`}>
                <div className="tc-code-left">
                  <div className="tc-code-top">
                    <span className="tc-code-value">{code.code}</span>
                    <span className="tc-badge plan">{PACKAGE_LABELS[code.package] ?? code.package}</span>
                    {used
                      ? <span className="tc-badge used">Brukt</span>
                      : <span className="tc-badge active">Aktiv</span>}
                  </div>
                  {code.created_by_note && <p className="tc-code-desc">{code.created_by_note}</p>}
                  <p className="tc-code-meta">
                    {code.trial_days} dagers trial · opprettet {formatDate(code.created_at)}
                    {used && code.used_at ? ` · brukt ${formatDate(code.used_at)}` : ''}
                  </p>
                </div>
                {!used && (
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button
                      onClick={() => copyCode(code.id, code.code)}
                      className="tc-copy-btn"
                    >
                      {copiedId === code.id ? 'Kopiert!' : 'Kopier'}
                    </button>
                    <button
                      onClick={() => setDeleteTarget(code)}
                      className="tc-copy-btn"
                      style={{ color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' }}
                    >
                      Slett
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

      </div>

      {deleteTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '28px', maxWidth: 400, width: '100%', fontFamily: "'Instrument Sans', sans-serif" }}>
            <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#f87171', marginBottom: 10 }}>
              Slett kode
            </p>
            <p style={{ fontSize: 14, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 24 }}>
              Slett koden <strong style={{ color: '#ffffff', fontFamily: "'Courier New', monospace", letterSpacing: '0.06em' }}>{deleteTarget.code}</strong>? Dette kan ikke angres.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDeleteTarget(null)}
                style={{ fontSize: 13, color: '#e8e4dd', background: 'transparent', border: '0.5px solid #2a2d38', borderRadius: 10, padding: '8px 16px', cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif" }}
              >
                Avbryt
              </button>
              <button
                onClick={() => deleteCode(deleteTarget.id)}
                disabled={deleting}
                style={{ fontSize: 13, fontWeight: 600, color: '#1a1c23', background: deleting ? '#2a2d38' : '#f87171', border: 'none', borderRadius: 10, padding: '8px 20px', cursor: deleting ? 'not-allowed' : 'pointer', fontFamily: "'Instrument Sans', sans-serif" }}
              >
                {deleting ? 'Sletter...' : 'Slett'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
