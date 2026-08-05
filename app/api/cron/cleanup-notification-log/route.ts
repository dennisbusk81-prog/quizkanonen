import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Rydder quiz_notification_log. Radene er en VARSLINGSLOGG, ikke spilledata:
// attempts, season_scores og alt annet er urørt og lever videre som før.
//
// 30 dager er valgt fordi det dekker feilsøking («jeg fikk aldri varsel forrige
// uke»), holder tabellen liten, og gjør avmeldingsspørsmålet irrelevant siden
// radene uansett forsvinner. Dataminimering.
//
// HVORFOR EGEN RUTE, og ikke et tillegg i cleanup-orgs:
// cleanup-orgs har fem tidlige `return`-er, blant annet i normaltilfellet
// «ingen forlatte orger». En prune lagt til på slutten der ville nesten aldri
// kjørt, og feilet stille — nøyaktig den feilformen denne tabellen finnes for
// å lukke. Lagt øverst ville den virket, men vært koblet til en rute som
// returnerer 500 på Stripe-feil.
//
// Registrert i vercel.json (auto-registreres ved deploy). De fleste andre
// cron-rutene ligger manuelt hos cron-job.org; en ny rute som ikke registreres
// noe sted kjører ALDRI og gir null feilspor. Vercel sender
// `Authorization: Bearer <CRON_SECRET>` selv, så vakten under er uendret.
export const maxDuration = 60

const RETENTION_DAYS = 30

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // Ingen konflikt med gjenopptakelsen: varslingsvinduet er 60 minutter,
  // slettegrensen 30 døgn. Loggen for en quiz er urørlig i hele perioden
  // cron-rutene kan komme til å lese den.
  const { error, count } = await supabaseAdmin
    .from('quiz_notification_log')
    .delete({ count: 'exact' })
    .lt('sent_at', cutoff)

  if (error) {
    console.error('[cron/cleanup-notification-log] delete error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.log(`[cron/cleanup-notification-log] slettet=${count ?? 0} eldre enn ${RETENTION_DAYS} dager`)
  return NextResponse.json({ deleted: count ?? 0, olderThan: cutoff })
}
