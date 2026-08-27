'use client'
import { useEffect, useRef, useState } from 'react'
import { autoDismissMs } from '@/lib/admin-feedback'
import { useRouter } from 'next/navigation'
import { isAdminLoggedIn, adminLoginPath } from '@/lib/admin-session'
import { adminFetch } from '@/lib/admin-fetch'
import { resolveCodeDuration } from '@/lib/access-code-duration'
import Link from 'next/link'

type Code = {
  id: string
  code: string
  description: string
  valid_until: string | null
  duration_days: number | null
  max_uses: number
  used_count: number
  is_active: boolean
  created_at: string
  // Eldre rader (opprettet før 26. juli 2026) mangler feltet — de var alle
  // brede koder, så null behandles som 'shared'.
  code_type: 'shared' | 'personal' | null
}

// Standard utløpsdato for en ny delt kode: 90 dager fram i tid. Delte koder MÅ
// ha en frist (serveren avviser dem uten), så feltet forhåndsutfylles i stedet
// for å stå tomt og stoppe lagringen.
function defaultValidUntil(): string {
  const d = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}

const STYLES = `

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
    --muted:    #918f8a;
    --green:    #4ade80;
    --green-bg: rgba(74,222,128,0.10);
    --green-bdr:rgba(74,222,128,0.20);
    --radius-card: 20px;
    --radius-btn:  10px;
  }

  body {
    background: var(--bg);
    font-family: var(--font-instrument-sans), sans-serif;
    color: var(--body);
    min-height: 100vh;
  }

  .ac-page { flex: 1; max-width: 680px; margin: 0 auto; padding: 0 20px 80px; }

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
    font-family: var(--font-libre-baskerville), serif;
    font-size: 26px;
    font-weight: 700;
    color: var(--white);
    letter-spacing: -0.01em;
  }
  .ac-title em { font-style: italic; color: var(--gold); }

  .ac-btn-add {
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
    font-family: var(--font-libre-baskerville), serif;
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
    font-family: var(--font-instrument-sans), sans-serif;
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
    color: #1a1c23;
    font-family: var(--font-instrument-sans), sans-serif;
    font-size: 14px;
    font-weight: 600;
    padding: 11px;
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

  /* Kodetype vs. status er to ULIKE ting, og skal ikke se like ut.
     Grått betyr «noe er av» (deaktivert/utløpt) — aldri «dette er en kodetype».
     Typen får derfor sin egen farge: gull-tint for delt, samme visuelle språk
     som det valgte kortet i opprettelses-skjemaet, så typen kjennes igjen
     hele veien fra opprettelse til liste. */
  .ac-badge.type-shared {
    background: var(--gold-bg);
    color: var(--gold);
    border: 1px solid var(--gold-bdr);
  }
  .ac-badge.type-personal {
    background: transparent;
    color: var(--body);
    border: 1px solid var(--border);
  }

  .ac-badge.off     { background: var(--border); color: var(--muted); }
  .ac-badge.expired { background: rgba(248,113,113,0.10); color: #f87171; border: 1px solid rgba(248,113,113,0.18); }

  .ac-code-desc { font-size: 13px; color: var(--body); margin-bottom: 4px; }

  .ac-code-meta { font-size: 11px; color: var(--muted); }
  /* Typen står også i meta-linjen, ikke bare som pille: da leses den som en
     egenskap ved koden, ikke som pynt man kan overse. */
  .ac-code-meta strong { color: var(--body); font-weight: 600; }

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
    font-family: var(--font-instrument-sans), sans-serif;
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
    font-family: var(--font-libre-baskerville), serif;
    font-size: 18px;
    color: var(--muted);
    font-style: italic;
  }
`

export default function AdminCodes() {
  const router = useRouter()
  const [codes, setCodes] = useState<Code[]>([])
  const [loading, setLoading] = useState(true)
  // loadError skiller en MISLYKKET henting fra en bekreftet tom liste — samme
  // mønster som app/admin/quizzes/page.tsx allerede hadde. Se fetchCodes.
  const [loadError, setLoadError] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [codeType, setCodeType] = useState<'shared' | 'personal'>('shared')
  const [form, setForm] = useState({ code: '', description: '', duration_days: '60', valid_until_date: defaultValidUntil(), max_uses: '100' })
  // «Permanent Premium» er nå et EKSPLISITT valg, ikke et tomt felt.
  //
  // Fram til 12. august ble permanens utledet av fravær: tomt varighetsfelt →
  // `duration_days: null`. To problemer med det. For det første kan
  // duration_days ikke endres etter opprettelse (PATCHABLE_ACCESS_CODE_FIELDS),
  // så en bom er permanent. For det andre — og verre — gikk enhver ugyldig
  // verdi samme vei: `parseInt('seksti')` er NaN, og linja under sendte da
  // `null`. En skrivefeil ble stille til en permanent kode.
  const [permanent, setPermanent] = useState(false)
  const [mounted, setMounted] = useState(false)
  // Nyopprettet privat kode vises én gang her — den genereres på serveren og
  // står ellers bare i tabellen.
  const [generated, setGenerated] = useState<string | null>(null)

  const emptyForm = () => ({ code: '', description: '', duration_days: '60', valid_until_date: defaultValidUntil(), max_uses: '100' })

  useEffect(() => {
    setMounted(true)
    if (!isAdminLoggedIn()) { router.replace(adminLoginPath()); setLoading(false); return }
    fetchCodes()
  }, [])

  // Timeren settes KUN for kvitteringer — autoDismissMs gir null for feil, se
  // lib/admin-feedback.ts. En feil blir stående til den erstattes av neste
  // melding eller lukkes for hånd.
  //
  // feedbackTimer: den forrige timeren ryddes før en ny melding vises. Uten
  // det kunne en kvittering fra tre sekunder siden rekke å slette en feil som
  // nettopp kom — timerne var uavhengige og visste ikke om hverandre.
  // Feil forsvinner ikke av seg selv lenger, så det må finnes en vei ut som
  // ikke er å laste siden på nytt.
  function dismissFeedback() {
    if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current)
    feedbackTimer.current = null
    setFeedback(null)
  }

  function showFeedback(type: 'success' | 'error', msg: string) {
    if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current)
    feedbackTimer.current = null
    setFeedback({ type, msg })
    const delay = autoDismissMs(type)
    if (delay !== null) {
      feedbackTimer.current = setTimeout(() => { setFeedback(null); feedbackTimer.current = null }, delay)
    }
  }

  async function fetchCodes() {
    try {
      const res = await adminFetch('/api/admin/codes')
      if (!res.ok) throw new Error(`API svarte ${res.status}`)
      const data = await res.json()
      if (!Array.isArray(data)) throw new Error('Uventet svarformat fra serveren')
      setCodes(data)
      setLoadError(false)
    } catch (e) {
      console.error('fetchCodes feilet:', e)
      // loadError, IKKE bare en toast: uten den falt lista tilbake på
      // "Ingen koder ennå. Lag din første!" — en positiv påstand om at basen
      // er tom, når alt vi vet er at hentingen feilet.
      setLoadError(true)
      showFeedback('error', 'Kunne ikke hente koder.')
    } finally {
      setLoading(false)
    }
  }

  async function retryLoad() {
    setRetrying(true)
    try { await fetchCodes() } finally { setRetrying(false) }
  }

  async function saveCode() {
    if (!form.description.trim()) {
      showFeedback('error', 'Fyll inn beskrivelse.')
      return
    }
    // Privat kode genereres på serveren — da finnes den aldri som fritekst noen
    // har valgt. Delt kode må ha et kodeord, og må ha bruksgrenser (serveren
    // håndhever det samme).
    if (codeType === 'shared') {
      if (!form.code.trim()) { showFeedback('error', 'Delte koder trenger et kodeord.'); return }
      if (!form.valid_until_date) { showFeedback('error', 'Delte koder må ha en utløpsdato.'); return }
      if (!(parseInt(form.max_uses) > 0)) { showFeedback('error', 'Delte koder må ha et maks antall innløsninger.'); return }
    }
    // Varigheten avgjøres ett sted (lib/access-code-duration.ts), og samme svar
    // brukes både til valideringen her og til payloaden under — de kan da ikke
    // drive fra hverandre.
    const duration = resolveCodeDuration(permanent, form.duration_days)
    if (!duration.ok) {
      showFeedback('error', duration.error)
      return
    }
    setSaving(true)
    setGenerated(null)
    try {
      // Datoen tolkes til og med hele dagen.
      const validUntil = form.valid_until_date
        ? new Date(`${form.valid_until_date}T23:59:59`).toISOString()
        : null
      const res = await adminFetch('/api/admin/codes', {
        method: 'POST',
        body: JSON.stringify({
          code_type: codeType,
          code: codeType === 'shared' ? form.code.trim().toUpperCase() : undefined,
          description: form.description.trim(),
          valid_until: validUntil,
          duration_days: duration.durationDays,
          max_uses: codeType === 'shared' ? parseInt(form.max_uses) : 1,
        }),
      })
      const d = await res.json()
      if (!res.ok) {
        showFeedback('error', d.error ?? 'Feil ved lagring.')
      } else {
        const saved = d.code?.code ?? form.code.toUpperCase()
        if (codeType === 'personal') setGenerated(saved)
        showFeedback('success', 'Kode opprettet: ' + saved)
        setForm(emptyForm())
        setPermanent(false)
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

  const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Aldri'
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
          <button onClick={() => { setShowForm(!showForm); setCodeType('shared'); setGenerated(null); setForm(emptyForm()) }} className="ac-btn-add">
            {showForm ? '✕ Avbryt' : '+ Ny kode'}
          </button>
        </header>

        <div className="ac-rule" />

        {feedback && (
          <div className={`ac-feedback ${feedback.type}`}>
            {feedback.type === 'success' ? '✓ ' : '✕ '}{feedback.msg}
            {feedback.type === 'error' && (
            <button
              onClick={dismissFeedback}
              aria-label="Lukk feilmelding"
              style={{
                background: 'none', border: 'none', padding: '0 0 0 10px',
                cursor: 'pointer', color: 'inherit', font: 'inherit', opacity: 0.7,
              }}
            >
              Lukk
            </button>
            )}
          </div>
        )}

        {showForm && (
          <div className="ac-form">
            <p className="ac-form-title">Ny verdikode</p>

            {/* Kodetype */}
            <div className="ac-field">
              <label className="ac-label">Kodetype</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {([
                  { value: 'shared', label: 'Delt kode', sub: 'Mange kan bruke · krever grense og frist' },
                  { value: 'personal', label: 'Privat kode', sub: 'Én mottaker · genereres tilfeldig' },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      setCodeType(opt.value)
                      setGenerated(null)
                      // Begge forhåndsvalgene under setter et dagtall. Uten
                      // denne ville en avkrysset «permanent» blitt stående og
                      // gjort forhåndsvalget virkningsløst — feltet ville vist
                      // 365 mens koden fortsatt ble permanent.
                      setPermanent(false)
                      if (opt.value === 'personal') {
                        setForm(f => ({ ...f, code: '', duration_days: '365', max_uses: '1', description: f.description || 'Gave til ' }))
                      } else {
                        setForm(f => ({ ...f, duration_days: '60', max_uses: '100', valid_until_date: f.valid_until_date || defaultValidUntil() }))
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: '10px 12px',
                      background: codeType === opt.value ? 'rgba(201,168,76,0.10)' : 'transparent',
                      border: codeType === opt.value ? '1px solid rgba(201,168,76,0.4)' : '1px solid #2a2d38',
                      borderRadius: 10,
                      cursor: 'pointer',
                      textAlign: 'left' as const,
                      fontFamily: "var(--font-instrument-sans), sans-serif",
                      transition: 'border-color 0.15s, background 0.15s',
                    }}
                  >
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: codeType === opt.value ? '#c9a84c' : '#e8e4dd', marginBottom: 2 }}>
                      {opt.label}
                    </span>
                    <span style={{ display: 'block', fontSize: 11, color: '#918f8a' }}>{opt.sub}</span>
                  </button>
                ))}
              </div>
            </div>

            {codeType === 'shared' ? (
              <div className="ac-field">
                <label className="ac-label">Kodeord</label>
                <input type="text" value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="F.eks. FREDAGSQUIZ"
                  className="ac-input ac-mono" />
                <p style={{ fontSize: 11, color: '#918f8a', marginTop: 6, lineHeight: 1.5 }}>
                  Skal kunne deles åpent og huskes. Det er grensen og fristen under
                  som beskytter koden — ikke at den er vanskelig å gjette.
                </p>
              </div>
            ) : (
              <div className="ac-field">
                <label className="ac-label">Kode</label>
                <p style={{
                  background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 10,
                  padding: '11px 14px', fontFamily: "'Courier New', monospace",
                  fontSize: 14, letterSpacing: '0.08em', color: '#918f8a',
                }}>
                  Genereres automatisk
                </p>
                <p style={{ fontSize: 11, color: '#918f8a', marginTop: 6, lineHeight: 1.5 }}>
                  En privat kode skal ikke kunne gjettes av utenforstående, og
                  settes derfor tilfeldig av serveren. Du får se den når den er lagret.
                </p>
              </div>
            )}

            <div className="ac-field">
              <label className="ac-label">Beskrivelse</label>
              <input type="text" value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder={codeType === 'personal' ? 'F.eks. Gave til Marte' : 'F.eks. Gratis tilgang til betatestere'}
                className="ac-input" />
            </div>

            <div className="ac-field ac-grid-2">
              <div>
                <label className="ac-label">Premium varer i dager</label>
                <input type="number" value={permanent ? '' : form.duration_days}
                  onChange={e => setForm(f => ({ ...f, duration_days: e.target.value }))}
                  disabled={permanent}
                  placeholder={permanent ? 'Permanent' : 'F.eks. 60'}
                  className="ac-input"
                  style={permanent ? { opacity: 0.45, cursor: 'not-allowed' } : undefined} />
                <label style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  marginTop: 10, cursor: 'pointer',
                }}>
                  <input
                    type="checkbox"
                    checked={permanent}
                    onChange={e => setPermanent(e.target.checked)}
                    style={{ marginTop: 2, accentColor: '#c9a84c', cursor: 'pointer' }} />
                  <span style={{ fontSize: 12, color: '#e8e4dd', lineHeight: 1.5 }}>
                    Permanent Premium
                  </span>
                </label>
                {permanent ? (
                  <p style={{
                    fontSize: 11, color: '#e8e4dd', marginTop: 8, lineHeight: 1.6,
                    background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.35)',
                    borderRadius: 10, padding: '10px 12px',
                  }}>
                    Premium varer for alltid, og varigheten kan ikke endres senere.
                    En slik kode kan ikke løses inn av noen som allerede betaler for
                    Premium — de får en beskjed om å ta kontakt i stedet.
                  </p>
                ) : (
                  <p style={{ fontSize: 11, color: '#918f8a', marginTop: 6, lineHeight: 1.5 }}>
                    Hvor lenge brukeren har Premium etter at koden er løst inn.
                  </p>
                )}
              </div>
              <div>
                <label className="ac-label">Maks innløsninger</label>
                <input type="number" value={form.max_uses}
                  onChange={e => setForm(f => ({ ...f, max_uses: e.target.value }))}
                  disabled={codeType === 'personal'}
                  className="ac-input"
                  style={codeType === 'personal' ? { opacity: 0.45, cursor: 'not-allowed' } : undefined} />
                <p style={{ fontSize: 11, color: '#918f8a', marginTop: 6, lineHeight: 1.5 }}>
                  {codeType === 'personal'
                    ? 'Låst til 1 — en privat kode har én mottaker.'
                    : 'Hver konto kan bruke koden én gang. Taket gjelder totalt.'}
                </p>
              </div>
            </div>

            <div className="ac-field">
              <label className="ac-label">
                Koden kan brukes til og med{codeType === 'shared' ? ' (påkrevd)' : ''}
              </label>
              <input type="date" value={form.valid_until_date}
                onChange={e => setForm(f => ({ ...f, valid_until_date: e.target.value }))}
                className="ac-input" />
              <p style={{ fontSize: 11, color: '#918f8a', marginTop: 6, lineHeight: 1.5 }}>
                Siste dag koden kan løses inn. Påvirker ikke hvor lenge Premium varer.<br />
                {codeType === 'shared'
                  ? 'En delt kode ligger ute for alltid — fristen er det som gjør at den ikke gjør det.'
                  : 'Tom = ingen frist; koden virker til den deaktiveres eller er brukt opp.'}
              </p>
            </div>

            <button onClick={saveCode} disabled={saving} className="ac-btn-save">
              {saving ? 'Lagrer...' : 'Lagre kode'}
            </button>
          </div>
        )}

        {generated && (
          <div className="ac-form" style={{ borderColor: 'rgba(201,168,76,0.4)' }}>
            <p className="ac-form-title">Privat kode opprettet</p>
            <p className="ac-code-value" style={{ fontSize: 20 }}>{generated}</p>
            <p style={{ fontSize: 12, color: '#918f8a', marginTop: 10, lineHeight: 1.6 }}>
              Send denne til mottakeren. Den står også i listen under.
            </p>
          </div>
        )}

        <div>
          {loadError ? (
            <div className="ac-empty">
              <p style={{ fontWeight: 600, color: '#e8e4dd', marginBottom: 6 }}>Kunne ikke laste koder</p>
              <p style={{ fontSize: 13, color: '#918f8a', lineHeight: 1.6, marginBottom: 14 }}>
                Kodene ligger trygt i databasen — dette er kun et lasteproblem.
              </p>
              <button
                onClick={retryLoad}
                disabled={retrying}
                style={{
                  background: 'transparent', border: '1px solid #2a2d38', borderRadius: 10,
                  padding: '10px 20px', fontSize: 13, fontWeight: 500, color: '#e8e4dd',
                  cursor: retrying ? 'not-allowed' : 'pointer', opacity: retrying ? 0.6 : 1,
                  fontFamily: "var(--font-instrument-sans), sans-serif",
                }}
              >
                {retrying ? 'Prøver igjen…' : 'Prøv igjen'}
              </button>
            </div>
          ) : codes.length === 0 ? (
            <div className="ac-empty">
              <p>Ingen koder ennå. Lag din første!</p>
            </div>
          ) : codes.map(code => {
            const expired = isExpired(code.valid_until)
            const inactive = !code.is_active || expired
            const usagePct = Math.min((code.used_count / code.max_uses) * 100, 100)
            // Eldre rader mangler code_type — de var alle brede koder.
            const personal = code.code_type === 'personal'
            // «1/1 brukt» sier ingenting om en kode som per definisjon har én
            // mottaker. «Plasser» gir bare mening for en delt kode.
            const usage = personal
              ? (code.used_count > 0 ? 'brukt' : 'ikke brukt ennå')
              : `${code.used_count} av ${code.max_uses} plasser brukt`
            return (
              <div key={code.id} className={`ac-code-card ${inactive ? 'inactive' : ''}`}>
                <div className="ac-code-left">
                  <div className="ac-code-top">
                    <span className="ac-code-value">{code.code}</span>
                    <span className={`ac-badge ${personal ? 'type-personal' : 'type-shared'}`}>
                      {personal ? 'Privat' : 'Delt'}
                    </span>
                    {!code.is_active && <span className="ac-badge off">Deaktivert</span>}
                    {expired && <span className="ac-badge expired">Utløpt</span>}
                  </div>
                  <p className="ac-code-desc">{code.description}</p>
                  <p className="ac-code-meta">
                    <strong>{personal ? 'Privat' : 'Delt'}</strong>
                    {' — '}{usage}
                    {' · '}gir {code.duration_days ? `${code.duration_days} dager Premium` : 'permanent Premium — ikke til betalende kunder'}
                    {' · '}{code.valid_until ? `siste frist ${formatDate(code.valid_until)}` : 'ingen frist'}
                  </p>
                  <div className="ac-usage-bar-track">
                    <div className="ac-usage-bar-fill" style={{ width: `${usagePct}%` }} />
                  </div>
                </div>
                {!expired && (
                  <button
                    onClick={() => toggleCode(code.id, code.is_active)}
                    className={`ac-toggle-btn ${code.is_active ? 'deactivate' : 'activate'}`}>
                    {code.is_active ? 'Deaktiver' : 'Aktiver'}
                  </button>
                )}
              </div>
            )
          })}
        </div>

      </div>
    </>
  )
}