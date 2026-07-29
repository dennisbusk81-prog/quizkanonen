import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { syncPremiumCache } from '@/lib/premium-state-io'

type Params = { params: Promise<{ slug: string }> }

// POST /api/org/[slug]/leave — et medlem melder seg selv ut av en organisasjon.
//
// slug er her en EKTE slug (ikke en UUID). Org-rutene er delt i to konvensjoner:
// admin-data/settings/set-admin tar slug, mens delete/reset-season/quiz-scores
// tar UUID under samme param-navn. Denne ruten kalles fra medlemssiden
// /org/[slug], som har slugen for hånden — derfor slug.
//
// ABSOLUTT PRINSIPP (samme som org-selvsletting): å forlate en organisasjon skal
// ALDRI røre brukerens personlige konto eller spillhistorikk. Kun raden i
// organization_members fjernes. profiles, attempts, attempt_answers, played_log,
// globale/liga-poeng og ligaer består — brukeren fortsetter som vanlig B2C-bruker.
//
// Org-scopede season_scores beholdes bevisst, nøyaktig som når en admin fjerner
// et medlem (members/[id]/remove rører dem heller ikke): poengene er en del av
// bedriftens sesonghistorikk, ikke brukerens eiendom alene. Å slette dem ville
// skrevet om en allerede avsluttet sesong for alle de andre.
export async function POST(request: NextRequest, { params }: Params) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(`org-leave:${ip}`, 10, 60_000).success) {
    return NextResponse.json({ error: 'For mange forespørsler. Prøv igjen om litt.' }, { status: 429 })
  }

  const bearerToken = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!bearerToken) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(bearerToken)
  if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { slug } = await params

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name')
    .eq('slug', slug)
    .maybeSingle()

  if (!org) return NextResponse.json({ error: 'Organisasjonen finnes ikke' }, { status: 404 })

  // Egen medlemsrad. Ingen admin-sjekk: dette er en selvbetjent handling.
  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('id, role')
    .eq('organization_id', org.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) {
    return NextResponse.json({ error: 'Du er ikke medlem av denne organisasjonen.' }, { status: 404 })
  }

  // ── Siste-admin-sperren ────────────────────────────────────────────────────
  // En org uten administrator kan ikke inviteres til, faktureres eller avsluttes
  // av noen — den ville vært permanent foreldreløs. Sperren er forhåndssjekken;
  // etterkontrollen lenger ned lukker kappløpet mellom to samtidige utmeldinger.
  if (membership.role === 'admin') {
    const { count: adminCount, error: countErr } = await supabaseAdmin
      .from('organization_members')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id)
      .eq('role', 'admin')

    // Kan vi ikke bekrefte antallet, slipper vi INGEN admin ut. Å feile mot en
    // unødvendig blokkering er trivielt for brukeren å komme seg ut av; å feile
    // andre veien etterlater en organisasjon ingen kan administrere.
    if (countErr || adminCount == null) {
      console.error(`[org-leave] kunne ikke telle administratorer — org=${org.id}:`, countErr?.message ?? 'count var null')
      return NextResponse.json(
        { error: 'Kunne ikke bekrefte administratorene akkurat nå. Prøv igjen om litt.' },
        { status: 503 },
      )
    }

    if (adminCount <= 1) {
      return NextResponse.json({
        error: 'Du er eneste administrator. Utpek en ny admin først, eller slett organisasjonen om den ikke lenger skal brukes.',
        code: 'last_admin',
        adminCount,
      }, { status: 409 })
    }
  }

  // Fjern medlemskapet. Samme mønster som members/[id]/remove: både error OG
  // antall matchede rader sjekkes, slik at en samtidig fjerning ikke gir en
  // suksessrespons for noe denne forespørselen ikke gjorde. `select('*')` gir
  // oss dessuten hele raden tilbake, som er det vi trenger for å kunne angre.
  const { data: removedRows, error: removeErr } = await supabaseAdmin
    .from('organization_members')
    .delete()
    .eq('id', membership.id)
    .select('*')

  if (removeErr || !removedRows || removedRows.length === 0) {
    console.error(
      `[org-leave] utmelding feilet — membership=${membership.id} org=${org.id} user=${user.id}:`,
      removeErr?.message ?? 'matchet 0 rader',
    )
    return NextResponse.json({ error: 'Kunne ikke forlate organisasjonen. Prøv igjen.' }, { status: 500 })
  }

  const removedRow = removedRows[0] as Record<string, unknown>

  // ── Etterkontroll: lukker kappløpet forhåndssjekken ikke kan fange ─────────
  // To administratorer som trykker samtidig ser begge «2 administratorer» og
  // slipper begge gjennom vakten over. Etter slettingen teller vi på nytt: står
  // orgen igjen uten admin, angrer vi denne utmeldingen og gir samme 409 som
  // forhåndssjekken. Den ene som rakk først beholder utmeldingen sin.
  if (removedRow.role === 'admin') {
    const { count: remainingAdmins, error: recountErr } = await supabaseAdmin
      .from('organization_members')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id)
      .eq('role', 'admin')

    if (recountErr || remainingAdmins == null || remainingAdmins === 0) {
      const { error: restoreErr } = await supabaseAdmin.from('organization_members').insert(removedRow)

      if (restoreErr) {
        // Verste utfall: raden er borte OG kunne ikke gjenopprettes. Da er orgen
        // uten administrator og må rettes manuelt — logg alt som trengs for det.
        console.error(
          `[org-leave] KRITISK: kunne ikke gjenopprette admin-medlemskap etter avbrutt utmelding — ` +
          `org=${org.id} user=${user.id} membership=${membership.id}. Organisasjonen står nå UTEN admin:`,
          restoreErr.message,
        )
        return NextResponse.json(
          { error: 'Noe gikk galt under utmeldingen. Kontakt support — organisasjonen kan mangle administrator.' },
          { status: 500 },
        )
      }

      console.error(
        `[org-leave] utmelding rullet tilbake — org=${org.id} user=${user.id}: ` +
        `${recountErr ? `ny telling feilet (${recountErr.message})` : 'ville etterlatt orgen uten admin'}`,
      )
      return NextResponse.json({
        error: 'Du er eneste administrator. Utpek en ny admin først, eller slett organisasjonen om den ikke lenger skal brukes.',
        code: 'last_admin',
        adminCount: 1,
      }, { status: 409 })
    }
  }

  // ── Premium rekalkuleres, aldri antas ─────────────────────────────────────
  // MÅ kjøre ETTER slettingen: getOrgCoverage leser organization_members, så en
  // rekalkulering før sletting ville fortsatt sett org-dekningen.
  //
  // Ingen grace-periode her, i motsetning til members/[id]/remove: å bli kastet
  // ut er ufrivillig og fortjener en mykere landing, mens dette er brukerens
  // eget valg. syncPremiumCache beholder uansett Premium hvis brukeren har en
  // verdikode eller et eget abonnement — den slår aldri av noe som er dekket.
  //
  // Feiler den (typisk Stripe nede), er medlemskapet like fullt fjernet, som er
  // det brukeren ba om. Cachen selv-heler ved neste webhook eller cron-kjøring,
  // så vi logger i stedet for å rulle tilbake en korrekt utmelding.
  let premiumRecomputed = true
  try {
    await syncPremiumCache(user.id)
  } catch (err) {
    premiumRecomputed = false
    console.error(
      `[org-leave] premium-rekalkulering feilet — user=${user.id} org=${org.id} ` +
      `(cachen selv-heler ved neste webhook/cron):`,
      err,
    )
  }

  // Spor handlingen på orgen. Samme form som resten av admin_actions-bruken:
  // aldri blokkerende, men aldri stille heller.
  try {
    const { error: logErr } = await supabaseAdmin.from('admin_actions').insert({
      user_id: user.id,
      action_type: 'org_member_left',
      scope_type: 'organization',
      scope_id: org.id,
    })
    if (logErr) console.error('[org-leave] admin_actions-logging feilet', org.id, logErr.message)
  } catch (err) {
    console.error('[org-leave] admin_actions-logging kastet', org.id, err)
  }

  console.log(`[org-leave] user=${user.id} forlot org "${org.name}" (${org.id}), rolle=${removedRow.role}`)

  return NextResponse.json({ ok: true, orgName: org.name, premiumRecomputed })
}
