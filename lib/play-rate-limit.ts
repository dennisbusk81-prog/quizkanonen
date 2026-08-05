// ── Rate-limit-nøkkel for spillestien (start-attempt og submit) ─────────────
//
// PROBLEMET SOM BLE LØST 5. AUGUST 2026 (funn F1 i lastmålingen)
// Begge rutene nøklet på `x-forwarded-for` alene: 20 forespørsler per 10
// minutter per IP-adresse. Så lenge telleren lå i en Map per serverless-instans
// var den effektive grensen 20 × antall instanser man tilfeldigvis traff, og
// problemet var usynlig. Da telleren ble delt via Upstash (5. august) ble
// grensen for første gang reell — og dermed også konsekvensen av å nøkle på
// noe flere mennesker deler.
//
// En IP-adresse er ikke en person. Bak én adresse ligger et kontornett (Elkjøp
// Nordic har 29 medlemmer), et skolenett, eller en mobiloperatørs CGNAT-pool.
// Og én spiller bruker mer enn ett kall: en sidelast midt i quizen kaller
// start-attempt på nytt (gjenbruk-stien), og «Prøv igjen» etter en timeout
// kaller submit på nytt. Reell kapasitet var 7–20 spillere per nett per 10
// minutter, hvorpå resten fikk «For mange forsøk» — som leses som at siden er
// ødelagt, ikke som at man er bremset.
//
// LØSNINGEN: nøkle på IDENTITET når vi har en.
// Innlogget spiller  → `<rute>:user:<user_id>`  — egen kvote, upåvirket av
//                       hvor mange kolleger som spiller fra samme nett.
// Ingen gyldig token → `<rute>:anon:<ip>`       — uendret oppførsel.
//
// HVORFOR DET ER TRYGT Å SLIPPE OPP PER NETT
// Grensen beskytter mot masseoppretting av rader. For en innlogget bruker er
// det allerede strukturelt umulig: `attempts_user_quiz_unique` tillater
// nøyaktig én attempt-rad per (bruker, quiz), og `submitted_at`-vakten i
// submit tillater nøyaktig én scoring per forsøk. Per-bruker-kvoten er derfor
// et tak over et tak. Den ekte flomflaten er den ANONYME stien (user_id NULL,
// ingen unik indeks), og den beholder IP-nøkkelen og grensen sin uendret.
//
// TO LAG, OG HVORFOR DET FØRSTE ER IN-MEMORY
// For å nøkle på bruker må tokenet slås opp (`auth.getUser`) FØR grensen
// sjekkes. Uten et lag foran ville et vilkårlig antall søppel-tokens kunne
// koste et GoTrue-oppslag hver, helt ubremset. Derfor en grov burst-brems
// FØRST — men med `rateLimit` (in-memory), ikke `rateLimitShared`:
//   • den koster ingen nettverksrundtur, og ligger på den varmeste skrivestien
//     vi har (jf. CLAUDE.md: ikke migrer noe «for konsistensens skyld»);
//   • instans-spredning er harmløs nettopp her, fordi lag 2 er den ekte
//     grensen — lag 1 skal kun hindre at pre-auth-arbeidet er gratis.
// Taket er satt høyt nok til at et stort kontornett aldri kan treffe det ved
// normal bruk, og lavt nok til at det fortsatt er et tak.
import 'server-only'

/**
 * Lag 1 — grov burst-brems per IP, FØR token-oppslaget. Per instans.
 *
 * 120 per minutt tilsvarer ~40 spillere som starter samtidig fra samme nett
 * med tre kall hver, altså godt over det største kontornettet vi kjenner (29).
 * Treffes den likevel, er lag 2 uansett ikke nådd, og en ekte spiller får
 * prøve igjen neste minutt i stedet for å være låst ute i ti.
 */
export const PLAY_PRE_AUTH_BURST = { limit: 120, windowMs: 60_000 } as const

/**
 * Lag 2 — den ekte grensen, delt teller. Uendrede tall fra før 5. august;
 * det som er endret er HVA de teller per, ikke hvor mange.
 */
export const PLAY_RATE_LIMIT = { limit: 20, windowMs: 600_000 } as const

/**
 * Bygger lag 2-nøkkelen.
 *
 * `userId` er resultatet av et VERIFISERT token-oppslag — aldri noe klienten
 * har oppgitt selv. Et ugyldig eller forfalsket token gir `null` og havner
 * dermed i anon-bøtta, som er den strenge. En angriper kan altså ikke rotere
 * påståtte bruker-id-er for å få uendelig kvote.
 *
 * Nøkkelen beholder rute-prefikset som første ledd fordi `keyPrefixOf`
 * (lib/rate-limit-protocol.ts) sender nettopp det leddet til Sentry ved
 * fail-open. Alt etter første kolon — IP eller bruker-id — holdes utenfor.
 */
export function playRateLimitKey(
  route: 'start-attempt' | 'submit',
  userId: string | null,
  ip: string,
): string {
  return userId ? `${route}:user:${userId}` : `${route}:anon:${ip}`
}
