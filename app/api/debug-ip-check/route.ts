import { NextRequest, NextResponse } from 'next/server'
import { ipAddress } from '@vercel/functions'

// MIDLERTIDIG DEBUG-RUTE — 2. august 2026.
//
// Formål: slå fast EMPIRISK hvilken IP-header Vercel faktisk fyller ut, og
// hvilken en avsender kan overstyre selv. Skal SLETTES så snart målingen er
// gjort. Ruten rører ingen data: ingen DB, ingen Stripe, ingen e-post, ingen
// skriving noe sted. Den leser fem headerverdier og logger dem.
//
// `?k=` er kun en spam-sperre så tilfeldig trafikk ikke fyller loggen mens
// ruten står ute. Den er IKKE en hemmelighet og beskytter ingenting.

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('k') !== 'a7f31c9e') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const xff = request.headers.get('x-forwarded-for')
  const hops = (xff ?? '').split(',').map((h) => h.trim()).filter(Boolean)

  console.log('IP-HEADER-TEST', JSON.stringify({
    xRealIp: request.headers.get('x-real-ip'),
    xffFull: xff,
    xffFirstHop: hops[0] ?? null,
    xffLastHop: hops[hops.length - 1] ?? null,
    vercelIpAddress: ipAddress(request) ?? null,
  }))

  return NextResponse.json({ ok: true })
}
