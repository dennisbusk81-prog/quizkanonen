import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { escapeHtml } from '@/lib/html-escape'
import { verifyUnsubscribeToken, type UnsubscribeType } from '@/lib/unsubscribe'

// Avmelding fra e-postvarsler.
//
// GET VISER KUN EN BEKREFTELSESSIDE — den skriver ingenting. Selve avmeldingen
// (email_*: false) skjer utelukkende i POST, utløst av at brukeren trykker
// knappen på siden.
//
// Grunnen er den samme som gjorde /api/auth/bekreft POST-only 20. juli:
// e-postskannere og lenke-forhåndshentere (Outlook Safe Links,
// bedrifts-sikkerhetsgatewayer, enkelte mobilklienter) følger lenker i e-post
// AUTOMATISK, før mottakeren har rørt noe. Så lenge tilstandsendringen lå på
// GET, kunne en slik skanner melde en bruker av fredagspåminnelsene uten at
// brukeren hadde klikket i det hele tatt — og brukeren ville aldri fått vite
// det. Skannere følger ikke skjema-POST-er.
//
// BAKOVERKOMPATIBILITET: lenkeformatet er uendret
// (?token=…&type=…&uid=…, se lib/unsubscribe.ts). Allerede utsendte e-poster
// peker på nøyaktig samme URL og virker som før — det eneste som er endret er
// at åpningen nå ender i en bekreftelse i stedet for en fullført avmelding.

const FONT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap');`

const VALID_TYPES: UnsubscribeType[] = ['reminders', 'reengagement', 'duel']

const COLUMN_MAP: Record<UnsubscribeType, string> = {
  reminders:    'email_reminders',
  reengagement: 'email_reengagement',
  duel:         'email_duel_notifications',
}

const TYPE_LABEL: Record<UnsubscribeType, string> = {
  reminders:    'fredagspåminnelser',
  reengagement: 'aktivitetspåminnelser',
  duel:         'duell-utfordringer',
}

const PROFILE_URL = 'https://www.quizkanonen.no/profil'

function page(title: string, body: string, isError = false): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex" />
  <title>${title} — Quizkanonen</title>
  <style>
    ${FONT}
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #1a1c23; font-family: 'Instrument Sans', sans-serif; color: #e8e4dd; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px 20px; }
    .card { background: #21242e; border: 1px solid #2a2d38; border-radius: 20px; padding: 40px 36px; max-width: 480px; width: 100%; text-align: center; }
    .eyebrow { font-size: 10px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: #c9a84c; margin-bottom: 12px; }
    h1 { font-family: 'Libre Baskerville', serif; font-size: 24px; font-weight: 700; color: #ffffff; margin-bottom: 14px; line-height: 1.3; }
    p { font-size: 14px; color: #e8e4dd; line-height: 1.6; margin-bottom: 24px; }
    .hint { font-size: 13px; color: #918f8a; line-height: 1.6; margin-bottom: 0; }
    a.btn { display: inline-block; background: transparent; color: #e8e4dd; font-family: 'Instrument Sans', sans-serif; font-size: 14px; font-weight: 600; padding: 10px 28px; border-radius: 10px; border: 1px solid #2a2d38; text-decoration: none; }
    button.btn-primary { display: inline-block; background: #c9a84c; color: #1a1c23; font-family: 'Instrument Sans', sans-serif; font-size: 14px; font-weight: 600; padding: 10px 28px; border-radius: 10px; border: none; cursor: pointer; width: auto; }
    .secondary { display: block; margin-top: 18px; font-size: 14px; color: #e8e4dd; text-decoration: none; }
    .divider { height: 1px; background: #2a2d38; margin: 24px 0; }
    ${isError ? '.card { border-color: rgba(248,113,113,0.2); }' : ''}
  </style>
</head>
<body>
  <div class="card">
    <p class="eyebrow">Quizkanonen</p>
    ${body}
  </div>
</body>
</html>`
  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

const invalidLinkPage = (detail: string) =>
  page('Ugyldig lenke', `
    <h1>Ugyldig lenke</h1>
    <p>${detail}</p>
    <a class="btn" href="${PROFILE_URL}">Gå til profilsiden →</a>
  `, true)

const failedPage = () =>
  page('Noe gikk galt', `
    <h1>Noe gikk galt</h1>
    <p>Vi klarte ikke å oppdatere innstillingene dine. Prøv igjen fra profilsiden.</p>
    <a class="btn" href="${PROFILE_URL}">Gå til profilsiden →</a>
  `, true)

type Verified = { token: string; uid: string; unsubType: UnsubscribeType }

/** Leser og verifiserer (token, type, uid). Returnerer null ved ugyldig lenke. */
function verify(params: URLSearchParams): Verified | null {
  const token = params.get('token') ?? ''
  const type  = params.get('type') ?? ''
  const uid   = params.get('uid') ?? ''

  if (!token || !uid || !VALID_TYPES.includes(type as UnsubscribeType)) return null

  const unsubType = type as UnsubscribeType
  if (!verifyUnsubscribeToken(uid, unsubType, token)) return null

  return { token, uid, unsubType }
}

/**
 * Parametere for POST hentes fra skjemaet (hidden inputs) med query-strengen som
 * reserve. Reserven finnes for at en POST mot den rene lenke-URL-en — f.eks. fra
 * en framtidig klient — skal treffe samme kodesti.
 */
async function postParams(request: Request): Promise<URLSearchParams> {
  const query = new URL(request.url).searchParams
  const form = await request.formData().catch(() => null)
  if (!form) return query

  const merged = new URLSearchParams()
  for (const key of ['token', 'type', 'uid']) {
    const fromForm = form.get(key)
    const value = typeof fromForm === 'string' && fromForm ? fromForm : query.get(key)
    if (value) merged.set(key, value)
  }
  return merged
}

// GET — viser bekreftelsen. Rører ALDRI databasen.
export async function GET(request: Request) {
  const verified = verify(new URL(request.url).searchParams)

  if (!verified) {
    return invalidLinkPage('Avmeldingslenken er ikke gyldig eller har utløpt.')
  }

  const { token, uid, unsubType } = verified
  const label = TYPE_LABEL[unsubType]

  return page('Bekreft avmelding', `
    <h1>Vil du melde deg av?</h1>
    <p>Du er i ferd med å melde deg av ${escapeHtml(label)} på e-post. Trykk under for å bekrefte.</p>
    <form method="post" action="/api/notifications/unsubscribe">
      <input type="hidden" name="token" value="${escapeHtml(token)}" />
      <input type="hidden" name="type" value="${escapeHtml(unsubType)}" />
      <input type="hidden" name="uid" value="${escapeHtml(uid)}" />
      <button type="submit" class="btn-primary">Ja, meld meg av</button>
    </form>
    <a class="secondary" href="${PROFILE_URL}">Nei, behold varslene</a>
  `)
}

// POST — den eneste kodestien som faktisk melder brukeren av.
export async function POST(request: Request) {
  const verified = verify(await postParams(request))

  if (!verified) {
    return invalidLinkPage('Denne avmeldingslenken er ikke gyldig.')
  }

  const { uid, unsubType } = verified
  const column = COLUMN_MAP[unsubType]

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ [column]: false })
    .eq('id', uid)

  if (error) {
    console.error('[unsubscribe] update failed:', error.message)
    return failedPage()
  }

  const label = TYPE_LABEL[unsubType]
  return page('Avmeldt', `
    <h1>Du er avmeldt</h1>
    <p>Du vil ikke lenger motta ${escapeHtml(label)} på e-post.</p>
    <div class="divider"></div>
    <p class="hint">Du kan endre dette når som helst på <a href="${PROFILE_URL}" style="color:#e8e4dd;">profilsiden din</a>.</p>
  `)
}
