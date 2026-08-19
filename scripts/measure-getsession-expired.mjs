// Måler PREMISSET bak Gap 1: er getSession() nettverksbundet når access-tokenet
// er utløpt? Hvis ja, kan en treg linje presse den over 1500 ms-grensen i
// app/leaderboard/[id]/page.tsx, og «falsk positiv» er en reell risiko for et
// ekte org-medlem — ikke bare en teoretisk.
//
// Ingen ekte konto, ingen prod-trafikk: både lagring og fetch er stubbet, så
// klienten snakker aldri med noe. Kjør: node scripts/measure-getsession-expired.mjs
import { createClient } from '@supabase/supabase-js'

const REF = 'testref'
const STORAGE_KEY = `sb-${REF}-auth-token`

function makeSession(secondsFromNow) {
  const exp = Math.floor(Date.now() / 1000) + secondsFromNow
  return {
    access_token: 'fake.access.token',
    refresh_token: 'fake-refresh-token',
    token_type: 'bearer',
    expires_at: exp,
    expires_in: secondsFromNow,
    user: { id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated' },
  }
}

function makeClient({ session, refreshDelayMs }) {
  const store = new Map([[STORAGE_KEY, JSON.stringify(session)]])
  const calls = []
  const fakeFetch = async (url, init) => {
    calls.push(String(url))
    await new Promise(r => setTimeout(r, refreshDelayMs))
    return new Response(JSON.stringify({
      access_token: 'fresh.access.token',
      refresh_token: 'fresh-refresh-token',
      token_type: 'bearer',
      expires_in: 3600,
      user: session.user,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const client = createClient(`https://${REF}.supabase.co`, 'fake-anon-key', {
    auth: {
      storageKey: STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: {
        getItem: k => store.get(k) ?? null,
        setItem: (k, v) => { store.set(k, v) },
        removeItem: k => { store.delete(k) },
      },
    },
    global: { fetch: fakeFetch },
  })
  return { client, calls }
}

async function measure(label, { session, refreshDelayMs }) {
  const { client, calls } = makeClient({ session, refreshDelayMs })
  const t0 = performance.now()
  const { data, error } = await client.auth.getSession()
  const ms = performance.now() - t0
  console.log(`${label}`)
  console.log(`   varighet:       ${ms.toFixed(0)} ms`)
  console.log(`   nettverkskall:  ${calls.length}${calls.length ? '  → ' + calls[0].replace(`https://${REF}.supabase.co`, '') : ''}`)
  console.log(`   sesjon tilbake: ${data.session ? 'ja' : 'nei'}${error ? '  feil: ' + error.message : ''}`)
  console.log(`   over 1500 ms:   ${ms > 1500 ? 'JA — grensen ville slått inn' : 'nei'}`)
  console.log()
  return ms
}

console.log('\n=== getSession(): ferskt vs. utløpt token ===\n')
await measure('A. FERSKT token (Dennis\' throttling-test var i denne tilstanden)',
  { session: makeSession(3600), refreshDelayMs: 3000 })
await measure('B. UTLØPT token, treg fornyelse (3000 ms)',
  { session: makeSession(-60), refreshDelayMs: 3000 })
await measure('C. UTLØPT token, rask fornyelse (200 ms)',
  { session: makeSession(-60), refreshDelayMs: 200 })

// ── Henger de tre forbrukerne SAMMEN? ───────────────────────────────────────
// Påstand jeg tidligere kun resonnerte meg til: fetchData, loadSession og
// ProfileProvider bruker samme klientinstans (lib/supabase.ts), så én treg
// fornyelse rammer alle tre samtidig — ikke bare den ene som ble stubbet i
// preview-testen. Her måles det.
console.log('=== tre samtidige getSession() på SAMME klient, utløpt token ===\n')
{
  const session = makeSession(-60)
  const { client, calls } = makeClient({ session, refreshDelayMs: 3000 })
  const t0 = performance.now()
  const results = await Promise.all([
    client.auth.getSession().then(() => performance.now() - t0),
    client.auth.getSession().then(() => performance.now() - t0),
    client.auth.getSession().then(() => performance.now() - t0),
  ])
  results.forEach((ms, i) => console.log(`   forbruker ${i + 1}: ${ms.toFixed(0)} ms`))
  console.log(`   nettverkskall totalt: ${calls.length}`)
  const alle = results.every(ms => ms > 1500)
  console.log(`   alle tre over 1500 ms: ${alle ? 'JA — de henger sammen' : 'nei'}\n`)
}
