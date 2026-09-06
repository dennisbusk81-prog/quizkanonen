// ── Hvilket felt viser /toppliste? ──────────────────────────────────────────
//
// Ren beslutning, ingen I/O. Kalles av app/toppliste/page.tsx, som eier
// scope-bryteren (6. september 2026).
//
// ── HVORFOR URL-EN IKKE SENDES RÅTT VIDERE ──────────────────────────────────
// `?scope=organization&scope_id=<id>` kan peke på en hvilken som helst
// organisasjon. Gaten i /api/toppliste er autoritativ og svarer 403 til en
// ikke-medlem, så ingenting lekker uansett hva denne funksjonen gjør. Men
// 403-grenen i SeasonLeaderboard viser «Noe gikk galt. Prøv å laste siden på
// nytt» — et råd som aldri kan hjelpe, fordi ingen mengde omlastinger gjør
// deg til medlem. Derfor sender vi ikke forespørselen i det hele tatt når vi
// VET at brukeren ikke er medlem: en fremmed som klikker en delt lenke får
// den offentlige lista.
//
// ── «VET IKKE» ER EN EGEN TILSTAND, TO GANGER ───────────────────────────────
// Medlemskapene lastes asynkront, og de kan feile. De to utfallene er ikke
// det samme, og ingen av dem er «ikke medlem»:
//
//   IKKE LANDET ENNÅ  → `venter`. Siden holder igjen. Alternativet var å
//     vise global først og bytte når svaret kom: feil liste under feil
//     overskrift i et halvt sekund, pluss en henting vi kaster.
//
//   FEILET           → vi konkluderer ALDRI «ikke medlem» av en feil
//     (lib/fetch-result.ts-regelen). Men vi kan heller ikke vente evig — uten
//     denne grenen ville en bruker med en bokmerket org-lenke stått fast på
//     «Henter bedriften din …» for alltid når hentingen feilet. Utfallet er
//     derfor global: en degradert, men SANN visning (global liste under
//     global overskrift), som retter seg selv ved omlasting. URL-en ryddes
//     IKKE — vi vet ikke nok til å fjerne brukerens eget valg.
//
// ── RYDDING AV URL-EN ───────────────────────────────────────────────────────
// `ryddUrl` settes kun når vi har et BEKREFTET svar om at org-id-en ikke er
// blant brukerens egne. Da fjernes scope-parameterne, slik at en delt lenke
// ikke etterlater en bedriftsoverskrift over globale tall.

/** Det kalleren vet om ett medlemskap. Speiler MyOrg i ProfileProvider. */
export type ScopeOrg = {
  orgId: string
}

export type TopplisteScopeInput = {
  /** `scope`-parameteren fra URL-en. */
  scopeParam: string | null
  /** `scope_id`-parameteren fra URL-en. */
  scopeIdParam: string | null
  /** Brukerens bekreftede medlemskap. Tom liste for gjest. */
  myOrgs: readonly ScopeOrg[]
  /** Har medlemskapene landet? Utlogget teller som BEKREFTET (tom liste). */
  myOrgsLoaded: boolean
  /** Feilet hentingen av medlemskapene? */
  myOrgsError: boolean
}

export type TopplisteScopeDecision = {
  /** Hva SeasonLeaderboard skal hente. */
  scope: 'global' | 'organization'
  /** Org-id-en å hente for, eller null i global visning. */
  valgtOrgId: string | null
  /** Hvilken overskrift siden skal vise. */
  ramme: 'global' | 'organization'
  /** Vis scope-skinnen? Kun den som har noe å bytte mellom. */
  visSkinne: boolean
  /** Hold igjen hentingen — medlemskapene har ikke landet. */
  venter: boolean
  /** Fjern scope-parameterne fra URL-en. */
  ryddUrl: boolean
}

export function decideTopplisteScope(input: TopplisteScopeInput): TopplisteScopeDecision {
  const { scopeParam, scopeIdParam, myOrgs, myOrgsLoaded, myOrgsError } = input

  // Skinnen henger på medlemskap, ikke på hva URL-en påstår. En gjest har
  // ingen, og en vanlig spiller skal ikke se en bryter med ett valg.
  const visSkinne = myOrgs.length > 0

  const orgOnsket = scopeParam === 'organization' && typeof scopeIdParam === 'string' && scopeIdParam.length > 0
  if (!orgOnsket) {
    return { scope: 'global', valgtOrgId: null, ramme: 'global', visSkinne, venter: false, ryddUrl: false }
  }

  const valgt = myOrgs.find(o => o.orgId === scopeIdParam) ?? null
  if (valgt) {
    return {
      scope: 'organization',
      valgtOrgId: valgt.orgId,
      ramme: 'organization',
      visSkinne,
      venter: false,
      ryddUrl: false,
    }
  }

  // Herfra: URL-en ber om en org vi ikke finner blant medlemskapene.
  // Rekkefølgen betyr noe — «ikke landet» sjekkes FØR «feilet», fordi en
  // henting som pågår ennå ikke har feilet, og fordi ventetilstanden er den
  // eneste som gir riktig førstevisning for et ekte medlem.
  if (!myOrgsLoaded && !myOrgsError) {
    return {
      scope: 'global',
      valgtOrgId: null,
      // Overskriften følger det URL-en ba om: viser vi «Topplisten» her og
      // bytter etterpå, har rammen vært feil i mellomtiden.
      ramme: 'organization',
      visSkinne,
      venter: true,
      ryddUrl: false,
    }
  }

  if (myOrgsError) {
    // Degradert, men sant: global liste under global overskrift. Ingen
    // rydding — et feilsvar er ikke bevis på at brukeren ikke er medlem.
    return { scope: 'global', valgtOrgId: null, ramme: 'global', visSkinne, venter: false, ryddUrl: false }
  }

  // Bekreftet: brukeren er ikke medlem av den org-en. Rydd URL-en.
  return { scope: 'global', valgtOrgId: null, ramme: 'global', visSkinne, venter: false, ryddUrl: true }
}
