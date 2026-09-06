import { isOrgLocked } from '@/lib/org-access'

// ── Scope-skinnen: HVILKE valg den viser, som rene data ─────────────────────
//
// REN logikk. components/ScopeRail.tsx rendrer det denne fila returnerer, og
// lib/scope-rail.test.ts kaller den per brukertype. Fire kallsteder deler den:
// /toppliste, /org/[slug], /liga/[slug] og /leaderboard/[id].
//
// ── MODELLEN (Dennis, 7. september 2026) ────────────────────────────────────
// Brukeren skal kunne bytte mellom de to universene — den nasjonale lista og
// bedriftens — på ALLE lister, i begge retninger. Skinnen NAVIGERER: hver
// flate beholder sin URL og sin ramme, og skinnen sender deg mellom dem.
// Alternativet, å bytte innhold på stedet, ble forkastet fordi /org/[slug]
// da ville blitt en kopi av /toppliste med en annen adresse: kortene der
// («Slik fungerer det», «Forlat organisasjon», låst-skjermen) hører til
// bedriften og måtte skjules når brukeren sto på global.
//
// ── VIS KUN NÅR DET FINNES MINST TO VALG ────────────────────────────────────
// En vanlig spiller uten bedrift skal ikke se en bryter med ett valg. Regelen
// bodde i lib/toppliste-scope.ts (visSkinne) fram til 7. september og ble
// flyttet hit da skinnen ble delt — én kilde, ikke én per flate. På
// /liga/[slug] har en bruker uten bedrift likevel to valg (Alle og ligaen),
// så skinnen vises der med rette.
//
// ── LÅST BEDRIFT VISES IKKE ─────────────────────────────────────────────────
// Samme begrunnelse som OrgCard på forsiden: bedriftens liste er sperret mens
// abonnementet er låst, og lenken ville ført en ansatt til en betalingsskjerm
// hun ikke kan bruke. Segmentet skjules — og med én låst bedrift faller
// skinnen under to valg og forsvinner helt. Dette er en VISNINGSregel;
// serverens gate for org-scope (/api/toppliste, /api/leaderboard/[id]?org=)
// håndhever ikke låsen ennå — egen sak, ikke rørt her.

export const MIN_SCOPE_OPTIONS = 2

/** Det kalleren vet om ett medlemskap. Speiler MyOrg i ProfileProvider. */
export type ScopeRailOrg = {
  orgId: string
  orgSlug: string
  orgName: string
  subscriptionStatus?: string | null
}

export type ScopeRailCurrent =
  | { kind: 'global' }
  | { kind: 'organization'; orgSlug: string }
  | { kind: 'league'; slug: string; name: string }

export type ScopeRailHrefs = {
  /** Lenken bak «Alle». */
  global: string
  /** Lenken bak en bedrift. */
  org: (org: ScopeRailOrg) => string
  /** Lenken bak ligaen — kun når `current.kind === 'league'`. */
  league?: string
}

export type ScopeRailOption = {
  key: string
  label: string
  href: string
  active: boolean
}

export function eligibleScopeOrgs<T extends Pick<ScopeRailOrg, 'subscriptionStatus'>>(orgs: readonly T[]): T[] {
  return orgs.filter(o => !isOrgLocked(o))
}

/**
 * Valgene skinnen skal vise, i rekkefølge: Alle · bedriftene · ligaen (kun på
 * ligaens egen flate). Tom liste når det ikke finnes minst to valg — da skal
 * skinnen ikke rendres i det hele tatt.
 */
export function scopeRailOptions(input: {
  current: ScopeRailCurrent
  myOrgs: readonly ScopeRailOrg[]
  hrefs: ScopeRailHrefs
}): ScopeRailOption[] {
  const { current, myOrgs, hrefs } = input
  const ut: ScopeRailOption[] = [
    { key: 'global', label: 'Alle', href: hrefs.global, active: current.kind === 'global' },
  ]
  for (const org of eligibleScopeOrgs(myOrgs)) {
    ut.push({
      key: `org:${org.orgSlug}`,
      label: org.orgName,
      href: hrefs.org(org),
      active: current.kind === 'organization' && current.orgSlug === org.orgSlug,
    })
  }
  if (current.kind === 'league') {
    ut.push({ key: `league:${current.slug}`, label: current.name, href: hrefs.league ?? '#', active: true })
  }
  return ut.length >= MIN_SCOPE_OPTIONS ? ut : []
}
