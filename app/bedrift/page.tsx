'use client'
import { useState } from 'react'

const STYLES = `
  html { overflow-x: hidden; }

  :root {
    --bg: #1a1c23;
    --card: #21242e;
    --card-dark: #191c25;
    --border: #2a2d38;
    --gold: #c9a84c;
    --gold-dim: rgba(201,168,76,0.15);
    --gold-border: rgba(201,168,76,0.3);
    --white: #ffffff;
    --body: #e8e4dd;
    --hint: #7a7873;
    --green: #3B6D11;
    --green-bg: rgba(59,109,17,0.12);
  }

  .page { max-width: 900px; margin: 0 auto; padding: 60px 24px 80px; overflow-x: hidden; font-family: 'Instrument Sans', sans-serif; }

  /* Header */
  .header { text-align: center; margin-bottom: 56px; }
  .eyebrow { font-size: 11px; font-weight: 500; letter-spacing: 0.14em; text-transform: uppercase; color: var(--gold); margin-bottom: 12px; }
  .title { font-family: 'Libre Baskerville', serif; font-size: clamp(32px, 5vw, 48px); font-weight: 700; color: var(--white); line-height: 1.1; letter-spacing: -0.02em; margin-bottom: 8px; }
  .title em { font-style: italic; color: var(--gold); }
  .subtitle { font-size: 15px; color: var(--hint); margin-top: 16px; line-height: 1.6; max-width: 520px; margin-left: auto; margin-right: auto; }

  /* Packages grid — minmax(0,1fr) prevents columns from overflowing viewport */
  .packages { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 48px; }
  @media (max-width: 780px) { .packages { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
  @media (max-width: 480px) { .packages { grid-template-columns: minmax(0, 1fr); } }

  .pkg { background: var(--card); border: 0.5px solid var(--border); border-radius: 16px; padding: 24px 20px; display: flex; flex-direction: column; position: relative; }
  .pkg-featured { background: #1e1a0e; border: 1px solid var(--gold-border); }
  .pkg-badge { position: absolute; top: -11px; left: 50%; transform: translateX(-50%); background: var(--gold); color: #1a1c23; font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; padding: 3px 12px; border-radius: 20px; white-space: nowrap; }

  .pkg-name { font-size: 11px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; color: var(--hint); margin-bottom: 6px; }
  .pkg-name-featured { color: var(--gold); }
  .pkg-price { font-family: 'Libre Baskerville', serif; font-size: 28px; font-weight: 700; color: var(--white); line-height: 1; margin-bottom: 2px; }
  .pkg-price span { font-size: 13px; font-weight: 400; color: var(--hint); font-family: 'Instrument Sans', sans-serif; }
  .pkg-desc { font-size: 12px; color: var(--hint); margin-bottom: 20px; margin-top: 6px; line-height: 1.4; }
  .pkg-divider { height: 0.5px; background: var(--border); margin-bottom: 16px; }

  .pkg-features { list-style: none; flex: 1; margin-bottom: 20px; }
  .pkg-features li { font-size: 12px; color: var(--body); padding: 5px 0; border-bottom: 0.5px solid var(--border); display: flex; align-items: flex-start; gap: 8px; line-height: 1.4; }
  .pkg-features li:last-child { border-bottom: none; }
  .check { color: var(--gold); flex-shrink: 0; font-size: 13px; margin-top: 1px; }
  .check-dim { color: var(--hint); }

  .pkg-btn { display: block; text-align: center; padding: 9px 16px; border-radius: 10px; font-size: 13px; font-weight: 600; font-family: 'Instrument Sans', sans-serif; text-decoration: none; border: 1px solid var(--border); color: var(--body); background: transparent; cursor: pointer; }
  .pkg-btn-featured { background: var(--gold); color: #1a1c23; border-color: var(--gold); }

  /* Comparison table — overflow-x: auto so table scrolls on mobile instead of clipping */
  .section-title { font-family: 'Libre Baskerville', serif; font-size: 20px; font-weight: 700; color: var(--white); margin-bottom: 20px; }
  .table-wrap { background: var(--card); border: 0.5px solid var(--border); border-radius: 16px; overflow: hidden; margin-bottom: 48px; }
  .table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; width: 100%; }
  table { width: 100%; min-width: 480px; border-collapse: collapse; }
  th { font-size: 11px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--hint); padding: 14px 16px; text-align: left; border-bottom: 0.5px solid var(--border); background: #1e2028; }
  th:not(:first-child) { text-align: center; }
  td { padding: 12px 16px; font-size: 12px; color: var(--body); border-bottom: 0.5px solid var(--border); vertical-align: middle; }
  td:not(:first-child) { text-align: center; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(255,255,255,0.02); }
  .td-feature { color: var(--hint); font-size: 11px; }
  .td-gold { color: var(--gold); font-weight: 500; }
  .td-yes { color: var(--gold); font-size: 14px; }
  .td-no { color: var(--border); font-size: 14px; }
  .col-featured { background: var(--gold-dim); }

  @media (max-width: 640px) {
    .table-wrap { display: none; }
    .section-title { display: none; }
  }

  /* Notes accordion */
  .notes { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 48px; }
  @media (max-width: 580px) { .notes { grid-template-columns: 1fr; } }

  .note {
    background: var(--card);
    border: 0.5px solid var(--border);
    border-radius: 12px;
    padding: 16px 18px;
    cursor: pointer;
    user-select: none;
    transition: border-color 0.15s;
  }
  .note:hover { border-color: rgba(201,168,76,0.2); }

  .note-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .note-title { font-size: 12px; font-weight: 500; color: var(--white); }

  .note-chevron {
    flex-shrink: 0;
    color: var(--hint);
    transition: transform 0.2s ease;
  }
  .note-chevron.open { transform: rotate(180deg); }

  .note-body { font-size: 12px; color: var(--hint); line-height: 1.6; margin-top: 10px; }

  /* CTA */
  .cta { background: #1e1a0e; border: 1px solid var(--gold-border); border-radius: 16px; padding: 32px; text-align: center; }
  .cta-title { font-family: 'Libre Baskerville', serif; font-size: 22px; font-weight: 700; color: var(--white); margin-bottom: 8px; }
  .cta-sub { font-size: 14px; color: var(--hint); margin-bottom: 24px; line-height: 1.6; }
  .cta-btn { display: inline-block; background: var(--gold); color: #1a1c23; font-family: 'Instrument Sans', sans-serif; font-size: 14px; font-weight: 700; padding: 12px 32px; border-radius: 10px; text-decoration: none; }
  .cta-note { font-size: 12px; color: var(--hint); margin-top: 12px; font-style: italic; }
`

const NOTES = [
  { title: 'Ingen bindingstid', body: 'Avslutt når du vil. Ingen skjulte kostnader. Prisen gjelder per bedrift — ikke per ansatt.' },
  { title: 'Gratis oppstart', body: 'Vi setter opp alt for deg. Inviter ansatte med én lenke. Første uke er gratis — ingen kortinfo nødvendig.' },
  { title: 'Fungerer i nettleseren', body: 'Ingen app å laste ned. Fungerer på mobil og desktop. Del en lenke — alle er med på 30 sekunder.' },
  { title: 'Ukentlig statistikk', body: 'Standard og opp får ukentlig rapport: hvem deltok, hvem vant, fremgang over tid. Enkelt å følge med.' },
]

export default function BedriftPage() {
  const [openNote, setOpenNote] = useState<number | null>(null)

  return (
    <>
      <style>{STYLES}</style>
      <div className="page">

        {/* Header */}
        <div className="header">
          <div className="eyebrow">Quizkanonen for bedrifter</div>
          <h1 className="title">Fredagsquizen som <em>samler teamet.</em></h1>
          <p className="subtitle">Alle ansatte logger inn med sitt eget navn. Eget leaderboard. Ukentlig engasjement. Ingen installasjon — del en lenke og alle er med.</p>
          <p className="subtitle">Teamet får sin egen liga — helt adskilt fra alle andre. Alle deltakere får Premium-tilgang inkludert.</p>
        </div>

        {/* Packages */}
        <div className="packages">

          <div className="pkg">
            <div className="pkg-name">Starter</div>
            <div className="pkg-price">499 <span>kr/mnd</span></div>
            <div className="pkg-desc">Én quiz i uken. Perfekt inngang.</div>
            <div className="pkg-divider"></div>
            <ul className="pkg-features">
              <li><span className="check">✓</span>Fredagsquiz hver uke</li>
              <li><span className="check">✓</span>Eget bedrifts-leaderboard</li>
              <li><span className="check">✓</span>Opptil 25 ansatte</li>
              <li><span className="check">✓</span>Invitasjon via lenke</li>
              <li><span className="check check-dim">—</span>Ukentlig statistikk-rapport</li>
              <li><span className="check check-dim">—</span>Egne quizer</li>
            </ul>
            <a href="/bedrift/registrer?plan=starter" className="pkg-btn">Kom i gang</a>
          </div>

          <div className="pkg pkg-featured">
            <div className="pkg-badge">Mest populær</div>
            <div className="pkg-name pkg-name-featured">Standard</div>
            <div className="pkg-price">899 <span>kr/mnd</span></div>
            <div className="pkg-desc">Tre quizer i uken. Mer engasjement.</div>
            <div className="pkg-divider"></div>
            <ul className="pkg-features">
              <li><span className="check">✓</span>Mandag, onsdag og fredag</li>
              <li><span className="check">✓</span>Eget bedrifts-leaderboard</li>
              <li><span className="check">✓</span>Opptil 50 ansatte</li>
              <li><span className="check">✓</span>Invitasjon via lenke</li>
              <li><span className="check">✓</span>Ukentlig statistikk-rapport</li>
              <li><span className="check check-dim">—</span>Egne quizer</li>
            </ul>
            <a href="/bedrift/registrer?plan=standard" className="pkg-btn pkg-btn-featured">Velg Standard</a>
          </div>

          <div className="pkg">
            <div className="pkg-name">Pro</div>
            <div className="pkg-price">1 499 <span>kr/mnd</span></div>
            <div className="pkg-desc">Daglig miniquiz + fredagsquiz.</div>
            <div className="pkg-divider"></div>
            <ul className="pkg-features">
              <li><span className="check">✓</span>Miniquiz man–tors (5 spørsmål)</li>
              <li><span className="check">✓</span>Full fredagsquiz</li>
              <li><span className="check">✓</span>Opptil 100 ansatte</li>
              <li><span className="check">✓</span>Invitasjon via lenke</li>
              <li><span className="check">✓</span>Ukentlig statistikk-rapport</li>
              <li><span className="check">✓</span>Egne quizer (kommer)</li>
            </ul>
            <a href="/bedrift/registrer?plan=pro" className="pkg-btn">Velg Pro</a>
          </div>

          <div className="pkg">
            <div className="pkg-name">Enterprise</div>
            <div className="pkg-price">Fra 2 499 <span>kr/mnd</span></div>
            <div className="pkg-desc">Skreddersydd for store team.</div>
            <div className="pkg-divider"></div>
            <ul className="pkg-features">
              <li><span className="check">✓</span>Alt i Pro</li>
              <li><span className="check">✓</span>Ubegrenset ansatte</li>
              <li><span className="check">✓</span>Skreddersydde quizer</li>
              <li><span className="check">✓</span>Quizer om eget produkt/bransje</li>
              <li><span className="check">✓</span>Dedikert support</li>
              <li><span className="check">✓</span>Faktura</li>
            </ul>
            <a href="mailto:support@quizkanonen.no?subject=Enterprise" className="pkg-btn">Ta kontakt</a>
          </div>

        </div>

        {/* Comparison table */}
        <div className="section-title">Sammenligning</div>
        <div className="table-wrap">
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Funksjon</th>
                <th>Starter</th>
                <th className="col-featured">Standard</th>
                <th>Pro</th>
                <th>Enterprise</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Fredagsquiz</td>
                <td className="td-yes">✓</td>
                <td className="td-yes col-featured">✓</td>
                <td className="td-yes">✓</td>
                <td className="td-yes">✓</td>
              </tr>
              <tr>
                <td>Quizer per uke</td>
                <td>1</td>
                <td className="col-featured td-gold">3</td>
                <td className="td-gold">5+</td>
                <td className="td-gold">Valgfritt</td>
              </tr>
              <tr>
                <td>Daglig miniquiz (man–tors)</td>
                <td className="td-no">—</td>
                <td className="td-no col-featured">—</td>
                <td className="td-yes">✓</td>
                <td className="td-yes">✓</td>
              </tr>
              <tr>
                <td>Bedrifts-leaderboard</td>
                <td className="td-yes">✓</td>
                <td className="td-yes col-featured">✓</td>
                <td className="td-yes">✓</td>
                <td className="td-yes">✓</td>
              </tr>
              <tr>
                <td>Maks antall ansatte</td>
                <td>25</td>
                <td className="col-featured">50</td>
                <td>100</td>
                <td className="td-gold">Ubegrenset</td>
              </tr>
              <tr>
                <td>Ukentlig statistikk-rapport</td>
                <td className="td-no">—</td>
                <td className="td-yes col-featured">✓</td>
                <td className="td-yes">✓</td>
                <td className="td-yes">✓</td>
              </tr>
              <tr>
                <td>Egne quizer</td>
                <td className="td-no">—</td>
                <td className="td-no col-featured">—</td>
                <td className="td-gold">Kommer</td>
                <td className="td-yes">✓</td>
              </tr>
              <tr>
                <td>Faktura</td>
                <td className="td-no">—</td>
                <td className="td-no col-featured">—</td>
                <td className="td-no">—</td>
                <td className="td-yes">✓</td>
              </tr>
              <tr>
                <td>Pris per mnd</td>
                <td>499 kr</td>
                <td className="col-featured td-gold">899 kr</td>
                <td>1 499 kr</td>
                <td>Fra 2 499 kr</td>
              </tr>
            </tbody>
          </table>
          </div>
        </div>

        {/* Notes accordion */}
        <div className="notes">
          {NOTES.map((note, i) => (
            <div
              key={i}
              className="note"
              onClick={() => setOpenNote(openNote === i ? null : i)}
            >
              <div className="note-header">
                <div className="note-title">{note.title}</div>
                <svg
                  className={`note-chevron${openNote === i ? ' open' : ''}`}
                  width="12" height="7" viewBox="0 0 12 7" fill="none"
                >
                  <path d="M1 1L6 6L11 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              {openNote === i && (
                <div className="note-body">{note.body}</div>
              )}
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="cta">
          <div className="cta-title">Klar til å prøve?</div>
          <div className="cta-sub">Registrer bedriften, betal via Stripe, og del invitasjonslenken med teamet. Ingen binding — avslutt når du vil.</div>
          <a href="/bedrift/registrer" className="cta-btn">Kom i gang →</a>
          <div className="cta-note">Alle ansatte får Premium inkludert i abonnementet.</div>
        </div>

      </div>
    </>
  )
}
