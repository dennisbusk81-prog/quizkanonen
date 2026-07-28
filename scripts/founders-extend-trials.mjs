// Engangsskript (IKKE produksjonskode): forleng B2C Founders-trials til 15. aug 2026.
//
// Gjelder KUN B2C Founders — vi filtrerer på STRIPE_PRICE_FOUNDERS, så org/B2B-
// abonnementer (egne price-IDer) røres aldri.
//
// Standard = DRY-RUN: lister alle Founders-abonnementer med status 'trialing' og
// viser hva som VILLE blitt endret, uten å skrive noe til Stripe.
// Med --commit: setter trial_end til 15. aug 2026 23:59 Europe/Oslo,
// proration_behavior: 'none', og rapporterer suksess/feil per abonnement.
// Med --test-first=N: kjører commit-logikken KUN på de N første abonnementene i
// lista (samme rekkefølge som dry-run viser) og stopper der — resten røres ikke.
// Nyttig for å verifisere webhook-oppførsel på et lite utvalg ekte abonnementer
// før hele lista oppdateres.
//
// Kjøring (Git Bash):
//   STRIPE_SECRET_KEY=sk_live_... STRIPE_PRICE_FOUNDERS=price_... node scripts/founders-extend-trials.mjs
//   STRIPE_SECRET_KEY=sk_live_... STRIPE_PRICE_FOUNDERS=price_... node scripts/founders-extend-trials.mjs --test-first=2
//   STRIPE_SECRET_KEY=sk_live_... STRIPE_PRICE_FOUNDERS=price_... node scripts/founders-extend-trials.mjs --commit

import 'dotenv/config'
import Stripe from 'stripe'

const COMMIT = process.argv.includes('--commit')

// --test-first=N: begrenset test-kjøring på de N første abonnementene.
let TEST_FIRST = null
const testArg = process.argv.find((a) => a.startsWith('--test-first='))
if (testArg) {
  const n = Number(testArg.split('=')[1])
  if (!Number.isInteger(n) || n < 1) {
    console.error(`Ugyldig --test-first-verdi: "${testArg.split('=')[1]}". Må være et heltall >= 1.`)
    process.exit(1)
  }
  TEST_FIRST = n
}

// Skriver vi til Stripe? Ja ved --commit eller --test-first. --test-first
// begrenser antallet; --commit alene kjører hele lista.
const WRITE = COMMIT || TEST_FIRST !== null

const SECRET = process.env.STRIPE_SECRET_KEY
const FOUNDERS_PRICE_ID = process.env.STRIPE_PRICE_FOUNDERS

if (!SECRET || !FOUNDERS_PRICE_ID) {
  console.error('Mangler miljøvariabler. Sett både STRIPE_SECRET_KEY og STRIPE_PRICE_FOUNDERS.')
  console.error('Disse ligger i Vercel (ikke i .env.local lokalt). Eksempel:')
  console.error('  STRIPE_SECRET_KEY=sk_live_... STRIPE_PRICE_FOUNDERS=price_... node scripts/founders-extend-trials.mjs')
  process.exit(1)
}

// Mål: 15. august 2026 kl 23:59 Europe/Oslo (CEST, +02:00) som Unix-sekunder.
const TARGET_TRIAL_END = Math.floor(new Date('2026-08-15T23:59:00+02:00').getTime() / 1000)

const stripe = new Stripe(SECRET, { apiVersion: '2026-03-25.dahlia' })

const fmt = (unixSeconds) =>
  unixSeconds
    ? new Intl.DateTimeFormat('nb-NO', {
        day: 'numeric', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo',
      }).format(new Date(unixSeconds * 1000))
    : '—'

async function main() {
  const modeLabel = TEST_FIRST !== null
    ? `TEST-KJØRING (commit på de ${TEST_FIRST} første — resten røres ikke)`
    : COMMIT
      ? 'COMMIT (skriver til Stripe)'
      : 'DRY-RUN (ingen endringer)'
  console.log(`\nMode:   ${modeLabel}`)
  console.log(`Konto:  ${SECRET.startsWith('sk_live') ? 'LIVE' : 'TEST'}`)
  console.log(`Price:  ${FOUNDERS_PRICE_ID}`)
  console.log(`Ny trial_end: ${fmt(TARGET_TRIAL_END)}  (unix ${TARGET_TRIAL_END})\n`)

  // Hent alle 'trialing'-abonnementer på Founders-prisen (auto-paginering).
  const subs = []
  for await (const sub of stripe.subscriptions.list({
    price: FOUNDERS_PRICE_ID,
    status: 'trialing',
    limit: 100,
    expand: ['data.customer'],
  })) {
    subs.push(sub)
  }

  if (subs.length === 0) {
    console.log('Ingen trialing Founders-abonnementer funnet. Ingenting å gjøre.')
    return
  }

  console.log(`Fant ${subs.length} trialing Founders-abonnement(er):\n`)

  const results = []
  let processed = 0 // antall abonnementer vi faktisk har behandlet (skrevet/forsøkt)
  for (const sub of subs) {
    // Test-kjøring: stopp etter de N første — resten røres ikke.
    if (TEST_FIRST !== null && processed >= TEST_FIRST) break

    const email = (sub.customer && typeof sub.customer === 'object' && !sub.customer.deleted)
      ? (sub.customer.email ?? '(ingen e-post)')
      : '(ukjent kunde)'
    const already = sub.trial_end === TARGET_TRIAL_END

    console.log(`  ${sub.id}  |  ${email}`)
    console.log(`      nå:  ${fmt(sub.trial_end)}   →   ny: ${fmt(TARGET_TRIAL_END)}${already ? '  (allerede satt)' : ''}`)

    if (!WRITE) {
      results.push({ id: sub.id, email, status: already ? 'ville hoppet over (allerede satt)' : 'ville oppdatert' })
      continue
    }

    processed++

    if (already) {
      results.push({ id: sub.id, email, status: 'HOPPET OVER (allerede satt)' })
      continue
    }

    try {
      await stripe.subscriptions.update(sub.id, {
        trial_end: TARGET_TRIAL_END,
        proration_behavior: 'none',
      })
      results.push({ id: sub.id, email, status: 'OK' })
      console.log('      ✓ oppdatert')
    } catch (err) {
      results.push({ id: sub.id, email, status: `FEIL: ${err?.message ?? err}` })
      console.log(`      ✗ FEIL: ${err?.message ?? err}`)
    }
  }

  console.log('\n—— Oppsummering ——')
  for (const r of results) {
    console.log(`  ${r.status.padEnd(34)}  ${r.id}  ${r.email}`)
  }

  if (TEST_FIRST !== null) {
    const untouched = subs.length - processed
    console.log(`\n⚠️  BEGRENSET TEST-KJØRING: endret ${processed} av ${subs.length} abonnement(er).`)
    console.log(`   ${untouched} abonnement(er) ble IKKE rørt.`)
    console.log('   Verifiser webhook-oppførsel (trial_end lagret, ingen uventet e-post/statusendring)')
    console.log('   på de endrede over. Kjør deretter med --commit for å oppdatere resten.')
  } else if (!WRITE) {
    console.log('\nDette var en DRY-RUN. Kjør på nytt med --commit for å faktisk oppdatere.')
  }
}

main().catch((err) => {
  console.error('Uventet feil:', err)
  process.exit(1)
})
