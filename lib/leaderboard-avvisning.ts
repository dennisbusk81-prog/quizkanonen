// ── Hvorfor ble leaderboard-hentingen avvist? ───────────────────────────────
//
// Ren logikk, ingen I/O. Brukt av components/SeasonLeaderboard.tsx
// (6. september 2026).
//
// ── FEILKLASSEN: TRE TILSTANDER, ETT SVAR ───────────────────────────────────
// Komponenten gjorde `if (!res.ok) setLoadError(true)` — én boolsk verdi for
// alle utfall. Visningen valgte deretter tekst ut fra om det fantes en sesjon,
// ikke ut fra hvorfor kallet feilet. Resultatet var råd som ikke kan følges:
//
//   403 (ikke medlem)    → «Noe gikk galt. Prøv å laste siden på nytt.»
//                          Ingen omlasting gjør deg til medlem.
//   401 (ikke innlogget) → «Ingen data ennå. Logg inn for å se din
//                          sesong-plassering.» Riktig ved 401, men samme
//                          tekst traff også en anonym bruker som fikk 500.
//
// Dette er samme klasse som c4e808e løste i questions-ruta: et smalere
// utfallsrom enn virkeligheten gjør diagnosen umulig — ikke bare for
// brukeren, men for den som feilsøker.
//
// Statuskoden er det ENESTE signalet som faktisk vet hvorfor. Sesjonens
// tilstand er en gjetning: en bruker kan ha gyldig sesjon OG få 403, eller
// mangle sesjon OG få 500.

/** Hvorfor serveren sa nei. */
export type Avvisning = 'uinnlogget' | 'ikke-medlem' | 'laast' | 'feil'

/** Hvilken tom skjerm som skal vises. */
export type TomSkjerm = 'logg-inn' | 'ikke-medlem' | 'laast' | 'feil' | 'ingen-data'

// ── STATUSEN ALENE ER IKKE NOK (7. september 2026) ──────────────────────────
// 403 dekker to tilstander som krever to ulike setninger: «du er ikke medlem»
// og «bedriften din er låst» (abonnementet er ikke aktivt). Serveren skiller
// dem med `code: 'org_locked'` i kroppen (lib/org-lock-guard.ts,
// ORG_LOCKED_CODE). Uten koden ville et medlem av en låst bedrift fått «Du er
// ikke medlem av denne bedriften» — usant. Samme feilklasse som 6. september,
// ett lag dypere: der gjettet sesjonen, her er statusen ikke nok.
//
// Literalen står her, ikke importert fra org-lock-guard: den fila importerer
// supabase-admin (server-only) og skal aldri inn i klientbundelen. At de to
// er like voktes av lib/org-lock-read-routes.test.ts.
export const LAAST_KODE = 'org_locked'

/**
 * Leser `code` ut av et avvist svar uten å kaste: en kropp som ikke er JSON
 * (Vercel-feilside, tom 503) gir null, og klassifiseringen faller da tilbake
 * på statusen alene.
 */
export async function lesAvvisningskode(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { code?: unknown } | null
    return typeof body?.code === 'string' ? body.code : null
  } catch {
    return null
  }
}

/**
 * HTTP-status → årsak.
 *
 * Kun 401 og 403 har egne utfall, fordi kun de to er tilstander brukeren kan
 * gjøre noe med (logge inn / ingenting). Alt annet — 400, 429, 500,
 * nettverksbrudd — er «feil», og der ER «prøv igjen» riktig råd.
 *
 * `/api/toppliste` svarer også 400 «Ugyldig scope». Den havner med vilje i
 * «feil»: den kan kun oppstå ved en programmeringsfeil hos oss, og da er en
 * generisk feilmelding riktigere enn å fortelle brukeren noe om medlemskap.
 */
export function klassifiserAvvisning(status: number, code?: string | null): Avvisning {
  if (status === 401) return 'uinnlogget'
  if (status === 403) return code === LAAST_KODE ? 'laast' : 'ikke-medlem'
  return 'feil'
}

/**
 * Årsak → skjerm.
 *
 * Merk at sesjonstilstanden IKKE er med i beslutningen lenger. Fram til nå
 * avgjorde `sessionChecked && !!session` hvilken tekst en feilet henting fikk,
 * slik at en anonym bruker med en 500-feil ble bedt om å logge inn — som ikke
 * hjelper — mens en innlogget bruker med 403 ble bedt om å laste på nytt.
 * Statusen vet; sesjonen gjetter.
 */
export function velgTomSkjerm(avvisning: Avvisning | null): TomSkjerm {
  switch (avvisning) {
    case 'uinnlogget': return 'logg-inn'
    case 'ikke-medlem': return 'ikke-medlem'
    case 'laast': return 'laast'
    case 'feil': return 'feil'
    // Ingen avvisning, men heller ingen data: hentingen gikk gjennom uten å gi
    // noe. Uendret oppførsel — den nøytrale tomme skjermen med innloggings-CTA.
    default: return 'ingen-data'
  }
}

/**
 * «Ikke medlem» av HVA.
 *
 * Samme ordlyd som `/org/[slug]` allerede bruker, gjenbrukt framfor å finne
 * opp en ny. Liga-varianten er FORESLÅTT (Dennis velger): den finnes ikke
 * noe annet sted å låne fra, og en 403 i liga-scope er den samme situasjonen
 * med et annet substantiv.
 *
 * Global scope har ingen medlemskapsgate og kan derfor ikke gi 403. Skulle
 * det likevel skje, er en nøytral formulering riktigere enn å påstå noe om
 * en bedrift eller liga brukeren ikke er i.
 */
/**
 * Samme avvisning, men MIDT I ØKTA.
 *
 * `loadHistory` og `fetchExpanded` er kun nåbare etter at hovedkallet gikk
 * gjennom MED tilgang. En 401 eller 403 der betyr derfor noe annet enn ved
 * første last: tilstanden endret seg mens siden sto åpen. Elkjøp har ~29
 * ansatte, og `scheduled-removals` og `cleanup-orgs` kjører som cron — blir du
 * fjernet fra organisasjonen med siden oppe, er det denne grenen du treffer.
 *
 * ORDLYDEN ER FORESLÅTT (Dennis velger). Begge setningene er sanne på begge
 * flatene, så de deles med vilje: to nesten like formuleringer ville drevet
 * fra hverandre ved første redigering.
 *
 * «feil» hører ikke hjemme her — der er «prøv igjen» riktig, og kallstedene
 * beholder sin egen tekst med retry-knapp.
 */
export function avvistMidtIOkta(avvisning: 'uinnlogget' | 'ikke-medlem' | 'laast'): string {
  if (avvisning === 'laast') return `${LAAST_OVERSKRIFT}. ${LAAST_TEKST}`
  return avvisning === 'ikke-medlem'
    ? 'Du har ikke lenger tilgang til denne listen.'
    : 'Du er logget ut. Logg inn på nytt for å se dette.'
}

/**
 * Låst bedrift — ordlyden.
 *
 * Overskriften er ORDRETT OrgCards setning på forsiden (Dennis, 7. september
 * 2026): samme tilstand, samme ord. Ingen handling tilbys — et medlem kan ikke
 * fornye abonnementet, og en knapp som garantert feiler er verre enn ingen
 * (org-checkout avviser ikke-admin med 403).
 *
 * UNDERTEKSTEN ER FORESLÅTT (Dennis velger). Den sier det som er sant for
 * medlemmet, og bare det: lista er sperret, poengene er trygge, spillingen
 * går som før — de to siste er ordrett løftene fra låst-skjermen på
 * /org/[slug].
 */
export const LAAST_OVERSKRIFT = 'Bedriften venter på fornyelse'
export const LAAST_TEKST = 'Bedriftens liste er sperret til abonnementet er fornyet. Poengene dine er lagret, og du kan spille som vanlig.'

export function ikkeMedlemTekst(scope: 'global' | 'league' | 'organization'): string {
  if (scope === 'organization') return 'Du er ikke medlem av denne bedriften.'
  if (scope === 'league') return 'Du er ikke medlem av denne ligaen.'
  return 'Du har ikke tilgang til denne listen.'
}
