// ── /toppliste?scope=… er en VIDEREKOBLING, ikke en visningsmodus ───────────
//
// REN logikk, ingen React. Kalles fra app/toppliste/page.tsx og testes direkte
// i lib/toppliste-scope.test.ts.
//
// ── HISTORIKK ───────────────────────────────────────────────────────────────
// 6. september 2026 (c1a3115) fikk /toppliste en scope-bryter som byttet
// INNHOLD på stedet: `?scope=organization&scope_id=<id>` viste bedriftens
// liste under bedriftens overskrift. 7. september ble bryteren delt av fire
// flater og lagt om til å NAVIGERE (lib/scope-rail.ts): bedriftens liste bor
// på /org/[slug], den nasjonale på /toppliste. Da fantes det to måter å vise
// bedriften på — den feilklassen navnerunden ryddet — så visningsmodusen ble
// fjernet. Parameterne beholdes som ren viderekobling, slik at lenker noen
// allerede har delt fortsatt lander riktig.
//
// ── FIRE UTFALL ─────────────────────────────────────────────────────────────
//   'none'      ingen scope-parameter → siden viser den nasjonale lista.
//   'redirect'  egen bedrift i URL-en → send til /org/<slug>. Resten av
//               query-strengen (period, hist, …) følger med.
//   'wait'      medlemskapene har ikke landet → hold igjen. Alternativet var å
//               vise den nasjonale lista et øyeblikk og så hoppe — en
//               ansatt som klikket en delt bedriftslenke ville da sett
//               nasjonale tall før bedriftens.
//   'clean'     bekreftet at org-id-en ikke er blant brukerens egne → fjern
//               parameterne, vis nasjonal. Ingen 403: en fremmed lenke er
//               ikke et forsøk på noe, bare en lenke som ikke gjelder deg.
//
// Feilet hentingen av medlemskap, blir det 'none' UTEN rydding: et feilsvar
// er ikke bevis på at brukeren ikke er medlem, og en omlasting kan rette det.
//
// ── SKINNEN ER IKKE HER ─────────────────────────────────────────────────────
// «Vis kun når det finnes minst to valg» (visSkinne) bodde i denne fila fram
// til 7. september. Regelen ligger nå i lib/scope-rail.ts, som alle fire
// flatene deler. Denne fila avgjør kun hva en gammel lenke skal gjøre.

/** Det kalleren vet om ett medlemskap. Speiler MyOrg i ProfileProvider. */
export type ScopeOrg = {
  orgId: string
  orgSlug: string
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

export type TopplisteScopeDecision =
  | { action: 'none' }
  | { action: 'wait' }
  | { action: 'redirect'; orgSlug: string }
  | { action: 'clean' }

export function decideTopplisteScope(input: TopplisteScopeInput): TopplisteScopeDecision {
  const { scopeParam, scopeIdParam, myOrgs, myOrgsLoaded, myOrgsError } = input

  const orgOnsket = scopeParam === 'organization' && typeof scopeIdParam === 'string' && scopeIdParam.length > 0
  if (!orgOnsket) return { action: 'none' }

  const valgt = myOrgs.find(o => o.orgId === scopeIdParam) ?? null
  if (valgt) return { action: 'redirect', orgSlug: valgt.orgSlug }

  // Herfra: URL-en ber om en org vi ikke finner blant medlemskapene.
  // Rekkefølgen betyr noe — «ikke landet» sjekkes FØR «feilet», fordi en
  // henting som pågår ennå ikke har feilet.
  if (!myOrgsLoaded && !myOrgsError) return { action: 'wait' }
  if (myOrgsError) return { action: 'none' }
  return { action: 'clean' }
}

/**
 * Målet for viderekoblingen: /org/<slug> med resten av query-strengen
 * (period, hist, histKey, …) intakt, minus scope-parameterne selv.
 */
export function topplisteRedirectHref(orgSlug: string, search: string): string {
  const params = new URLSearchParams(search)
  params.delete('scope')
  params.delete('scope_id')
  const qs = params.toString()
  return `/org/${orgSlug}${qs ? `?${qs}` : ''}`
}
