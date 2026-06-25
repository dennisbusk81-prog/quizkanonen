'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { isAdminLoggedIn } from '@/lib/admin-auth'
import { adminFetch } from '@/lib/admin-fetch'
import Link from 'next/link'

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

  .ret-shell { min-height: 100vh; display: flex; flex-direction: column; }
  .ret-page { flex: 1; max-width: 800px; margin: 0 auto; padding: 0 20px 80px; }

  .ret-header {
    padding: 24px 0 28px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .ret-eyebrow {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--gold);
    margin-bottom: 6px;
  }
  .ret-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 28px;
    font-weight: 700;
    color: var(--white);
    letter-spacing: -0.01em;
  }
  .ret-title em { font-style: italic; color: var(--gold); }

  .ret-back {
    font-size: 12px;
    font-weight: 500;
    color: var(--body);
    background: var(--card);
    border: 0.5px solid var(--border);
    border-radius: 8px;
    padding: 6px 14px;
    text-decoration: none;
    display: inline-block;
    transition: color 0.15s, border-color 0.15s;
    margin-top: 6px;
  }
  .ret-back:hover { color: var(--white); border-color: rgba(255,255,255,0.15); }

  .ret-rule { width: 100%; height: 1px; background: var(--border); margin-bottom: 24px; }

  .ret-intro {
    font-size: 13px;
    color: var(--hint);
    line-height: 1.6;
    margin-bottom: 20px;
  }

  .ret-card {
    background: var(--card);
    border: 0.5px solid var(--border);
    border-radius: 12px;
    padding: 8px 16px 12px;
    overflow-x: auto;
  }

  .ret-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .ret-table thead th {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--hint);
    text-align: left;
    padding: 12px 10px;
    border-bottom: 0.5px solid var(--border);
    white-space: nowrap;
  }
  .ret-table thead th.num, .ret-table tbody td.num { text-align: right; }
  .ret-table tbody td {
    padding: 12px 10px;
    border-bottom: 0.5px solid var(--border);
    color: var(--body);
    vertical-align: middle;
  }
  .ret-table tbody tr:last-child td { border-bottom: none; }

  .ret-quiz { color: var(--body); font-weight: 500; }
  .ret-date { font-size: 11px; color: var(--hint); white-space: nowrap; }
  .ret-num { font-variant-numeric: tabular-nums; }
  .ret-dash { color: var(--hint); }

  .ret-pct {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--gold);
  }

  .ret-empty {
    font-family: 'Libre Baskerville', serif;
    font-style: italic;
    font-size: 15px;
    color: var(--hint);
    padding: 28px 10px;
    text-align: center;
  }

  .ret-loading {
    min-height: 100vh;
    background: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .ret-loading p {
    font-family: 'Libre Baskerville', serif;
    font-size: 18px;
    color: var(--hint);
    font-style: italic;
  }
`

type RetentionRow = {
  quizId: string
  title: string
  opensAt: string | null
  players: number
  returned: number | null
  retentionPct: number | null
}

export default function AdminRetention() {
  const router = useRouter()
  const [rows, setRows] = useState<RetentionRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isAdminLoggedIn()) { router.push('/admin/login'); setLoading(false); return }
    fetchRetention()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchRetention() {
    try {
      const res = await adminFetch('/api/admin/retention')
      if (res.ok) {
        const data = await res.json()
        setRows(data.rows ?? [])
      }
    } catch (e) {
      console.error('fetchRetention feilet:', e)
    } finally {
      setLoading(false)
    }
  }

  function formatDate(iso: string | null): string {
    if (!iso) return '–'
    return new Date(iso).toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  if (loading) return (
    <>
      <style>{STYLES}</style>
      <div className="ret-loading"><p>Laster...</p></div>
    </>
  )

  return (
    <>
      <style>{STYLES}</style>
      <div className="ret-shell">
      <div className="ret-page">

        <header className="ret-header">
          <div>
            <p className="ret-eyebrow">Quizkanonen</p>
            <h1 className="ret-title">Retention<em>kohort</em></h1>
          </div>
          <Link href="/admin" className="ret-back">← Tilbake</Link>
        </header>

        <div className="ret-rule" />

        <p className="ret-intro">
          Unike innloggede spillere som fullførte hver quiz, og hvor mange av dem som
          kom tilbake og fullførte neste quiz. Retention-raten viser andelen som ble værende
          fra én uke til den neste.
        </p>

        <div className="ret-card">
          {rows.length === 0 ? (
            <p className="ret-empty">Ingen fullførte attempts å vise ennå.</p>
          ) : (
            <table className="ret-table">
              <thead>
                <tr>
                  <th>Quiz</th>
                  <th>Dato</th>
                  <th className="num">Spillere</th>
                  <th className="num">Kom tilbake</th>
                  <th className="num">Retention</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.quizId}>
                    <td className="ret-quiz">{row.title}</td>
                    <td className="ret-date">{formatDate(row.opensAt)}</td>
                    <td className="num ret-num">{row.players}</td>
                    <td className="num ret-num">
                      {row.returned === null ? <span className="ret-dash">–</span> : row.returned}
                    </td>
                    <td className="num">
                      {row.retentionPct === null
                        ? <span className="ret-dash">–</span>
                        : <span className="ret-pct">{row.retentionPct}%</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
      </div>
    </>
  )
}
