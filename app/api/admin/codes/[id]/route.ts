import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'
import { buildAccessCodePatch, type AccessCodeType } from '@/lib/access-code'

// Endrer en eksisterende verdikode. Ruten gjorde tidligere `update(body)` rått
// — samme feilklasse som POST hadde med `insert(body)` fram til 26. juli, bare
// på den andre siden av kodens levetid. Nå går endringen gjennom
// buildAccessCodePatch, som er ren og testdekket: kun is_active, description,
// max_uses og valid_until kan endres, og reglene er de samme som ved
// opprettelse (delte koder beholder tak og frist, private beholder max_uses=1).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  // Reglene er ulike for de to sikkerhetsmodellene, og typen er nettopp ikke
  // noe kalleren får sende med — den må leses av raden som skal endres.
  const { data: existing, error: readError } = await supabaseAdmin
    .from('access_codes').select('code_type').eq('id', id).maybeSingle()
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: 'Kode ikke funnet' }, { status: 404 })

  const built = buildAccessCodePatch(body, existing.code_type as AccessCodeType)
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 })

  // .select('id') etter update: en .eq('id', id) som treffer 0 rader er ikke en
  // feil — error forblir null — men skal ikke late som om koden ble lagret.
  const { data, error } = await supabaseAdmin
    .from('access_codes').update(built.patch).eq('id', id).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) return NextResponse.json({ error: 'Kode ikke funnet' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
