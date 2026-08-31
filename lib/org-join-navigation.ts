/**
 * Hva som skal skje ETTER at POST /api/org/join/[token] har svart OK — ren
 * logikk, trukket ut av app/bli-med/[token]/page.tsx for å være testbar uten
 * React-rigg.
 *
 * Hvorfor 'hard-navigate' og ikke en myk router.push: ProfileProvider er
 * montert i rot-layouten og overlever en myk navigasjon. `myOrgs` ble hentet
 * FØR innmeldingen, og dedupe-vakten (kun første auth-event per bruker-id
 * utløser henting) gjør at ingen re-henting skjer på veien. /org/[slug] leser
 * medlemskapet fra nettopp `myOrgs`, med `myOrgsLoaded=true` fra den gamle
 * hentingen — deriveOrgLoadState gir da 'notfound', og et ferskt medlem møter
 * «Ingen tilgang — Du er ikke medlem av denne bedriften». Forsidens org-kort
 * mangler av samme grunn.
 *
 * En hard navigasjon remonterer ProfileProvider, som henter listen på nytt.
 * Feiler DEN hentingen, er `myOrgsLoaded` fortsatt false og siden viser
 * feilskjermen med «Prøv igjen» — aldri en avvisning. Samme valg som
 * LeaveOrgModal allerede tok for utmelding
 * (window.location.assign('/?melding=org-forlatt')), bare med motsatt fortegn.
 * Alternativet — await refreshMyOrgs() før en myk push — ble valgt bort fordi
 * det binder utfallet til delt context-logikk der to grener (ingen sesjon fra
 * getSession, feilet henting) fortsatt lar den gamle listen stå som bekreftet.
 */
export type OrgJoinNavigation =
  | { kind: 'hard-navigate'; url: string }
  | { kind: 'invalid-response' }

export function decideOrgJoinNavigation(slug: unknown): OrgJoinNavigation {
  // Samme aksept som sidens gamle `if (data.slug)`: svaret kommer fra vårt
  // eget API, men et manglende/tomt felt skal gi feilmelding, ikke en
  // navigasjon til /org/undefined.
  if (typeof slug !== 'string' || slug.length === 0) {
    return { kind: 'invalid-response' }
  }
  return { kind: 'hard-navigate', url: `/org/${slug}` }
}
