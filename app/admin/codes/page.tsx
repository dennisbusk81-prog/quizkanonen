'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { isAdminLoggedIn } from '@/lib/admin-auth'
import { adminFetch } from '@/lib/admin-fetch'
import Link from 'next/link'

type Code = {
  id: string
  code: string
  description: string
  valid_until: string | null
  max_uses: number
  used_count: number
  is_active: boolean
  created_at: string
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
    --muted:    #6a6860;
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

  .ac-page { max-width: 680px; margin: 0 auto; padding: 0 20px 80px; }

  .ac-header {
    padding: 48px 0 28px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }

  .ac-back {
    font-size: 12px;
    color: var(--muted);
    text-decoration: none;
    display: block;
    margin-bottom: 8px;
    transition: color 0.15s;
  }
  .ac-back:hover { color: var(--gold); }

  .ac-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 26px;
    font-weight: 700;
    color: var(--white);
    letter-spacing: -0.01em;
  }
  .ac-title em { font-style: italic; color: var(--gold); }

  .ac-btn-add {
    font-size: 13px;
    font-weight: 600;
    color: #0f0f10;
    background: var(--gold);
    border: none;
    border-radius: var(--radius-btn);
    padding: 10px 18px;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }
  .ac-btn-add:hover { background: #d9b85c; }

  .ac-rule { width: 100%; height: 1px; background: var(--border); margin-bottom: 20px; }

  /* Feedback */
  .ac-feedback {
    border-radius: var(--radius-btn);
    padding: 11px 16px;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 16px;
  }
  .ac-feedback.success { background: var(--green-bg); color: var(--green); border: 1px solid var(--green-bdr); }
  .ac-feedback.error   { background: rgba(248,113,113,0.08); color: #f87171; border: 1px solid rgba(248,113,113,0.18); }

  /* Form */
  .ac-form {
    background: var(--card);
    border: 1px solid var(--gold-bdr);
    border-radius: var(--radius-card);
    padding: 24px;
    margin-bottom: 16px;
  }

  .ac-form-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 15px;
    font-weight: 700;
    color: var(--white);
    margin-bottom: 20px;
  }

  .ac-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
    display: block;
    margin-bottom: 7px;
  }

  .ac-input {
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
    margin-bottom: 0;
  }

  .ac-input.mono { font-family: 'Courier New', monospace; letter-spacing: 0.08em; }
  .ac-input::placeholder { color: var(--muted); }
  .ac-input:focus { border-color: var(--gold); }

  .ac-field { margin-bottom: 14px; }
  .ac-field:last-of-type { margin-bottom: 0; }
  .ac-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

  .ac-btn-save {
    width: 100%;
    background: var(--gold);
    color: #0f0f10;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 14px;
    font-weight: 600;
    padding: 12px;
    border-radius: var(--radius-btn);
    border: none;
    cursor: pointer;
    margin-top: 16px;
    transition: background 0.15s, opacity 0.15s;
  }
  .ac-btn-save:hover { background: #d9b85c; }
  .ac-btn-save:disabled { opacity: 0.35; cursor: not-allowed; }

  /* Code card */
  .ac-code-card {
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

  .ac-code-card.inactive { opacity: 0.45; }

  .ac-code-left { flex: 1; min-width: 0; }

  .ac-code-top {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 5px;
  }

  .ac-code-value {
    font-family: 'Courier New', monospace;
    font-size: 17px;
    font-weight: 700;
    color: var(--gold);
    letter-spacing: 0.06em;
  }

  .ac-badge {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: 20px;
  }

  .ac-badge.off     { background: var(--border); color: var(--muted); }
  .ac-badge.expired { background: rgba(248,113,113,0.10); color: #f87171; border: 1px solid rgba(248,113,113,0.18); }

  .ac-code-desc { font-size: 13px; color: var(--body); margin-bottom: 4px; }

  .ac-code-meta { font-size: 11px; color: var(--muted); }

  /* Usage bar */
  .ac-usage-bar-track {
    width: 80px;
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    margin-top: 6px;
    overflow: hidden;
  }

  .ac-usage-bar-fill {
    height: 100%;
    border-radius: 2px;
    background: var(--gold);
    transition: width 0.3s;
  }

  .ac-toggle-btn {
    font-size: 12px;
    font-weight: 500;
    padding: 7px 14px;
    border-radius: var(--radius-btn);
    border: none;
    cursor: pointer;
    flex-shrink: 0;
    font-family: 'Instrument Sans', sans-serif;
    transition: opacity 0.15s;
  }
  .ac-toggle-btn:hover { opacity: 0.75; }
  .ac-toggle-btn.deactivate { background: rgba(251,146,60,0.12); color: #fb923c; }
  .ac-toggle-btn.activate   { background: var(--green-bg); color: var(--green); }

  /* Empty */
  .ac-empty {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 48px 24px;
    text-align: center;
  }
  .ac-empty p { font-size: 14px; color: var(--muted); }

  .ac-loading {
    min-height: 100vh;
    background: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .ac-loading p {
    font-family: 'Libre Baskerville', serif;
    font-size: 18px;
    color: var(--muted);
    font-style: italic;
  }
`

export default function AdminCodes() {
  const router = useRouter()
  const [codes, setCodes] = useState<Code[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [form, setForm] = useState({ code: '', description: '', valid_days: '60', max_uses: '100' })
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    if (!isAdminLoggedIn()) { router.push('/admin/login'); setLoading(false); return }
    fetchCodes()
  }, [])

  function showFeedback(type: 'success' | 'error', msg: string) {
    setFeedback({ type, msg })
    setTimeout(() => setFeedback(null), 3000)
  }

  async function fetchCodes() {
    try {
      const res = await adminFetch('/api/admin/codes')
      if (!res.ok) throw new Error(`API svarte ${res.status}`)
      const data = await res.json()
      setCodes(data)
    } catch (e) {
      console.error('fetchCodes feilet:', e)
      showFeedback('error', 'Kunne ikke hente koder.')
    } finally {
      setLoading(false)
    }
  }

  async function saveCode() {
    if (!form.code.trim() || !form.description.trim()) {
      showFeedback('error', 'Fyll inn kode og beskrivelse.')
      return
    }
    setSaving(true)
    try {
      const validUntil = form.valid_days
        ? new Date(Date.now() + parseInt(form.valid_days) * 24 * 60 * 60 * 1000).toISOString()
        : null
      const res = await adminFetch('/api/admin/codes', {
        method: 'POST',
        body: JSON.stringify({
          code: form.code.trim().toUpperCase(),
          description: form.description.trim(),
          valid_until: validUntil,
          max_uses: parseInt(form.max_uses) || 100,
          used_count: 0,
          is_active: true,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        showFeedback('error', 'Feil ved lagring: ' + d.error)
      } else {
        showFeedback('success', 'Kode opprettet: ' + form.code.toUpperCase())
        setForm({ code: '', description: '', valid_days: '60', max_uses: '100' })
        setShowForm(false)
        fetchCodes()
      }
    } catch {
      showFeedback('error', 'Uventet feil ved lagring.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleCode(id: string, current: boolean) {
    try {
      const res = await adminFetch(`/api/admin/codes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !current }),
      })
      if (!res.ok) {
        const d = await res.json()
        showFeedback('error', 'Kunne ikke oppdatere: ' + d.error)
      } else {
        fetchCodes()
      }
    } catch {
      showFeedback('error', 'Uventet feil ved oppdatering.')
    }
  }

  const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString('no-NO') : 'Aldri'
  const isExpired = (d: string | null) => mounted && (d ? new Date(d) < new Date() : false)

  if (loading) return (
    <>
      <style>{STYLES}</style>
      <div className="ac-loading"><p>Laster...</p></div>
    </>
  )

  return (
    <>
      <style>{STYLES}</style>
      <div className="ac-page">

        <header className="ac-header">
          <div>
            <Link href="/admin" className="ac-back">← Admin</Link>
            <h1 className="ac-title">Verdi<em>koder</em></h1>
          </div>
          <button onClick={() => setShowForm(!showForm)} className="ac-btn-add">
            {showForm ? '✕ Avbryt' : '+ Ny kode'}
          </button>
        </header>

        <div className="ac-rule" />

        {feedback && (
          <div className={`ac-feedback ${feedback.type}`}>
            {feedback.type === 'success' ? '✓ ' : '✕ '}{feedback.msg}
          </div>
        )}

        {showForm && (
          <div className="ac-form">
            <p className="ac-form-title">Ny verdikode</p>

            <div className="ac-field">
              <label className="ac-label">Kode</label>
              <input type="text" value={form.code}
                onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="F.eks. BETATEST"
                className="ac-input ac-mono" />
            </div>

            <div className="ac-field">
              <label className="ac-label">Beskrivelse</label>
              <input type="text" value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="F.eks. Gratis tilgang til betatestere"
                className="ac-input" />
            </div>

            <div className="ac-field ac-grid-2">
              <div>
                <label className="ac-label">Gyldig i dager</label>
                <input type="number" value={form.valid_days}
                  onChange={e => setForm(f => ({ ...f, valid_days: e.target.value }))}
                  className="ac-input" />
              </div>
              <div>
                <label className="ac-label">Maks brukere</label>
                <input type="number" value={form.max_uses}
                  onChange={e => setForm(f => ({ ...f, max_uses: e.target.value }))}
                  className="ac-input" />
              </div>
            </div>

            <button onClick={saveCode} disabled={saving} className="ac-btn-save">
              {saving ? 'Lagrer...' : 'Lagre kode'}
            </button>
          </div>
        )}

        <div>
          {codes.length === 0 ? (
            <div className="ac-empty">
              <p>Ingen koder ennå. Lag din første!</p>
            </div>
          ) : codes.map(code => {
            const expired = isExpired(code.valid_until)
            const inactive = !code.is_active || expired
            const usagePct = Math.min((code.used_count / code.max_uses) * 100, 100)
            return (
              <div key={code.id} className={`ac-code-card ${inactive ? 'inactive' : ''}`}>
                <div className="ac-code-left">
                  <div className="ac-code-top">
                    <span className="ac-code-value">{code.code}</span>
                    {!code.is_active && <span className="ac-badge off">Deaktivert</span>}
                    {expired && <span className="ac-badge expired">Utløpt</span>}
                  </div>
                  <p className="ac-code-desc">{code.description}</p>
                  <p className="ac-code-meta">
                    {code.used_count}/{code.max_uses} brukt · utløper {formatDate(code.valid_until)}
                  </p>
                  <div className="ac-usage-bar-track">
                    <div className="ac-usage-bar-fill" style={{ width: `${usagePct}%` }} />
                  </div>
                </div>
                <button
                  onClick={() => toggleCode(code.id, code.is_active)}
                  className={`ac-toggle-btn ${code.is_active ? 'deactivate' : 'activate'}`}>
                  {code.is_active ? 'Deaktiver' : 'Aktiver'}
                </button>
              </div>
            )
          })}
        </div>

      </div>
    </>
  )
}