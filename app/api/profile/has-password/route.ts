import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'

// Avledet erstatning for det skrivbare feltet profiles.has_password.
//
// Forgjengeren, POST /api/auth/mark-password, tok `userId` fra request-body og
// hadde ingen auth-sjekk i det hele tatt — hvem som helst kunne sette
// has_password=true på en vilkårlig konto. Se
// supabase/migrations/20260804000000_derive_has_password.sql.
//
// Den strukturelle forskjellen er ikke at denne ruten er «bedre validert»:
// den er LESE-ONLY, og bruker-id-en kommer utelukkende fra det verifiserte
// tokenet. Det finnes ingen parameter en kaller kan bruke til å peke svaret mot
// noen andre — verken i body, query eller header. Kommer det en gang et behov
// for å slå opp en ANNEN bruker, hører det hjemme bak admin-auth
// (/api/admin/users/[id] gjør allerede nettopp det), ikke som et felt her.
//
// GET, ikke POST, av samme grunn som avmeldingslenkene ble lagt om 1. august:
// formen på ruten skal fortelle sannheten om hva den gjør.
export async function GET(request: NextRequest) {
  // Samme mønster som premium-status: brems kun når vi faktisk kan skille
  // klienter fra hverandre. Uten x-forwarded-for ville alle delt én bøtte.
  const ip = request.headers.get('x-forwarded-for')
  if (ip && !rateLimit(`has-password:${ip}`, 60, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { data, error } = await supabaseAdmin.rpc('auth_has_password', { p_user_id: user.id })

  if (error) {
    console.error('[profile/has-password] auth_has_password feilet:', error.message)
    return NextResponse.json({ error: 'Kunne ikke hente' }, { status: 500 })
  }

  return NextResponse.json({ hasPassword: data === true })
}
