import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { logRateLimitHit } from '@/lib/rate-limit-log'
import { requireUnlockedOrg } from '@/lib/org-lock-guard'

// POST /api/admin/exclude-member
// Body: { scope_type, scope_id, user_id, action: 'exclude'|'unexclude' }
// Auth: admin-passord, eller token med liga-eier / org-admin-rettigheter
//
// DENNE RUTEN ER SÆREGEN under admin/: den er den eneste som kan nås UTEN
// admin-hemmeligheten. Dobbel auth-sti betyr at en vanlig innlogget bruker med
// en org- eller ligarolle kommer inn her. Derfor har den nå de samme fire
// innstrammingene som søsterrutene under /api/org og /api/leagues har fra før:
// rate-limit, hvitelistet scope_type, org-lås og medlemskapskrav på den
// brukeren det skrives en rad om.
//
// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

/**
 * HVITELISTE, ikke fritekst (F2.2). På bearer-stien var `scope_type` i praksis
 * begrenset til disse to av auth-grenene under — en ukjent verdi satte aldri
 * `authed` og falt ut med 403. På ADMIN-stien gikk fri tekst rett inn i
 * `excluded_members.scope_type`. Samme mass-assignment-form som
 * POST /api/admin/codes hadde før `buildAccessCode()`.
 *
 * Sjekken står FØR auth, sammen med resten av formvalideringen: hvilke
 * scope-typer API-et godtar er en statisk egenskap ved ruten, ikke noe en
 * uinnlogget kaller lærer noe av. Konsekvens å være klar over: en ukjent
 * `scope_type` svarer nå 400, ikke 403 som før — den ble avvist begge veier,
 * men nå på formen i stedet for på tilgangen.
 *
 * Merk at leserne også spør etter rader med `scope_type='global'`
 * (scope_id NULL) — men INGEN kodesti skriver slike rader, og denne ruten
 * kunne aldri gjort det uansett: `scope_id` er påkrevd over.
 */
const SCOPE_TYPES = ['league', 'organization'] as const
type ScopeType = (typeof SCOPE_TYPES)[number]

/** Tabellen og kolonnen som avgjør medlemskap for hver scope-type. */
const MEMBERSHIP: Record<ScopeType, { table: string; scopeColumn: string }> = {
  league:       { table: 'league_members',       scopeColumn: 'league_id' },
  organization: { table: 'organization_members', scopeColumn: 'organization_id' },
}

export async function POST(request: NextRequest) {
  // Samme mønster og størrelsesorden som naborutene for medlemsadministrasjon
  // (org-member-remove og invite-deactivate: begge 20/60 s). Lag 1 holder her:
  // handlingen skriver kun én rad i vår egen DB, sender ingen e-post og koster
  // ingen ekstern rundtur, så instans-spredning er ikke en reell åpning.
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rlKey = `exclude-member:${ip}`
  if (!rateLimit(rlKey, 20, 60_000).success) {
    logRateLimitHit(rlKey, { lag: 'lokal', limit: 20, windowMs: 60_000 })
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  let body: { scope_type?: string; scope_id?: string; user_id?: string; action?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 }) }

  const { scope_type, scope_id, user_id, action } = body
  if (!scope_type || !scope_id || !user_id || !['exclude', 'unexclude'].includes(action ?? '')) {
    return NextResponse.json({ error: 'Mangler eller ugyldige felter' }, { status: 400 })
  }
  if (!(SCOPE_TYPES as readonly string[]).includes(scope_type)) {
    return NextResponse.json({ error: 'Ugyldig scope_type' }, { status: 400 })
  }
  const scopeType = scope_type as ScopeType

  // ── Auth ─────────────────────────────────────────────────────────────────────
  const bearerToken = request.headers.get('authorization')?.replace('Bearer ', '')

  let authed = false

  if (verifyAdminRequest(request)) {
    authed = true
  } else if (bearerToken) {
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(bearerToken)
    if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

    if (scopeType === 'league') {
      const { data: league } = await supabaseAdmin
        .from('leagues')
        .select('owner_id')
        .eq('id', scope_id)
        .maybeSingle()
      authed = league?.owner_id === user.id
    } else {
      const { data: mem } = await supabaseAdmin
        .from('organization_members')
        .select('role')
        .eq('organization_id', scope_id)
        .eq('user_id', user.id)
        .maybeSingle()
      authed = mem?.role === 'admin'
    }
  }

  if (!authed) return NextResponse.json({ error: 'Ingen tilgang' }, { status: 403 })

  // ── Låst org ────────────────────────────────────────────────────────────────
  // Ekskludering er en del av det betalte bedriftsproduktet: den styrer hvem som
  // vises i bedriftens aktivitetsliste og toppliste. Uten denne kunne en låst
  // org sin admin fortsatt ekskludere, mens de samme hendene nektes alt annet i
  // panelet. Står ETTER auth, som invarianten i lib/org-lock-guard.ts krever.
  //
  // Gjelder scope-typen, ikke auth-stien: også et kall med admin-hemmeligheten
  // avvises mot en låst org. Ruten har i dag ingen kaller på admin-stien
  // (begge kallstedene i repoet sender Bearer-token), så et unntak der ville
  // vært en åpning uten en bruker.
  //
  // LIGA-GRENEN HAR INGEN TILSVARENDE LÅS: `leagues` har ingen
  // `subscription_status`-kolonne og ikke noe `isLeagueLocked`-begrep i det
  // hele tatt — ligaer er en Premium-funksjon hos EIEREN, ikke et abonnement på
  // ligaen. Det er altså ingen vakt utelatt her; det finnes ingen å legge på.
  if (scopeType === 'organization') {
    const lock = await requireUnlockedOrg({ id: scope_id })
    if (!lock.ok) return NextResponse.json(lock.body, { status: lock.status })
  }

  // ── Brukeren MÅ være medlem av DETTE scopet ─────────────────────────────────
  // Samme klasse som F1 i send-reminder: `user_id` kom rått fra body og ble
  // aldri målt mot medlemslista. Bruker-UUID-er er offentlige (/api/toppliste
  // returnerer dem uten auth), så en org-admin kunne skrevet rader om
  // vilkårlige kontoer. Skaden er i dag begrenset fordi alle tre leserne
  // (toppliste, org/[slug]/members-activity, leagues/[id]/members-activity)
  // uansett skjærer mot medlemslista — men vakten manglet, og en inert rad er
  // ikke det samme som en avvist skriving.
  //
  // Oppslaget nøkles på den FORESPURTE id-en, ikke på hele medlemslista: en
  // liste ville møtt PostgRESTs stille 1000-radskutt, og medlem nr. 1001 ville
  // sett ut som en fremmed.
  //
  // Gjelder BEGGE handlingene. En `unexclude` av en ikke-medlem ville uansett
  // bare slettet en rad som er inert for alle lesere.
  const { table, scopeColumn } = MEMBERSHIP[scopeType]
  const { data: memberRows, error: memberErr } = await supabaseAdmin
    .from(table)
    .select('user_id')
    .eq(scopeColumn, scope_id)
    .eq('user_id', user_id)
    .limit(1)

  // Ikke fått svar betyr UKJENT, aldri «ikke medlem». Samme linje som
  // lib/has-settled-plays.ts og medlemsvakten i send-reminder.
  if (memberErr) {
    console.error('[exclude-member] kunne ikke slå opp medlemskap:', memberErr.message)
    return NextResponse.json(
      { error: 'Kunne ikke bekrefte medlemskapet akkurat nå. Prøv igjen om litt.' },
      { status: 503 }
    )
  }

  if ((memberRows ?? []).length === 0) {
    return NextResponse.json(
      { error: 'Brukeren er ikke medlem av dette scopet.', code: 'not_a_member' },
      { status: 403 }
    )
  }

  // ── Handling ──────────────────────────────────────────────────────────────────
  if (action === 'exclude') {
    const { error } = await supabaseAdmin
      .from('excluded_members')
      .upsert(
        { scope_type: scopeType, scope_id, user_id, excluded_at: new Date().toISOString() },
        { onConflict: 'scope_type,scope_id,user_id', ignoreDuplicates: true }
      )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await supabaseAdmin
      .from('excluded_members')
      .delete()
      .eq('scope_type', scopeType)
      .eq('scope_id', scope_id)
      .eq('user_id', user_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
