// Engangsskript (IKKE produksjonskode): forleng de 6 Founders-brukerne som falt
// utenfor scripts/founders-extend-trials.mjs 18. juli 2026.
//
// BAKGRUNN
// Det opprinnelige skriptet enumererte `status:'trialing'` og kjørte 18. juli
// kl. 15:04–15:11 CEST. Disse 6 hadde da allerede konvertert til `active` og
// feilet (ingen av dem har noensinne registrert kort), så de sto i `past_due`
// eller `canceled` og var usynlige for lista. 77 andre ble forlenget.
//
// TO ULIKE METODER — statusen avgjør:
//   past_due  → subscriptions.update({ trial_end })     (5 stk)
//   canceled  → subscriptions.create({ trial_end })     (1 stk — Magnus)
// Et kansellert abonnement kan ikke gjenopplives i Stripe; det må erstattes.
//
// ÅPNE FAKTURAER VOIDES FØRST
// Hver av dem har en åpen 49-kr-faktura med aktiv purring (`auto_advance:true`,
// neste forsøk innen 1–2 døgn). Uten void fortsetter purringen etter
// forlengelsen, og når forsøkene er oppbrukt kansellerer Stripe abonnementet —
// nøyaktig slik Magnus' ble kansellert 27. juli. Da ville forlengelsen blitt
// reversert av seg selv. Void stopper purringen og nullstiller kravet.
//
// E-POST: ingen av operasjonene treffer en webhook-gren som sender e-post.
//   - invoice.voided                → ikke håndtert av webhooken
//   - customer.subscription.created → ikke håndtert av webhooken
//   - customer.subscription.updated → B2C trialing-grenen skriver kun DB
//   - 0-kr-fakturaen ved create har billing_reason 'subscription_create',
//     og invoice.payment_succeeded reagerer kun på 'subscription_cycle'
//   - invoice.payment_failed (om en purring rekker å gå før void) har
//     attempt_count >= 6 og stoppes av dedupe-sperren (kun forsøk 1 varsler)
//
//   node scripts/founders-extend-stragglers.mjs           # DRY-RUN (standard)
//   node scripts/founders-extend-stragglers.mjs --apply   # skriver til Stripe + DB

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

const APPLY = process.argv.includes('--apply')

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2026-03-25.dahlia' })
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const FOUNDERS_PRICE = 'price_1ThaC3CuFvuZpvNY31Zfs6zr'
// 15. august 2026 kl 23:59 Europe/Oslo — identisk konstant som i founders-extend-trials.mjs
const TARGET_TRIAL_END = Math.floor(new Date('2026-08-15T23:59:00+02:00').getTime() / 1000)

const oslo = s => s
  ? new Intl.DateTimeFormat('nb-NO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Oslo' }).format(new Date(s * 1000))
  : '—'

// ── De 6. Eksplisitt liste, ikke et filter. ─────────────────────────────────
const TARGETS = [
  { navn: 'Magnus Rolstad',          epost: 'magnus.rolstad@gmail.com',    sub: 'sub_1ThmABCuFvuZpvNYxh2awMSZ', kunde: 'cus_UhAV6hO2ZObJPx' },
  { navn: 'Anette Fuglsang Nielsen', epost: 'anettefnielsen@hotmail.com',  sub: 'sub_1Tj0URCuFvuZpvNYMW40k4nV', kunde: 'cus_UiRNhV2YPV9SOM' },
  { navn: 'Anna Johansson',          epost: 'pluttisanna12@gmail.com',     sub: 'sub_1TjKp3CuFvuZpvNYwJ1QGkUK', kunde: 'cus_UimNJOW26XkLxc' },
  { navn: 'Espen Jakobsen',          epost: 'esjak74@gmail.com',           sub: 'sub_1TjOOXCuFvuZpvNY263ESXSk', kunde: 'cus_Uiq4fykYIG7BdP' },
  { navn: 'Simen Sundt',             epost: 'sundts@gmail.com',            sub: 'sub_1TjcHpCuFvuZpvNYPACt2kgW', kunde: 'cus_Uj4QptG1o6RRgW' },
  { navn: 'Martin Andresen',         epost: 'martin.andresen89@gmail.com', sub: 'sub_1TjdsuCuFvuZpvNYzydzYcJ1', kunde: 'cus_Uj65npSart0awo' },
]

// ── Harde sperrer: disse skal ALDRI røres. ─────────────────────────────────
const FORBUDT = new Set(['simenwahlj@gmail.com', 'williandersen@gmail.com'])
const FORBUDTE_SUBS = new Set([
  'sub_1TiYNPCuFvuZpvNY5i07k6dM', 'sub_1TiYNPCuFvuZpvNYRyvdE7Yw', // Simen Jørgensen
  'sub_1TjauLCuFvuZpvNYppuwRpzr',                                  // William Andersen
  'sub_1TjcHqCuFvuZpvNYm4ySNKGq',                                  // Simen Sundt sitt DUPLIKAT (kansellert 19. juli)
])

for (const t of TARGETS) {
  if (FORBUDT.has(t.epost)) throw new Error(`SPERRE: ${t.epost} står på forbudt-lista`)
  if (FORBUDTE_SUBS.has(t.sub)) throw new Error(`SPERRE: ${t.sub} står på forbudt-lista`)
}
if (TARGETS.length !== 6) throw new Error(`Forventet 6 mål, fant ${TARGETS.length}`)

console.log(`\nMode:   ${APPLY ? 'APPLY (skriver til Stripe + DB)' : 'DRY-RUN (ingen endringer)'}`)
console.log(`Konto:  ${env.STRIPE_SECRET_KEY.startsWith('sk_live') ? 'LIVE' : 'TEST'}`)
console.log(`Price:  ${FOUNDERS_PRICE}`)
console.log(`Ny trial_end: ${oslo(TARGET_TRIAL_END)}  (unix ${TARGET_TRIAL_END})\n`)

const resultater = []

for (const t of TARGETS) {
  console.log(`── ${t.navn}  <${t.epost}>`)

  const sub = await stripe.subscriptions.retrieve(t.sub, { expand: ['customer'] })

  // Identitetssjekk: abonnementet må tilhøre riktig kunde med riktig e-post og pris.
  if (sub.customer.id !== t.kunde) throw new Error(`${t.sub}: kunde-mismatch (${sub.customer.id} != ${t.kunde})`)
  if ((sub.customer.email ?? '').toLowerCase() !== t.epost) throw new Error(`${t.sub}: e-post-mismatch (${sub.customer.email})`)
  if (sub.items.data[0]?.price?.id !== FOUNDERS_PRICE) throw new Error(`${t.sub}: feil pris`)

  if (sub.trial_end === TARGET_TRIAL_END && sub.status === 'trialing') {
    console.log('   allerede forlenget og trialing — hopper over\n')
    resultater.push({ navn: t.navn, status: 'HOPPET OVER (allerede riktig)' })
    continue
  }

  // ── Steg 1: void åpne, ubetalte sykluskrav på kunden ────────────────────
  const invs = await stripe.invoices.list({ customer: t.kunde, limit: 50 })
  const aaVoide = invs.data.filter(i =>
    i.status === 'open' && i.amount_paid === 0 && i.billing_reason === 'subscription_cycle'
  )

  for (const inv of aaVoide) {
    console.log(`   void faktura ${inv.id}  (${inv.total / 100} kr, forsøk ${inv.attempt_count}, neste ${oslo(inv.next_payment_attempt)})`)
    if (APPLY) {
      await stripe.invoices.voidInvoice(inv.id)
      console.log('      ✓ voidet')
    }
  }
  if (aaVoide.length === 0) console.log('   ingen åpne fakturaer å voide')

  // ── Steg 2: forleng — metoden avhenger av status ────────────────────────
  const kanOppdateres = !['canceled', 'incomplete_expired'].includes(sub.status)

  if (kanOppdateres) {
    console.log(`   METODE: UPDATE  (status ${sub.status})`)
    console.log(`      trial_end ${oslo(sub.trial_end)}  →  ${oslo(TARGET_TRIAL_END)}`)
    if (APPLY) {
      const oppdatert = await stripe.subscriptions.update(t.sub, {
        trial_end: TARGET_TRIAL_END,
        proration_behavior: 'none',
      })
      console.log(`      ✓ oppdatert — ny status: ${oppdatert.status}`)
      resultater.push({ navn: t.navn, status: 'OK (update)', sub: oppdatert.id, nyStatus: oppdatert.status })
    } else {
      resultater.push({ navn: t.navn, status: 'ville oppdatert', sub: t.sub })
    }

    // De 5 får premium tilbake automatisk: subscription.updated → trialing →
    // webhooken setter premium_status=true. Men personal_stripe_subscription_id
    // ble nullet av webhooken i juli, og skal peke på abonnementet igjen for å
    // være konsistent med de 77 øvrige.
    console.log(`      DB: personal_stripe_subscription_id → ${t.sub}`)
    if (APPLY) {
      const { error } = await supabase.from('profiles')
        .update({ personal_stripe_subscription_id: t.sub })
        .eq('stripe_customer_id', t.kunde)
      if (error) console.log(`      ✗ DB-feil: ${error.message}`)
      else console.log('      ✓ DB oppdatert')
    }

  } else {
    console.log(`   METODE: CREATE NYTT ABONNEMENT  (status ${sub.status} — kan ikke gjenopplives)`)
    console.log(`      gammelt: ${t.sub} (kansellert ${oslo(sub.canceled_at)}, grunn ${sub.cancellation_details?.reason})`)
    console.log(`      nytt:    price ${FOUNDERS_PRICE}, trial_end ${oslo(TARGET_TRIAL_END)}, save_default_payment_method: off`)

    if (APPLY) {
      const nySub = await stripe.subscriptions.create({
        customer: t.kunde,
        items: [{ price: FOUNDERS_PRICE }],
        trial_end: TARGET_TRIAL_END,
        payment_settings: { save_default_payment_method: 'off' },
      }, {
        idempotencyKey: `founders-straggler-2026-07-28:${t.kunde}`,
      })
      console.log(`      ✓ opprettet ${nySub.id} — status ${nySub.status}, trial_end ${oslo(nySub.trial_end)}`)

      // customer.subscription.created håndteres IKKE av webhooken, så profilen
      // må settes her — ellers får han ikke Premium i appen.
      const { error } = await supabase.from('profiles')
        .update({
          premium_status: true,
          premium_source: 'founders',
          personal_stripe_subscription_id: nySub.id,
        })
        .eq('stripe_customer_id', t.kunde)
      if (error) console.log(`      ✗ DB-feil: ${error.message}`)
      else console.log('      ✓ DB: premium_status=true, premium_source=founders, personal_sub satt')

      resultater.push({ navn: t.navn, status: 'OK (create)', sub: nySub.id, nyStatus: nySub.status })
    } else {
      console.log('      DB: premium_status=true, premium_source=founders, personal_stripe_subscription_id=<ny sub>')
      console.log('      (nødvendig fordi webhooken ikke håndterer subscription.created)')
      resultater.push({ navn: t.navn, status: 'ville opprettet nytt' })
    }
  }
  console.log('')
}

console.log('—— Oppsummering ——')
for (const r of resultater) console.log(`  ${String(r.status).padEnd(28)}  ${r.navn}  ${r.sub ?? ''} ${r.nyStatus ?? ''}`)
if (!APPLY) console.log('\nDette var en DRY-RUN. Ingenting er endret. Kjør med --apply for å utføre.')
