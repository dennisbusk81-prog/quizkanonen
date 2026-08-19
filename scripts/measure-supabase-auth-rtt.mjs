// Måler EKTE rundturstid til Supabase-auth (eu-west-1) fra denne maskinen.
//
// Grunnlaget for ventegrensen i .claude/QK_OPPDATERING_ORG_SCOPE_TIDSGRENSE_19AUG.md.
// Kjør på nytt før tallet endres — det er målt fra ÉN maskin på ett nett, og
// sier ingenting om p95 i felt. Se forbeholdet i briefen.
//
// Kjør: node --env-file=.env.local scripts/measure-supabase-auth-rtt.mjs
// Read-only: /auth/v1/health er GoTrues helsesjekk — ingen skriving, ingen auth.
const URL_BASE = 'https://nbfyarftteitbjglgfyd.supabase.co'
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY // kun som apikey-header

async function probe(path, init = {}) {
  const t0 = performance.now()
  try {
    const r = await fetch(`${URL_BASE}${path}`, { ...init, headers: { apikey: KEY, ...(init.headers || {}) } })
    return { ms: performance.now() - t0, status: r.status }
  } catch (e) {
    return { ms: performance.now() - t0, status: 'FEIL: ' + e.message }
  }
}

// Kald forbindelse: TLS-håndtrykk inkludert. Dette er tilfellet som ligner mest
// på en mobil som nettopp våknet.
console.log('KALD (nytt TLS-håndtrykk, ny prosess):')
const kald = await probe('/auth/v1/health')
console.log(`   ${kald.ms.toFixed(0)} ms   status ${kald.status}\n`)

console.log('VARM (gjenbrukt forbindelse), 8 målinger:')
const varme = []
for (let i = 0; i < 8; i++) {
  const p = await probe('/auth/v1/health')
  varme.push(p.ms)
  process.stdout.write(`   ${p.ms.toFixed(0)} ms`)
}
console.log('\n')

// POST mot token-endepunktet med et ugyldig refresh-token: samme endepunkt og
// samme metode som en ekte fornyelse, men kan ikke lykkes. Måler serverarbeidet
// en fornyelse faktisk koster, ikke bare nettverket.
console.log('TOKEN-ENDEPUNKTET (POST, ugyldig token — kan ikke lykkes), 3 målinger:')
const token = []
for (let i = 0; i < 3; i++) {
  const p = await probe('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: 'ugyldig-maalesonde-ikke-et-ekte-token' }),
  })
  token.push(p.ms)
  process.stdout.write(`   ${p.ms.toFixed(0)} ms (${p.status})`)
}
console.log('\n')

const stat = (a) => {
  const s = [...a].sort((x, y) => x - y)
  return { min: s[0], median: s[Math.floor(s.length / 2)], max: s[s.length - 1] }
}
const v = stat(varme), t = stat(token)
console.log(`Varm helsesjekk:  min ${v.min.toFixed(0)}  median ${v.median.toFixed(0)}  max ${v.max.toFixed(0)} ms`)
console.log(`Token-POST:       min ${t.min.toFixed(0)}  median ${t.median.toFixed(0)}  max ${t.max.toFixed(0)} ms`)
console.log(`Kald forbindelse: ${kald.ms.toFixed(0)} ms  (TLS-påslag ≈ ${(kald.ms - v.median).toFixed(0)} ms)`)
