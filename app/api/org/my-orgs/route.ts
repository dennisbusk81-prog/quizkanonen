import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

type OrgResult = {
  orgId: string; orgName: string; orgSlug: string; isAdmin: boolean
  subscriptionStatus: string; allowGlobalLeague: boolean; globalLeagueOptOut: boolean | null
}

// Org-medlemskap endres kun ved en admin-handling (inviter/fjerner medlem),
// ikke per sidelast — samme korttids-cache-mønster (per-instans i minne) som
// last_quiz-cachen i toppliste-ruten. Nøkkel: bruker-id.
//
// OM INVALIDERING (vurdert 28. juli 2026): modul-lokal per instans, så
// revalidateTag når den ikke, og tverr-instans-invalidering ville krevd delt
// lagring. Opptil 30 s gammel medlemsliste rett etter en medlemskapsendring er
// bevisst akseptert — se den lengre begrunnelsen ved lastQuizAttemptsCache i
// app/api/toppliste/route.ts.
const MY_ORGS_CACHE_TTL_MS = 30_000
const myOrgsCache = new Map<string, { orgs: OrgResult[]; expires: number }>()

// POST /api/org/my-orgs
// Body: { access_token: string }
// Returnerer alle organisasjoner brukeren er medlem av (uavhengig av rolle).
//
// STATUSKODER (endret 31. juli 2026): ruten svarte tidligere 200 med
// `{ orgs: [] }` på ALLE tre utfallene under — manglende token, ugyldig token
// og oppslagsfeil — altså samme svar som en bruker uten medlemskap. Klienten
// sjekket `r.ok` og kunne umulig se forskjell, så et utløpt token eller en
// transient DB-feil ga «Du er ikke medlem av denne bedriften» PERMANENT for en
// ekte ansatt, ikke bare et glimt. Kun et faktisk oppslag får returnere en
// liste; alt annet er en feil, og en tom liste betyr nå entydig «ingen
// medlemskap». Samme invariant som lib/fetch-result.ts.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const access_token: string | undefined = body?.access_token

  if (!access_token) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(access_token)

  if (authErr || !user) {
    console.error('[my-orgs] getUser feil:', authErr?.message)
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const now = Date.now()
  const cached = myOrgsCache.get(user.id)
  if (cached && cached.expires > now) {
    return NextResponse.json({ orgs: cached.orgs })
  }

  // Én spørring via embedded resource-select i stedet for to sekvensielle
  // (organization_members → organizations) — organization_id har FK mot
  // organizations.id, så PostgREST joiner dette i én runde-tur.
  const { data: memberships, error: memErr } = await supabaseAdmin
    .from('organization_members')
    .select('organization_id, role, global_league_opt_out, organizations(id, name, slug, allow_global_league, subscription_status)')
    .eq('user_id', user.id)

  // Cach IKKE en feilrespons — unngår å servere tomt i 30s ved en transient feil.
  if (memErr) {
    console.error('[my-orgs] medlemskapsoppslag feilet:', memErr.message)
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  }

  // PostgREST-embed for denne many-to-one-relasjonen (organization_id er FK
  // på organization_members-siden) er ETT objekt, ikke et array — verifisert
  // empirisk mot prod 25. juli. Samme mønster gjelder season-summary-rutens
  // profiles(display_name)-embed (også many-to-one via FK); den hadde
  // samme bugklasse (antok array) og ble rettet 25. juli.
  type Row = {
    organization_id: string
    role: string
    global_league_opt_out: boolean | null
    organizations: {
      id: string; name: string; slug: string
      allow_global_league: boolean | null; subscription_status: string | null
    } | null
  }

  const result: OrgResult[] = ((memberships ?? []) as unknown as Row[])
    .map(m => {
      const org = m.organizations
      if (!org) return null
      return {
        orgId:              org.id,
        orgName:            org.name,
        orgSlug:            org.slug,
        isAdmin:            m.role === 'admin',
        subscriptionStatus: org.subscription_status ?? 'active',
        allowGlobalLeague:  org.allow_global_league !== false,
        // null = ikke besvart, true = valgt seg ut, false = valgt seg inn
        globalLeagueOptOut: m.global_league_opt_out ?? null,
      }
    })
    .filter((o): o is NonNullable<typeof o> => o !== null)

  // Enkel opprydding så Map-en ikke vokser ubegrenset (utløpte bruker-nøkler).
  if (myOrgsCache.size > 500) {
    for (const [k, v] of myOrgsCache) if (v.expires <= now) myOrgsCache.delete(k)
  }
  myOrgsCache.set(user.id, { orgs: result, expires: now + MY_ORGS_CACHE_TTL_MS })

  return NextResponse.json({ orgs: result })
}
