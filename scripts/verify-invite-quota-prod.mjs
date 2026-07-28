// Read-only kontroll: klassifiserer ALLE eksisterende organisasjoner med den
// samme rene funksjonen ruten bruker (lib/invite-quota.ts), og viser hvilken
// sendekvote de faktisk får etter innstrammingen. Gjør INGEN skriv.
//
//   node scripts/verify-invite-quota-prod.mjs
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { resolveInviteQuota } from '../lib/invite-quota.ts'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: orgs, error } = await supabase
  .from('organizations')
  .select('id, name, created_at, subscription_status')
  .order('created_at', { ascending: true })

if (error) { console.error('SELECT feilet:', error.message); process.exit(1) }

console.log(`Organisasjoner: ${orgs.length}\n`)

for (const org of orgs) {
  const { count } = await supabase
    .from('organization_members')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', org.id)

  const quota = resolveInviteQuota({
    subscriptionStatus: org.subscription_status,
    createdAt: org.created_at,
    memberCount: count ?? 0,
  })

  const ageDays = Math.floor((Date.now() - Date.parse(org.created_at)) / 86_400_000)
  console.log(
    `${org.name.padEnd(20)} status=${String(org.subscription_status).padEnd(9)} ` +
    `alder=${String(ageDays).padStart(3)}d medlemmer=${String(count ?? 0).padStart(3)} ` +
    `→ ${quota.tier.toUpperCase()} (${quota.perCall}/kall, ${quota.perDay}/døgn)`
  )
}
