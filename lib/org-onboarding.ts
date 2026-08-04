import { isOrgLocked } from '@/lib/org-access'

// Skal en org-admin sendes til /org/[slug]/velkommen?
//
// Ren logikk, ingen I/O — kalleren har allerede org-raden fra admin-data.
// Ligger her og ikke inne i panelet fordi betingelsen må kunne testes: en
// redirect som ikke slutter å fyre, er en løkke rett i fjeset på den eneste
// bedriftskunden vi har.
//
// HVORFOR EN EGEN KOLONNE, IKKE UTLEDNING FRA SVARENE:
// Verken `allow_global_league` eller `org_quiz_closes_at` kan bære dette.
// `allow_global_league` har DB-default `false` (målt mot prod 4. august 2026),
// så «svarte nei» og «svarte aldri» er samme verdi. Og `org_quiz_closes_at`
// er NULL både når spørsmålet er ubesvart OG når admin bevisst valgte
// standardfristen — en betingelse på den ville sendt enhver admin som vil ha
// vanlig stengetid til velkomstsiden om og om igjen, for alltid.
// `onboarding_completed_at` sier i stedet det vi faktisk trenger å vite.

export type OrgOnboardingRow = {
  // Tolererer begge navnekonvensjonene, som isOrgLocked selv gjør:
  // admin-data gir snake_case, my-orgs gir camelCase.
  subscription_status?: string | null
  subscriptionStatus?: string | null
  onboarding_completed_at?: string | null
}

/**
 * True kun når oppsettet aldri er fullført OG orgen er i en tilstand der det
 * gir mening å be om det.
 *
 * REKKEFØLGEN ER POENGET: en låst org skal til låseskjermen, ikke til et
 * oppsett den ikke får lagre uansett — settings-ruten avviser en låst org med
 * 403 (`requireUnlockedOrg`). Låsesjekken kommer derfor først.
 *
 * Når `onboarding_completed_at` er satt, returnerer denne ALDRI true igjen.
 * Det er hele garantien: velkomstsiden nullstiller `org_quiz_opens_at` ved
 * lagring, så et påtvunget gjensyn ville kunne overskrive en åpningstid admin
 * har satt i panelet i mellomtiden.
 */
export function shouldRedirectToWelcome(org: OrgOnboardingRow | null | undefined): boolean {
  if (!org) return false
  if (isOrgLocked(org)) return false
  return !org.onboarding_completed_at
}
