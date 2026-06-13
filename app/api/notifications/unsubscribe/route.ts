import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyUnsubscribeToken, type UnsubscribeType } from '@/lib/unsubscribe'

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

function page(title: string, body: string, isError = false): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — Quizkanonen</title>
  <style>
    ${FONT}
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #1a1c23; font-family: 'Instrument Sans', sans-serif; color: #e8e4dd; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px 20px; }
    .card { background: #21242e; border: 1px solid #2a2d38; border-radius: 20px; padding: 40px 36px; max-width: 480px; width: 100%; text-align: center; }
    .eyebrow { font-size: 10px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: #c9a84c; margin-bottom: 12px; }
    h1 { font-family: 'Libre Baskerville', serif; font-size: 24px; font-weight: 700; color: #ffffff; margin-bottom: 14px; line-height: 1.3; }
    p { font-size: 14px; color: #e8e4dd; line-height: 1.6; margin-bottom: 24px; }
    .hint { font-size: 13px; color: #7a7873; line-height: 1.6; margin-bottom: 0; }
    a.btn { display: inline-block; background: transparent; color: #e8e4dd; font-family: 'Instrument Sans', sans-serif; font-size: 14px; font-weight: 600; padding: 10px 28px; border-radius: 10px; border: 1px solid #2a2d38; text-decoration: none; }
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
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const token = searchParams.get('token') ?? ''
  const type  = searchParams.get('type') ?? ''
  const uid   = searchParams.get('uid') ?? ''

  if (!token || !uid || !VALID_TYPES.includes(type as UnsubscribeType)) {
    return page('Ugyldig lenke', `
      <h1>Ugyldig lenke</h1>
      <p>Avmeldingslenken er ikke gyldig eller har utløpt.</p>
      <a class="btn" href="https://www.quizkanonen.no/profil">Gå til profilsiden →</a>
    `, true)
  }

  const unsubType = type as UnsubscribeType

  if (!verifyUnsubscribeToken(uid, unsubType, token)) {
    return page('Ugyldig lenke', `
      <h1>Ugyldig lenke</h1>
      <p>Denne avmeldingslenken er ikke gyldig.</p>
      <a class="btn" href="https://www.quizkanonen.no/profil">Gå til profilsiden →</a>
    `, true)
  }

  const column = COLUMN_MAP[unsubType]
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ [column]: false })
    .eq('id', uid)

  if (error) {
    console.error('[unsubscribe] update failed:', error.message)
    return page('Noe gikk galt', `
      <h1>Noe gikk galt</h1>
      <p>Vi klarte ikke å oppdatere innstillingene dine. Prøv igjen fra profilsiden.</p>
      <a class="btn" href="https://www.quizkanonen.no/profil">Gå til profilsiden →</a>
    `, true)
  }

  const label = TYPE_LABEL[unsubType]
  return page('Avmeldt', `
    <h1>Du er avmeldt</h1>
    <p>Du vil ikke lenger motta ${label} på e-post.</p>
    <div class="divider"></div>
    <p class="hint">Du kan endre dette når som helst på <a href="https://www.quizkanonen.no/profil" style="color:#e8e4dd;">profilsiden din</a>.</p>
  `)
}
