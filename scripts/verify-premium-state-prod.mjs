// Read-only sammenligning: den nye utledede premium-tilstanden
// (lib/premium-state.ts) mot dagens denormaliserte profiles.premium_status.
//
// Formål: bevise at innføringen av den autoritative modellen IKKE endrer hvem
// som har Premium i dag. Avvik skal være null før noe pushes.
//
//   node scripts/verify-premium-state-prod.mjs
//
// Gjør INGEN skriv. Stripe-oppslag er lesende, og hoppes over hvis nøkkelen
// mangler — profiler uten stripe_customer_id kan verifiseres helt uten Stripe,
// og rapporteres separat fra dem som ikke kan det.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { decidePremiumState } from '../lib/premium-state.ts'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2026-03-25.dahlia' })
  : null

const { data: profiles, error } = await supabase
  .from('profiles')
  .select('id, premium_status, premium_source, premium_expires_at, org_premium_grace_until, stripe_customer_id')

if (error) { console.error('SELECT feilet:', error.message); process.exit(1) }

// ── Org-dekning for alle, i to spørringer i stedet for én per bruker ─────────
const { data: memberships } = await supabase.from('organization_members').select('user_id, organization_id')
const { data: orgs } = await supabase.from('organizations').select('id, name, subscription_status')
const liveOrgs = new Map((orgs ?? []).filter(o => ['active', 'trialing'].includes(o.subscription_status)).map(o => [o.id, o.name]))

const orgByUser = new Map()
for (const m of memberships ?? []) {
  if (!liveOrgs.has(m.organization_id)) continue
  const cur = orgByUser.get(m.user_id) ?? { orgIds: [], orgNames: [] }
  cur.orgIds.push(m.organization_id)
  cur.orgNames.push(liveOrgs.get(m.organization_id))
  orgByUser.set(m.user_id, cur)
}

// ── Kode-dekning ─────────────────────────────────────────────────────────────
const { data: redemptions, error: redErr } = await supabase
  .from('access_code_redemptions')
  .select('id, user_id, code_id, expires_at')

if (redErr) {
  console.log(`access_code_redemptions ikke tilgjengelig (${redErr.code}) — migrasjonen er ikke kjørt ennå.`)
  console.log('Ingen kode er noensinne løst inn, så kode-dekning = null for alle. Fortsetter.\n')
}
const codeByUser = new Map((redemptions ?? []).map(r => [r.user_id, r]))

const unknownCustomers = []
let verified = 0
let needsStripe = 0
const mismatches = []

for (const p of profiles) {
  const org = orgByUser.get(p.id) ?? { orgIds: [], orgNames: [] }
  const orgCoverage = { ...org, graceUntil: p.org_premium_grace_until ?? null }
  const red = codeByUser.get(p.id)
  const code = red ? { redemptionId: red.id, codeId: red.code_id, expiresAt: red.expires_at } : null

  let stripeCoverage = null
  if (p.stripe_customer_id) {
    if (!stripe) { needsStripe++; continue }
    let active, trialing
    try {
      ;[active, trialing] = await Promise.all([
        stripe.subscriptions.list({ customer: p.stripe_customer_id, limit: 1, status: 'active' }),
        stripe.subscriptions.list({ customer: p.stripe_customer_id, limit: 1, status: 'trialing' }),
      ])
    } catch (err) {
      if (err?.code === 'resource_missing') {
        // Kunde-id-en finnes ikke i live-modus — nesten sikkert et levn fra
        // test-modus før 23. juni. Produksjonskoden behandler dette som «ingen
        // dekning» (getStripeCoverage i lib/premium-state-io.ts og
        // /api/stripe/subscription gjør begge det), så det gjør vi her også.
        unknownCustomers.push(p.id)
        active = { data: [] }
        trialing = { data: [] }
      } else {
        throw err
      }
    }
    const sub = active.data[0] ?? trialing.data[0] ?? null
    if (sub) {
      stripeCoverage = {
        subscriptionId: sub.id,
        status: sub.status,
        trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
        currentPeriodEnd: sub.items.data[0]?.current_period_end
          ? new Date(sub.items.data[0].current_period_end * 1000).toISOString()
          : null,
        pauseResumesAt: sub.pause_collection?.resumes_at
          ? new Date(sub.pause_collection.resumes_at * 1000).toISOString()
          : null,
      }
    }
  }

  const state = decidePremiumState({ code, stripe: stripeCoverage, org: orgCoverage })
  verified++

  if (state.isPremium !== (p.premium_status === true)) {
    mismatches.push({
      id: p.id,
      dagens: p.premium_status,
      utledet: state.isPremium,
      source: p.premium_source,
      harKunde: !!p.stripe_customer_id,
      kilder: Object.entries(state.sources).filter(([, v]) => v).map(([k]) => k).join(','),
    })
  }
}

console.log(`Profiler totalt:            ${profiles.length}`)
console.log(`Verifisert:                 ${verified}`)
console.log(`Hoppet over (krever Stripe): ${needsStripe}`)
console.log(`AVVIK:                      ${mismatches.length}\n`)

for (const m of mismatches) {
  console.log(`  ${m.id}  dagens=${m.dagens}  utledet=${m.utledet}  source=${m.source}  kunde=${m.harKunde}  kilder=[${m.kilder}]`)
}

if (needsStripe > 0) {
  console.log(
    `\n${needsStripe} profiler har stripe_customer_id og kan ikke verifiseres uten ` +
    'STRIPE_SECRET_KEY i .env.local. Kjør på nytt når nøkkelen er på plass.'
  )
}

process.exit(mismatches.length === 0 ? 0 : 1)
