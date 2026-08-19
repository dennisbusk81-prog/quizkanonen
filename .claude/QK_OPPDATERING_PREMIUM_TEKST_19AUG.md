# QK-oppdatering — Premium-tekstrunden, 19. august 2026

Kilde: kartlegging 19.08 (read-only) + byggesteg samme kveld.
`qk-docs-temp/` er gitignorert, så mirrorene der er allerede rettet —
denne fila er teksten som skal inn i de EKSTERNE dokumentene.

---

## TIL QK_2 (Hva er bygget)

**Kjernesetningen «Premium for deg som vil mer enn bare svare riktig»**
står nå to steder:
- `app/premium/page.tsx` — over funksjonslista, i sidens serif-tittelstil
  (20px). Ikke et nytt visuelt system.
- `app/page.tsx` — i «Dette får du med Premium»-kortet, som innledning
  OVER 4-punktslista (16px serif), ikke som erstatning for punktene.

**To funksjoner som var bygget og betalt for, men aldri solgt, er lagt
inn i alle tre salgslistene** («Se dine svar» / per-forsøk gjennomgang,
og svarfordelingen):
- `/premium` sin FEATURES: 4 → 6 punkter
- forsidens «Dette får du med Premium»: 4 → 6 punkter
- `/slik-fungerer-det` sin Premium-kolonne: 5 → 6 punkter

Formuleringene er konkrete, ikke «avansert statistikk»:
«Se nøyaktig hvilke spørsmål du svarte feil på, uke for uke» og
«Svarfordeling — se hvordan alle svarte på hvert spørsmål».

**Liga-lenkene har fått Premium-forbehold** fire steder — ren
forventningsstyring, ingen ny gate (alle fire landet allerede på /liga,
som forklarer skillet riktig): `components/AccordionSection.tsx`,
`app/quiz/[id]/page.tsx` (to steder på resultatskjermen),
`app/leaderboard/[id]/page.tsx`.

**Aktiverings-e-postens CTA** (`trialWelcomeEmail`) er endret fra
«Se plasseringen din →» → /toppliste, til «Kom i gang →» → forsiden.

**Alle e-postfooterne** bruker nå `#918f8a` i stedet for den forbudte
`#9a9590` — 39 forekomster i `lib/email-templates.ts`.

---

## TIL QK_3 (Strategi og produkt) — TO RETTELSER

### 1. Attribusjonsfeil: to-gule-regelen på /premium

Sto som åpen med parentesen «(/profil er lost 19.08, 30d7cac.)», noe
som leses som om 30d7cac dekket /premium. Det gjorde den ikke.

- **30d7cac gjaldt /profil.**
- **/premium ble løst 12. august av `4bb34fb`** («feat(premium):
  synlig 14-dagers prøveperiode»). `showTrial`
  (`app/premium/page.tsx:237`, brukt `:428-437`) degraderer
  «Gå til betaling» til outline når prøveknappen er den gule primæren.

Det som står igjen er en ANNEN observasjon, ikke denne: gull 2px-ramme
og gull pris-TEKST i pris-boksen (QK_0 [L-8]). Hverken knapp eller
tekstlenke, så to-gule-regelen biter strengt tatt ikke der.

### 2. Dødt premiss: «deltakelsesrekke og kategoristyrke vises ikke»

Sto som «BEREGNET, men vises ikke … ferdig arbeid som ligger ubrukt».
**Feil siden historikk-redesignet 13. august.** Begge VISES:
- deltakelsesrekka i heroen via `decideHero`
  (`app/historikk/page.tsx:629-635`)
- kategori-kortene sterkeste/svakeste (`app/historikk/page.tsx:811-829`)

Punktet skal ut som åpen sak. Det eneste som gjensto — at
kategoristyrke ikke ble nevnt på noen salgsflate — er dekket av
tekstrunden over.

---

## TIL QK_0 (Åpen status)

Fra «8. Produktbeslutninger som venter på Dennis», to punkter lukkes:
- «Svarfordelingen er premium-gatet i kode, men nevnes ingen steder» —
  LØST, nevnes nå på alle tre salgsflatene.
- «Aktiverings-e-postens knapp sier Se plasseringen din →» — LØST,
  «Kom i gang →» mot forsiden.

Fortsatt åpent (bevisst ikke rørt i denne runden):
- «Se dine svar →» er en SKJULT knapp for gratisbrukere — produktvalg:
  vise som låst eller la den forbli usynlig. Ikke avgjort.
- QuizInterlude-hintet under spilling — forstyrre midt i quizen? Ikke
  avgjort.
- /premium mangler navigasjon og intro («hva ER Quizkanonen») —
  strukturelt større, egen sak.
- E-postmalenes egne 4-punktslister er IKKE utvidet med de to nye
  funksjonene. Samme spørsmål som salgslistene, større flate.
- [L-8] «to gull på /premium» — se attribusjonsrettelsen til QK_3 over;
  linjenumrene der (:317, :326, :350) er forskjøvet +13 av
  kjernesetningen.

---

## FAKTAFEIL RETTET I PRODUKTET

`/slik-fungerer-det` listet **«Se hvem du slo og hvem som slo deg» i
Premium-kolonnen.** H2H Duell er GRATIS
(`components/RivalryCard.tsx:153-154`: «H2H Duell er gratis — vises for
alle innloggede brukere … Ingen Premium-gating»).

Linja er flyttet til gratis-kolonnen, omformulert til
«Duell mot en venn — se hvem som slo hvem» så det er tydelig hvilken
funksjon den beskriver. Den siktet ikke til eksakt plassering mot
naboer — den kolonnen har «Nøyaktig plassering på leaderboard» som eget
punkt fra før, og «slo/ble slått av» er duell-språk.

Feilen kunne aktivt avskrekke en gratisbruker fra noe hun allerede har.
