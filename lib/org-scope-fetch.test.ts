// Kjøres med:  npm test
//
// SPERRE for org-scope-tidsgrensen på topplistesiden (brief:
// .claude/QK_OPPDATERING_ORG_SCOPE_TIDSGRENSE_19AUG.md, avgjort 19. august
// 2026 i 80c6fd2). To feilformer skal ikke kunne gjenoppstå:
//
//   A. Tidsgrensen tar produktbeslutningen: en fornyelse som LYKKES, men
//      lander etter spinner-budsjettet, gir permanent nasjonalt scope for et
//      ekte org-medlem med gyldig sesjon.
//   B. Paritetsrefetchen tar den: når fornyelsen lander (TOKEN_REFRESHED →
//      identitetsskifte → automatisk re-henting) bytter lista populasjon
//      UNDER leseren, uten klikk. Dette var den FAKTISKE feilformen på main
//      etter 74b94e7 — driftet fra briefens antagelse, målt 26. august 2026.
//
// Kjedetesten driver den EKTE withTimeout mot et getSession som settles etter
// at budsjettet har fyrt — samme mønster som lib/session-check.test.ts — og
// tar deretter alle tre hentebeslutningene i rekkefølgen prod tar dem.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger.
// Alle fire mutasjonene er KJØRT 26. august 2026, ikke antatt:
//   • Fjern nationalAlreadyServed-grenen i decideFetchScope
//     → 2 ryker: «B: automatisk re-henting bytter aldri» + kjedetesten
//       (auto-byttet er tilbake).
//   • Snu `!input.upgradeRequested` til `input.upgradeRequested`
//     → 3 ryker: «klikket henter org-lista» (knappen blir virkningsløs),
//       «B: automatisk re-henting bytter aldri» og kjedetesten.
//   • La upgradeRequested overstyre sessionKnown
//     → 1 ryker: «klikk uten kjent sesjon» (org-kall uten token →
//       login-redirect midt i en klikk-flyt).
//   • Bypass decideFetchScope i page.tsx (skriv `scopedOrg = orgSlug` direkte)
//     → 1 ryker: «struktur: den gamle formen er borte».
//   • Gjør klikket påkrevd også i den RASKE stien (`if (!input.upgradeRequested)`
//     foran sluttreturen) → 2 ryker: «normalflyt: … scopes med en gang» +
//     «kjeden: sesjon INNENFOR budsjettet». Det er sperren mot å løse
//     hjørnetilfellet ved å ødelegge hovedtilfellet — normalen for alle 29
//     Elkjøp-medlemmer hver fredag.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Session } from '@supabase/supabase-js'
import { decideFetchScope } from './org-scope-fetch'
import { withTimeout, type TimerApi } from './with-timeout'

// ── Enkeltbeslutningene ──────────────────────────────────────────────────────

test('nasjonal lenke: ingen org å velge, historikken nullstilles', () => {
  const d = decideFetchScope({
    requestedOrg: null, sessionKnown: true,
    nationalAlreadyServed: true, upgradeRequested: false,
  })
  assert.equal(d.scope, null)
  assert.equal(d.nationalServedForOrg, false)
})

test('normalflyt: org-lenke med sesjon i tide scopes med en gang', () => {
  const d = decideFetchScope({
    requestedOrg: 'elkjop-nordic', sessionKnown: true,
    nationalAlreadyServed: false, upgradeRequested: false,
  })
  assert.equal(d.scope, 'elkjop-nordic', 'førstegangshentingen skal IKKE vente på noe klikk')
  assert.equal(d.nationalServedForOrg, false)
})

test('A: timeout gir nasjonal visning — og hendelsen huskes', () => {
  const d = decideFetchScope({
    requestedOrg: 'elkjop-nordic', sessionKnown: false,
    nationalAlreadyServed: false, upgradeRequested: false,
  })
  assert.equal(d.scope, null)
  assert.equal(d.nationalServedForOrg, true, 'uten dette vet neste henting ikke at leseren alt ser nasjonal liste')
})

test('B: automatisk re-henting bytter aldri populasjon under leseren', () => {
  // Sesjonen ER kjent nå — det er nettopp derfor grenen finnes: uten den ville
  // «sesjon kjent» alene vært nok til å bytte lista uten klikk.
  const d = decideFetchScope({
    requestedOrg: 'elkjop-nordic', sessionKnown: true,
    nationalAlreadyServed: true, upgradeRequested: false,
  })
  assert.equal(d.scope, null, 'byttet skal TILBYS (knapp), ikke utføres — avgjort 19. august 2026')
  assert.equal(d.nationalServedForOrg, true)
})

test('klikket henter org-lista — og nullstiller historikken', () => {
  const d = decideFetchScope({
    requestedOrg: 'elkjop-nordic', sessionKnown: true,
    nationalAlreadyServed: true, upgradeRequested: true,
  })
  assert.equal(d.scope, 'elkjop-nordic')
  assert.equal(
    d.nationalServedForOrg, false,
    'leseren er nå på kollegevisningen — senere automatiske hentinger som beholder scopet er ikke et bytte',
  )
})

test('klikk uten kjent sesjon scoper IKKE — org-kall uten token er en login-redirect', () => {
  const d = decideFetchScope({
    requestedOrg: 'elkjop-nordic', sessionKnown: false,
    nationalAlreadyServed: true, upgradeRequested: true,
  })
  assert.equal(d.scope, null)
  assert.equal(d.nationalServedForOrg, true, 'knappen skal kunne klikkes igjen når sesjonen svarer')
})

// ── Hele kjeden: den EKTE feiltilstanden fra briefen ─────────────────────────
// En fornyelse som LYKKES, men lander ETTER spinner-budsjettet, skal gi
// org-visning via knappen — aldri permanent nasjonalt scope, aldri auto-bytte.

test('kjeden: sen-men-vellykket fornyelse → nasjonal nå, org KUN via knappen', async () => {
  // Manuelle timere, så testen ikke bruker 2500 ms veggklokketid.
  let fire: (() => void) | null = null
  const timers: TimerApi = {
    setTimeout: fn => { fire = fn; return 1 },
    clearTimeout: () => {},
  }

  // Fornyelsen: et getSession som settles — men først ETTER at budsjettet fyrte.
  let landSession: ((s: Session) => void) | null = null
  const slowRenewal = new Promise<Session>(resolve => { landSession = resolve })

  const pending = withTimeout(slowRenewal, { ms: 2500, timers })
  assert.ok(fire, 'spinner-budsjettet skal være armert')
  ;(fire as unknown as () => void)()
  const outcome = await pending
  assert.equal(outcome.ok, false, 'budsjettet er brukt opp — siden slippes fram')

  // Henting 1 (sidelastingen): nasjonal, hendelsen huskes.
  const first = decideFetchScope({
    requestedOrg: 'elkjop-nordic', sessionKnown: outcome.ok,
    nationalAlreadyServed: false, upgradeRequested: false,
  })
  assert.equal(first.scope, null)

  // Fornyelsen LYKKES nå — i prod fyrer TOKEN_REFRESHED, identiteten endres,
  // og paritetsrefetchen kjører automatisk. Den skal HOLDE nasjonal visning.
  ;(landSession as unknown as (s: Session) => void)(
    { access_token: 'abc', user: { id: 'u1' } } as unknown as Session,
  )
  const second = decideFetchScope({
    requestedOrg: 'elkjop-nordic', sessionKnown: true,
    nationalAlreadyServed: first.nationalServedForOrg, upgradeRequested: false,
  })
  assert.equal(second.scope, null, 'lista skal ALDRI bytte populasjon under leseren')

  // Klikket på «Vi fant bedriften din — vis kollegene»: org-lista hentes.
  const third = decideFetchScope({
    requestedOrg: 'elkjop-nordic', sessionKnown: true,
    nationalAlreadyServed: second.nationalServedForOrg, upgradeRequested: true,
  })
  assert.equal(third.scope, 'elkjop-nordic', 'et ekte medlem med gyldig sesjon skal fram til kollegene sine')
  assert.equal(third.nationalServedForOrg, false)
})

// ── Kjeden: NORMALTILFELLET — rask sesjon skal scopes uten noe klikk ─────────
// Dette er stien alle 29 Elkjøp-medlemmer tar hver fredag. Var
// populasjonsbyttet ved et uhell gatet på klikk også her, hadde vi løst et
// hjørnetilfelle og ødelagt hovedtilfellet — og ingen i huset har
// org-medlemskap til å oppdage det manuelt.

test('kjeden: sesjon INNENFOR budsjettet → org-lista serveres uten at knappen finnes', async () => {
  // Manuelle timere som i session-check.test.ts: timeren armeres, men fyrer
  // aldri — sesjonen rekker fram først, slik den gjør for et raskt oppslag.
  const timers: TimerApi = { setTimeout: () => 1, clearTimeout: () => {} }
  const outcome = await withTimeout(
    Promise.resolve({ access_token: 'abc', user: { id: 'u1' } } as unknown as Session),
    { ms: 2500, timers },
  )
  assert.equal(outcome.ok, true, 'oppslaget rakk fram — budsjettet ble aldri brukt')

  // Sidelastingens ENESTE hentebeslutning: klikk-flagget er false og forblir
  // false — det finnes ingen knapp å klikke i normalflyten.
  const d = decideFetchScope({
    requestedOrg: 'elkjop-nordic', sessionKnown: outcome.ok,
    nationalAlreadyServed: false, upgradeRequested: false,
  })
  assert.equal(d.scope, 'elkjop-nordic', 'kollega-feltet skal komme AUTOMATISK når sesjonen svarer i tide')
  assert.equal(d.nationalServedForOrg, false, 'ingen nasjonal liste ble vist — det finnes ingen hendelse å huske')
})

// ── Strukturbinding: siden bruker faktisk funksjonen ─────────────────────────
// Ren logikk kan være korrekt og likevel ukalt (grep teller navn, ikke
// oppførsel). Ankrene er valgt fordi de SKILLER ny form fra gammel: den gamle
// formen var `let scopedOrg = orgSlug` + manuell nulling i timeout-grenen.

const pageSource = readFileSync('app/leaderboard/[id]/page.tsx', 'utf8')

test('struktur: fetchData tar scope-beslutningen via decideFetchScope', () => {
  assert.match(
    pageSource,
    /decideFetchScope\(\{/,
    'scope-beslutningen skal gå via lib/org-scope-fetch.ts, ikke tas inline',
  )
  assert.match(
    pageSource,
    /nationalAlreadyServed:\s*nationalServedForOrgRef\.current/,
    'hendelses-historikken (ref) skal mates inn i beslutningen',
  )
  assert.match(
    pageSource,
    /upgradeRequested:\s*orgScopeUpgradeRequested/,
    'knappens klikk-tilstand skal mates inn i beslutningen',
  )
})

test('struktur: den gamle formen er borte — ingen manuell scope-tildeling', () => {
  assert.doesNotMatch(
    pageSource,
    /let scopedOrg = orgSlug/,
    'gammel form: scope satt direkte fra URL-en og nullet manuelt i timeout-grenen',
  )
})

test('struktur: knappen finnes med avgjort ordlyd, og degraderingslinja består', () => {
  assert.match(pageSource, /Vi fant bedriften din — vis kollegene/)
  // Degraderingslinja skal fortsatt finnes for tilfellet der betingelsene
  // aldri blir sanne (fornyelsen lander ikke, eller medlemskapet avkreftes).
  assert.match(pageSource, /Vi fikk ikke bekreftet bedriftstilhørigheten din/)
})
