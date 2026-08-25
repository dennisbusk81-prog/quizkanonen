import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'
import { fetchRetentionRows, latestClosedRetention } from '@/lib/retention'
import { fetchAllRows } from '@/lib/paginate'
import { onlyRealQuizzes } from '@/lib/real-quiz-population'

// Datagrunnlaget for /admin/dashboard. Ett kall — siden skal vise ett bilde av
// tilstanden, ikke seks kort som lander til ulik tid.
//
// AGGREGERING: de fleste tallene her er `count: 'exact', head: true`. Det
// returnerer INGEN rader, kun en telling i Content-Range-headeren, og rammes
// derfor aldri av PostgREST sin stille 1000-rads-grense. Kun de to tingene som
// faktisk krever gruppering i databasen bruker RPC
// (weekly_active_players, count_active_leagues — se
// supabase/migrations/20260730000000_dashboard_rpcs.sql).

const WEEKS = 12

// ── MRR-priser (NOK/mnd) ─────────────────────────────────────────────────────
// Utledet fra `organizations.plan` — tabellen har ingen price_id-kolonne, og
// prisen finnes kun som Stripe-price-id-er i miljøvariabler
// (STRIPE_ORG_*_PRICE_ID, se app/api/stripe/org-checkout/route.ts).
//
// 'enterprise' er skreddersydd og finnes ikke i PLAN_PRICES i checkout-ruten.
// 2499 er en avtalt plassholder slik at en fremtidig enterprise-rad ikke
// stille teller som 0.
const PLAN_PRICE_NOK: Record<string, number> = {
  starter: 499,
  standard: 899,
  pro: 1499,
  enterprise: 2499,
}

const B2C_PREMIUM_PRICE_NOK = 49

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const nowIso = new Date().toISOString()

    // Nyeste STENGTE quiz — grunnlaget for «Deltakere siste quiz».
    //
    // onlyRealQuizzes lukker [A-7]: uten den overtar en testquiz kortet, og
    // deltakertallet blir de 2–3 radene testkjøringen la igjen. Filteret gjør
    // dessuten kortet ENIG med retention-kortet rett ved siden av, som allerede
    // avgrenser på is_test (lib/retention.ts:107). Se lib/real-quiz-population.ts.
    //
    // Spørringen står i en LOKAL VARIABEL: inlinet som argument til
    // onlyRealQuizzes() ga TS2589 «Type instantiation is excessively deep».
    // Se lib/real-quiz-population.ts. Ikke inline den tilbake.
    const lastQuizQuery = supabaseAdmin
      .from('quizzes')
      .select('id, title, closes_at')
      .not('closes_at', 'is', null)
      .lt('closes_at', nowIso)
      .order('closes_at', { ascending: false })
      .limit(1)

    const { data: lastQuizRows, error: lastQuizErr } = await onlyRealQuizzes(lastQuizQuery)

    if (lastQuizErr) throw new Error(lastQuizErr.message)
    const lastQuiz = lastQuizRows?.[0] ?? null

    const [
      participantsRes,
      profilesRes,
      premiumRes,
      personalPremiumRes,
      orgRows,
      duelsActiveRes,
      duelsPendingRes,
      weeklyRes,
      leaguesRes,
      retentionRows,
    ] = await Promise.all([
      // Deltakere = innsendte forsøk på quizen. attempts har UNIQUE(user_id,
      // quiz_id) for innloggede, så radtallet ER deltakertallet; anonyme
      // forsøk telles med, som på analytics-siden.
      lastQuiz
        ? supabaseAdmin
            .from('attempts')
            .select('*', { count: 'exact', head: true })
            .eq('quiz_id', lastQuiz.id)
            .not('submitted_at', 'is', null)
        : Promise.resolve({ count: 0, error: null }),

      supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }),

      // Org-medlemmers premium er allerede materialisert inn i
      // profiles.premium_status med premium_source = 'org' (skrives i
      // org/join, org-founders-activate og Stripe-webhooken). Å telle
      // premium_status = true dekker derfor BÅDE B2C og B2B — det skal ikke
      // legges til et separat org-tall oppå, da ville B2B blitt dobbeltelt.
      supabaseAdmin
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('premium_status', true),

      // Kun 'personal' er faktisk betalende B2C. 'founders' er gratis trial,
      // 'org' er dekket av bedriftens abonnement, 'code' er verdikode.
      supabaseAdmin
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('premium_status', true)
        .eq('premium_source', 'personal'),

      // MRR telles over ALLE org-rader. Uten paginering kutter PostgREST stille
      // ved 1000 rader — samme feilklasse som ble rettet i ranking-spørringene
      // 26. juli. I dag er tallet énsifret, men et tak som gjør MRR-tallet
      // STILLE feil ved vekst skal ikke ligge og vente i en økonomivisning.
      fetchAllRows<{ plan: string | null; subscription_status: string }>((from, to) =>
        supabaseAdmin.from('organizations').select('plan, subscription_status').order('id', { ascending: true }).range(from, to)
      ),

      supabaseAdmin
        .from('rivalries')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active'),

      supabaseAdmin
        .from('rivalries')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending'),

      supabaseAdmin.rpc('weekly_active_players', { p_weeks: WEEKS }),
      supabaseAdmin.rpc('count_active_leagues'),
      fetchRetentionRows(),
    ])

    // ── Bedrifter og MRR ─────────────────────────────────────────────────────
    const orgs = orgRows
    const orgsByStatus = { active: 0, trialing: 0, locked: 0 } as Record<string, number>
    let b2bMrr = 0
    const trialingByPlan: Record<string, number> = {}
    let trialingValue = 0

    for (const org of orgs) {
      orgsByStatus[org.subscription_status] = (orgsByStatus[org.subscription_status] ?? 0) + 1
      const price = PLAN_PRICE_NOK[org.plan ?? ''] ?? 0

      // KUN 'active' teller som MRR. 'trialing' er ikke fakturert ennå og
      // skal aldri vises som inntekt.
      //
      // MERK for fremtidige økter: en org kan stå som 'trialing' selv om den
      // reelt er en betalende kunde. Elkjøp ble bevisst satt til trial under
      // testfasen sommeren 2026 som et forsiktighetstiltak mens bugs ble
      // funnet, og skal tilbake til 'active' senere. Et lavt MRR-tall her
      // betyr altså ikke nødvendigvis manglende betalingsvilje — sjekk
      // trial-linjen under kortet før du konkluderer.
      if (org.subscription_status === 'active') {
        b2bMrr += price
      } else if (org.subscription_status === 'trialing') {
        trialingByPlan[org.plan ?? 'ukjent'] = (trialingByPlan[org.plan ?? 'ukjent'] ?? 0) + 1
        trialingValue += price
      }
    }

    const b2cCount = personalPremiumRes.count ?? 0
    const b2cMrr = b2cCount * B2C_PREMIUM_PRICE_NOK

    // ── Graf: ukentlig aktivitet + retention som sekundærserie ───────────────
    const weekly = ((weeklyRes.data ?? []) as { week_start: string; active_players: number }[])
      .map(w => ({ weekStart: w.week_start, activePlayers: Number(w.active_players) }))

    // Retention er per quiz, aktivitet er per uke. Med én quiz i uka faller de
    // sammen; vi plasserer hver quiz sin prosent på uken quizen ÅPNET, slik at
    // de to seriene deler x-akse. Uker uten quiz får null (brudd i linjen),
    // ikke 0 — ingen quiz er ikke det samme som null retention.
    const retentionByWeek = new Map<string, { pct: number; title: string }>()
    for (const row of retentionRows) {
      if (row.retentionPct === null || !row.opensAt) continue
      const key = mondayOf(new Date(row.opensAt))
      if (!retentionByWeek.has(key)) retentionByWeek.set(key, { pct: row.retentionPct, title: row.title })
    }

    const series = weekly.map(w => ({
      weekStart: w.weekStart,
      activePlayers: w.activePlayers,
      retentionPct: retentionByWeek.get(w.weekStart)?.pct ?? null,
    }))

    const latestRetention = latestClosedRetention(retentionRows)

    return NextResponse.json({
      lastQuiz: lastQuiz
        ? {
            id: lastQuiz.id,
            title: lastQuiz.title,
            closesAt: lastQuiz.closes_at,
            participants: participantsRes.count ?? 0,
          }
        : null,
      retention: latestRetention
        ? {
            pct: latestRetention.retentionPct,
            title: latestRetention.title,
            returned: latestRetention.returned,
          }
        : null,
      premium: { total: premiumRes.count ?? 0, personal: b2cCount },
      orgs: {
        active: orgsByStatus.active ?? 0,
        trialing: orgsByStatus.trialing ?? 0,
        locked: orgsByStatus.locked ?? 0,
      },
      profiles: { total: profilesRes.count ?? 0 },
      mrr: {
        total: b2bMrr + b2cMrr,
        b2b: b2bMrr,
        b2c: b2cMrr,
        b2cCount,
        trialingValue,
        trialingByPlan,
      },
      series,
      leagues: { active: Number(leaguesRes.data ?? 0) },
      duels: { active: duelsActiveRes.count ?? 0, pending: duelsPendingRes.count ?? 0 },
    })
  } catch (e) {
    console.error('[dashboard] feilet:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Kunne ikke hente dashboard-data' },
      { status: 500 },
    )
  }
}

/**
 * Mandagen i uken en dato faller i, som YYYY-MM-DD — samme bøtte-nøkkel som
 * weekly_active_players bruker (date_trunc('week', …) i Postgres starter på
 * mandag).
 */
function mondayOf(d: Date): string {
  const copy = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = copy.getUTCDay() // 0 = søndag
  const diff = day === 0 ? -6 : 1 - day
  copy.setUTCDate(copy.getUTCDate() + diff)
  return copy.toISOString().slice(0, 10)
}
