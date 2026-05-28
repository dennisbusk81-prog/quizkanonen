# Quizkanonen — Oppdatering etter TV-show-økt (6. april 2026)

Dette dokumentet oppsummerer alt som ble bygget og besluttet i denne økten.
Bruk dette til å oppdatere prosjektfilene ved neste oppstart.

---

## HVA SOM BLE BYGGET (legg til i QK_2)

### TV-SHOW-OPPLEVELSE — FERDIGSTILT (april 2026)

```
OK  lib/quiz-messages.ts — meldingskonfigurasjon (ny fil)
      7 kategorier: streak, perfect_run, comeback, halftime_good,
      halftime_bad, final_push, rival_intro
      Minimum 3 varianter per kategori
      Template-placeholders: {streak}, {percent}, {rivalName}, {remaining}
      Designet for å redigeres av ikke-teknisk person
      Enkelt å utvide med sesongmeldinger, A/B-testing, DB-henting later

OK  lib/select-quiz-message.ts — meldingsvelger (ny fil)
      Input: { questionIndex, totalQuestions, streak, correctCount,
               wrongInARow, rivalName, percentileEstimate,
               scoreIsAboveMedian, lastAnswerCorrect }
      Prioriteringsrekkefølge:
        1. lastAnswerCorrect === false → alltid comeback
        2. streak ≥ 2 → streak
        3. Ingen feil så langt → perfect_run
        4. wrongInARow ≥ 2 → comeback
        5. Halvtid + score ≥ 60% + over median → halftime_good (med ekte %)
        6. Halvtid + svak score → halftime_bad (ingen prosent)
        7. Siste 3 spørsmål → final_push
        8. Rival finnes → rival_intro
        9. Default → comeback
      Regel: vis aldri positivt percentil-estimat ved score under median
      Regel: comeback nevner aldri prosentplassering

OK  app/api/quiz/rival/route.ts — rival-API (ny fil)
      GET ?quizId&userId
      Prioritering: liga-peer over deg → global leder denne uken
      Bedriftsansatte: henter automatisk rival fra bedriftsligaen
      Fallback: null hvis ingen har spilt ennå
      Cache: 60 sekunder (server-side)
      Timeout-fallback: returner null, aldri feilmelding til bruker
      Skalerer til 10 000+ brukere — ett kall per bruker ved quiz-start

OK  app/api/quiz/percentile/route.ts — percentil-API (ny fil)
      GET ?quizId
      Henter score-fordeling fra denne ukens attempts
      Cache: 5 minutter
      Returnerer array: [{ score, percentile }]
      Beregnes lokalt i klienten — null kall mellom spørsmål

OK  components/QuizInterlude.tsx — mellomskjerm (ny komponent)
      Vises mellom hvert spørsmål etter riktig/feil-animasjon
      Ingen automatisk videre — brukeren klikker selv
      Gul fylt knapp: "Neste spørsmål →"
      Layout: result-pill (grønn/rød), headline (Libre Baskerville 28px),
              subline, rival-avatar (40px farget sirkel + navn),
              percentil-hint nederst (#7a7873, kun hvis over median)
      Fade-in animasjon inn: 200ms
      Ingen timer, ingen countdown

OK  app/quiz/[id]/page.tsx — oppdatert
      Parallel fetch ved quiz-start: rival + percentile (Promise.all)
      Fallback hvis ett kall feiler: fortsett uten — null i state
      goToNext refaktorert til pendingNextIndex (ingen timer-basert auto-advance)
      lastAnswerCorrect sendes til selectQuizMessage()

OK  Spørsmål glir inn
      questionIn keyframe: opacity 0 + translateY(12px) → opacity 1 + translateY(0)
      Varighet: 200ms ease-out
      Svaralternativer: animationDelay i * 50ms (0ms, 50ms, 100ms, 150ms)
      Timer starter simultant — animasjon blokkerer ingenting

OK  Timer pulserer
      Siste 3 sekunder: scale 1.0 → 1.05 → 1.0, 600ms, gjentas
      Haptikk timeout: navigator.vibrate(200)
      Haptikk riktig svar: navigator.vibrate(50)
      Feature detection: if ('vibrate' in navigator) på alle kall

OK  Gullkonfetti ved riktig svar
      100 partikler (opp fra 8)
      Tilfeldige størrelser: 3–8px
      Tilfeldige avstander: 60–280px
      Tilfeldige retninger: basis i/100 * 2π ± 15 grader avvik
      Tilfeldige varigheter: 700–1100ms
      Radialgradient-overlay sentrert på knappens posisjon
      Total animasjonsvarighet: ~2.4s
      Kjører utelukkende på klientens enhet — null serverbelastning

OK  Podium-animasjon på leaderboard
      3. plass: 0ms → 2. plass: 400ms → 1. plass: 1000ms
      Fade-in + slide opp 16px, 300ms ease-out
      Resten av listen samlet etter 1400ms
      Gjelder kun når leaderboard er åpent

OK  Smooth overgang mellom QuizInterlude og neste spørsmål
      Crossfade 250ms, bakgrunn forblir #1a1c23 hele veien
      Ingen flash, ingen hvit blink
```

### FORSIDE — KNAPPEHIERARKI FIKSET (april 2026)
```
OK  "Spill nå"-knappen på quiz-kortet endret til outline/sekundær
      border: 0.5px solid rgba(201,168,76,0.35), color: #c9a84c
      Bryter ikke lenger to-gule-knapper-regelen
      "Spill ukens quiz" i hero forblir eneste gule primærknapp
```

### ADMIN — AUTOPUBLISER-TEKST FIKSET (april 2026)
```
OK  Forklaringstekst under AUTO-PUBLISER-feltet oppdatert til:
      "Quizen publiseres automatisk på valgt tidspunkt.
       For at dette skal fungere må «Publisert»-togglen
       være satt til Av — systemet slår den på for deg."
```

---

## ARKITEKTURAVGJØRELSER (legg til i QK_1 og QK_3)

### Mellomskjerm — skaleringsdesign
- Rival og percentil-data hentes én gang ved quiz-start, lagres i komponent-state
- Null databasekall mellom spørsmål — all logikk i klienten
- 60s cache på rival-API, 5 min cache på percentil-API
- Trygt for 10 000+ samtidige brukere uten infrastrukturendringer

### Rival-logikk — prioritering
- Innlogget med liga → nærmeste spiller over deg i ligaen (denne uken)
- Innlogget uten liga → global leder denne uken
- Ikke innlogget → ingen rival, kun streak/comeback-meldinger
- Bedriftsansatte → rival fra bedriftsligaen automatisk (B2B-salgsargument)

### Meldingssystem — fremtidssikret
- lib/quiz-messages.ts er ren konfigurasjon, ingen logikk
- Enkelt å bytte tekster uten deploy
- Klar for sesongmeldinger (jul, VM, valgkveld)
- Klar for A/B-testing
- Klar for DB-henting når ønskelig

### Percentil-estimat — regler
- Vises kun til brukere med score over median OG ≥ 60% riktige
- Aldri vist til brukere med svak score — troverdighetsregel
- Beregnes lokalt fra score-fordelingen denne uken (live, ikke forrige)
- Comeback-meldinger nevner aldri prosentplassering

---

## FREMTIDIGE MELDINGER (legg til i backlog)

### first_players-kategori (ikke bygget ennå)
Når færre enn 10 har spilt denne uken:
- "Du er blant de første denne uken. Sett lista."
- "Ingen å jakte ennå — bli den de andre må slå."
- "Du spiller først. Det er en fordel."
Implementasjon: totalPlayersThisWeek returneres fra rival-API (count),
sjekkes øverst i selectQuizMessage() prioritering.
Snur svakhet (lite data) til identitet (pioneer).

### Gullkonfetti — kan skrues opp
Antall partikler ligger i én konstant i koden.
100 fungerer bra — vurder 150+ etter feedback fra ekte brukere.

---

## BUGS FIKSET DENNE ØKTEN

```
OK  Comeback-melding vistes ved riktig svar — fikset med lastAnswerCorrect-flagg
OK  Percentil-beregning var feil (viste 50% ved 2 av 8 riktige) — fikset
OK  halftime_good vistes ved svak score — fikset med 60%-terskel
OK  Flash ved overgang mellomskjerm → neste spørsmål — fikset med crossfade
```

---

## OPPDATER LANSERINGS-SJEKKLISTE (QK_4)

### B2C — erstatt status:
```
[✓] TV-show-opplevelse (alle 5 øyeblikk ferdigstilt)
      Spørsmål glir inn ✓
      Timer pulserer + haptikk ✓
      Gullkonfetti 100 partikler ✓
      Mellomskjerm med rival og meldingssystem ✓
      Podium-animasjon på leaderboard ✓
```

---

## TEKNISK GJELD LAGT TIL

```
LAV:
-  first_players-kategori i meldingssystemet ikke bygget ennå
   (strukturen er klar, krever én ny kategori i quiz-messages.ts
   og én sjekk i select-quiz-message.ts)
-  Gullkonfetti-antall (100) kan vurderes justert opp etter
   feedback fra ekte brukere
```

---

## NESTE STEG (prioritert)

1. **Stripe-aktivering** — start KYC-prosessen i Stripe-dashboardet NÅ,
   parallelt med annen utvikling. Kan ta 1-3 dager manuell gjennomgang.
   Krever: org.nr, adresse, eier, bankkonto, BankID/pass.

2. **Supabase Pro** — oppgrader plan (10 minutter)

3. **Invitasjonsflyt B2B** — test end-to-end med annen Google-konto

4. **Forklaringstekst per spørsmål** — valgfritt felt i admin,
   vises på resultatskjermen. På B2C lanserings-sjekklisten.

5. **Mobil-test på ekte enheter** — særlig mellomskjermen og
   touch-opplevelsen av hele quiz-flyten

6. **E-post ved Stripe-hendelser** — kvittering, bekreftelse, fornyelse

---

## MERK TIL NESTE ØKT

- Stripe fortsatt i **Test Mode** — ikke bytt uten eksplisitt beskjed
- TV-show-opplevelsen er ferdigstilt og testet på mobil
- Meldingssystemet er klar for utvidelse — les lib/quiz-messages.ts
- Dennis skal vise frem produktet på reise — hent feedback fra disse
  menneskene, særlig på mellomskjermen og den generelle quiz-flyten
- Nye filer opprettet denne økten:
  - lib/quiz-messages.ts
  - lib/select-quiz-message.ts
  - app/api/quiz/rival/route.ts
  - app/api/quiz/percentile/route.ts
  - components/QuizInterlude.tsx

---

## PANELANALYSE — QUIZKANONEN.NO (6. april 2026)

Fullstendig gjennomgang av hele produktet. Fri feedback fra alle 13 panelmedlemmer.

### STYRKER
- Design og designsystem er gjennomført og konsistent
- Arkitektur er solid og skalerbar for solobygger
- Mellomskjerm-opplevelsen er et gjennombrudd
- B2B-potensial er større enn antatt
- Prisingsstrategi er riktig (kr 49/mnd B2C, kr 499-1499 B2B)
- Libre Baskerville + mørk bakgrunn + gull skiller seg tydelig fra konkurrentene

### SVAKHETER
- Ingen onboarding for nye brukere — tagline alene er ikke nok
- Viral loop på del-funksjonen er for svak
- Ligaer er for komplisert å forstå for nye brukere
- Innholdssårbarhet — én person produserer all quiz-innhold
- Tone-of-voice mangler gjennomgående — forsiden, e-poster, feilmeldinger
- Touch-target på svaralternativer er i grenseland på små skjermer

### POTENSIAL
Høyt — men realiseres kun hvis produktet når brukere som ikke allerede kjenner Dennis.
Nordisk marked er underservert for voksne quiz og sosiale konkurranser.
Quizkanonen som infrastruktur for sosiale konkurranser (ikke bare quiz-app) er den
investerbare historien.

### KONKRETE TILTAK SOM MÅ JOBBES MED

**HØY PRIORITET:**

1. SOSIALT BEVIS PÅ QUIZ-STARTSIDEN
   "X spiller allerede denne uken" + par navn synlig før man starter
   Motiverer til å spille raskt — skaper følelse av at noe skjer nå
   Hentes fra attempts-tabellen, cachet, ett kall

2. DEL-FUNKSJON — VIRAL LOOP
   Resultatkortet som deles må være vakkert og fristende
   Navn, score, plassering, Quizkanonen-branding
   "Jeg fikk topp 5% — kan du slå meg?" må være visuelt og delbart
   Mål: folk legger det ut på Instagram og Facebook uten å bli bedt om det

3. LIGAER — FORENKLE DRASTISK
   Én knapp, én handling — for ny bruker skal det ta 10 sekunder å forstå
   "Opprett liga og inviter venner" må ikke kreve forklaring
   Ligaer er viral loop nr. 2 — én bruker inviterer fem venner

4. TOUCH-TARGET PÅ MOBIL
   Svaralternativer: øk padding fra 14px til 18px på mobil
   Test på iPhone SE og Samsung Galaxy A-serien spesielt
   "Neste spørsmål →"-knappen skal alltid være synlig uten scroll

**MEDIUM PRIORITET:**

5. ONBOARDING FOR NYE BRUKERE
   En som aldri har hørt om Quizkanonen skal forstå verdien på 10 sekunder
   Hva skiller dette fra alle andre quiz-apper? Si det eksplisitt
   Vurder én enkel onboarding-flyt for første gangs besøkende

6. TONE-OF-VOICE
   Gjennomgående personlighet mangler — er produktet varmt? morsomt? selvironisk?
   Gjelder: forsiden, mellomskjerm-meldinger, e-postpåminnelser, feilmeldinger
   Meldingssystemet i quiz-messages.ts er et steg i riktig retning

7. PLASSERINGSBEREGNING — TEKNISK GJELD
   Beregnes live per sidevisning — greit til 200 brukere
   Ved 2000+ bør det caches eller forhåndsberegnes etter quiz-stenging
   Ikke kritisk nå — noter og adresser før skalering

**LAV PRIORITET / FREMTID:**

8. LIVE-STILLING UNDERVEIS
   Bruker 28 år: "Spenningen av å ikke vite er ikke like bra som å se at jeg er på 2. plass"
   Teknisk krevende og skaleringsutfordring — ikke nå
   Kan være en Premium-feature på sikt

9. FACEBOOK-GRUPPE — UTNYTTES IKKE NOK
   Automatisk post etter hver quiz: leaderboard-bilde, topp 3, "Kan du slå dem?"
   Gratismarkedsføring og community-bygging i én operasjon
   Opprett én liga for hele Facebook-gruppen og inviter alle 400

---

## KANON-ANIMASJON — PARKERT TIL NESTE ØKT

**Idé (fra Dennis, inspirert av journalistens tone-of-voice-kommentar):**
En kanonanimasjon som er synlig under quizen og som skyter konfetti ved riktig svar.
Konsistent med merkevarenavnet Quizkanonen — potensielt et sterkt brand-element.

**Panelets vurdering — enstemmig positiv:**
- Grafisk designer: stilisert SVG-kanon i gull, ikon-nivå, ren geometri. Ikke realistisk — tidløst.
- UX-designer: fast element gjennom hele quizen, liten og diskret i hjørnet. Lader, venter, skyter.
- Vekststrateg: merkevare-gull. Delbart i seg selv. Kan bli Quizkanonens ansikt utad.
- Teknisk: SVG + CSS keyframes. Partikler fra kanonmunningen. Haptikk ved skudd: vibrate([50, 30, 100]).
- Løve-investor: strukturelt unikt. Ingen kan kopiere merkevaren Quizkanonen med ekte kanon.
- Journalist: "Quizkanonen — appen som faktisk har en kanon som skyter konfetti." Én setning som selger.

**Krav:**
- Stilisert, ikke realistisk — must look professional, ikke barnslig
- Liten og diskret — maks 40-48px på mobil, ikke konkurrere med innhold
- Fast element gjennom hele quizen, animeres kun ved riktig svar
- Røyk/puff-animasjon etter skudd
- Konfetti starter fra kanonmunningen, ikke fra svaret

**Prosess:**
- Krever egen designøkt med visuelle referanser og skisser FØR kode
- Ingen kode før stilen er avklart og godkjent av Dennis
- Feil utførelse er verre enn ingen kanon — gjøres riktig eller ikke i det hele tatt
