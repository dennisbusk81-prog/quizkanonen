'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { isAdminLoggedIn } from '@/lib/admin-auth'
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

  .nq-page { max-width: 680px; margin: 0 auto; padding: 0 20px 80px; }

  .nq-header { padding: 48px 0 32px; }

  .nq-back {
    font-size: 12px;
    color: var(--muted);
    text-decoration: none;
    display: inline-block;
    margin-bottom: 12px;
    transition: color 0.15s;
  }

  .nq-back:hover { color: var(--gold); }

  .nq-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 26px;
    font-weight: 700;
    color: var(--white);
    letter-spacing: -0.01em;
  }

  .nq-title em { font-style: italic; color: var(--gold); }

  .nq-rule { width: 100%; height: 1px; background: var(--border); margin-bottom: 24px; }

  /* Section card */
  .nq-section {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 24px;
    margin-bottom: 12px;
  }

  .nq-section-title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .nq-section-title::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  /* Form elements */
  .nq-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    display: block;
    margin-bottom: 8px;
  }

  .nq-input, .nq-select, .nq-textarea {
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

  .nq-input::placeholder,
  .nq-textarea::placeholder { color: var(--muted); }

  .nq-input:focus,
  .nq-select:focus,
  .nq-textarea:focus { border-color: var(--gold); }

  .nq-select { appearance: none; cursor: pointer; }
  .nq-textarea { resize: none; }

  .nq-field { margin-bottom: 16px; }
  .nq-field:last-child { margin-bottom: 0; }

  .nq-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

  /* Slider */
  .nq-slider-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  .nq-slider-value {
    font-family: 'Libre Baskerville', serif;
    font-size: 20px;
    font-weight: 700;
    color: var(--gold);
  }

  .nq-slider-unit { font-size: 12px; color: var(--muted); margin-left: 4px; }

  input[type=range] {
    width: 100%;
    accent-color: var(--gold);
    height: 4px;
    cursor: pointer;
  }

  .nq-slider-ticks {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
  }

  .nq-slider-ticks span { font-size: 11px; color: var(--muted); }

  /* Options buttons */
  .nq-option-btns { display: flex; gap: 8px; }

  .nq-opt-btn {
    flex: 1;
    padding: 10px 8px;
    border-radius: var(--radius-btn);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--body);
    font-family: 'Instrument Sans', sans-serif;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .nq-opt-btn.active {
    background: var(--gold-bg);
    border-color: var(--gold-bdr);
    color: var(--gold);
  }

  /* Toggle rows */
  .nq-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
  }

  .nq-toggle-row:last-child { border-bottom: none; padding-bottom: 0; }
  .nq-toggle-row:first-child { padding-top: 0; }

  .nq-toggle-info { flex: 1; min-width: 0; padding-right: 16px; }

  .nq-toggle-label {
    font-size: 14px;
    font-weight: 500;
    color: var(--white);
    margin-bottom: 2px;
  }

  .nq-toggle-desc { font-size: 12px; color: var(--muted); }

  .nq-toggle {
    width: 42px;
    height: 23px;
    border-radius: 12px;
    background: var(--border);
    border: none;
    cursor: pointer;
    flex-shrink: 0;
    position: relative;
    transition: background 0.18s;
  }

  .nq-toggle.on { background: var(--gold); }

  .nq-toggle-knob {
    width: 17px;
    height: 17px;
    background: var(--white);
    border-radius: 50%;
    position: absolute;
    top: 3px;
    left: 3px;
    transition: transform 0.18s;
  }

  .nq-toggle.on .nq-toggle-knob { transform: translateX(19px); }

  /* Save button */
  .nq-save-btn {
    width: 100%;
    background: var(--gold);
    color: #0f0f10;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 15px;
    font-weight: 600;
    padding: 14px;
    border-radius: var(--radius-btn);
    border: none;
    cursor: pointer;
    margin-top: 12px;
    transition: background 0.15s, opacity 0.15s;
  }

  .nq-save-btn:hover { background: #d9b85c; }
  .nq-save-btn:disabled { opacity: 0.35; cursor: not-allowed; }

  .nq-hint {
    font-size: 11px;
    color: var(--muted);
    margin-top: 8px;
    text-align: center;
  }

  .nq-loading {
    min-height: 100vh;
    background: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  @media (max-width: 480px) {
    .nq-grid-2 { grid-template-columns: 1fr; }
  }
`

export default function NewQuiz() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'Allmennkunnskap',
    opens_at: '',
    closes_at: '',
    scheduled_at: '',
    time_limit_seconds: 30,
    num_options: 4,
    show_leaderboard: true,
    hide_leaderboard_until_closed: true,
    show_live_placement: false,
    show_answer_explanation: true,
    randomize_questions: false,
    allow_teams: true,
    requires_access_code: false,
    is_active: true,
  })

  useEffect(() => {
    if (!isAdminLoggedIn()) { router.push('/admin/login'); return }

    const now = new Date()
    const dayOfWeek = now.getDay()
    const daysUntilFriday = dayOfWeek <= 5 ? 5 - dayOfWeek : 6
    const nextFriday = new Date(now)
    nextFriday.setDate(now.getDate() + (daysUntilFriday === 0 ? 7 : daysUntilFriday))
    nextFriday.setHours(17, 0, 0, 0)
    const nextFridayClose = new Date(nextFriday)
    nextFridayClose.setDate(nextFriday.getDate() + 7)

    const toLocal = (d: Date) => {
      const pad = (n: number) => n.toString().padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    setForm(f => ({ ...f, opens_at: toLocal(nextFriday), closes_at: toLocal(nextFridayClose) }))
  }, [])

  const update = (key: string, value: any) => setForm(f => ({ ...f, [key]: value }))

  const handleSave = async () => {
    if (!form.title || !form.opens_at || !form.closes_at) {
      alert('Fyll inn tittel, åpningstid og stengetid.')
      return
    }
    setSaving(true)
    const { data, error } = await supabase.from('quizzes').insert({
      ...form,
      opens_at: new Date(form.opens_at).toISOString(),
      closes_at: new Date(form.closes_at).toISOString(),
      scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
    }).select().single()

    if (error) {
      alert('Feil ved lagring: ' + error.message)
      setSaving(false)
      return
    }
    router.push(`/admin/quizzes/${data.id}/questions`)
  }

  const toggleItems = [
    { key: 'show_leaderboard',               label: 'Vis leaderboard',                    desc: 'Spillere kan se rangeringen' },
    { key: 'hide_leaderboard_until_closed',  label: 'Skjul leaderboard til quiz stenger', desc: 'Hindrer at folk ser andres score under spilling' },
    { key: 'show_live_placement',            label: 'Vis live plassering',                desc: 'Spilleren ser sin plassering underveis' },
    { key: 'show_answer_explanation',        label: 'Vis forklaring etter svar',          desc: 'Kort forklaring vises etter hvert svar' },
    { key: 'randomize_questions',            label: 'Tilfeldig rekkefølge',               desc: 'Spørsmålene vises i tilfeldig rekkefølge' },
    { key: 'allow_teams',                    label: 'Tillat lag-modus',                   desc: 'Spillere kan velge å spille som lag' },
    { key: 'requires_access_code',           label: 'Krever verdikode',                   desc: 'Kun spillere med kode kan delta' },
    { key: 'is_active',                      label: 'Publisert',                          desc: 'Quizen vises på forsiden' },
  ]

  return (
    <>
      <style>{STYLES}</style>
      <div className="nq-page">

        <header className="nq-header">
          <Link href="/admin/quizzes" className="nq-back">← Tilbake</Link>
          <h1 className="nq-title">Lag ny <em>quiz</em></h1>
        </header>

        <div className="nq-rule" />

        {/* Grunninfo */}
        <div className="nq-section">
          <p className="nq-section-title">Grunnleggende info</p>
          <div className="nq-field">
            <label className="nq-label">Tittel *</label>
            <input type="text" value={form.title} onChange={e => update('title', e.target.value)}
              placeholder="F.eks. Fredagsquiz #12" className="nq-input" />
          </div>
          <div className="nq-field">
            <label className="nq-label">Beskrivelse</label>
            <textarea value={form.description} onChange={e => update('description', e.target.value)}
              placeholder="Kort beskrivelse av quizen..." rows={2} className="nq-textarea" />
          </div>
          <div className="nq-field">
            <label className="nq-label">Kategori</label>
            <select value={form.category} onChange={e => update('category', e.target.value)} className="nq-select">
              {['Allmennkunnskap', 'Sport', 'Historie', 'Geografi', 'Musikk', 'Film og TV', 'Vitenskap', 'Norsk'].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Tid */}
        <div className="nq-section">
          <p className="nq-section-title">Åpnings- og stengetid</p>
          <div className="nq-grid-2">
            <div className="nq-field">
              <label className="nq-label">Åpner *</label>
              <input type="datetime-local" value={form.opens_at}
                onChange={e => update('opens_at', e.target.value)} className="nq-input" />
            </div>
            <div className="nq-field">
              <label className="nq-label">Stenger *</label>
              <input type="datetime-local" value={form.closes_at}
                onChange={e => update('closes_at', e.target.value)} className="nq-input" />
            </div>
          </div>
          <p className="nq-hint">Standard: åpner neste fredag kl 17:00, stenger uken etter.</p>
          <div className="nq-field" style={{ marginTop: 16, marginBottom: 0 }}>
            <label className="nq-label">⏰ Auto-publiser (valgfritt)</label>
            <input
              type="datetime-local"
              value={form.scheduled_at}
              onChange={e => {
                update('scheduled_at', e.target.value)
                if (e.target.value) update('is_active', false)
              }}
              className="nq-input"
            />
            <p className="nq-hint" style={{ textAlign: 'left', marginTop: 6 }}>
              Quizen publiseres automatisk på dette tidspunktet. Sett «Publisert» til Av nedenfor.
            </p>
          </div>
        </div>

        {/* Spillinnstillinger */}
        <div className="nq-section">
          <p className="nq-section-title">Spillinnstillinger</p>
          <div className="nq-field">
            <div className="nq-slider-row">
              <label className="nq-label" style={{ margin: 0 }}>Tid per spørsmål</label>
              <span>
                <span className="nq-slider-value">{form.time_limit_seconds}</span>
                <span className="nq-slider-unit">sek</span>
              </span>
            </div>
            <input type="range" min={10} max={120} step={5} value={form.time_limit_seconds}
              onChange={e => update('time_limit_seconds', parseInt(e.target.value))} />
            <div className="nq-slider-ticks">
              <span>10s</span><span>30s</span><span>60s</span><span>120s</span>
            </div>
          </div>
          <div className="nq-field" style={{ marginBottom: 0 }}>
            <label className="nq-label">Antall svaralternativer</label>
            <div className="nq-option-btns">
              {[2, 3, 4].map(n => (
                <button key={n} onClick={() => update('num_options', n)}
                  className={`nq-opt-btn ${form.num_options === n ? 'active' : ''}`}>
                  {n} alternativer
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Funksjoner */}
        <div className="nq-section">
          <p className="nq-section-title">Funksjoner</p>
          {toggleItems.map(item => (
            <div key={item.key} className="nq-toggle-row">
              <div className="nq-toggle-info">
                <p className="nq-toggle-label">{item.label}</p>
                <p className="nq-toggle-desc">{item.desc}</p>
              </div>
              <button
                onClick={() => update(item.key, !(form as any)[item.key])}
                className={`nq-toggle ${(form as any)[item.key] ? 'on' : ''}`}
              >
                <div className="nq-toggle-knob" />
              </button>
            </div>
          ))}
        </div>

        <button onClick={handleSave} disabled={saving} className="nq-save-btn">
          {saving ? 'Lagrer...' : 'Lagre og legg til spørsmål →'}
        </button>

      </div>
    </>
  )
}