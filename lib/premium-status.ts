// ── Robust klient-henting av premium-status (Sak 2) ──────────────────────────
// Problemet: en mislykket/429/nettverksfeil på premium-status-kallet nullstilte
// isPremium til false, slik at en betalende bruker fikk estimert spenn i stedet
// for eksakt plassering.
//
// Reglene her:
//  • Kun et DEFINITIVT svar fra serveren (true/false) endrer status.
//  • Enhver ikke-ok respons (401/429/5xx) eller nettverksfeil = «ukjent» → null.
//    Kalleren beholder da forrige verdi (nedgraderer ALDRI på feil).
//  • Kort retry med backoff til et definitivt svar foreligger.
//  • Asymmetrisk cache: en bekreftet true lagres i sessionStorage (nøklet på
//    bruker-id) og hydreres ved mount. Default forblir false; vi oppgraderer KUN
//    til true når serveren positivt bekrefter det. En gratisbruker får aldri en
//    server-true, og kan derfor aldri ende opp med true fra cachen.

const key = (userId: string) => `qk_premium_${userId}`

// Les en tidligere bekreftet premium-status fra sessionStorage. Returnerer kun
// true (oppgradering); alt annet gir false slik at default forblir konservativt.
export function hydratePremiumStatus(userId: string): boolean {
  try {
    return sessionStorage.getItem(key(userId)) === 'true'
  } catch {
    return false
  }
}

// Henter premium-status. Returnerer:
//   true/false → definitivt svar fra serveren (og oppdaterer sessionStorage)
//   null       → ukjent (behold forrige verdi hos kalleren)
export async function fetchPremiumStatus(
  accessToken: string,
  userId: string,
  opts: { retries?: number } = {},
): Promise<boolean | null> {
  const retries = opts.retries ?? 2
  let delay = 400

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch('/api/profile/premium-status', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (res.ok) {
        const data = await res.json().catch(() => null)
        if (data && typeof data.isPremium === 'boolean') {
          const isP: boolean = data.isPremium
          try {
            if (isP) sessionStorage.setItem(key(userId), 'true')
            else sessionStorage.removeItem(key(userId))
          } catch { /* sessionStorage utilgjengelig — ikke kritisk */ }
          return isP
        }
        // ok, men uventet form → behandle som ukjent og prøv igjen
      }
      // ikke-ok (401/429/5xx) → ukjent
    } catch {
      // nettverksfeil → ukjent
    }
    if (attempt < retries) {
      await new Promise(r => setTimeout(r, delay))
      delay *= 2
    }
  }
  return null
}
