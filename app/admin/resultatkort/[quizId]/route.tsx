import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchAllRowsChunked } from '@/lib/paginate'
import { getPublicSnapshot } from '@/lib/public-snapshot'
import { erEkteQuiz } from '@/lib/real-quiz-population'
import {
  byggResultatkort,
  filnavnDato,
  formatTid,
  type KortSpiller,
} from '@/lib/resultatkort'

// ── Ukas resultater som ÉTT bilde, rendret på serveren ──────────────────────
//
// Dennis deler resultatene i Facebook hver fredag. Fram til nå tok han et
// skjermbilde av den offentlige resultatlisten, og det bildet var ikke det
// samme to uker på rad: «Utfordre» sto ut for hvert navn, og på mobil falt
// TID-kolonnen bort helt. Utfallet hang altså på hvilken skjerm han satt ved.
//
// ── HVORFOR SERVEREN RENDRER, OG IKKE NETTLESEREN ──────────────────────────
// Det er hele poenget. `next/og` (som ER @vercel/og — satori + resvg, vendet
// inn i Next, derfor ingen ny avhengighet i package.json) tegner bildet med
// våre egne fontfiler i en fast 1080×1350-ramme. Samme bytes uansett om
// forespørselen kommer fra PC eller mobil. En klientside-løsning
// (html-to-image o.l.) ville arvet nøyaktig den skjermavhengigheten oppgaven
// finnes for å fjerne.
//
// ── SATORI ER IKKE EN NETTLESER ────────────────────────────────────────────
// Kun flexbox og et subsett av CSS. Ingen `display: grid`, ingen webfonter via
// CSS — fontene må inn som ArrayBuffer. Se regelen rett over `Uthevet` nederst
// i fila for den ene fellen som faktisk felte denne rendringen under bygging.
//
// EMOJI: kortets egen tekst bruker ingen — men SPILLERNAVN kan inneholde dem,
// og gjør det i dag («Azets Ski🎿📈💰», målt 11. september 2026). Satori
// tegner dem ved å HENTE twemoji-SVG-er fra et CDN under rendringen. Det
// virker (verifisert lokalt), men betyr at ett bilde i blant gjør utgående
// nettverkskall. Faller CDN-et, er det navnet som mister ikonene — ikke hele
// kortet. Emoji skal derfor ikke strippes fra navn her: det ville endret
// navnet folk selv har valgt.
//
// ── RANGERINGEN ER IKKE SKREVET HER ────────────────────────────────────────
// `getPublicSnapshot` er den ene implementasjonen av «det synlige feltet for
// en quiz»: kanonisk rangering (flest riktige → raskest tid → flest riktige
// på rad, via rankQuizAttempts), dedup per spiller, kun innsendte forsøk, og
// den globale blokkerings-gaten. Gaten er ikke pynt: en spiller som har meldt
// seg ut av den åpne konkurransen skal ikke havne i et Facebook-innlegg.
// Ruten sorterer derfor ingenting selv — den plukker (lib/resultatkort.ts).
//
// ── FLATEN ER ADMIN-ONLY ───────────────────────────────────────────────────
// `verifyAdminRequest` FØRST, deretter UUID-vakta — samme rekkefølge som
// resten av admin, og rekkefølgen er testfelt i lib/admin-users-id-uuid.test.ts:
// en uautentisert kaller skal få 401 også for en ugyldig id, ikke lære hvilke
// id-er som er velformede. Bildet hentes med `adminFetch` fra knappen i
// /admin/quizzes, som er det som setter `x-admin-token` — et vanlig <a href>
// ville fått 401.

// Lese-/lettskriv-rute: kun egen DB — men med en PNG-render på toppen, som er
// ekte CPU-arbeid (satori-layout + resvg-rasterisering av 1080×1350). 15 er
// fortsatt rikelig; budsjettet er her for at en treg DB-runde ikke skal kutte
// selve rendringen på midten.
export const maxDuration = 15

// Samme vakt som søsterrutene (users/[id], start-attempt, arkiv/[id]): id-en
// kommer rått fra URL-stien, og en ikke-UUID ville ellers nådd Postgres som
// 22P02.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Fast format, hver uke. Endres tallene, må avstandene under regnes om —
// de er valgt mot nettopp disse.
const BREDDE = 1080
const HOYDE = 1350

const FARGE = {
  bakgrunn: '#1a1c23',
  kort: '#21242e',
  kant: '#2a2d38',
  gull: '#c9a84c',
  tittel: '#ffffff',
  brodtekst: '#e8e4dd',
  hint: '#918f8a',
} as const

const SERIF = 'Libre Baskerville'
const SANS = 'Instrument Sans'

type Profil = { id: string; display_name: string | null; nickname: string | null }

/**
 * Fontene satori skal tegne med.
 *
 * Leses fra disk ved første kall og holdes i modul-scope — en varm
 * serverless-instans betaler filsystemrunden én gang, ikke per bilde.
 *
 * `join(process.cwd(), …)` med literale filnavn er formen Next selv
 * dokumenterer for nettopp dette (docs for opengraph-image), og er den
 * `@vercel/nft` klarer å spore med inn i deployet. Gjør du stien dynamisk,
 * forsvinner fontene ut av tracen og ruta feiler først i prod.
 */
let fontCache: Promise<{ navn: string; data: Buffer; vekt: 400 | 700 }[]> | null = null

function lastFonter() {
  if (!fontCache) {
    const mappe = join(process.cwd(), 'assets', 'fonts')
    fontCache = Promise.all([
      readFile(join(mappe, 'LibreBaskerville-Bold.ttf')),
      readFile(join(mappe, 'InstrumentSans-Regular.ttf')),
      readFile(join(mappe, 'InstrumentSans-Bold.ttf')),
    ]).then(([serifBold, sansRegular, sansBold]) => [
      { navn: SERIF, data: serifBold, vekt: 700 as const },
      { navn: SANS, data: sansRegular, vekt: 400 as const },
      { navn: SANS, data: sansBold, vekt: 700 as const },
    ])
    // En lesefeil skal ikke fryse en avvist promise i modul-scope for
    // instansens levetid — neste forespørsel skal få et ekte nytt forsøk.
    // Samme grunn som at getGloballyBlockedSet aldri cacher en feil.
    fontCache.catch(() => { fontCache = null })
  }
  return fontCache
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ quizId: string }> },
) {
  if (!verifyAdminRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { quizId } = await params
  if (!UUID_RE.test(quizId)) {
    return NextResponse.json({ error: 'Ugyldig quiz-id' }, { status: 400 })
  }

  const { data: quizRad, error: quizFeil } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, opens_at, closes_at, season_points_awarded, is_test, quiz_type')
    .eq('id', quizId)
    .maybeSingle()

  if (quizFeil) {
    return NextResponse.json({ error: quizFeil.message }, { status: 500 })
  }
  if (!quizRad) {
    return NextResponse.json({ error: 'Quiz ikke funnet' }, { status: 404 })
  }

  const quiz = quizRad as {
    id: string
    title: string
    opens_at: string | null
    closes_at: string | null
    season_points_awarded: boolean | null
    is_test: boolean | null
    quiz_type: string | null
  }

  // Testquizer og arkivkopier ut — samme definisjon som alle andre lesere som
  // rangerer folk (lib/real-quiz-population.ts), og samme predikat som
  // knappen i /admin/quizzes vises på. Et resultatkort fra en testquiz ville
  // sett helt ekte ut i en Facebook-tråd.
  if (!erEkteQuiz(quiz)) {
    return NextResponse.json(
      { error: 'Resultatkort lages kun for ekte quizer (ikke test eller arkiv).' },
      { status: 400 },
    )
  }

  const { publicSnapshot } = await getPublicSnapshot(quizId, {
    seasonPointsAwarded: quiz.season_points_awarded === true,
  })

  // Navn: kallenavn foran profilnavn foran navnet ved spilletidspunktet —
  // samme rekkefølge som den offentlige resultatlisten bygger sin linje 1 av
  // (app/leaderboard/[id]/page.tsx:1240). Kortet skal vise samme navn som
  // lista det erstatter.
  //
  // FAIL-STENGT: klarer vi ikke lese profilene, avbryter vi. Å falle tilbake
  // på `player_name` ville stille avslørt det EKTE navnet til alle som med
  // vilje spiller under kallenavn — i et innlegg som deles offentlig. Samme
  // kontrakt som fetchNicknames i /api/leaderboard/[id], som svarer 503.
  const brukerIder = [...new Set(
    publicSnapshot.map(e => e.user_id).filter((id): id is string => !!id)
  )]
  let profiler: Profil[] = []
  if (brukerIder.length > 0) {
    try {
      profiler = await fetchAllRowsChunked<Profil>(
        brukerIder,
        (chunk, from, to) =>
          supabaseAdmin
            .from('profiles')
            .select('id, display_name, nickname')
            .in('id', chunk)
            .order('id', { ascending: true })
            .range(from, to),
      )
    } catch (e) {
      console.error(
        '[resultatkort] profil-oppslag feilet — kortet lages ikke:',
        e instanceof Error ? e.message : e,
      )
      return NextResponse.json(
        { error: 'Kunne ikke hente navnene akkurat nå. Prøv igjen om litt.' },
        { status: 503 },
      )
    }
  }

  const profilPerBruker = new Map<string, Profil>()
  for (const p of profiler) profilPerBruker.set(p.id, p)

  const felt: KortSpiller[] = publicSnapshot.map(e => {
    const profil = e.user_id ? profilPerBruker.get(e.user_id) : undefined
    const kallenavn = profil?.nickname?.trim()
    return {
      rank: e.rank,
      navn: (kallenavn || profil?.display_name || e.player_name || '?').trim(),
      riktige: e.correct_answers,
      totalTidMs: e.total_time_ms,
    }
  })

  const kort = byggResultatkort(felt)
  if (!kort) {
    return NextResponse.json(
      { error: 'Ingen innsendte resultater på denne quizen ennå.' },
      { status: 404 },
    )
  }

  const fonter = await lastFonter()
  const filnavn = `quizkanonen-resultater-${filnavnDato(quiz.closes_at ?? quiz.opens_at)}.png`

  const bilde = new ImageResponse(tegnKort(quiz.title, kort), {
    width: BREDDE,
    height: HOYDE,
    fonts: fonter.map(f => ({
      name: f.navn,
      data: f.data as unknown as ArrayBuffer,
      weight: f.vekt,
      style: 'normal' as const,
    })),
  })

  // ImageResponse ER en Response, men headerne må settes på en ny — ellers
  // kommer PNG-en ned som `inline` uten filnavn, og nedlastingen i admin
  // mister navnet Dennis skal kjenne igjen uke for uke.
  return new NextResponse(bilde.body, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="${filnavn}"`,
      // Resultatene kan endres i ettertid (en fasitkorreksjon regraderer hele
      // feltet), så ingen skal ligge og servere et gammelt kort.
      'Cache-Control': 'no-store',
    },
  })
}

// ── Selve tegningen ─────────────────────────────────────────────────────────
//
// REGELEN DENNE SEKSJONEN ER SKREVET ETTER: hvert eneste <div> har en
// EKSPLISITT `display`. Ikke bare de med flere barn.
//
// Målt under bygging 11. september 2026: cellen
// `<div style={{ width: 64 }}>{rad.rank}</div>` — ett barn, og barnet er et
// TALL — felte hele rendringen med «Expected <div> to have explicit
// display: flex … if it has more than one child node». Feilmeldingen peker på
// antall barn, men antallet var ikke problemet: samme celle med
// `display: 'flex'` rendret umiddelbart. Tallene skrives derfor også som
// strenger (`{`${rad.rank}`}`), og «N deltakere» som ÉN streng i stedet for
// `{n} {ord}` — den formen gir tre barn i JSX.
//
// Konsekvensen for den som endrer noe her: et <div> uten `display` kan gi et
// 500 som klager over noe annet enn det du gjorde, og først når ekte data
// treffer den grenen. Sett `display` med én gang.

/** Ett av de tre utheva kortene øverst. */
function Uthevet({
  etikett,
  navn,
  linjer,
  fremhevet,
  forskyv,
}: {
  etikett: string
  navn: string
  linjer: string[]
  fremhevet: boolean
  /** Luft mot kortet til venstre. Av på det første kortet i raden. */
  forskyv: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minWidth: 0,
        marginLeft: forskyv ? 20 : 0,
        backgroundColor: FARGE.kort,
        border: `1px solid ${fremhevet ? FARGE.gull : FARGE.kant}`,
        borderRadius: 16,
        padding: '24px 22px',
      }}
    >
      <div
        style={{
          display: 'flex',
          fontFamily: SANS,
          fontWeight: 700,
          fontSize: 17,
          letterSpacing: 1.6,
          color: FARGE.gull,
        }}
      >
        {etikett}
      </div>
      <div
        style={{
          // Satori bryter ikke tekst slik en nettleser gjør. Et langt navn
          // klippes heller enn å dytte kortet ut av rammen — formatet er fast.
          display: 'flex',
          overflow: 'hidden',
          fontFamily: SANS,
          fontWeight: 700,
          fontSize: 27,
          lineHeight: 1.2,
          color: FARGE.tittel,
          marginTop: 14,
        }}
      >
        {navn}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 12 }}>
        {linjer.map((linje, i) => (
          <div
            key={linje}
            style={{
              display: 'flex',
              fontFamily: SANS,
              fontWeight: 400,
              fontSize: 20,
              color: i === 0 ? FARGE.brodtekst : FARGE.hint,
              marginTop: i === 0 ? 0 : 4,
            }}
          >
            {linje}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Kolonnebreddene i topp 10 — overskriftsraden og datalinjene deler dem. */
const KOL = { plass: 64, riktige: 150, tid: 130 } as const

// Radhøyden er valgt slik at ti rader fyller plassen mellom de utheva kortene
// og bunnlinja i 1350-rammen, i stedet for å etterlate et tomt felt nederst.
// Er feltet mindre enn ti, står bunnlinja fortsatt i bunn (flexGrow på
// listen) og luften havner der — det er riktig vei for et fast format.
const RADHOYDE = 70

function tegnKort(
  tittel: string,
  kort: NonNullable<ReturnType<typeof byggResultatkort>>,
) {
  const { vinner, raskest, midten, topp10, deltakere } = kort

  // De tre utheva kortene bygges som en LISTE, ikke med `{midten && <>…</>}`:
  // satori går gjennom JSX-treet selv og behandler et Fragment som en node
  // uten `display`, så et betinget fragment med to barn felte rendringen.
  // Luften mellom kortene er `marginLeft`, ikke spacer-elementer.
  const uthevede = [
    {
      etikett: 'VINNER',
      spiller: vinner,
      linjer: [`${vinner.riktige} riktige`, formatTid(vinner.totalTidMs)],
      fremhevet: true,
    },
    {
      etikett: 'RASKEST',
      spiller: raskest,
      linjer: [formatTid(raskest.totalTidMs), `${raskest.riktige} riktige`],
      fremhevet: false,
    },
    ...(midten
      ? [{
          etikett: 'MIDT I FELTET',
          spiller: midten,
          linjer: [
            `${midten.rank}. plass`,
            `${midten.riktige} riktige · ${formatTid(midten.totalTidMs)}`,
          ],
          fremhevet: false,
        }]
      : []),
  ]

  // `hoyre` må følge datacellene under kolonne for kolonne. Uten flagget fikk
  // `#` også `justify-content: flex-end`, ble dyttet mot høyre kant av sin
  // egen 64-pikslers kolonne og la seg inntil NAVN — overskriften leste
  // «#NAVN» mens tallene under sto helt til venstre.
  const overskrifter: { tekst: string; bredde: number | null; hoyre: boolean }[] = [
    { tekst: '#', bredde: KOL.plass, hoyre: false },
    { tekst: 'NAVN', bredde: null, hoyre: false },
    { tekst: 'RIKTIGE', bredde: KOL.riktige, hoyre: true },
    { tekst: 'TID', bredde: KOL.tid, hoyre: true },
  ]

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: BREDDE,
        height: HOYDE,
        backgroundColor: FARGE.bakgrunn,
        padding: '52px 56px 40px',
        fontFamily: SANS,
      }}
    >
      {/* Topptekst */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            display: 'flex',
            fontFamily: SERIF,
            fontWeight: 700,
            fontSize: 30,
            letterSpacing: 3,
            color: FARGE.gull,
          }}
        >
          QUIZKANONEN
        </div>
        <div
          style={{
            display: 'flex',
            overflow: 'hidden',
            fontFamily: SERIF,
            fontWeight: 700,
            fontSize: 54,
            color: FARGE.tittel,
            marginTop: 14,
          }}
        >
          {tittel}
        </div>
        <div
          style={{
            display: 'flex',
            fontFamily: SANS,
            fontWeight: 400,
            fontSize: 24,
            color: FARGE.hint,
            marginTop: 12,
          }}
        >
          {`${deltakere} ${deltakere === 1 ? 'deltaker' : 'deltakere'}`}
        </div>
      </div>

      {/* De tre kortene Dennis faktisk deler */}
      <div style={{ display: 'flex', flexDirection: 'row', marginTop: 34 }}>
        {uthevede.map((k, i) => (
          <Uthevet
            key={k.etikett}
            etikett={k.etikett}
            navn={k.spiller.navn}
            linjer={k.linjer}
            fremhevet={k.fremhevet}
            forskyv={i > 0}
          />
        ))}
      </div>

      {/* Topp 10 — ingen «Utfordre»-lenker, og TID faller aldri bort */}
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 36, flexGrow: 1 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            paddingBottom: 12,
            borderBottom: `1px solid ${FARGE.kant}`,
          }}
        >
          {overskrifter.map(kol => (
            <div
              key={kol.tekst}
              style={{
                display: 'flex',
                ...(kol.bredde === null ? { flex: 1 } : { width: kol.bredde }),
                ...(kol.hoyre ? { justifyContent: 'flex-end' as const } : {}),
                fontFamily: SANS,
                fontWeight: 400,
                fontSize: 15,
                letterSpacing: 1.4,
                color: FARGE.hint,
              }}
            >
              {kol.tekst}
            </div>
          ))}
        </div>

        {topp10.map(rad => {
          const topp3 = rad.rank <= 3
          return (
            <div
              key={rad.rank}
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                height: RADHOYDE,
                borderBottom: `1px solid ${FARGE.kant}`,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  width: KOL.plass,
                  fontFamily: SANS,
                  fontWeight: 700,
                  fontSize: 25,
                  color: topp3 ? FARGE.gull : FARGE.hint,
                }}
              >
                {`${rad.rank}`}
              </div>
              <div
                style={{
                  display: 'flex',
                  flex: 1,
                  overflow: 'hidden',
                  fontFamily: SANS,
                  fontWeight: topp3 ? 700 : 400,
                  fontSize: 25,
                  color: topp3 ? FARGE.tittel : FARGE.brodtekst,
                }}
              >
                {rad.navn}
              </div>
              <div
                style={{
                  display: 'flex',
                  width: KOL.riktige,
                  justifyContent: 'flex-end',
                  fontFamily: SANS,
                  fontWeight: 700,
                  fontSize: 25,
                  color: FARGE.brodtekst,
                }}
              >
                {`${rad.riktige}`}
              </div>
              <div
                style={{
                  display: 'flex',
                  width: KOL.tid,
                  justifyContent: 'flex-end',
                  fontFamily: SANS,
                  fontWeight: 400,
                  fontSize: 25,
                  color: FARGE.hint,
                }}
              >
                {formatTid(rad.totalTidMs)}
              </div>
            </div>
          )
        })}
      </div>

      {/* Bunn */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          fontFamily: SERIF,
          fontWeight: 700,
          fontSize: 26,
          letterSpacing: 1,
          color: FARGE.gull,
          marginTop: 24,
        }}
      >
        quizkanonen.no
      </div>
    </div>
  )
}
