import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { ipScopeId } from '@/lib/redeem-throttle'
import {
  CHECK_EMAIL_ACTION,
  CHECK_EMAIL_WINDOW_MS,
  decideCheckEmailThrottle,
} from '@/lib/check-email-throttle'

// EKSPLISITT app-side sperre mot duplikate kontoer ved passord-signup.
//
// Appen kobler profiles utelukkende på auth.users.id, aldri e-post, og det finnes
// ingen unique constraint på e-post. Vi stoler derfor IKKE blindt på at Supabase sin
// automatiske identitetskobling (via "Confirm email") er riktig konfigurert — vi
// sjekker eksplisitt om e-posten allerede finnes i auth.users FØR et signup sendes.
//
// Krever service-role, derav egen server-rute.
//
// Returnerer { exists, hasPassword, hasGoogle } til klienten. Ingen id-er lekkes.
//
// phase='pre-signup'  → forventet 0 treff for en ny bruker (ellers blokkeres signup).
// phase='post-signup' → forventet NØYAKTIG 1 treff (verifiserer at ingen duplikat-id
//                       ble opprettet). >1 logges som ADVARSEL.
// phase='lookup'      → oppslag ved innlogging (diagnoseLoginFailure i AuthForm).
// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  // Førstelag: billig burst-brems i minnet. Denne ALENE er ikke grensen vi
  // lener oss på — Map-en lever per serverless-instans — men den holder
  // rå-flooding unna DB-arbeidet under.
  if (!rateLimit(`check-email:${ip}`, 10, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  let body: { email?: string; phase?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const email = body.email?.trim().toLowerCase()
  const allowedPhases = ['pre-signup', 'post-signup', 'lookup']
  const phase = allowedPhases.includes(body.phase ?? '') ? (body.phase as string) : 'pre-signup'
  if (!email) {
    return NextResponse.json({ error: 'Mangler e-post' }, { status: 400 })
  }

  // ── Andrelag: vedvarende telling (lib/check-email-throttle.ts) ─────────────
  // Ruten avslører om en e-post finnes, og er uinnlogget. Uten en teller som
  // overlever kalde starter kan hele medlemslista kartlegges. Her telles ALLE
  // oppslag, ikke bom — se modulen for hvorfor bom har motsatt fortegn her enn
  // i lib/redeem-throttle.ts.
  const ipScope = ipScopeId(ip)
  const since = new Date(Date.now() - CHECK_EMAIL_WINDOW_MS).toISOString()

  const { count: lookups, error: countError } = await supabaseAdmin
    .from('admin_actions')
    .select('id', { count: 'exact', head: true })
    .eq('action_type', CHECK_EMAIL_ACTION)
    .eq('scope_id', ipScope)
    .gte('created_at', since)

  // Til forskjell fra /api/codes/redeem feiler vi ÅPENT her, med vilje: kan vi
  // ikke lese admin_actions, er databasen nede — og da feiler oppslaget under
  // uansett med 500. Å feile lukket ville bare byttet ut den ene feilmeldingen
  // med en annen, samtidig som en forbigående DB-hikke ville blokkert all
  // registrering og all innloggingsdiagnostikk. Burst-bremsen over står igjen.
  if (countError) {
    console.error('[auth/check-email] kunne ikke telle tidligere oppslag:', countError.message)
  } else {
    const decision = decideCheckEmailThrottle(lookups ?? 0)
    if (!decision.allowed) {
      return NextResponse.json({ error: decision.message }, { status: 429 })
    }

    // Bokfør oppslaget FØR arbeidet gjøres, så et dyrt oppslag alltid er betalt
    // for. Et avvist forsøk bokføres ikke — da ville utestengelsen forlenget seg
    // selv for hver gang noen prøver.
    const { error: logErr } = await supabaseAdmin.from('admin_actions').insert({
      action_type: CHECK_EMAIL_ACTION,
      scope_type: 'ip',
      scope_id: ipScope,
    })
    if (logErr) console.error('[auth/check-email] kunne ikke bokføre oppslag:', logErr.message)
  }

  // Ett direkte oppslag mot auth.users.email (unik indeks fra GoTrue), i stedet
  // for den tidligere pagineringen gjennom HELE brukertabellen ved hvert kall.
  // Se supabase/migrations/20260738000001_auth_email_lookup.sql.
  //
  // NB: identities-arrayet er TOMT i admin.listUsers-resultatet i denne
  // Supabase-versjonen (verifisert mot en ekte Google-bruker). Den pålitelige
  // kilden til «har Google» er app_metadata.providers — funksjonen leser samme
  // felt, med samme fallback.
  type LookupRow = { match_ids: string[] | null; has_google: boolean; has_password: boolean }
  let row: LookupRow | null = null
  try {
    const { data, error } = await supabaseAdmin.rpc('auth_email_lookup', { p_email: email })
    if (error) {
      console.error('[auth/check-email] auth_email_lookup error:', error.message)
      return NextResponse.json({ error: 'Kunne ikke verifisere e-post' }, { status: 500 })
    }
    row = (Array.isArray(data) ? data[0] : data) as LookupRow | null
  } catch (err) {
    console.error('[auth/check-email] uventet feil:', err)
    return NextResponse.json({ error: 'Kunne ikke verifisere e-post' }, { status: 500 })
  }

  const matches = row?.match_ids ?? []
  const hasGoogle = row?.has_google === true
  const hasPassword = row?.has_password === true

  // Logglinje for verifisering (Dennis kan lese denne i Vercel-loggen).
  console.log(
    `[auth/check-email] phase=${phase} email=${email} matchCount=${matches.length} ` +
    `hasPassword=${hasPassword} hasGoogle=${hasGoogle} ids=[${matches.join(', ')}]`
  )
  if (phase === 'post-signup' && matches.length > 1) {
    console.error(
      `[auth/check-email] ADVARSEL: ${matches.length} auth-brukere for samme e-post ${email} ` +
      `— mulig duplikat-id! ids=[${matches.join(', ')}]`
    )
  }

  // Kun disse tre feltene til klienten — ingen id-er eller annen data lekkes ut.
  return NextResponse.json({ exists: matches.length > 0, hasPassword, hasGoogle })
}
