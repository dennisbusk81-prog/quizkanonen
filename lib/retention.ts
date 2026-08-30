import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchAllRows } from '@/lib/paginate'
import { onlyRealQuizzes } from '@/lib/real-quiz-population'

// Retention-beregningen, delt av /api/admin/retention (tabellen på
// /admin/retention) og /api/admin/dashboard (kortet + grafen).
//
// Ligger her framfor å bli reimplementert som en SQL-RPC nettopp fordi to
// implementasjoner av samme tall uunngåelig drifter fra hverandre. Dashboardet
// og retention-siden SKAL alltid vise identiske prosenter.
//
// DEFINISJON (uendret fra 20. juli-kartleggingen): retention for en quiz er
// hvor stor andel av FORRIGE quiz sine spillere som kom tilbake på denne.
// Nevneren er forrige quiz sitt spillertall — ikke denne quizens. Med denne
// quizens tall som nevner ville man målt «andel av dagens spillere som er
// tilbakevendende», som er noe helt annet.
//
// Kun innloggede (user_id NOT NULL) og fullførte (submitted_at NOT NULL)
// forsøk teller.

export type RetentionQuiz = {
  id: string
  title: string
  opens_at: string | null
  closes_at: string | null
}

export type RetentionAttempt = {
  quiz_id: string
  user_id: string
}

export type RetentionRow = {
  quizId: string
  title: string
  opensAt: string | null
  closesAt: string | null
  players: number
  returned: number | null
  retentionPct: number | null
}

/**
 * Ren beregning. `quizzes` MÅ være sortert stigende på opens_at — rekkefølgen
 * er hele grunnlaget for hva «forrige quiz» betyr.
 *
 * Returnerer nyeste først.
 */
export function computeRetention(
  quizzes: RetentionQuiz[],
  attempts: RetentionAttempt[],
): RetentionRow[] {
  // quiz_id → sett av unike user_id som fullførte.
  const playersByQuiz = new Map<string, Set<string>>()
  for (const a of attempts) {
    if (!a.quiz_id || !a.user_id) continue
    let set = playersByQuiz.get(a.quiz_id)
    if (!set) { set = new Set(); playersByQuiz.set(a.quiz_id, set) }
    set.add(a.user_id)
  }

  const rows: RetentionRow[] = quizzes.map((quiz, i) => {
    const players = playersByQuiz.get(quiz.id) ?? new Set<string>()

    // Retention vises på DENNE quizens rad, men måles bakover mot FORRIGE quiz
    // (kronologisk før). Første quiz har ingen forgjenger og får derfor null,
    // ikke 0 — «ingen målt verdi» er ikke det samme som «ingen kom tilbake».
    const prev = quizzes[i - 1]
    const prevPlayers = prev ? (playersByQuiz.get(prev.id) ?? new Set<string>()) : null

    let returned: number | null = null
    let retentionPct: number | null = null
    if (prevPlayers) {
      returned = 0
      for (const uid of players) if (prevPlayers.has(uid)) returned++
      retentionPct = prevPlayers.size > 0 ? Math.round((returned / prevPlayers.size) * 100) : 0
    }

    return {
      quizId: quiz.id,
      title: quiz.title,
      opensAt: quiz.opens_at,
      closesAt: quiz.closes_at,
      players: players.size,
      returned,
      retentionPct,
    }
  })

  // Nyeste øverst.
  rows.reverse()
  return rows
}

/** Henter grunnlaget og beregner. Nyeste først. */
export async function fetchRetentionRows(): Promise<RetentionRow[]> {
  // season_points_awarded=true er den autoritative «faktisk spilt og gjort
  // opp»-markøren (satt av award-season-points, se lib/award-season-points.ts)
  // — IKKE en closes_at-datosammenligning. Dennis planlegger quizer flere uker
  // fram, så en ren dato-sjekk ville tatt med alle de kommende, uspilte
  // radene. Leddet BEHOLDES: det er en egen betingelse («gjort opp»), ikke en
  // erstatning for populasjonsfilteret under.
  //
  // POPULASJONEN kommer derimot fra onlyRealQuizzes. Her sto tidligere
  // `.eq('is_test', false)`, med to hull:
  //
  //   1. INGEN quiz_type-VAKT. En arkivquiz får `is_test = false` satt
  //      EKSPLISITT (lib/archive-copy.ts:201), så is_test-leddet slapp den
  //      GJENNOM. Det eneste som holdt treningsrunder ute av retention-tallet
  //      var at `season_points_awarded` sto på DB-defaulten false — altså en
  //      VERDI ingen har bestemt skal være en vakt. Gjør noe en arkivquiz opp
  //      (en gjenbrukt kodesti, en manuell retting, en framtidig arkiv-XP),
  //      begynner treningsrunder å telle i oppslutningskurven uten at én linje
  //      her er endret. Samme feilklasse som i /api/rivalries/my, der
  //      `closes_at IS NULL` var den tilfeldige vakten.
  //   2. `.eq('is_test', false)` matcher IKKE `is_test IS NULL`, og kolonnen er
  //      nullable — filteret var altså ikke engang totalt for testquizer.
  //      Husformen `.not('is_test', 'is', true)` dekker både false og NULL, og
  //      ligger allerede i helperen.
  //
  // Målt mot prod 29. august 2026: 11 quizer før OG etter — retention-tallet
  // Dennis har lest på /admin/retention og dashboardet er UENDRET, og
  // historiske avlesninger er fortsatt sammenlignbare. Motprøve
  // `quiz_type=in.(archive)` → 0 (filteret binder faktisk).
  //
  // ── is_active FILTRERES BEVISST IKKE (B-33, 30. august 2026) ─────────────
  // Ikke glemt — vurdert og forkastet. Retention er en REGNSKAPSFLATE: den
  // teller hvem som faktisk kom tilbake på quizer som allerede er spilt og
  // gjort opp. «Skjul» i admin skal ikke fjerne resultater folk har spilt —
  // samme side av linjen som cron/award-season-points:58 og
  // org/[slug]/quiz-insights:56, og motsatt av butikkflatene (forsidens «Ukens
  // fakta», /quizer, /api/arkiv, start-attempt). Full drøfting står i
  // app/api/admin/dashboard/route.ts, som er den andre leseren av disse radene.
  //
  // HER LIGGER DESSUTEN DEN AVGJØRENDE GRUNNEN, og den er strukturell:
  // computeRetention regner hver quiz mot FORGJENGEREN I LISTA (linje 68
  // under). Lista er altså ikke et sett, den er en KJEDE. Filtreres en skjult
  // quiz bort herfra, blir etterfølgerens forgjenger stille den nest forrige —
  // og prosenten for en HELT ANNEN quiz endrer seg, etter at den er lest og
  // notert. En vakt her er derfor ikke «ett filter til»; den skriver om
  // historikk stille. Forkastet av den grunn.
  //
  // TAS DETTE OPP IGJEN, er svaret VARIANT 4, og den hører hjemme et annet
  // sted enn her: la KJEDEN regnes komplett som nå, og filtrer kun
  // VISNINGSVALGET — `latestClosedRetention` (nederst i denne filen) og
  // `lastQuiz` i dashboard-ruta. RetentionRow må da bære `is_active`.
  // /admin/retention beholder alle radene, dashbordets to kort flytter seg
  // sammen, og ingen prosent endrer seg bakover.
  //
  // FORM: spørringen i lokal variabel, helperen påført etterpå — inlinet
  // argument gir `next build` TS2589 på lange byggerkjeder.
  const retentionQuizQuery = supabaseAdmin
    .from('quizzes')
    .select('id, title, opens_at, closes_at')
    .not('opens_at', 'is', null)
    .eq('season_points_awarded', true)
    .order('opens_at', { ascending: true })

  const { data: quizzes, error: quizErr } = await onlyRealQuizzes(retentionQuizQuery)

  if (quizErr) throw new Error(quizErr.message)

  // Denne listen vokser monotont over hele historikken (nullstilles aldri) og
  // passerte PostgREST sin stille 1000-rads-grense innen rekkevidde — derfor
  // paginert full henting i stedet for ett enkelt .select().
  //
  // BEVISST UTEN onlyRealQuizAttempts: computeRetention slår KUN opp
  // `playersByQuiz.get(quiz.id)` for quizer som står i listen over — både for
  // `players` og for forgjengeren `prev`. En attempt på en arkiv- eller
  // testquiz havner i kartet under en id ingen spør etter, og teller derfor
  // ikke i noen teller eller nevner. Et `quizzes!inner(id)`-embed her ville
  // lagt en join på hver side av en paginert fullhenting over HELE
  // attempt-historikken uten å endre ett eneste tall. Quiz-listen er gaten;
  // byttes den ut mot noe som ikke avgrenser populasjonen, må vakten inn her
  // i samme endring.
  const attempts = await fetchAllRows<RetentionAttempt>((from, to) =>
    supabaseAdmin
      .from('attempts')
      .select('quiz_id, user_id')
      .not('user_id', 'is', null)
      .not('submitted_at', 'is', null)
      .order('id', { ascending: true })
      .range(from, to)
  )

  return computeRetention(quizzes ?? [], attempts)
}

/**
 * Retention for nyeste STENGTE quiz — tallet dashboard-kortet viser.
 *
 * Filtrerer bort planlagte og pågående quizer: en quiz som åpner i morgen har
 * null spillere ennå og ville gitt 0 % på kortet, som ser ut som et krasj i
 * oppslutningen framfor «ikke spilt ennå».
 */
export function latestClosedRetention(rows: RetentionRow[], now = new Date()): RetentionRow | null {
  return rows.find(r => r.closesAt !== null && new Date(r.closesAt) <= now && r.retentionPct !== null) ?? null
}
