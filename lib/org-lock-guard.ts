import { supabaseAdmin } from '@/lib/supabase-admin'
import { isOrgLocked } from '@/lib/org-access'

// ── Server-side håndheving av org-låsen ─────────────────────────────────────
//
// En org låses (`subscription_status = 'locked'`) når en B2B-trial utløper uten
// betaling, eller når abonnementet dør. Fram til 29. juli 2026 var låsen KUN en
// UI-sperre: `isOrgLocked` ble lest i app/org/[slug]/page.tsx og
// app/org/[slug]/admin/page.tsx, mens INGEN rute under /api/org sjekket den.
// Et curl-kall med en gyldig sesjon kunne dermed invitere ansatte, sende e-post
// fra vårt domene, endre bedriftsnavnet og hente ut hele bedriftsanalysen etter
// at betalingen stoppet.
//
// INVARIANT: enhver rute som utfører eller utleverer noe av det betalte
// bedriftsproduktet kaller `requireUnlockedOrg()` — ETTER sin egen auth- og
// admin-sjekk, slik at en utenforstående ikke får vite noe om org-en i det hele
// tatt. De bevisste unntakene står i tabellen under.
//
// BEVISSTE UNNTAK (skal IKKE ha vakten):
//   /api/org/[slug]/leave        — ansatte må kunne forlate en låst org
//   /api/org/[slug]/delete       — admin må kunne avvikle en låst org
//   /api/org/[slug]/admin-data   — lås-skjermen rendres FRA dette svaret
//   /api/org/my-orgs             — samme, for /org/[slug]
//   /api/org/my-quiz-times       — quiz-spilling. Låsen skal aldri hindre en
//                                  ansatt i å spille den ukentlige quizen
//   /api/org/[slug]/league-preference — ansattes egen opt-out, angår kun dem selv
//   /api/stripe/org-checkout     — veien UT av låsen (reactivateOrgId)

export const ORG_LOCKED_CODE = 'org_locked'

export const ORG_LOCKED_ERROR =
  'Bedriftens abonnement er ikke aktivt. En administrator må fornye det på ' +
  'bedriftssiden før dette kan gjøres.'

/**
 * Egen tekst til den som prøver å bli med via en invitasjonslenke. Den som
 * klikker er en ansatt uten tilgang til abonnementet — meldingen skal peke på
 * administratoren, ikke på en handling de ikke har. Samme resonnement som
 * medlemsgrense-avvisningen i /api/org/join/[token].
 */
export const ORG_LOCKED_JOIN_ERROR =
  'Bedriftens abonnement er ikke aktivt akkurat nå. Ta kontakt med ' +
  'administratoren deres, så kan de fornye det.'

/** Slug ELLER org-UUID — rutene er ikke konsistente på hva `[slug]` inneholder. */
export type OrgRef = { slug: string } | { id: string }

export type OrgLockRow = {
  id: string
  slug: string
  name: string
  plan: string | null
  subscription_status: string | null
}

export type OrgLockGuard =
  | { ok: true; org: OrgLockRow }
  | { ok: false; status: 403 | 404 | 503; body: { error: string; code?: string } }

/**
 * Slår opp org-en og avviser hvis den er låst.
 *
 * Returnerer org-raden ved suksess, slik at en kaller som uansett trengte den
 * kan gjenbruke oppslaget i stedet for å gjøre sitt eget.
 *
 * FEILER LUKKET: går oppslaget i stå, får kalleren 503 — ikke fri passasje.
 * Samme linje som siste-admin-vakten i /api/org/[slug]/leave: en kortvarig,
 * tydelig blokkering er langt billigere enn å slippe gjennom en handling vi
 * ikke fikk bekreftet at var lov.
 */
export async function requireUnlockedOrg(ref: OrgRef): Promise<OrgLockGuard> {
  const column = 'slug' in ref ? 'slug' : 'id'
  const value = 'slug' in ref ? ref.slug : ref.id

  const { data: org, error } = await supabaseAdmin
    .from('organizations')
    .select('id, slug, name, plan, subscription_status')
    .eq(column, value)
    .maybeSingle()

  if (error) {
    console.error(`[org-lock] oppslag feilet — ${column}=${value}:`, error.message)
    return {
      ok: false,
      status: 503,
      body: { error: 'Kunne ikke bekrefte bedriftens abonnement akkurat nå. Prøv igjen om litt.' },
    }
  }

  if (!org) {
    return { ok: false, status: 404, body: { error: 'Organisasjonen finnes ikke' } }
  }

  if (isOrgLocked(org)) {
    return {
      ok: false,
      status: 403,
      body: { error: ORG_LOCKED_ERROR, code: ORG_LOCKED_CODE },
    }
  }

  return { ok: true, org: org as OrgLockRow }
}
