'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { isAdminLoggedIn } from '@/lib/admin-auth'
import { adminFetch } from '@/lib/admin-fetch'
import { Quiz } from '@/lib/supabase'
import Link from 'next/link'

const VALID_CATEGORIES = [
  'Sport', 'Musikk', 'Historie', 'Geografi', 'Film & TV',
  'Mat & Drikke', 'Vitenskap & Natur', 'Kunst & Kultur', 'Politikk & Samfunn', 'Diverse',
]

type ParsedQuestion = {
  question_text: string
  option_a: string
  option_b: string
  option_c: string | null
  option_d: string | null
  time_limit_seconds: number | null
  shuffle_options: boolean
  category: string | null
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
    --radius-card: 20px;
    --radius-btn:  10px;
  }

  body {
    background: var(--bg);
    font-family: 'Instrument Sans', sans-serif;
    color: var(--body);
    min-height: 100vh;
  }

  .aqz-page { max-width: 860px; margin: 0 auto; padding: 0 20px 80px; }

  .aqz-header {
    padding: 48px 0 36px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }

  .aqz-back {
    font-size: 12px;
    color: var(--body);
    text-decoration: none;
    display: block;
    margin-bottom: 8px;
    transition: color 0.15s;
  }

  .aqz-back:hover { color: var(--gold); }

  .aqz-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 26px;
    font-weight: 700;
    color: var(--white);
    letter-spacing: -0.01em;
  }

  .aqz-title em { font-style: italic; color: var(--gold); }

  .aqz-btn-primary {
    background: var(--gold);
    color: #1a1c23;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 13px;
    font-weight: 600;
    padding: 10px 18px;
    border-radius: var(--radius-btn);
    text-decoration: none;
    white-space: nowrap;
    transition: background 0.15s;
    display: inline-block;
  }

  .aqz-btn-primary:hover { background: #d9b85c; }

  .aqz-rule { width: 100%; height: 1px; background: var(--border); margin-bottom: 24px; }

  /* Feedback */
  .aqz-feedback {
    border-radius: var(--radius-btn);
    padding: 12px 16px;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 16px;
  }

  .aqz-feedback.success { background: rgba(74,222,128,0.10); color: #4ade80; border: 1px solid rgba(74,222,128,0.2); }
  .aqz-feedback.error   { background: rgba(248,113,113,0.10); color: #f87171; border: 1px solid rgba(248,113,113,0.2); }

  /* Quiz card */
  .aqz-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 20px 24px;
    margin-bottom: 10px;
  }

  .aqz-card-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;
    flex-wrap: wrap;
  }

  .aqz-card-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 4px;
  }

  .aqz-card-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 17px;
    font-weight: 700;
    color: var(--white);
  }

  .aqz-badge {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 3px 8px;
    border-radius: 20px;
  }

  .aqz-badge.open   { background: rgba(74,222,128,0.12); color: var(--green); border: 1px solid rgba(74,222,128,0.2); }
  .aqz-badge.closed { background: transparent; color: var(--muted); border: 1px solid var(--border); }
  .aqz-badge.hidden { background: transparent; color: var(--muted); border: 1px solid var(--border); }

  .aqz-card-desc { font-size: 13px; color: var(--muted); }

  .aqz-card-meta {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    margin-top: 6px;
  }

  .aqz-card-meta span { font-size: 12px; color: var(--muted); }

  /* Action buttons */
  .aqz-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }

  .aqz-action {
    font-size: 12px;
    font-weight: 500;
    padding: 6px 12px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
    transition: opacity 0.15s;
    font-family: 'Instrument Sans', sans-serif;
  }

  .aqz-action:hover { opacity: 0.8; }

  .aqz-action.blue,
  .aqz-action.gray,
  .aqz-action.orange,
  .aqz-action.green,
  .aqz-action.purple,
  .aqz-action.red    { background: transparent; color: #e8e4dd; border: 1px solid #2a2d38; }

  /* Empty */
  .aqz-empty {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 56px 32px;
    text-align: center;
  }

  .aqz-empty-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 20px;
    color: var(--white);
    margin-bottom: 8px;
  }

  .aqz-empty-sub { font-size: 13px; color: var(--muted); margin-bottom: 24px; }

  .aqz-loading {
    min-height: 100vh;
    background: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .aqz-loading p {
    font-family: 'Libre Baskerville', serif;
    font-size: 18px;
    color: var(--muted);
    font-style: italic;
  }
`

export default function AdminQuizzes() {
  const router = useRouter()
  const [quizzes, setQuizzes] = useState<Quiz[]>([])
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [mounted, setMounted] = useState(false)

  // Import modal
  const [copiedQuizId, setCopiedQuizId] = useState<string | null>(null)

  // Inline closes_at editing per quiz
  const [closesAtDate,   setClosesAtDate]   = useState<Record<string, string>>({})
  const [closesAtTime,   setClosesAtTime]   = useState<Record<string, string>>({})
  const [closesAtError,  setClosesAtError]  = useState<Record<string, string | null>>({})
  const [closesAtStatus, setClosesAtStatus] = useState<Record<string, 'ok' | 'error' | null>>({})

  // Import modal
  const [importModal, setImportModal] = useState(false)
  const [importTitle, setImportTitle] = useState('')
  const [importRows, setImportRows] = useState<ParsedQuestion[]>([])
  const [importFileName, setImportFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function shareQuizResults(quizId: string) {
    try {
      const res = await adminFetch('/api/admin/quiz-results-text', {
        method: 'POST',
        body: JSON.stringify({ quizId }),
      })
      if (!res.ok) return
      const { text } = await res.json()
      await navigator.clipboard.writeText(text)
      setCopiedQuizId(quizId)
      setTimeout(() => setCopiedQuizId(null), 3000)
    } catch {
      // silent — non-critical
    }
  }

  async function downloadTemplate() {
    const XLSX = await import('xlsx')
    const headers = [
      'Spørsmålstekst',
      'Alternativ 1 (riktig svar)',
      'Alternativ 2',
      'Alternativ 3',
      'Alternativ 4',
      'Tid i sekunder (valgfritt, default 20)',
      'Bland svaralternativer (TRUE/FALSE, valgfritt)',
      'Kategori (valgfritt, en av de 10 kategoriene)',
    ]
    const example1 = ['Hva er hovedstaden i Norge?', 'Oslo', 'Bergen', 'Stavanger', 'Trondheim', 10, 'FALSE', 'Geografi']
    const example2 = ['Hvilket år ble Norge selvstendig?', '1905', '1814', '1940', '1945', 10, 'TRUE', 'Historie']
    const ws = XLSX.utils.aoa_to_sheet([headers, example1, example2])
    ws['!cols'] = [{ wch: 40 }, { wch: 25 }, { wch: 25 }, { wch: 25 }, { wch: 25 }, { wch: 30 }, { wch: 35 }, { wch: 40 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Quizkanonen mal')
    XLSX.writeFile(wb, 'quizkanonen-mal.xlsx')
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const XLSX = await import('xlsx')
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1 })

    const parsed: ParsedQuestion[] = []
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] as unknown[]
      const questionText = String(row[0] ?? '').trim()
      const optA = String(row[1] ?? '').trim()
      const optB = String(row[2] ?? '').trim()
      if (!questionText || !optA || !optB) continue
      const optC = row[3] ? String(row[3]).trim() : null
      const optD = row[4] ? String(row[4]).trim() : null
      const rawTime = row[5]
      const parsedTime = rawTime !== undefined && rawTime !== '' && rawTime !== null
        ? parseInt(String(rawTime), 10) : null
      const timeSec = parsedTime !== null && !isNaN(parsedTime)
        ? Math.min(60, Math.max(5, parsedTime)) : null
      const rawShuffle = String(row[6] ?? '').trim().toUpperCase()
      const shuffle = rawShuffle === 'TRUE' || rawShuffle === '1'
      const rawCategory = String(row[7] ?? '').trim()
      const category = VALID_CATEGORIES.includes(rawCategory) ? rawCategory : null
      parsed.push({ question_text: questionText, option_a: optA, option_b: optB, option_c: optC, option_d: optD, time_limit_seconds: timeSec, shuffle_options: shuffle, category })
    }

    setImportRows(parsed)
    setImportFileName(file.name)
    setImportTitle(file.name.replace(/\.[^.]+$/, ''))
    setImportModal(true)
    e.target.value = ''
  }

  async function runImport() {
    if (!importTitle.trim() || importRows.length === 0) return
    setImporting(true)
    try {
      const res = await adminFetch('/api/admin/quizzes/import', {
        method: 'POST',
        body: JSON.stringify({ title: importTitle.trim(), questions: importRows }),
      })
      const data = await res.json()
      if (!res.ok) { showFeedback('error', 'Import feilet: ' + (data.error ?? 'ukjent feil')); return }
      setImportModal(false)
      router.push(`/admin/quizzes/new?id=${data.quizId}`)
    } catch {
      showFeedback('error', 'Uventet feil under import.')
    } finally {
      setImporting(false)
    }
  }

  useEffect(() => {
    setMounted(true)
    if (!isAdminLoggedIn()) { router.push('/admin/login'); setLoading(false); return }
    fetchQuizzes()
  }, [])

  function showFeedback(type: 'success' | 'error', msg: string) {
    setFeedback({ type, msg })
    setTimeout(() => setFeedback(null), 3500)
  }

  async function fetchQuizzes() {
    try {
      const res = await adminFetch('/api/admin/quizzes')
      if (!res.ok) throw new Error(`API svarte ${res.status}`)
      const data: Quiz[] = await res.json()
      setQuizzes(data)
    } catch (e) {
      console.error('fetchQuizzes feilet:', e)
    } finally {
      setLoading(false)
    }
  }

  async function toggleActive(quiz: Quiz) {
    try {
      const res = await adminFetch(`/api/admin/quizzes/${quiz.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !quiz.is_active }),
      })
      if (!res.ok) showFeedback('error', 'Kunne ikke oppdatere quiz.')
      else fetchQuizzes()
    } catch {
      showFeedback('error', 'Kunne ikke oppdatere quiz.')
    }
  }

  async function deleteQuiz(id: string) {
    if (!confirm('Er du sikker på at du vil slette denne quizen? Dette kan ikke angres.')) return
    try {
      const res = await adminFetch(`/api/admin/quizzes/${id}`, { method: 'DELETE' })
      if (!res.ok) showFeedback('error', 'Kunne ikke slette quiz.')
      else fetchQuizzes()
    } catch {
      showFeedback('error', 'Kunne ikke slette quiz.')
    }
  }

  async function resetQuiz(id: string, title: string) {
    if (!confirm(`Nullstill "${title}"? Dette sletter alle resultater og lar alle spille på nytt.`)) return
    try {
      const res = await adminFetch(`/api/admin/quizzes/${id}/reset`, { method: 'POST' })
      if (!res.ok) showFeedback('error', `Kunne ikke nullstille "${title}".`)
      else { showFeedback('success', `"${title}" er nullstilt — alle kan spille igjen.`); fetchQuizzes() }
    } catch {
      showFeedback('error', `Kunne ikke nullstille "${title}".`)
    }
  }

  const isOpen = (quiz: Quiz) => {
    if (!mounted) return false
    const now = new Date()
    return new Date(quiz.opens_at) <= now && new Date(quiz.closes_at) >= now
  }

  const formatDate = (d: string) => new Date(d).toLocaleString('nb-NO', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })

  function toDatetimeParts(iso: string): [string, string] {
    if (!iso) return ['', '']
    const d = new Date(iso)
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    const pad = (n: number) => String(n).padStart(2, '0')
    const dateStr = `${pad(local.getUTCDate())}.${pad(local.getUTCMonth() + 1)}.${local.getUTCFullYear()}`
    const timeStr = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`
    return [dateStr, timeStr]
  }

  function parseNorwegianDateTime(dateStr: string, timeStr: string): Date | null {
    const dateParts = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
    const timeParts = timeStr.match(/^(\d{1,2}):(\d{2})$/)
    if (!dateParts || !timeParts) return null
    const d = parseInt(dateParts[1], 10)
    const m = parseInt(dateParts[2], 10)
    const y = parseInt(dateParts[3], 10)
    const h = parseInt(timeParts[1], 10)
    const min = parseInt(timeParts[2], 10)
    if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || min > 59) return null
    return new Date(y, m - 1, d, h, min)
  }

  async function updateClosesAt(quizId: string) {
    const quiz = quizzes.find(q => q.id === quizId)
    const [defaultDate, defaultTime] = toDatetimeParts(quiz?.closes_at ?? '')
    const dateStr = closesAtDate[quizId] ?? defaultDate
    const timeStr = closesAtTime[quizId] ?? defaultTime
    const parsed = parseNorwegianDateTime(dateStr, timeStr)
    if (!parsed) {
      setClosesAtError(prev => ({ ...prev, [quizId]: 'Ugyldig format — bruk DD.MM.ÅÅÅÅ og TT:MM' }))
      return
    }
    setClosesAtError(prev => ({ ...prev, [quizId]: null }))
    try {
      const isoValue = parsed.toISOString()
      const res = await adminFetch(`/api/admin/quizzes/${quizId}`, {
        method: 'PATCH',
        body: JSON.stringify({ closes_at: isoValue }),
      })
      if (!res.ok) {
        setClosesAtStatus(prev => ({ ...prev, [quizId]: 'error' }))
      } else {
        setClosesAtStatus(prev => ({ ...prev, [quizId]: 'ok' }))
        setQuizzes(prev => prev.map(q => q.id === quizId ? { ...q, closes_at: isoValue } : q))
      }
    } catch {
      setClosesAtStatus(prev => ({ ...prev, [quizId]: 'error' }))
    }
    setTimeout(() => setClosesAtStatus(prev => ({ ...prev, [quizId]: null })), 3000)
  }

  const statusBadge = (quiz: Quiz) => {
    if (!quiz.is_active) return <span className="aqz-badge hidden">Skjult</span>
    if (isOpen(quiz)) return <span className="aqz-badge open">● Åpen</span>
    return <span className="aqz-badge closed">Stengt</span>
  }

  if (loading) return (
    <>
      <style>{STYLES}</style>
      <div className="aqz-loading"><p>Laster quizer...</p></div>
    </>
  )

  return (
    <>
      <style>{STYLES}</style>
      <div className="aqz-page">

        <header className="aqz-header">
          <div>
            <Link href="/admin" className="aqz-back">← Admin</Link>
            <h1 className="aqz-title">Alle <em>quizer</em></h1>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              onClick={downloadTemplate}
              style={{
                background: 'transparent', border: '1px solid #2a2d38', borderRadius: 10,
                padding: '10px 16px', fontSize: 13, fontWeight: 500, color: '#e8e4dd',
                cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
              }}
            >
              Last ned Excel-mal
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                background: 'transparent', border: '1px solid #2a2d38', borderRadius: 10,
                padding: '10px 16px', fontSize: 13, fontWeight: 500, color: '#e8e4dd',
                cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
              }}
            >
              Importer fra Excel
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            <Link href="/admin/quizzes/new" className="aqz-btn-primary">+ Ny quiz</Link>
          </div>
        </header>

        <div className="aqz-rule" />

        {feedback && (
          <div className={`aqz-feedback ${feedback.type}`}>
            {feedback.type === 'success' ? '✓ ' : '✕ '}{feedback.msg}
          </div>
        )}

        {quizzes.length === 0 ? (
          <div className="aqz-empty">
            <p className="aqz-empty-title">Ingen quizer ennå</p>
            <p className="aqz-empty-sub">Lag din første quiz for å komme i gang.</p>
            <Link href="/admin/quizzes/new" className="aqz-btn-primary">Lag din første quiz</Link>
          </div>
        ) : (
          <div>
            {quizzes.map(quiz => (
              <div key={quiz.id} className="aqz-card">
                <div className="aqz-card-top">
                  <div className="flex-1 min-w-0">
                    <div className="aqz-card-title-row">
                      <h2 className="aqz-card-title">{quiz.title}</h2>
                      {statusBadge(quiz)}
                    </div>
                    {quiz.description && (
                      <p className="aqz-card-desc">{quiz.description}</p>
                    )}
                    <div className="aqz-card-meta">
                      <span>{formatDate(quiz.opens_at)}</span>
                      <span>{formatDate(quiz.closes_at)}</span>
                      <span>{quiz.time_limit_seconds}s</span>
                    </div>
                  </div>
                </div>

                {/* ── Inline closes_at editor — kun for åpne quizer ── */}
                {mounted && isOpen(quiz) && (
                  <div style={{ padding: '12px 0 4px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#7a7873', flexShrink: 0 }}>
                      Stenger
                    </span>
                    <input
                      type="text"
                      value={closesAtDate[quiz.id] ?? toDatetimeParts(quiz.closes_at)[0]}
                      onChange={e => setClosesAtDate(prev => ({ ...prev, [quiz.id]: e.target.value }))}
                      placeholder="DD.MM.ÅÅÅÅ"
                      style={{
                        background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 8,
                        padding: '6px 10px', fontSize: 13, color: '#e8e4dd',
                        fontFamily: "'Instrument Sans', sans-serif", outline: 'none', width: 110,
                      }}
                    />
                    <input
                      type="text"
                      value={closesAtTime[quiz.id] ?? toDatetimeParts(quiz.closes_at)[1]}
                      onChange={e => setClosesAtTime(prev => ({ ...prev, [quiz.id]: e.target.value }))}
                      placeholder="TT:MM"
                      style={{
                        background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 8,
                        padding: '6px 10px', fontSize: 13, color: '#e8e4dd',
                        fontFamily: "'Instrument Sans', sans-serif", outline: 'none', width: 72,
                      }}
                    />
                    <button
                      onClick={() => updateClosesAt(quiz.id)}
                      style={{
                        background: 'transparent', border: '1px solid #2a2d38', borderRadius: 10,
                        padding: '6px 16px', fontSize: 13, fontWeight: 500, color: '#e8e4dd',
                        cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif", whiteSpace: 'nowrap',
                      }}
                    >
                      Oppdater
                    </button>
                    {closesAtError[quiz.id] && (
                      <span style={{ fontSize: 12, color: '#f87171' }}>{closesAtError[quiz.id]}</span>
                    )}
                    {closesAtStatus[quiz.id] === 'ok' && (
                      <span style={{ fontSize: 12, color: '#c9a84c' }}>Oppdatert ✓</span>
                    )}
                    {closesAtStatus[quiz.id] === 'error' && (
                      <span style={{ fontSize: 12, color: '#e8e4dd' }}>Feil — prøv igjen</span>
                    )}
                  </div>
                )}

                <div className="aqz-actions">
                  <Link href={`/admin/quizzes/${quiz.id}/questions`} className="aqz-action blue">
                    Spørsmål
                  </Link>
                  <Link href={`/admin/quizzes/new?id=${quiz.id}`} className="aqz-action gray">
                    Rediger
                  </Link>
                  <Link href={`/admin/quizzes/${quiz.id}/analytics`} className="aqz-action gray">
                    Analytics
                  </Link>
                  <button onClick={() => toggleActive(quiz)}
                    className={`aqz-action ${quiz.is_active ? 'orange' : 'green'}`}>
                    {quiz.is_active ? 'Skjul' : 'Publiser'}
                  </button>
                  <button onClick={() => resetQuiz(quiz.id, quiz.title)} className="aqz-action purple">
                    Reset
                  </button>
                  <button onClick={() => deleteQuiz(quiz.id)} className="aqz-action red">
                    Slett
                  </button>
                  {mounted && quiz.closes_at && new Date(quiz.closes_at) < new Date() && (
                    <button
                      onClick={() => shareQuizResults(quiz.id)}
                      className="aqz-action"
                      style={{
                        color: copiedQuizId === quiz.id ? '#4ade80' : '#e8e4dd',
                        border: `1px solid ${copiedQuizId === quiz.id ? '#e8e4dd' : '#2a2d38'}`,
                        background: 'transparent',
                        transition: 'color 0.15s, border-color 0.15s',
                      }}
                    >
                      {copiedQuizId === quiz.id ? 'Kopiert! ✓' : 'Del resultater'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Import modal */}
      {importModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px',
        }}>
          <div style={{
            background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20,
            padding: '28px', width: '100%', maxWidth: 520, fontFamily: "'Instrument Sans', sans-serif",
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#ffffff', marginBottom: 4 }}>
              Importer quiz fra Excel
            </h2>
            <p style={{ fontSize: 12, color: '#7a7873', marginBottom: 20 }}>
              {importFileName} · {importRows.length} spørsmål funnet
            </p>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7a7873', display: 'block', marginBottom: 6 }}>
                Quiz-navn *
              </label>
              <input
                type="text"
                value={importTitle}
                onChange={e => setImportTitle(e.target.value)}
                style={{ width: '100%', background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 10, padding: '10px 14px', color: '#ffffff', fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            <p style={{ fontSize: 12, color: '#7a7873', marginBottom: 20, lineHeight: 1.5 }}>
              Quizen opprettes som skjult. Åpne quiz-cockpiten etter import for å justere datoer og publisere.
            </p>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={runImport}
                disabled={importing || !importTitle.trim() || importRows.length === 0}
                style={{
                  flex: 1, background: '#c9a84c', color: '#1a1c23', border: 'none', borderRadius: 10,
                  padding: '12px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                  opacity: importing || !importTitle.trim() ? 0.5 : 1,
                }}
              >
                {importing ? 'Importerer...' : `Importer ${importRows.length} spørsmål`}
              </button>
              <button
                onClick={() => { setImportModal(false); setImportRows([]); setImportTitle('') }}
                style={{
                  background: 'transparent', border: '1px solid #2a2d38', borderRadius: 10,
                  padding: '12px 20px', fontSize: 14, fontWeight: 500, color: '#e8e4dd',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
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