// ── Vakt: middleware skal ALDRI slette sesjons-cookies ──────────────────────
//
// Ren logikk, ingen I/O — kalles fra `setAll` i `middleware.ts`.
//
// BAKGRUNN. `middleware.ts` kaller `supabase.auth.getUser()` for å fornye
// tokenet. Feiler fornyelsen med noe auth-js ikke regner som «infrastruktur»,
// kaller `_callRefreshToken` `_removeSession()` (GoTrueClient.js:3903-3906),
// som via `onAuthStateChange('SIGNED_OUT')` → `applyServerStorage` sender
// slette-cookies inn i `setAll`. En Supabase som svarer 500 eller 429 logger
// dermed ut hver innlogget bruker som treffer middleware — stille, med 200 OK
// og null loggspor.
//
// 429 er ikke-retryable i ALLE versjoner av auth-js, også nyeste. En
// oppgradering er derfor ikke fiksen; denne vakten er.
//
// PRINSIPPET er det samme som i `lib/has-settled-plays.ts`: at vi ikke fikk
// svar betyr UKJENT, ikke «utlogget». Ukjent skal aldri kaste noen ut.
//
// ⚠ DENNE VAKTEN LIGGER OPPÅ BIBLIOTEKETS EGEN ATFERD.
// Den forutsetter formen `applyServerStorage` gir slette-oppføringer
// (`value: ""` + `maxAge: 0`) og navnemønsteret `sb-<ref>-auth-token[.N]`
// (`defaultStorageKey` i supabase-js). Begge er interne detaljer i
// @supabase/ssr og @supabase/supabase-js. **Verifiser dem på nytt ved HVER
// oppgradering av @supabase/ssr eller @supabase/supabase-js** — endrer
// biblioteket kodingen eller navnene, slutter vakten å gjenkjenne
// slettingene og blir et stille no-op. `lib/middleware-cookie-guard.test.ts`
// feller formen, men den testen er skrevet mot dagens bibliotek og kan ikke
// oppdage at biblioteket har byttet mening.
//
// Verifisert mot @supabase/ssr 0.10.2 / supabase-js 2.104.0, 16. august 2026.

export type CookieToSet = {
  name: string
  value: string
  options?: { maxAge?: number } & Record<string, unknown>
}

// Chunk-suffikset @supabase/ssr legger på når verdien sprenger cookie-taket:
// `sb-abc-auth-token.0`, `.1`, … Speiler CHUNK_LIKE_REGEX i
// @supabase/ssr/dist/main/utils/chunker.js.
const CHUNK_SUFFIX = /\.(?:0|[1-9][0-9]*)$/

/**
 * Lagringsnøkkelen en cookie tilhører, eller null hvis den ikke er
 * sesjons-tokenet.
 *
 * Treffer `sb-<ref>-auth-token` og chunkene dens. Treffer bevisst IKKE
 * `sb-<ref>-auth-token-code-verifier` eller `…-user`: det er egne
 * lagringsnøkler, og PKCE-flyten er avhengig av å kunne slette verifieren.
 */
export function authSessionBaseName(cookieName: string): string | null {
  const base = cookieName.replace(CHUNK_SUFFIX, '')
  if (!base.startsWith('sb-')) return null
  if (!base.endsWith('-auth-token')) return null
  return base
}

/**
 * Er dette en slette-oppføring? `applyServerStorage` skriver slettinger som
 * tom verdi PLUSS `maxAge: 0` (cookies.js:335-338) — begge kreves her, så en
 * fornyelse som tilfeldigvis har tom verdi ikke feiltolkes.
 */
function isDeletion(cookie: CookieToSet): boolean {
  return cookie.value === '' && cookie.options?.maxAge === 0
}

/**
 * Fjerner slettinger av sesjons-cookien fra en `setAll`-batch.
 *
 * VIKTIG UNNTAK — chunk-krymping. `applyServerStorage` legger også
 * slette-oppføringer i listen ved en VELLYKKET fornyelse: blir det nye
 * tokenet kortere enn det gamle, faller en chunk bort, og den foreldede
 * `…-auth-token.1` MÅ slettes (cookies.js:307-312). Blokkerer vi den, blir
 * en utdatert chunk liggende og cookien settes sammen feil ved neste lesing.
 *
 * Derfor: en sletting blokkeres kun når samme batch ikke inneholder en
 * set-oppføring for samme lagringsnøkkel. Er det en fornyelse på gang,
 * slipper alt gjennom uendret.
 */
export function filterSessionDeletions<T extends CookieToSet>(
  cookiesToSet: readonly T[]
): { kept: T[]; dropped: T[] } {
  // Lagringsnøkler som får en ekte verdi skrevet i denne batchen.
  const renewed = new Set<string>()
  for (const cookie of cookiesToSet) {
    const base = authSessionBaseName(cookie.name)
    if (base !== null && !isDeletion(cookie)) renewed.add(base)
  }

  const kept: T[] = []
  const dropped: T[] = []
  for (const cookie of cookiesToSet) {
    const base = authSessionBaseName(cookie.name)
    if (base !== null && isDeletion(cookie) && !renewed.has(base)) {
      dropped.push(cookie)
    } else {
      kept.push(cookie)
    }
  }
  return { kept, dropped }
}
