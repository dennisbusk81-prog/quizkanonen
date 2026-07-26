'use client'

/**
 * Delt resultattabell — «Sluttresultat · N deltakere».
 *
 * Trukket ut fra app/admin/quizzes/[id]/results/page.tsx (4. juli) da
 * org/[slug]/admin skulle ha nøyaktig samme visning for bedriftens egne
 * deltakere. Kartleggingen 26. juli viste at appen allerede har to nesten
 * identiske leaderboard-implementasjoner som har drevet fra hverandre
 * (leaderboard/[id] og SeasonLeaderboard) — en tredje kopi av samme tabell
 * ville blitt den neste. Derfor én komponent begge sidene renderer.
 *
 * Stilen er bevisst SELVSTENDIG (egne qkrt-klasser, fargene skrevet ut i
 * stedet for CSS-variabler): admin-siden definerer --card/--gold/… i sin egen
 * STYLES-blokk, mens org-admin ikke har de variablene i det hele tatt.
 * Hardkodede verdier her er hentet direkte fra designsystemet og gjør at
 * komponenten ser lik ut uansett hvilken side den plasseres i.
 */

export type ResultsTableRow = {
  /** Stabil nøkkel — attemptId i admin, userId i org-admin. */
  key: string
  rank: number
  name: string
  /** Andrelinje under navnet: det ekte navnet når `name` er et kallenavn. */
  secondary?: string | null
  correctAnswers: number
  totalTimeMs: number
  /** Uthevet rad (median hos admin, «meg» hos org-admin). */
  highlight?: boolean
}

type Props = {
  rows: ResultsTableRow[]
  /**
   * Vises som «13 / 15». Utelates (eller 0) når totalen ikke er kjent — da
   * står det bare «13». Samme oppførsel som admin-siden hadde fra før.
   */
  totalQuestions?: number
  /** Seksjonsoverskrift over tabellen. Utelates for tabell uten overskrift. */
  title?: string
  formatTime?: (ms: number) => string
  /**
   * Dropper kort-rammen rundt tabellen. Brukes når komponenten plasseres inne
   * i et kort som allerede har bakgrunn, ramme og avrunding (org-admin sin
   * fane-boks) — ellers ville man fått to rammer og to avrundinger utenpå
   * hverandre.
   */
  embedded?: boolean
}

const defaultFormatTime = (ms: number) => `${(ms / 1000).toFixed(1)}s`

const STYLES = `
  .qkrt-section {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 32px 0 14px;
  }
  .qkrt-section-text {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #7a7873;
    white-space: nowrap;
  }
  .qkrt-section-line { flex: 1; height: 1px; background: #2a2d38; }

  .qkrt-wrap {
    background: #21242e;
    border: 1px solid #2a2d38;
    border-radius: 20px;
    overflow: hidden;
  }
  /* Vannrett scroll KUN for tabellen, aldri for siden: på smal skjerm skal
     ikke navn/tid presses sammen til uleselighet. */
  .qkrt-scroll { overflow-x: auto; }
  .qkrt-table { width: 100%; border-collapse: collapse; }
  .qkrt-table th {
    text-align: left;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    color: #7a7873;
    padding: 14px 16px 12px;
    border-bottom: 1px solid #2a2d38;
  }
  .qkrt-table td {
    padding: 11px 16px;
    font-size: 13px;
    color: #e8e4dd;
    border-bottom: 1px solid #2a2d38;
    vertical-align: middle;
  }
  .qkrt-table tr:last-child td { border-bottom: none; }
  .qkrt-table tr.is-highlight td { background: rgba(201,168,76,0.10); }
  .qkrt-rank { color: #7a7873; font-size: 12px; width: 34px; }
  .qkrt-rank.medal { color: #c9a84c; font-weight: 700; }
  .qkrt-name { font-weight: 500; color: #ffffff; }
  .qkrt-nick { font-size: 11px; color: #7a7873; display: block; margin-top: 1px; }
  .qkrt-num { text-align: right; white-space: nowrap; }
`

export default function ResultsTable({ rows, totalQuestions, title, formatTime, embedded }: Props) {
  const fmt = formatTime ?? defaultFormatTime
  const showTotal = typeof totalQuestions === 'number' && totalQuestions > 0

  return (
    <>
      <style>{STYLES}</style>

      {title && (
        <div className="qkrt-section">
          <span className="qkrt-section-text">{title}</span>
          <div className="qkrt-section-line" />
        </div>
      )}

      <div className={embedded ? '' : 'qkrt-wrap'}>
        <div className="qkrt-scroll">
          <table className="qkrt-table">
            <thead>
              <tr>
                <th className="qkrt-rank">#</th>
                <th>Navn</th>
                <th className="qkrt-num">Riktige</th>
                <th className="qkrt-num">Tid</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key} className={r.highlight ? 'is-highlight' : ''}>
                  <td className={`qkrt-rank ${r.rank <= 3 ? 'medal' : ''}`}>{r.rank}</td>
                  <td>
                    <span className="qkrt-name">{r.name}</span>
                    {r.secondary ? <span className="qkrt-nick">{r.secondary}</span> : null}
                  </td>
                  <td className="qkrt-num">
                    {r.correctAnswers}{showTotal ? ` / ${totalQuestions}` : ''}
                  </td>
                  <td className="qkrt-num">{fmt(r.totalTimeMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
