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
 * Utvidet 26. juli med merke-/klikk-/note-/separator-støtte da det offentlige
 * quiz-leaderboardet (app/leaderboard/[id]/page.tsx) også skulle konverteres
 * til samme format. Alle nye felt er valgfrie og additive — admin/results og
 * org-admin, som ikke bruker dem, får ingen visuell endring (bortsett fra to
 * strengt ikke-regressive mobiltilpasninger, se STYLES under).
 *
 * Stilen er bevisst SELVSTENDIG (egne qkrt-klasser, fargene skrevet ut i
 * stedet for CSS-variabler): admin-siden definerer --card/--gold/… i sin egen
 * STYLES-blokk, mens org-admin ikke har de variablene i det hele tatt.
 * Hardkodede verdier her er hentet direkte fra designsystemet og gjør at
 * komponenten ser lik ut uansett hvilken side den plasseres i.
 */
import BadgeCircle, { type BadgeKind } from '@/components/BadgeCircle'

export type ResultsTableRow = {
  /** Stabil nøkkel — attemptId i admin, userId i org-admin/leaderboard. */
  key: string
  rank: number
  name: string
  /** Andrelinje under navnet: det ekte navnet når `name` er et kallenavn. */
  secondary?: string | null
  correctAnswers: number
  totalTimeMs: number
  /**
   * Liten grå undertekst UNDER tallet i tredje kolonne (f.eks. «4 quizer»
   * på periode-topplistene, 28. juli 2026). Egen plassering — ikke i
   * navnecellens `secondary` — fordi den ellers ville kollidert med
   * kallenavn-avsløring der (se components/SeasonLeaderboard.tsx sin
   * entryToRow).
   */
  metricSubLabel?: string | null
  /** Uthevet rad (median hos admin, «meg» hos org-admin/leaderboard). */
  highlight?: boolean
  /** Delt rangering — rangeringstallet får «=»-suffiks, Tid får en «delt»-tag. */
  tied?: boolean
  /** Lite ikon etter navnet (krone/pil/flamme/lyn/medalje). */
  badge?: BadgeKind | null
  /**
   * Gjør raden klikkbar: viser en liten chevron ved navnets høyre kant og gir
   * raden `role="button"`/tastaturstøtte. `onRowClick` (tabell-nivå) fyres kun
   * for rader med `clickable === true`.
   */
  clickable?: boolean
  /**
   * Vises i STEDET for chevronen (f.eks. «Sendt») — antyder implisitt at
   * raden ikke lenger er klikkbar (kalleren bør sette `clickable:false` når
   * denne er satt, komponenten håndhever det ikke selv).
   */
  trailingLabel?: string | null
  /**
   * Liten hint-tekst vist FORAN chevronen på klikkbare rader (f.eks.
   * «Utfordre») — gjør det tydelig HVA klikket gjør, ikke bare at raden er
   * klikkbar generelt. Kun relevant når `clickable` er true og
   * `trailingLabel` ikke er satt. Domene-agnostisk med hensikt, som
   * `ariaLabel` — kalleren bestemmer ordlyden.
   */
  clickHint?: string | null
  /** A11y-tekst for klikkbare rader. Domene-agnostisk med hensikt — ingen
   *  hardkodet "duell"-tekst inne i selve tabellen; kalleren bestemmer ordlyden. */
  ariaLabel?: string | null
  /** Full-bredde rad rendret RETT UNDER denne (feilmelding / live-notis). */
  note?: { text: string; tone?: 'error' | 'muted' } | null
  /** Full-bredde divider-rad rendret RETT OVER denne (f.eks. «— Din plassering —»). */
  separatorLabel?: string | null
  /** Passthrough-klasse på selve `<tr>` — brukt for podium-inn-animasjonen. */
  rowClassName?: string | null
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
  /** Overskrift på tredje kolonne. Default «Riktige» — periode-topplistene
   *  (SeasonLeaderboard) setter «Poeng», siden `correctAnswers` der bærer
   *  akkumulert poengsum, ikke antall riktige svar på én quiz. */
  correctLabel?: string
  /** Vis fjerde kolonne (Tid). Default true. Periode-topplistene har ikke
   *  noe tid-begrep og setter denne til false — 3 kolonner i stedet for 4,
   *  se periode-tabell-final-spec (28. juli 2026). */
  showTimeColumn?: boolean
  /** Fyres kun for rader med `clickable === true`. */
  onRowClick?: (row: ResultsTableRow) => void
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
    color: #918f8a;
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
     ikke navn/tid presses sammen til uleselighet — et for langt navn tvinger
     heller tabellen bredere enn kortet (se .qkrt-name white-space under) og
     blir lesbart via scroll i stedet for å bli kuttet eller wrappet. */
  .qkrt-scroll { overflow-x: auto; }
  .qkrt-table { width: 100%; border-collapse: collapse; }
  .qkrt-table th {
    text-align: left;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    color: #918f8a;
    padding: 14px 16px 12px;
    border-bottom: 1px solid #2a2d38;
    white-space: nowrap;
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
  .qkrt-rank { color: #918f8a; font-size: 12px; width: 34px; white-space: nowrap; }
  .qkrt-rank.medal { color: #c9a84c; font-weight: 700; }
  .qkrt-name { font-weight: 500; color: #ffffff; white-space: nowrap; }
  .qkrt-nick { font-size: 11px; color: #918f8a; display: block; margin-top: 1px; white-space: nowrap; }
  /* Selektoren må matche/slå .qkrt-table th sin spesifisitet (klasse+element),
     ellers taper høyrejusteringen for th.qkrt-num mot .qkrt-table th sin
     text-align: left — nøyaktig det som gjorde at RIKTIGE/TID-headerne sto
     venstrejustert mens tallene under sto høyrejustert i samme kolonnebredde.
     td.qkrt-num trengte ikke dette (ingen konkurrerende td-regel på
     text-align), men begge er skrevet ut likt for symmetri og for å unngå at
     samme feil oppstår igjen hvis .qkrt-table td noensinne får en egen
     text-align. */
  .qkrt-table th.qkrt-num, .qkrt-table td.qkrt-num { text-align: right; white-space: nowrap; }
  .qkrt-tied { color: #c9a84c; margin-left: 4px; }
  .qkrt-metric-sub { display: block; font-size: 10px; color: #918f8a; margin-top: 1px; }

  /* Navn-cellens indre layout: badge + navn til venstre, chevron/trailing-
     label dyttet til høyre kant — chevronen får IKKE egen kolonne (hver
     kolonne koster 32px padding på 360px; en 5. kolonne ville motvirket
     hele poenget med konverteringen). */
  .qkrt-name-cell { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .qkrt-name-main { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .qkrt-chevron { flex-shrink: 0; color: #918f8a; }
  .qkrt-trailing-label { flex-shrink: 0; font-size: 11px; font-weight: 600; color: #c9a84c; letter-spacing: 0.06em; white-space: nowrap; }
  .qkrt-click-hint-wrap { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
  .qkrt-click-hint { font-size: 11px; color: #918f8a; white-space: nowrap; }
  .qkrt-table tr.is-clickable { cursor: pointer; }
  .qkrt-table tr.is-clickable:hover td,
  .qkrt-table tr.is-clickable:focus-visible td { background: rgba(255,255,255,0.03); }
  .qkrt-table tr.is-clickable:focus-visible { outline: 1px solid rgba(201,168,76,0.4); outline-offset: -1px; }

  .qkrt-sep-row td { border-bottom: none; padding: 10px 16px 0; }
  .qkrt-inline-sep { text-align: center; font-size: 11px; color: #918f8a; letter-spacing: 0.1em; text-transform: uppercase; font-weight: 600; }
  .qkrt-note-row td { border-bottom: none; padding: 0 16px 10px; }
  .qkrt-note-error { font-size: 13px; color: #E24B4A; margin: 0; }
  .qkrt-note-muted { font-size: 12px; color: #e8e4dd; text-align: center; margin: 0; }

  /* Gjenvinner celle-padding på smal skjerm — 12px × 4 kolonner = 48px
     tilbake FØR vannrett scroll trengs i det hele tatt. Strengt additiv:
     strammer aldri innhold bort, kun luften rundt det. */
  @media (max-width: 400px) {
    .qkrt-table th, .qkrt-table td { padding: 11px 10px; }
  }
`

export default function ResultsTable({ rows, totalQuestions, title, formatTime, embedded, correctLabel, showTimeColumn = true, onRowClick }: Props) {
  const fmt = formatTime ?? defaultFormatTime
  const showTotal = typeof totalQuestions === 'number' && totalQuestions > 0
  const colSpan = showTimeColumn ? 4 : 3

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
                <th className="qkrt-num">{correctLabel ?? 'Riktige'}</th>
                {showTimeColumn && <th className="qkrt-num">Tid</th>}
              </tr>
            </thead>
            <tbody>
              {rows.flatMap(r => {
                const trClass = [
                  r.highlight ? 'is-highlight' : '',
                  r.clickable ? 'is-clickable' : '',
                  r.rowClassName ?? '',
                ].filter(Boolean).join(' ')

                const mainRow = (
                  <tr
                    key={r.key}
                    className={trClass || undefined}
                    role={r.clickable ? 'button' : undefined}
                    tabIndex={r.clickable ? 0 : undefined}
                    aria-label={r.clickable ? (r.ariaLabel ?? undefined) : undefined}
                    onClick={r.clickable ? () => onRowClick?.(r) : undefined}
                    onKeyDown={r.clickable ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick?.(r) }
                    } : undefined}
                  >
                    <td className={`qkrt-rank ${r.rank <= 3 ? 'medal' : ''}`}>{r.rank}{r.tied ? '=' : ''}</td>
                    <td>
                      <div className="qkrt-name-cell">
                        <div className="qkrt-name-main">
                          <span className="qkrt-name">{r.name}</span>
                          {r.badge && <BadgeCircle badge={r.badge} size={16} />}
                          {r.secondary ? <span className="qkrt-nick">{r.secondary}</span> : null}
                        </div>
                        {r.trailingLabel
                          ? <span className="qkrt-trailing-label">{r.trailingLabel}</span>
                          : r.clickable
                            ? (
                              <span className="qkrt-click-hint-wrap">
                                {r.clickHint && <span className="qkrt-click-hint">{r.clickHint}</span>}
                                <svg className="qkrt-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="9 6 15 12 9 18" />
                                </svg>
                              </span>
                            )
                            : null
                        }
                      </div>
                    </td>
                    <td className="qkrt-num">
                      {r.correctAnswers}{showTotal ? ` / ${totalQuestions}` : ''}
                      {r.metricSubLabel ? <span className="qkrt-metric-sub">{r.metricSubLabel}</span> : null}
                    </td>
                    {showTimeColumn && (
                      <td className="qkrt-num">
                        {fmt(r.totalTimeMs)}
                        {r.tied && <span className="qkrt-tied">delt</span>}
                      </td>
                    )}
                  </tr>
                )

                const sepRow = r.separatorLabel ? (
                  <tr key={`${r.key}-sep`} className="qkrt-sep-row">
                    <td colSpan={colSpan}><div className="qkrt-inline-sep">{r.separatorLabel}</div></td>
                  </tr>
                ) : null

                const noteRow = r.note ? (
                  <tr key={`${r.key}-note`} className="qkrt-note-row">
                    <td colSpan={colSpan}>
                      <p className={r.note.tone === 'error' ? 'qkrt-note-error' : 'qkrt-note-muted'}>{r.note.text}</p>
                    </td>
                  </tr>
                ) : null

                return [sepRow, mainRow, noteRow].filter(Boolean)
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
