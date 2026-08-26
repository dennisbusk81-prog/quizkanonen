// Hvilket org-scope liste-hentingen på topplistesiden skal bruke — søsteren
// til lib/org-scope-notice.ts: notice-funksjonen avgjør hva vi SIER om lista,
// denne avgjør hva vi HENTER. Ren logikk, ingen React. Testdekket i
// lib/org-scope-fetch.test.ts.
//
// Bakgrunn (26. august 2026, brief i
// .claude/QK_OPPDATERING_ORG_SCOPE_TIDSGRENSE_19AUG.md): tidsgrensen på
// getSession() styrte scope-beslutningen direkte — en fornyelse som LYKTES,
// men landet etter grensen, fjernet org-visningen for et ekte medlem med
// gyldig sesjon. Og etter [P-3]-paritetsrefetchen (74b94e7) var feilformen
// blitt den motsatte: når fornyelsen landet (TOKEN_REFRESHED → identiteten
// endres → automatisk re-henting) byttet lista populasjon UNDER leseren,
// fra nasjonal til kolleger, uten at noen ba om det.
//
// AVGJORT 19. august 2026 (80c6fd2) — skal ikke åpnes på nytt:
//   1. Handling, ikke automatisk bytte. Lista skal ALDRI endre seg under en
//      som allerede leser. Lander org-medlemskapet etter at siden er tegnet,
//      TILBYS byttet som knapp («Vi fant bedriften din — vis kollegene») —
//      brukeren utsettes ikke for det.
//   2. Tidsgrensen er et SPINNER-BUDSJETT, ikke en frist på sesjonen —
//      se kommentaren over SESSION_CHECK_MS i app/leaderboard/[id]/page.tsx.
//   3. Ingen ny gjenopprettingsmekanisme: supabase-js serialiserer fornyelsen
//      selv, og TOKEN_REFRESHED via onAuthStateChange er signalet som allerede
//      driver re-hentingen. Denne funksjonen legger bare en POLICY oppå:
//      en automatisk re-henting får ikke bytte populasjon, et klikk får.
//
// `nationalAlreadyServed` er bevisst en HENDELSE («denne sidelastingen har
// alt vist leseren en nasjonal liste for org-lenken»), ikke en UI-tilstand.
// Det er ikke samme feilklasse som det gamle `orgScopeDegraded`-flagget
// (se lib/org-scope-notice.ts): UI-teksten utledes fortsatt av servedOrgSlug
// alene og kan ikke drifte. Policyen «aldri bytt under leseren» handler
// derimot OM historikk — den kan ikke uttrykkes uten å huske hendelsen.

export type FetchScopeDecision = {
  /** Org-scope hentingen skal bruke. null = nasjonal liste. */
  scope: string | null
  /**
   * Verdien «nasjonal liste er vist for org-lenken» skal ha ETTER denne
   * hentingen — kalleren skriver den tilbake og sender den inn ved neste
   * henting. Nullstilles når org-lista faktisk serveres: da er leseren på
   * kollegevisningen, og en senere automatisk re-henting som BEHOLDER scopet
   * er ikke et populasjonsbytte.
   */
  nationalServedForOrg: boolean
}

export function decideFetchScope(input: {
  /** Org-slug fra URL-en — hva brukeren ba om. null = nasjonal lenke. */
  requestedOrg: string | null
  /** getSession() svarte innenfor spinner-budsjettet (outcome.ok). */
  sessionKnown: boolean
  /** Har DENNE sidelastingen allerede vist en nasjonal liste for org-lenken? */
  nationalAlreadyServed: boolean
  /** Har brukeren klikket «vis kollegene»? */
  upgradeRequested: boolean
}): FetchScopeDecision {
  // Nasjonal lenke: det finnes ikke noe org-scope å velge bort. Historikken
  // nullstilles — den gjelder kun så lenge en org faktisk er etterspurt.
  if (!input.requestedOrg) return { scope: null, nationalServedForOrg: false }

  // Verken heng eller feil er et svar på «er du innlogget?». Vi faller til
  // nasjonal visning (tilgjengelig uten token) og husker at leseren nå får
  // se den — det er DET som binder senere automatiske hentinger.
  if (!input.sessionKnown) return { scope: null, nationalServedForOrg: true }

  // Sesjonen er kjent, men leseren har allerede fått den nasjonale lista:
  // en AUTOMATISK re-henting (fornyelsen landet, identiteten endret seg) skal
  // ikke bytte populasjon under lesing. Kun et klikk på knappen får.
  if (input.nationalAlreadyServed && !input.upgradeRequested) {
    return { scope: null, nationalServedForOrg: true }
  }

  // Førstegangshenting med kjent sesjon, eller et eksplisitt klikk: org-scope.
  return { scope: input.requestedOrg, nationalServedForOrg: false }
}
