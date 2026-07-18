import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

// EKSPLISITT app-side sperre mot duplikate kontoer ved passord-signup.
//
// Appen kobler profiles utelukkende på auth.users.id, aldri e-post, og det finnes
// ingen unique constraint på e-post. Vi stoler derfor IKKE blindt på at Supabase sin
// automatiske identitetskobling (via "Confirm email") er riktig konfigurert — vi
// sjekker eksplisitt om e-posten allerede finnes i auth.users FØR et signup sendes.
//
// Krever service-role (admin.listUsers), derav egen server-rute.
//
// Returnerer { exists, hasPassword, hasGoogle } til klienten (identifier-first-flyten
// på /login bruker dette til å vise kun relevante metoder). Ingen id-er lekkes.
//
// phase='pre-signup'  → forventet 0 treff for en ny bruker (ellers blokkeres signup).
// phase='post-signup' → forventet NØYAKTIG 1 treff (verifiserer at ingen duplikat-id
//                       ble opprettet). >1 logges som ADVARSEL.
// phase='lookup'      → identifier-first-oppslag ved innlogging.
export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  // Rate-limit for å bremse e-post-enumerering (ruten avslører om en e-post finnes).
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

  // Paginer gjennom auth.users og finn ALLE treff på e-posten (case-insensitivt),
  // ikke bare det første — slik at et eventuelt duplikat kan oppdages i loggen.
  // Behold også første treff-objekt for å lese hvilke providere brukeren har.
  //
  // NB: identities-arrayet er TOMT i admin.listUsers-resultatet i denne Supabase-
  // versjonen (verifisert mot en ekte Google-bruker). Den pålitelige kilden til
  // «har Google» er app_metadata.providers (fallback provider), ikke identities.
  type MatchedUser = { id: string; app_metadata?: { provider?: string; providers?: string[] } }
  const matches: string[] = []
  let matchedUser: MatchedUser | null = null
  let page = 1
  try {
    while (true) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) {
        console.error('[auth/check-email] listUsers error (page', page, '):', error.message)
        return NextResponse.json({ error: 'Kunne ikke verifisere e-post' }, { status: 500 })
      }
      const users = data?.users ?? []
      for (const u of users) {
        if (u.email && u.email.toLowerCase() === email) {
          matches.push(u.id)
          if (!matchedUser) matchedUser = { id: u.id, app_metadata: u.app_metadata }
        }
      }
      if (users.length < 1000) break // siste side
      page++
    }
  } catch (err) {
    console.error('[auth/check-email] uventet feil:', err)
    return NextResponse.json({ error: 'Kunne ikke verifisere e-post' }, { status: 500 })
  }

  // Utled hasGoogle (fra app_metadata.providers) og hasPassword (fra
  // profiles.has_password) for den matchende brukeren. Begge false hvis e-posten
  // ikke finnes.
  let hasGoogle = false
  let hasPassword = false
  if (matchedUser) {
    const meta = matchedUser.app_metadata ?? {}
    const providers = meta.providers ?? (meta.provider ? [meta.provider] : [])
    hasGoogle = providers.includes('google')
    const { data: prof } = await supabaseAdmin
      .from('profiles')
      .select('has_password')
      .eq('id', matchedUser.id)
      .maybeSingle()
    hasPassword = prof?.has_password === true
  }

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
