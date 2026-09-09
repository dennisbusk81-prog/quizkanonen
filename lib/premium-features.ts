// ── Premium-fordelene: ÉN liste, to flater ──────────────────────────────────
//
// Fram til 9. september 2026 lå denne lista i to kopier — inline i
// app/page.tsx («Dette får du med Premium», vist til premiumLocked) og som
// FEATURES i app/premium/page.tsx — holdt identiske på ære, med en kommentar
// som ba om det og ingen test som håndhevet det. 7e5160b rettet begge i samme
// runde; kanonkule-punktet under ville vært det første som driftet. Nå leser
// begge flatene herfra, og lib/premium-features.test.ts krever at ingen av
// dem har en egen kopi.
//
// Samme løfte til samme publikum: forsidekortet vises til gratisbrukere, og
// salgssiden selger til de samme. Derfor står sesong-forbeholdet i
// arkiv-punktet på begge — et arkivresultat som ikke dukker opp på
// topplisten ville ellers lest som en feil, ikke som funksjonen.
//
// ANDRE lister med premium-fordeler finnes fortsatt med egen ordlyd og eget
// publikum, og er BEVISST ikke koblet hit: oppsalgspanelet på resultatskjermen
// (app/quiz/[id]/page.tsx), /slik-fungerer-det, founders/success og fem
// e-postmaler i lib/email-templates.ts. Kartlagt 9. september 2026.
//
// Ren fil, ingen I/O: importeres av en server-komponent (forsiden) og en
// klientkomponent (/premium).
import { GENERATION_QUOTA } from '@/lib/generated-quiz-rules'

/**
 * Kanonkule-punktet. Tallet er kvoten fra generatoren (GENERATION_QUOTA), ikke
 * skrevet som tekst — endres kvoten, følger løftet med. Ordlyden er Dennis'
 * (9. september 2026).
 */
export const PREMIUM_GENERATOR_FEATURE =
  `Lag opptil ${GENERATION_QUOTA.premium} egne quizer i måneden — du velger kategori`

export const PREMIUM_FEATURES: readonly string[] = [
  'Nøyaktig plassering i resultatene',
  'Hele topplisten — søk og bla gjennom alle spillere',
  'Historikk og statistikk — beste plassering, streak og utvikling over tid',
  'Private ligaer med venner',
  'Se nøyaktig hvilke spørsmål du svarte feil på, uke for uke',
  // «hvert spørsmål» var usant: ruten leverer bevisst kun de to letteste + to
  // vanskeligste (sikkerhetsbeslutning 26. juli — HIGHLIGHT_COUNT i
  // answer-distribution/route.ts). Samme ordlyd som svarfordeling-seksjonen
  // på /leaderboard/[id] allerede bruker.
  'Svarfordeling — se hvordan alle svarte på ukens letteste og vanskeligste spørsmål',
  // Arkivet ble bygget 27. august ([ARK-1]). Ordlyden er hentet fra flatens
  // egen tekst i app/arkiv/page.tsx, som allerede sier det sant: «som
  // trening», «teller ikke i sesongen», «hvilken plass du ville fått den uken».
  'Quizarkivet — spill tidligere quizer på nytt som trening, og se hvilken plass du ville fått den uken (teller ikke i sesongen)',
  // Generatoren («kanonkuler», 8.–9. september 2026). Forsidekortet lover
  // gratisbrukere «Med Premium: 30 kanonkuler i måneden»; her innfris det.
  PREMIUM_GENERATOR_FEATURE,
]
