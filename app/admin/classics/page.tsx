'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { isAdminLoggedIn, adminLoginPath } from '@/lib/admin-session'
import { adminFetch } from '@/lib/admin-fetch'
import { readAdminList } from '@/lib/admin-load'

type ClassicQuestion = {
  id: string
  question_text: string
  option_a: string
  option_b: string
  option_c: string | null
  option_d: string | null
  correct_answer: string
  correct_answers: string[] | null
  explanation: string | null
  category: string | null
  quiz_id: string
  quiz_title: string | null
}

type QuizOption = { id: string; title: string }

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
    --muted:  #918f8a;
    --green:  #4ade80;
    --rcard:  16px;
    --rbtn:   10px;
  }

  body { background: var(--bg); font-family: 'Instrument Sans', sans-serif; color: var(--body); }

  .cl-page { flex: 1; max-width: 800px; margin: 0 auto; padding: 0 20px 80px; }
  .cl-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 32px 0 20px; flex-wrap: wrap; }
  .cl-back { font-size: 12px; color: var(--body); text-decoration: none; display: inline-block; margin-bottom: 6px; }
  .cl-back:hover { color: var(--white); }
  .cl-title { font-family: 'Libre Baskerville', serif; font-size: 26px; font-weight: 700; color: var(--white); }
  .cl-rule { height: 1px; background: var(--border); margin-bottom: 24px; }

  .cl-search {
    width: 100%; background: var(--card); border: 1px solid var(--border); border-radius: var(--rbtn);
    padding: 12px 16px; font-family: 'Instrument Sans', sans-serif; font-size: 14px; color: var(--white);
    outline: none; margin-bottom: 20px; transition: border-color 0.15s;
  }
  .cl-search::placeholder { color: var(--muted); }
  .cl-search:focus { border-color: rgba(201,168,76,0.4); }

  .cl-card {
    background: var(--card); border: 1px solid var(--border); border-radius: var(--rcard);
    padding: 20px; margin-bottom: 12px;
  }
  .cl-q-text { font-size: 15px; color: var(--white); font-weight: 600; margin-bottom: 12px; line-height: 1.4; }
  .cl-opts { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
  .cl-opt { font-size: 13px; color: var(--body); }
  .cl-opt.correct { color: var(--green); font-weight: 600; }
  .cl-meta { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
  .cl-tag {
    font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
    border-radius: 20px; padding: 2px 8px;
  }
  .cl-tag-gold { color: var(--gold); background: rgba(201,168,76,0.08); border: 1px solid rgba(201,168,76,0.18); }
  .cl-tag-muted { color: var(--muted); background: var(--bg); border: 1px solid var(--border); }
  .cl-explanation { font-size: 12px; color: var(--muted); font-style: italic; margin-bottom: 12px; }
  .cl-footer { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .cl-quiz-name { font-size: 12px; color: var(--muted); }

  .cl-copy-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .cl-select {
    background: var(--bg); border: 1px solid var(--border); border-radius: var(--rbtn);
    padding: 7px 12px; font-family: 'Instrument Sans', sans-serif; font-size: 13px; color: var(--body);
    cursor: pointer; outline: none; min-width: 160px; flex: 1;
  }
  .cl-btn-copy {
    background: transparent; border: 1px solid var(--border); border-radius: var(--rbtn);
    padding: 7px 16px; font-family: 'Instrument Sans', sans-serif; font-size: 13px; font-weight: 600;
    color: var(--body); cursor: pointer; transition: border-color 0.15s, color 0.15s; white-space: nowrap;
  }
  .cl-btn-copy:hover { border-color: rgba(201,168,76,0.4); color: var(--white); }
  .cl-btn-copy.done { color: var(--green); border-color: rgba(74,222,128,0.3); }
  .cl-btn-copy:disabled { opacity: 0.5; cursor: not-allowed; }

  .cl-empty { text-align: center; padding: 60px 20px; color: var(--muted); font-size: 15px; }
  .cl-error { text-align: center; padding: 60px 20px; }
  .cl-error-title { font-family: 'Libre Baskerville', serif; font-size: 16px; color: var(--white); margin: 0 0 8px; }
  .cl-error-sub { font-size: 13px; color: var(--muted); margin: 0 0 20px; line-height: 1.6; }
  .cl-retry {
    background: transparent; border: 1px solid var(--border); border-radius: var(--rbtn);
    padding: 10px 20px; font-family: 'Instrument Sans', sans-serif; font-size: 13px; font-weight: 500;
    color: var(--body); cursor: pointer;
  }
  .cl-retry:disabled { opacity: 0.6; cursor: not-allowed; }
  .cl-count { font-size: 13px; color: var(--muted); margin-bottom: 16px; }
`

export default function ClassicsPage() {
  const router = useRouter()
  const [questions, setQuestions] = useState<ClassicQuestion[]>([])
  const [quizzes,   setQuizzes]   = useState<QuizOption[]>([])
  const [loading,   setLoading]   = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [retrying,  setRetrying]  = useState(false)
  const [search,    setSearch]    = useState('')
  const [copying,   setCopying]   = useState<string | null>(null)
  const [copyDone,  setCopyDone]  = useState<string | null>(null)
  const [targetMap, setTargetMap] = useState<Record<string, string>>({})
  // Synkron sperre PER MÅLQUIZ, ikke per spørsmål (copying-state over er scopet
  // per spørsmål og hindret derfor ikke to raske klikk på ULIKE spørsmål begge
  // rettet mot SAMME quiz). To slike samtidige POST-kall til
  // /api/admin/classics/copy kunne begge lese samme fersk COUNT og beregne
  // identisk order_index — rotårsaken bak kolliderende spørsmålsrekkefølger på
  // Fredagsquiz 26.06.2026 og 07.08.2026.
  const copyInFlightRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!isAdminLoggedIn()) { router.replace(adminLoginPath()); return }
    loadAll()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  // loadError skiller en MISLYKKET henting fra en bekreftet tom bank — samme
  // mønster som app/admin/quizzes/page.tsx.
  //
  // Fram til 19. august hadde Promise.all-en INGEN .catch, mens .finally slo av
  // loading uansett. To utfall gikk derfor samme vei til «Ingen klassikere
  // ennå»: en kastet fetch (offline, DNS, avbrutt), og et feilsvar der
  // `r.json()` ga `{ error: … }` og `cData.questions ?? []` gjorde det om til
  // en tom liste. Kun quiz-lista tåler å være tom ved feil — den fyller en
  // nedtrekksmeny, ikke en påstand om innhold.
  async function fetchClassicsOnce(): Promise<ClassicQuestion[]> {
    return readAdminList<ClassicQuestion>(await adminFetch('/api/admin/classics'), 'questions')
  }

  async function loadAll() {
    try {
      const [cRows, qRes] = await Promise.all([
        fetchClassicsOnce(),
        adminFetch('/api/admin/quizzes').then(r => r.ok ? r.json() : []).catch(() => []),
      ])
      setQuestions(cRows)
      setQuizzes((Array.isArray(qRes) ? qRes : []).map((q: { id: string; title: string }) => ({ id: q.id, title: q.title })))
      setLoadError(false)
    } catch (e) {
      console.error('loadAll feilet:', e)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  async function retryLoad() {
    setRetrying(true)
    try {
      setQuestions(await fetchClassicsOnce())
      setLoadError(false)
    } catch (e) {
      console.error('retryLoad feilet:', e)
      setLoadError(true)
    } finally {
      setRetrying(false)
    }
  }

  const filtered = questions.filter(q => {
    if (!search) return true
    const s = search.toLowerCase()
    return q.question_text.toLowerCase().includes(s) || (q.category ?? '').toLowerCase().includes(s)
  })

  async function copyToQuiz(questionId: string) {
    const targetQuizId = targetMap[questionId]
    if (!targetQuizId) return
    // Synkron sperre og claim FØR alt annet — se copyInFlightRef sin begrunnelse
    // over. Et andre klikk på et ANNET spørsmål mot SAMME quiz avbrytes her.
    if (copyInFlightRef.current.has(targetQuizId)) return
    copyInFlightRef.current.add(targetQuizId)
    setCopying(questionId)
    try {
      const res = await adminFetch('/api/admin/classics/copy', {
        method: 'POST',
        body: JSON.stringify({ question_id: questionId, target_quiz_id: targetQuizId }),
      })
      if (res.ok) {
        setCopyDone(questionId)
        setTimeout(() => setCopyDone(null), 2500)
      }
    } finally {
      copyInFlightRef.current.delete(targetQuizId)
      setCopying(null)
    }
  }

  const optMap: Record<string, 'option_a' | 'option_b' | 'option_c' | 'option_d'> =
    { A: 'option_a', B: 'option_b', C: 'option_c', D: 'option_d' }

  if (loading) return (
    <>
      <style>{STYLES}</style>
      <div className="cl-page">
        <div className="cl-header"><p style={{ color: '#918f8a', fontSize: 14, paddingTop: 40 }}>Laster klassikere…</p></div>
      </div>
    </>
  )

  return (
    <>
      <style>{STYLES}</style>
      <div className="cl-page">

        <header className="cl-header">
          <div>
            <Link href="/admin/quizzes" className="cl-back">← Tilbake til quizer</Link>
            <h1 className="cl-title">Klassiker<em style={{ fontStyle: 'italic', color: '#c9a84c' }}>banken</em></h1>
          </div>
        </header>

        <div className="cl-rule" />

        <input
          className="cl-search"
          type="text"
          placeholder="Søk på spørsmål eller kategori…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {filtered.length > 0 && (
          <p className="cl-count">{filtered.length} spørsmål{search ? ' funnet' : ''}</p>
        )}

        {loadError ? (
          <div className="cl-error">
            <p className="cl-error-title">Kunne ikke laste klassikerne</p>
            <p className="cl-error-sub">
              Noe gikk galt under henting. Spørsmålene ligger trygt i databasen —
              dette er kun et lasteproblem. Prøv igjen.
            </p>
            <button className="cl-retry" onClick={retryLoad} disabled={retrying}>
              {retrying ? 'Prøver igjen…' : 'Prøv igjen'}
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="cl-empty">
            {search ? 'Ingen spørsmål matcher søket.' : 'Ingen klassikere ennå. Merk spørsmål som klassikere i quiz-editoren.'}
          </div>
        ) : (
          filtered.map(q => {
            const correctKeys = q.correct_answers && q.correct_answers.length > 0 ? q.correct_answers : [q.correct_answer]
            const opts = ['A', 'B', 'C', 'D'].filter(o => q[optMap[o]])
            return (
              <div key={q.id} className="cl-card">
                <p className="cl-q-text">{q.question_text}</p>

                <div className="cl-opts">
                  {opts.map(o => (
                    <p key={o} className={`cl-opt ${correctKeys.includes(o) ? 'correct' : ''}`}>
                      <strong>{o}: </strong>{q[optMap[o]]}{correctKeys.includes(o) ? ' ✓' : ''}
                    </p>
                  ))}
                </div>

                <div className="cl-meta">
                  {q.category && <span className="cl-tag cl-tag-gold">{q.category}</span>}
                  {correctKeys.length > 1 && (
                    <span className="cl-tag cl-tag-muted">{correctKeys.length} riktige svar</span>
                  )}
                </div>

                {q.explanation && <p className="cl-explanation">{q.explanation}</p>}

                <div className="cl-footer">
                  <p className="cl-quiz-name">Fra: {q.quiz_title ?? q.quiz_id}</p>
                  <div className="cl-copy-row" style={{ marginLeft: 'auto' }}>
                    <select
                      className="cl-select"
                      value={targetMap[q.id] ?? ''}
                      onChange={e => setTargetMap(prev => ({ ...prev, [q.id]: e.target.value }))}
                    >
                      <option value="">Velg quiz…</option>
                      {quizzes.map(qz => (
                        <option key={qz.id} value={qz.id}>{qz.title}</option>
                      ))}
                    </select>
                    <button
                      className={`cl-btn-copy ${copyDone === q.id ? 'done' : ''}`}
                      disabled={!targetMap[q.id] || copying === q.id}
                      onClick={() => copyToQuiz(q.id)}
                    >
                      {copyDone === q.id ? 'Lagt til!' : copying === q.id ? 'Kopierer…' : 'Legg til i quiz'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })
        )}

      </div>
    </>
  )
}
