// Kjøres med:  npm test
//
// Admin-sesjonen har ÉN kilde: tokenet.
//
// BAKGRUNN (12. august 2026)
// Sesjonen lå i to lagre med hver sin død. `isAdminLoggedIn()` leste
// localStorage (`qk_admin`, 8t), `getAdminToken()` leste sessionStorage
// (`qk_admin_token`, 8t). Lukket du nettleseren og kom tilbake innen 8 timer,
// sa den første «innlogget» mens den andre ikke hadde noe å sende. Siden lot
// deg altså bli, fyrte kall som svarte 401, og viste «Ingen koder ennå. Lag din
// første!» — mens det lå to koder i databasen.
//
// Splitten var arvet: før 19. juli lå SELVE PASSORDET i sessionStorage, der
// kort levetid var riktig. Verdien ble byttet til et signert token; lagringen
// ble stående.
//
// HVA TESTENE VOKTER
//  1. At utløpet leses fra tokenet, som nå er eneste kilde.
//  2. At grenseverdien er IDENTISK med serverens (`Date.now() <= exp`).
//     Spriker de, får du et vindu der siden vises og kallene avvises — samme
//     feil på nytt, bare smalere.
//  3. At tull i sessionStorage ikke ser ut som en gyldig sesjon.
//  4. At `?next=` ikke kan gjøre innloggingssiden til en åpen viderekobling.
//
// MUTASJONSBEVIS: se rapporten. Hver mutasjon er skrevet til fil med
// scripts/mutate.mjs, som leser tilbake fra disk og avbryter hvis endringen
// ikke står der.

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readTokenExpiry, isAdminLoggedIn, getAdminToken, setAdminToken, logoutAdmin, safeNextPath } from './admin-session'

// ── Minimal nettleser-lagring ───────────────────────────────────────────────
// Nok til å kjøre den ekte modulen. `window` må finnes for at vaktene i
// funksjonene ikke skal kortslutte.
function fakeStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) },
    _map: m,
  }
}

const g = globalThis as unknown as Record<string, unknown>

beforeEach(() => {
  g.window = {}
  g.sessionStorage = fakeStorage()
  g.localStorage = fakeStorage()
})

afterEach(() => {
  delete g.window
  delete g.sessionStorage
  delete g.localStorage
})

const tokenExpiring = (msFromNow: number) => `${Date.now() + msFromNow}.c2lnbmF0dXI`

// ── readTokenExpiry ─────────────────────────────────────────────────────────

test('utløpet leses ut av tokenet', () => {
  assert.equal(readTokenExpiry('1786567642108.abc'), 1786567642108)
})

test('token uten signaturdel avvises', () => {
  // Uten denne sjekken ville et hvilket som helst tall i sessionStorage sett ut
  // som en gyldig sesjon.
  assert.equal(readTokenExpiry('1786567642108.'), null)
  assert.equal(readTokenExpiry('1786567642108'), null)
})

test('token uten utløpsdel avvises', () => {
  assert.equal(readTokenExpiry('.abc'), null)
})

test('ikke-numerisk utløp avvises', () => {
  // Merk at et desimaltall ikke KAN oppstå her: første punktum avslutter
  // utløpsdelen, så «12.5.abc» er utløp 12 med signatur «5.abc» — se
  // paritetstesten under. Det som faktisk må avvises er en utløpsdel som ikke
  // er et tall i det hele tatt.
  assert.equal(readTokenExpiry('senere.abc'), null)
  assert.equal(readTokenExpiry('NaN.abc'), null)
  assert.equal(readTokenExpiry('Infinity.abc'), null)
})

test('parsingen er IDENTISK med serverens, ikke strengere', () => {
  // verifyAdminToken splitter på FØRSTE punktum og gjør Number(exp). Tolker vi
  // strengere enn serveren, sendes en bruker til innlogging selv om kallene
  // ville gått gjennom; tolker vi mildere, vises en side der kallene avvises.
  // Begge er den samme uenigheten vi nettopp fjernet, flyttet ned på tegnnivå.
  //
  // «123.45.abc» = utløp 123, signatur «45.abc» — begge steder.
  assert.equal(readTokenExpiry('123.45.abc'), 123)
  // Number() tåler mellomrom, og det gjør serveren også. Ufarlig: et token med
  // tuklet utløp har uansett feil signatur og avvises der.
  assert.equal(readTokenExpiry(' 123 .abc'), 123)
})

test('tomt, null og undefined avvises', () => {
  assert.equal(readTokenExpiry(''), null)
  assert.equal(readTokenExpiry(null), null)
  assert.equal(readTokenExpiry(undefined), null)
})

// ── isAdminLoggedIn ─────────────────────────────────────────────────────────

test('gyldig token = innlogget', () => {
  setAdminToken(tokenExpiring(60_000))
  assert.equal(isAdminLoggedIn(), true)
})

test('UTLØPT token = IKKE innlogget', () => {
  setAdminToken(tokenExpiring(-1))
  assert.equal(isAdminLoggedIn(), false)
})

test('ingen token = ikke innlogget — dette er hele feilen som ble fikset', () => {
  // Nøyaktig tilstanden etter at nettleseren er lukket: sessionStorage er tom.
  // Før fiksen svarte isAdminLoggedIn() true fra localStorage, og siden lot deg
  // bli værende på en flate der hvert kall svarte 401.
  assert.equal(isAdminLoggedIn(), false)
})

test('et gjenglemt localStorage-flagg gir IKKE lenger tilgang', () => {
  // Alle som var innlogget før denne endringen har disse to liggende. De skal
  // ikke kunne holde en sesjon i live på egen hånd.
  ;(g.localStorage as ReturnType<typeof fakeStorage>).setItem('qk_admin', 'true')
  ;(g.localStorage as ReturnType<typeof fakeStorage>).setItem('qk_admin_time', String(Date.now()))

  assert.equal(isAdminLoggedIn(), false, 'den gamle andre kilden lever fortsatt')
})

test('grenseverdien er IDENTISK med serverens: NØYAKTIG på utløpet er gyldig', () => {
  // verifyAdminToken gjør `Date.now() <= expMs`. Byttes denne til `<`, oppstår
  // et millisekund der klient og server er uenige.
  //
  // Klokka MÅ fryses her. Et utløp «noen ms fram i tid» treffer ikke grensen —
  // både `<` og `<=` svarer true, og testen beviser ingenting. Nøyaktig
  // likhet er hele poenget.
  const ekteNow = Date.now
  const FROSSEN = 1786567642108
  try {
    Date.now = () => FROSSEN
    setAdminToken(`${FROSSEN}.sig`)
    assert.equal(isAdminLoggedIn(), true, 'siste gyldige millisekund ble avvist')

    setAdminToken(`${FROSSEN - 1}.sig`)
    assert.equal(isAdminLoggedIn(), false, 'første utløpte millisekund ble godtatt')
  } finally {
    Date.now = ekteNow
  }
})

test('tull i sessionStorage ser ikke ut som en sesjon', () => {
  for (const tull of ['true', 'ja', '{}', 'abc.def', '']) {
    ;(g.sessionStorage as ReturnType<typeof fakeStorage>).setItem('qk_admin_token', tull)
    assert.equal(isAdminLoggedIn(), false, `«${tull}» ble godtatt som sesjon`)
  }
})

test('utenfor nettleseren er svaret alltid false', () => {
  delete g.window
  assert.equal(isAdminLoggedIn(), false)
  assert.equal(getAdminToken(), null)
})

// ── logoutAdmin ─────────────────────────────────────────────────────────────

test('utlogging tømmer tokenet OG de gamle localStorage-nøklene', () => {
  setAdminToken(tokenExpiring(60_000))
  const ls = g.localStorage as ReturnType<typeof fakeStorage>
  ls.setItem('qk_admin', 'true')
  ls.setItem('qk_admin_time', String(Date.now()))

  logoutAdmin()

  assert.equal(isAdminLoggedIn(), false)
  assert.equal(getAdminToken(), null)
  assert.equal(ls.getItem('qk_admin'), null, 'gammel nøkkel ble liggende igjen')
  assert.equal(ls.getItem('qk_admin_time'), null)
})

// ── safeNextPath ────────────────────────────────────────────────────────────

test('interne admin-stier slippes gjennom', () => {
  assert.equal(safeNextPath('/admin'), '/admin')
  assert.equal(safeNextPath('/admin/codes'), '/admin/codes')
  assert.equal(safeNextPath('/admin/quizzes/abc/questions'), '/admin/quizzes/abc/questions')
  assert.equal(safeNextPath('/admin?fane=2'), '/admin?fane=2')
})

test('ÅPEN VIDEREKOBLING blokkeres', () => {
  // Verdien kommer fra URL-en, så hvem som helst kan sende Dennis en lenke til
  // /admin/login?next=… Uten filtreringen ville han logget inn på et domene han
  // stoler på og landet et helt annet sted.
  for (const ond of [
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'http://evil.example/admin',
    '/admincd/../../evil',
    '/profil',
    '/',
    'admin/codes',
  ]) {
    assert.equal(safeNextPath(ond), null, `«${ond}» slapp gjennom`)
  }
})

test('tomt next gir null, ikke krasj', () => {
  assert.equal(safeNextPath(null), null)
  assert.equal(safeNextPath(undefined), null)
  assert.equal(safeNextPath(''), null)
})
