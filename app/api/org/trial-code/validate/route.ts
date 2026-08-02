import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { ipScopeId } from '@/lib/redeem-throttle'
import {
  ORG_TRIAL_CODE_MISS_ACTION,
  ORG_TRIAL_CODE_WINDOW_MS,
  decideOrgTrialCodeThrottle,
} from '@/lib/org-trial-code-throttle'

// POST /api/org/trial-code/validate — sjekk en promo-kode på registreringssiden.
// Returnerer pakke + trial-dager hvis koden er gyldig og ubrukt. Markerer IKKE
// koden som brukt — det skjer først ved innløsning i org-founders-activate.
export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  // Førstelag: burst-brems i minnet. Lever per serverless-instans, så den er
  // ikke grensen vi lener oss på — kun et billig filter foran DB-arbeidet.
  if (!rateLimit(`trial-code-validate:${ip}`, 15, 60_000).success) {
    return NextResponse.json({ error: 'For mange forsøk. Prøv igjen om litt.' }, { status: 429 })
  }

  let body: { code?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const code = body.code?.trim().toUpperCase()
  if (!code) return NextResponse.json({ error: 'Mangler kode' }, { status: 400 })

  // ── Andrelag: vedvarende bom-telling (lib/org-trial-code-throttle.ts) ──────
  // Samme mønster som /api/codes/redeem: tellingen ligger i admin_actions, som
  // overlever kalde starter. Kun bom telles — en gyldig kode slått opp av tjue
  // kolleger bak samme NAT-IP gir null treff.
  const ipScope = ipScopeId(ip)
  const since = new Date(Date.now() - ORG_TRIAL_CODE_WINDOW_MS).toISOString()

  const { count: misses, error: countError } = await supabaseAdmin
    .from('admin_actions')
    .select('id', { count: 'exact', head: true })
    .eq('action_type', ORG_TRIAL_CODE_MISS_ACTION)
    .eq('scope_id', ipScope)
    .gte('created_at', since)

  // Kan vi ikke lese forbruket, vet vi ikke om dette er forsøk nr. 2 eller
  // nr. 200. Samme linje som /api/codes/redeem: en DB-feil skal ikke være
  // omveien rundt grensen. Her koster det heller ingenting å feile lukket —
  // kodeoppslaget under ville uansett feilet.
  if (countError) {
    console.error('[org/trial-code] kunne ikke telle tidligere kodeforsøk:', countError.message)
    return NextResponse.json(
      { error: 'Kunne ikke verifisere koden akkurat nå. Prøv igjen om litt.' },
      { status: 503 },
    )
  }

  const decision = decideOrgTrialCodeThrottle(misses ?? 0)
  if (!decision.allowed) {
    return NextResponse.json({ error: decision.message }, { status: 429 })
  }

  const { data: row, error: lookupError } = await supabaseAdmin
    .from('org_trial_codes')
    .select('code, package, trial_days, used_at')
    .eq('code', code)
    .maybeSingle()

  // Feilen ble tidligere svelget: en DB-hikke ga row=null, som ble til «Ukjent
  // kode». Med bom-telling på plass ville det vært verre enn misvisende — en
  // ekte kundes GYLDIGE kode ville blitt bokført som gjetting.
  if (lookupError) {
    console.error('[org/trial-code] kunne ikke slå opp koden:', lookupError.message)
    return NextResponse.json(
      { error: 'Kunne ikke verifisere koden akkurat nå. Prøv igjen om litt.' },
      { status: 503 },
    )
  }

  if (!row) {
    // Bokfør bommet. Kun her — «allerede brukt» under telles bevisst ikke, for
    // der FINNES koden og brukeren skal se feilmeldingen sin hver gang.
    const { error: logErr } = await supabaseAdmin.from('admin_actions').insert({
      action_type: ORG_TRIAL_CODE_MISS_ACTION,
      scope_type: 'ip',
      scope_id: ipScope,
    })
    if (logErr) console.error('[org/trial-code] kunne ikke bokføre kodeforsøk:', logErr.message)

    return NextResponse.json({ valid: false, error: 'Ukjent kode.' }, { status: 404 })
  }
  if (row.used_at) {
    return NextResponse.json({ valid: false, error: 'Koden er allerede brukt.' }, { status: 409 })
  }

  return NextResponse.json({ valid: true, package: row.package, trial_days: row.trial_days })
}
