/**
 * Hvilken skjerm `/org/[slug]` skal vise — ren logikk, trukket ut av
 * `app/org/[slug]/page.tsx` for å være testbar uten React.
 *
 * Bakgrunn (31. juli 2026): siden utledet «ikke medlem» som «ikke lenger
 * loading OG slug-en finnes ikke i myOrgs». `myOrgs: []` betydde da to helt
 * ulike ting — «ikke hentet ennå» og «hentet, du er faktisk ikke medlem» —
 * og `profileLoading` var ikke et signal om at my-orgs-kallet var ferdig:
 * ProfileProvider satte det til false fem steder, og bare ETT av dem
 * (`finally` i `loadAll`) innebar at listen faktisk hadde landet. Både
 * dedupe-grenen (et andre auth-event for samme bruker, typisk
 * TOKEN_REFRESHED midt i hentingen) og 3-sekunders sikkerhetsventilen slapp
 * gjennom med tom liste, og ekte ansatte fikk et glimt av «Du er ikke
 * medlem av denne bedriften».
 *
 * Samme invariant som lib/fetch-result.ts: et feilsvar er «vet ikke», aldri
 * «tomt». Derfor er `notFound` her betinget av en BEKREFTET henting, ikke av
 * fravær av en laste-flagg.
 */

export type OrgLoadState = 'loading' | 'ready' | 'notfound' | 'error'

export type OrgMembershipInput = {
  /** undefined = sesjonssjekken har ikke svart ennå, null = utlogget. */
  session: 'unchecked' | 'anonymous' | 'authenticated'
  /** True hvis brukerens org-liste inneholder slug-en vi ser på. */
  hasOrg: boolean
  /** True KUN når my-orgs faktisk har svart OK — ikke ved feil, ikke ved timeout. */
  myOrgsLoaded: boolean
  /** True når siste my-orgs-forsøk feilet (401/500/nettverk). */
  myOrgsError: boolean
}

/**
 * Rekkefølgen er meningsbærende:
 *
 * 1. Uten avklart sesjon vet vi ingenting — vis laster (siden redirigerer
 *    selv til /login når den er avklart utlogget).
 * 2. Har vi allerede en bekreftet org, VINNER den over en senere transient
 *    feil. En bruker som ser bedriften sin skal ikke kastes ut på skjermen
 *    fordi en re-henting feilet.
 * 3. Feil er «vet ikke» → feilskjerm med retry, ALDRI «ikke medlem».
 * 4. Kun en bekreftet henting uten treff gir «ikke medlem».
 * 5. Alt annet er fortsatt underveis.
 */
export function deriveOrgLoadState(input: OrgMembershipInput): OrgLoadState {
  if (input.session !== 'authenticated') return 'loading'
  if (input.hasOrg) return 'ready'
  if (input.myOrgsError) return 'error'
  if (input.myOrgsLoaded) return 'notfound'
  return 'loading'
}
