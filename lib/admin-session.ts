// ── Admin-sesjon i nettleseren ───────────────────────────────────────────────
//
// KLIENT-SIDEN, og bevisst i en EGEN fil uten krypto-import.
//
// Fram til 12. august bodde disse funksjonene i lib/admin-auth.ts sammen med
// `verifyAdminRequest`, som importerer `node:crypto` og leser `ADMIN_PASSWORD`.
// Fjorten klientkomponenter importerte fra den filen. At serverkoden ikke havnet
// i nettleserbundelen skyldtes at Next ristet bort det som ikke ble referert —
// en optimalisering, ikke en garanti. Ett nytt kall til noe krypto-nært, eller
// én endring i hvordan bundleren resonnerer, og hemmeligheten ville fulgt med.
// Nå kan den ikke det: filen har ingenting å dra med seg.
//
// ── ÉN KILDE TIL SANNHET ────────────────────────────────────────────────────
//
// Sesjonen lå tidligere i TO lagre med hver sin levetid:
//
//   isAdminLoggedIn()  ← localStorage   (qk_admin + qk_admin_time, 8t)
//   getAdminToken()    ← sessionStorage (qk_admin_token, 8t)
//
// Begge varte i 8 timer, så levetiden var ikke problemet — lagringen var.
// sessionStorage tømmes når fanen lukkes; localStorage gjør det ikke. Lukket du
// nettleseren og kom tilbake innen 8 timer, sa den ene «innlogget» og den andre
// hadde ingenting å sende. Resultatet var en admin-side som ikke sendte deg til
// innlogging, men i stedet fyrte kall som svarte 401 — og viste en tom liste
// med teksten «Ingen koder ennå. Lag din første!». En positiv påstand om at
// databasen var tom.
//
// Splitten var arvet, ikke bestemt. Før 19. juli lå SELVE PASSORDET i
// sessionStorage ('qk_admin_pw'), og da var kort levetid riktig for en
// klartekst-hemmelighet. `981a950` byttet verdien til et signert token, men lot
// plasseringen stå. Sikkerhetsgrunnen forsvant med passordet.
//
// Løsningen er å FJERNE den andre kilden, ikke å synkronisere den: tokenet
// bærer allerede sitt eget utløp, så `qk_admin_time` var en kopi av noe vi har.
// Tokenet blir liggende i sessionStorage — å flytte det til localStorage ville
// også fjernet uenigheten, men gjort tokenet lesbart i opptil 8 timer etter at
// nettleseren er lukket. Vi løser en UX-feil; det er ingen grunn til å betale
// for den med sikkerhet.
//
// ── HVA DENNE SJEKKEN ER, OG IKKE ER ────────────────────────────────────────
//
// Utløpet leses UTEN å verifiere signaturen — nøkkelen er ADMIN_PASSWORD og
// finnes ikke i nettleseren. Dette er ruting og visning: «skal jeg vise siden
// eller sende deg til innlogging». Porten er `verifyAdminRequest` på serveren,
// som verifiserer signaturen og utløpet på nytt ved hvert kall. Et token med
// tuklet utløp slipper altså forbi HER og blir avvist DER — nøyaktig som en
// bruker som skriver `/admin` i adressefeltet uten å ha noe token i det hele
// tatt. Samme skille som `eligible` i prøveperiode-flyten.

const TOKEN_KEY = 'qk_admin_token'

/**
 * Utløpstidspunktet (ms siden epoke) fra et admin-token, eller null hvis
 * tokenet ikke har en form vi kjenner igjen.
 *
 * Formatet er `<utløp-i-ms>.<base64url-signatur>`, se lib/admin-token.ts.
 *
 * Ren funksjon — ingen lagring, ingen klokke. Testes direkte.
 */
export function readTokenExpiry(token: string | null | undefined): number | null {
  if (!token) return null

  const dot = token.indexOf('.')
  // `dot <= 0` dekker både «ingen punktum» og «punktum først», altså tomt utløp.
  if (dot <= 0) return null

  // Signaturdelen må finnes. Uten denne sjekken ville «12345.» blitt godtatt,
  // og et hvilket som helst tall i sessionStorage sett ut som en gyldig sesjon.
  if (!token.slice(dot + 1)) return null

  // PARITET med serveren er kravet her, ikke strenghet. `verifyAdminToken`
  // splitter på FØRSTE punktum og gjør `Number(exp)` — så «123.45.abc» leses
  // som utløp 123 med signatur «45.abc» begge steder, og « 123 » godtas begge
  // steder fordi Number() tåler mellomrom.
  //
  // Det er med vilje. Et token vi tolker strengere enn serveren gir en bruker
  // som sendes til innlogging selv om kallene ville gått gjennom; tolker vi det
  // mildere, får vi en side som vises og kall som avvises. Begge er den samme
  // uenigheten vi nettopp fjernet, bare flyttet ned på tegn-nivå. At det er
  // slingringsmonn i parsingen er ufarlig: et token med tuklet utløp har
  // fortsatt feil signatur, og serveren avviser det.
  const exp = Number(token.slice(0, dot))
  if (!Number.isInteger(exp)) return null

  return exp
}

/**
 * Har nettleseren en sesjon som ennå ikke er utløpt?
 *
 * `<=` speiler `verifyAdminToken` på serveren nøyaktig. Spriker de to på
 * grenseverdien, får du et sekund der klienten viser siden og serveren avviser
 * kallene — i praksis den samme feilen vi nettopp fjernet, bare mye smalere.
 */
export function isAdminLoggedIn(): boolean {
  if (typeof window === 'undefined') return false
  const exp = readTokenExpiry(getAdminToken())
  return exp !== null && Date.now() <= exp
}

export function getAdminToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setAdminToken(token: string): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(TOKEN_KEY, token)
    // Rydd bort rester fra tiden da passordet lå her i klartekst.
    sessionStorage.removeItem('qk_admin_pw')
  } catch {
    // Ignorer feil (f.eks. privat modus eller quota)
  }
}

export function logoutAdmin(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem('qk_admin_pw')
    // De to gamle localStorage-nøklene styrer ingenting lenger, men de ligger
    // igjen hos alle som var innlogget før denne endringen. Ryddingen beholdes
    // en stund så «logg ut» faktisk tømmer alt — og kan fjernes senere.
    localStorage.removeItem('qk_admin')
    localStorage.removeItem('qk_admin_time')
  } catch {
    // ignore
  }
}

// ── Retur etter ny innlogging ───────────────────────────────────────────────

/**
 * Renser `?next=`-parameteren fra innloggingslenken.
 *
 * Verdien kommer fra URL-en og er dermed angriper-kontrollerbar: hvem som helst
 * kan sende Dennis en lenke til `/admin/login?next=…`. Uten denne filtreringen
 * ville innloggingssiden vært en åpen viderekobling — man logger inn på et
 * domene man stoler på og lander et helt annet sted.
 *
 * Derfor en HVITELISTE, ikke en svarteliste: kun stier som begynner med
 * `/admin`. Det er dessuten det eneste `next` noensinne skal peke på, siden den
 * settes av adminFetch fra en admin-side.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null

  // `//evil.com` er protokoll-relativ og ville blitt et annet domene, selv om
  // den begynner med `/`. `/\evil.com` behandles likt av flere nettlesere.
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null

  if (raw !== '/admin' && !raw.startsWith('/admin/') && !raw.startsWith('/admin?')) return null

  return raw
}

const ADMIN_LOGIN = '/admin/login'

/** Er dette selve innloggingssiden? Delt vakt mot å sende den til seg selv. */
export function isAdminLoginPath(path: string): boolean {
  return path === ADMIN_LOGIN || path.startsWith(ADMIN_LOGIN + '?')
}

/**
 * URL-en til innloggingssiden, med veien tilbake hit.
 *
 * ÉN formulering av «hvor er innloggingen, og hvor skal jeg tilbake til».
 * Brukes av BEGGE veiene dit:
 *
 *   1. Sidenes egen vakt — `isAdminLoggedIn()` er false, altså ingen token i
 *      det hele tatt. Dette er den VANLIGE veien: nettleseren har vært lukket.
 *   2. `decideAdminRedirect` i lib/admin-fetch.ts — serveren avviste et token
 *      vi hadde. Sjeldnere: utløp mens fanen sto åpen, eller rotert passord.
 *
 * At det var to veier er nettopp grunnen til at denne funksjonen finnes.
 * 12. august ble `next` lagt til i vei 2 alene, mens de tretten sidene i vei 1
 * fortsatte å sende en naken `/admin/login`. Fiksen så komplett ut i rapporten
 * og virket ikke i praksis, fordi vei 1 er den man nesten alltid går.
 *
 * Kalles uten argument fra nettleseren; `currentPath` finnes for tester.
 */
export function adminLoginPath(currentPath?: string): string {
  const here = currentPath ?? browserPath()
  // Ingen sti å vende tilbake til (server-side render), eller vi står allerede
  // på innloggingssiden — da ville `next` pekt på siden selv.
  if (!here || isAdminLoginPath(here)) return ADMIN_LOGIN

  const next = safeNextPath(here)
  return next ? `${ADMIN_LOGIN}?next=${encodeURIComponent(next)}` : ADMIN_LOGIN
}

function browserPath(): string | null {
  if (typeof window === 'undefined') return null
  return window.location.pathname + window.location.search
}
