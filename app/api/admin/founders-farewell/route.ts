import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/email'
import { foundersFarewellEmail } from '@/lib/email-templates'
import { dispatchInBatches } from '@/lib/notify-dispatch'
import { EMAIL_BATCH_SIZE } from '@/lib/email-batch'
import farewellList from '@/lib/founders-farewell-list.json'

// Engangs-utsendelse til Founders-kohorten, formiddag 15. august 2026.
//
// BEVISST IKKE koblet til quiz-åpnings-deteksjonen i notify-subscribers/
// send-reminders/send-push: målgruppen er den FASTE listen materialisert
// 11. august (lib/founders-farewell-list.json, skrevet av
// scripts/founders-shutdown-materialize.mjs), ikke et dynamisk filter.
//
// Står med vilje IKKE i vercel.json — en uregistrert rute kjører aldri av seg
// selv. Trigges manuelt av Dennis med:
//
//   curl -X POST https://www.quizkanonen.no/api/admin/founders-farewell \
//     -H "Authorization: Bearer $CRON_SECRET"
//
// (legg til ?dry=1 for å se hva som VILLE blitt sendt, uten å sende noe)
//
// GJENOPPTAKBAR: hver levert mottaker stemples i admin_actions
// (action_type='founders_farewell_email', scope_id=bruker-id) — samme
// varige telling som invite-kvoten og verdikode-bremsen, den overlever
// kalde starter. Kjøres ruten på nytt, sendes kun til de som ikke er
// stemplet. Stemplingen skjer PER BATCH underveis (dispatchInBatches),
// så et avbrudd aldri gir dobbeltsending ved neste kjøring.

export const maxDuration = 60

const FAREWELL_ACTION = 'founders_farewell_email'
const WORK_BUDGET_MS = 45_000
const BATCH_INTERVAL_MS = 1_000

// Samme livsdefinisjon som lib/subscription-lifecycle.ts — past_due/unpaid er
// abonnement Stripe fortsatt krever inn, altså en konvertert kunde.
const CONVERTED_STATUSES = ['active', 'past_due', 'unpaid']

type Entry = {
  userId: string | null
  email: string | null
  displayName: string | null
  customerId: string
  subscriptionId: string
  trialEnd: string | null
}

// KRAV 1 — fersk sjekk ved sendingstidspunkt, ikke blind tillit til listen.
// Listen er fra 11. august; noen kan konvertere natt til 15. eller samme
// morgen. Har kunden fått et ANNET levende abonnement siden materialiseringen
// (aktivt/innkrevd, eller en ny trial på en annen pris — slik rad E-checkout
// med verdikode lager), skal de IKKE ha «prøveperioden din avsluttes i dag».
//
// Fail-safe ved Stripe-feil: vi vet da ikke om de har konvertert, og å sende
// takke-e-posten til en fersk betalende kunde er verre enn at én mottaker får
// den i en senere kjøring — mottakeren HOPPES OVER uten stempling, og plukkes
// opp av neste kjøring.
async function hasConvertedSinceMaterialization(
  stripe: Stripe,
  entry: Entry,
  foundersPriceId: string,
): Promise<boolean | null> {
  try {
    const subs = await stripe.subscriptions.list({
      customer: entry.customerId, status: 'all', limit: 10,
    })
    return subs.data.some(s =>
      s.id !== entry.subscriptionId &&
      (CONVERTED_STATUSES.includes(s.status) ||
        (s.status === 'trialing' && s.items.data[0]?.price?.id !== foundersPriceId))
    )
  } catch (err) {
    console.error(`[founders-farewell] konverteringssjekk feilet for ${entry.userId}:`, err)
    return null
  }
}

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dryRun = request.nextUrl.searchParams.get('dry') === '1'
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })

  const entries = (farewellList.entries as Entry[]).filter(e => e.userId && e.email)
  const invalid = (farewellList.entries as Entry[]).length - entries.length
  if (invalid > 0) {
    console.error(`[founders-farewell] ${invalid} rader i listen mangler userId/email — de sendes ikke`)
  }

  // Allerede stemplet = levert i en tidligere kjøring.
  const { data: stampedRows, error: stampedErr } = await supabaseAdmin
    .from('admin_actions')
    .select('scope_id')
    .eq('action_type', FAREWELL_ACTION)
  if (stampedErr) {
    // Uten stempel-lesing kan vi ikke vite hvem som alt har fått e-posten —
    // å fortsette ville risikert dobbeltsending til alle. Stopp.
    console.error('[founders-farewell] kunne ikke lese stempler:', stampedErr.message)
    return NextResponse.json({ error: 'Kunne ikke lese leveringsstatus' }, { status: 500 })
  }
  const stamped = new Set((stampedRows ?? []).map(r => r.scope_id))
  const remaining = entries.filter(e => !stamped.has(e.userId))

  // Fersk konverteringssjekk (KRAV 1) for alle gjenstående.
  const toSend: Entry[] = []
  const skippedConverted: Entry[] = []
  const skippedUnknown: Entry[] = []
  for (const entry of remaining) {
    const converted = await hasConvertedSinceMaterialization(stripe, entry, farewellList.foundersPriceId)
    if (converted === true) skippedConverted.push(entry)
    else if (converted === null) skippedUnknown.push(entry)
    else toSend.push(entry)
  }

  for (const e of skippedConverted) {
    console.log(`[founders-farewell] HOPPER ${e.userId} — konverterte etter materialiseringen, skal ikke ha utløps-e-post`)
  }

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      listTotal: entries.length,
      alreadySent: stamped.size,
      wouldSend: toSend.length,
      skippedConverted: skippedConverted.length,
      skippedUnknownConversion: skippedUnknown.length,
    })
  }

  // Konverterte stemples så de aldri vurderes igjen — beslutningen er permanent.
  if (skippedConverted.length > 0) {
    const { error } = await supabaseAdmin.from('admin_actions').insert(
      skippedConverted.map(e => ({
        action_type: FAREWELL_ACTION,
        scope_type: 'user',
        scope_id: e.userId,
        user_id: e.userId,
      }))
    )
    if (error) console.error('[founders-farewell] stempling av konverterte feilet:', error.message)
  }

  // KRAV 2 — Resend-taket (FREE: 100/døgn) gjør at overskytende kan feile.
  // Hver feil fanges eksplisitt per mottaker (onSendError), telles og
  // returneres — og siden feilede aldri stemples, plukker neste kjøring dem
  // opp. Tydelig logg på sendt vs. forsøkt under.
  const resendErrors: { userId: string | null; error: string }[] = []
  const result = await dispatchInBatches<Entry>(
    toSend,
    {
      send: entry => sendEmail({
        to: entry.email!,
        subject: 'Nå begynner den ordentlige sesongen',
        html: foundersFarewellEmail(entry.displayName),
      }),
      stamp: async delivered => {
        const { error } = await supabaseAdmin.from('admin_actions').insert(
          delivered.map(e => ({
            action_type: FAREWELL_ACTION,
            scope_type: 'user',
            scope_id: e.userId,
            user_id: e.userId,
          }))
        )
        if (error) throw new Error(`stempling feilet: ${error.message}`)
      },
      now: () => Date.now(),
      sleep: ms => new Promise(r => setTimeout(r, ms)),
      onSendError: (entry, reason) => {
        const msg = reason instanceof Error ? reason.message : String(reason)
        resendErrors.push({ userId: entry.userId, error: msg })
        console.error(`[founders-farewell] RESEND-FEIL for ${entry.userId}: ${msg}`)
      },
      onStampError: reason => console.error('[founders-farewell] stempling feilet, stopper:', reason),
    },
    {
      batchSize: EMAIL_BATCH_SIZE,
      minBatchIntervalMs: BATCH_INTERVAL_MS,
      budgetMs: WORK_BUDGET_MS,
    },
  )

  const summary = {
    listTotal: entries.length,
    alreadySentBefore: stamped.size,
    attempted: toSend.length,
    sent: result.sent,
    failed: result.failed,
    remaining: result.remaining + skippedUnknown.length,
    skippedConverted: skippedConverted.length,
    skippedUnknownConversion: skippedUnknown.length,
    stoppedOnBudget: result.stoppedOnBudget,
    stampFailed: result.stampFailed,
    resendErrors,
    rerunNeeded: result.remaining + skippedUnknown.length > 0 || result.failed > 0,
  }
  console.log(`[founders-farewell] FERDIG: sendt ${result.sent} av ${toSend.length} forsøkt ` +
    `(${result.failed} feilet, ${result.remaining} ikke forsøkt, ${skippedConverted.length} konverterte hoppet over). ` +
    `Kjør ruten på nytt hvis rerunNeeded=true.`)
  return NextResponse.json(summary)
}
