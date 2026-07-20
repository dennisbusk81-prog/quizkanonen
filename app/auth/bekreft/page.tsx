import Link from 'next/link'
import { safeNextPath } from '@/lib/auth-post-login'

// Landingssiden for e-postlenker (magic link, «sett passord», kontobekreftelse).
//
// Hele grunnen til at denne siden finnes: å ÅPNE en lenke skal ikke BRUKE den.
// Supabase sin /auth/v1/verify forbruker engangs-tokenet på GET, og
// e-postskannere følger lenker automatisk før brukeren klikker — lenken var da
// allerede oppbrukt når brukeren selv trykket.
//
// Her gjør GET ingenting annet enn å vise en knapp. Selve innløsningen skjer i
// POST-en til /api/auth/bekreft. Skjemaet er rent HTML og virker uten JS.
//
// Følger samme visuelle mønster som /sett-passord og /login.

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:       #1a1c23;
    --card:     #21242e;
    --border:   #2a2d38;
    --gold:     #c9a84c;
    --white:    #ffffff;
    --body:     #e8e4dd;
    --muted:    #7a7873;
    --radius-card: 20px;
    --radius-btn:  10px;
  }

  body {
    background: var(--bg);
    font-family: 'Instrument Sans', sans-serif;
    color: var(--body);
    min-height: 100vh;
  }

  .ab-screen {
    min-height: 100vh;
    background: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 20px;
  }

  .ab-panel {
    width: 100%;
    max-width: 380px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 40px 32px;
  }

  .ab-eyebrow {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--gold);
    text-align: center;
    margin-bottom: 8px;
  }

  .ab-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 28px;
    font-weight: 700;
    color: var(--white);
    text-align: center;
    letter-spacing: -0.01em;
    margin-bottom: 4px;
  }

  .ab-title em { font-style: italic; color: var(--gold); }

  .ab-sub {
    font-size: 13px;
    color: var(--muted);
    text-align: center;
    margin-bottom: 32px;
  }

  .ab-rule {
    width: 100%;
    height: 1px;
    background: var(--border);
    margin-bottom: 28px;
  }

  .ab-lead {
    font-size: 14px;
    color: var(--body);
    line-height: 1.6;
    text-align: center;
    margin-bottom: 24px;
  }

  .ab-error {
    font-size: 13px;
    color: #f87171;
    text-align: center;
    margin-bottom: 16px;
    padding: 10px;
    background: rgba(248,113,113,0.08);
    border: 1px solid rgba(248,113,113,0.18);
    border-radius: var(--radius-btn);
    line-height: 1.5;
  }

  .ab-btn-primary {
    width: 100%;
    background: var(--gold);
    color: #1a1c23;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 15px;
    font-weight: 700;
    padding: 12px 28px;
    border-radius: var(--radius-btn);
    border: none;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .ab-btn-primary:hover { opacity: 0.88; }

  .ab-back {
    display: block;
    text-align: center;
    margin-top: 20px;
    font-size: 13px;
    color: var(--body);
    text-decoration: none;
    transition: color 0.15s;
  }

  .ab-back:hover { color: #ffffff; }
`

const ALLOWED_TYPES = ['recovery', 'magiclink', 'signup', 'invite', 'email', 'email_change'] as const
type AllowedType = (typeof ALLOWED_TYPES)[number]

// Teksten på knappen skal beskrive hva som faktisk skjer etterpå.
const COPY: Record<AllowedType, { lead: string; cta: string }> = {
  recovery:     { lead: 'Trykk under for å fortsette til siden der du velger passord.', cta: 'Fortsett til passordvalg' },
  magiclink:    { lead: 'Trykk under for å logge inn på Quizkanonen.',                  cta: 'Logg inn' },
  signup:       { lead: 'Trykk under for å bekrefte kontoen din.',                      cta: 'Bekreft kontoen' },
  invite:       { lead: 'Trykk under for å ta imot invitasjonen.',                      cta: 'Ta imot invitasjon' },
  email:        { lead: 'Trykk under for å bekrefte e-postadressen din.',               cta: 'Bekreft e-postadresse' },
  email_change: { lead: 'Trykk under for å bekrefte den nye e-postadressen din.',       cta: 'Bekreft e-postadresse' },
}

function asString(v: string | string[] | undefined): string {
  return typeof v === 'string' ? v : ''
}

export default async function BekreftPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const tokenHash = asString(sp.token_hash)
  const rawType = asString(sp.type)
  const next = safeNextPath(asString(sp.next))

  const type = (ALLOWED_TYPES as readonly string[]).includes(rawType)
    ? (rawType as AllowedType)
    : null

  const valid = Boolean(tokenHash) && type !== null

  return (
    <>
      <style>{STYLES}</style>
      <div className="ab-screen">
        <div className="ab-panel">
          <p className="ab-eyebrow">Quizkanonen</p>
          <h1 className="ab-title">{valid ? <>Nesten <em>der</em></> : <>Ugyldig <em>lenke</em></>}</h1>
          <p className="ab-sub">{valid ? 'Ett siste steg' : 'Lenken mangler informasjon'}</p>
          <div className="ab-rule" />

          {valid && type ? (
            <>
              <p className="ab-lead">{COPY[type].lead}</p>
              <form action="/api/auth/bekreft" method="post">
                <input type="hidden" name="token_hash" value={tokenHash} />
                <input type="hidden" name="type" value={type} />
                <input type="hidden" name="next" value={next} />
                <button type="submit" className="ab-btn-primary">{COPY[type].cta}</button>
              </form>
            </>
          ) : (
            <>
              <p className="ab-error">
                Denne lenken ser ikke ut til å være komplett. Den kan ha blitt delt opp av
                e-postprogrammet ditt.
              </p>
              <p className="ab-lead">Be om en ny lenke, så sender vi en fersk med det samme.</p>
            </>
          )}

          <Link href="/login" className="ab-back">← Til innlogging</Link>
        </div>
      </div>
    </>
  )
}
