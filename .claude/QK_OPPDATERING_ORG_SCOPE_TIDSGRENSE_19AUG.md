# QK_0/QK_4-oppdatering: org-scope-tidsgrensen har en PÅVIST feiltilstand

**Dato:** 19. august 2026
**Commits:** `fb6eb5a` (tidsgrensen innført), `986779e` (servedOrgSlug),
`be0603c` (måleskript)

## STATUS: BLOKKERT AV DATO, IKKE AV PRIORITET

**Alle tre produktvalgene er avgjort 19. august** (se «AVGJORT» lenger nede).
Briefen er klar til å plukkes opp og bygges uten flere avklaringsrunder.

**Trigger for å låse opp:** fredagsquizen 21. august 2026 er gjennomført og
gjort opp (`season_scores` skrevet, jf. `processQuiz()`).

Denne saken skal IKKE flyte inn i «senere». Den har en konkret utløser, og når
den utløseren har inntruffet er saken uten videre klar til å bygges. Står den
fortsatt åpen mandag 24. august uten at noen har rørt den, er det en
forglemmelse — ikke en nedprioritering.

Grunnen til blokkeringen er utelukkende at fiksen berører hovedhentingen på
topplistesiden, og at topplisten er den flaten flest bruker rett etter at en
fredagsquiz stenger. Den er ikke blokkert av tvil om at den er riktig.

---

## HVA SOM ER GALT

`app/leaderboard/[id]/page.tsx` legger en 1500 ms-tidsgrense på `getSession()`
før den avgjør om topplisten skal hentes med org-scope. Svarer oppslaget ikke i
tide, hentes den nasjonale listen i stedet, og en linje sier fra om det.

Tidsgrensen løste en ekte feil (evig spinner) og skal ikke reverseres. Men den
gjør «treg» om til «permanent degradert for hele denne sidelastingen», og det
er feil form.

### Målt, ikke antatt (`scripts/measure-getsession-expired.mjs`, `be0603c`)

Stubbet lagring og stubbet fetch — ingen ekte konto, ingen prod-trafikk:

| Tilfelle | Varighet | Nettverkskall |
|---|---|---|
| Ferskt token, 3000 ms treg «fornyelse» | 1 ms | 0 |
| Utløpt token, 3000 ms fornyelse | 3025 ms | 1, sesjon OK |
| Utløpt token, 200 ms fornyelse | 207 ms | 1, sesjon OK |
| Tre samtidige kall, utløpt token | 3015 / 3016 / 3016 ms | ETT |

**`getSession()` er nettverksbundet KUN når access-tokenet er utløpt.** Da
kalles `/auth/v1/token?grant_type=refresh_token`. Med ferskt token er det et
rent localStorage-oppslag på ~1 ms.

**Feiltilstanden:** fornyelsen LYKKES — brukeren er fullt innlogget, sesjonen
kommer tilbake — men tar 3025 ms. Tidsgrensen fjerner da org-visningen for et
ekte medlem med gyldig sesjon. Terskelen er ikke «nettverket er nede», den er
«fornyelsen tok mer enn 1,5 sekund». For en Elkjøp-ansatt på mobil, med et
token som akkurat løp ut, er det en helt ordinær tirsdag.

**De tre forbrukerne henger sammen** (siste rad): `fetchData`, `loadSession` og
`ProfileProvider` deler klientinstans og serialiseres bak én fornyelse. Ett
tregt oppslag rammer alle tre, ikke bare det ene.

### Konsekvens for tidligere verifisering

Preview-testen 19. august stubbet KUN `fetchData` sitt oppslag. Den produserte
derfor innlogget chrome + eyebrow «Elkjøp Nordic» over en nasjonal liste. Prod
lager ikke den skjermen: der ville `loadSession` også tidsavbrutt (siden
utlogget) og `ProfileProvider` ikke rukket å løse `myOrgs` (eyebrow
«Quizkanonen»). Godkjenningen av den skjermen gjaldt et testartefakt.

Throttling-testen samme dag (7,01 s og 43,98 s, org-scopet holdt) kunne per
konstruksjon ikke gi utslag: tokenet var ferskt. Den avkreftet falsk-positiv
for fersk-token, og sa ingenting om det eneste tilfellet som betyr noe.

---

## FORESLÅTT FIKS

La tidsgrensen styre SPINNEREN, ikke scope-beslutningen.

I dag: `timeout → commit til nasjonal visning for resten av sidelastingen`.
Foreslått: `timeout → vis siden nå, men fortsett å vente på sesjonen; når den
lander, hent org-listen og oppgrader visningen`.

Da beholder vi gevinsten (ingen evig spinner) uten prisen (en ekte ansatt
mister kollegalisten fordi tokenet ble fornyet på et tregt nett).

`986779e` gjør dette billig og er allerede ute: `orgScopeDegraded` (boolean) er
byttet med `servedOrgSlug` (hvilket scope hentingen faktisk brukte), og begge
headerlinjene utledes av `decideOrgScopeNotice()` i `lib/org-scope-notice.ts`.
En senere scoped henting flytter derfor teksten fra «nasjonal toppliste» til
«Resultater blant kollegene dine» av seg selv — samme skriving, ingen egen
opprydding, og ingen mulighet for at tekst og liste motsier hverandre.

### Skisse

1. `fetchData` hever grensen 1500 → **2500 ms** for å slippe siden fram.
2. Ved timeout: nasjonal henting som i dag, `setServedOrgSlug(null)`.
   Sesjonsoppslaget forlates — vi trenger det ikke lenger (se AVGJORT punkt 3 under).
3. Headeren viser degraderingslinja, uendret ordlyd (godkjent 19. august).
4. NÅR `session` blir gyldig OG `myOrgs` bekrefter medlemskap i `orgSlug`:
   bytt linja til knappen «Vi fant bedriften din — vis kollegene».
   Begge betingelsene er allerede tilstand i komponenten.
5. Klikk → scopet henting → `setServedOrgSlug(orgSlug)` → teksten blir
   «Resultater blant kollegene dine» av seg selv via `decideOrgScopeNotice`.
6. Blir betingelsene aldri sanne: dagens degraderte visning står, som nå.

Merk at steg 5 er den ENESTE stedet lista byttes, og den er utløst av et klikk.
Ingen liste endrer seg under en bruker som leser.

### AVGJORT 19. august 2026 — de tre spørsmålene er lukket

#### 1. Handling, ikke automatisk bytte (Dennis)

Degraderingslinja blir en KNAPP: «Vi fant bedriften din — vis kollegene».
Brukeren klikker selv. Lista skal ikke endre seg under en som allerede leser.

Dette forenkler resten av designet mer enn det ser ut til. Se punkt 3.

#### 2. Ventegrense: 2500 ms (Claude, målt grunnlag)

**Først en rettelse:** 3025 ms fra måleskriptet er IKKE en målt fornyelsestid.
Det er stub-forsinkelsen jeg selv satte (3000 ms) pluss overhead. Den viste at
grensen slår inn når fornyelsen er treg — ingenting om hvor treg en ekte
fornyelse er. Tallet under hviler på en egen måling.

Målt 19. august, Oslo → eu-west-1, kablet forbindelse
(`scripts/measure-supabase-auth-rtt.mjs`):

| Måling | Verdi |
|---|---|
| Token-POST, varm forbindelse | median 140 ms, maks 175 ms |
| Helsesjekk, varm | median 124 ms (min 77, maks 248) |
| Kald forbindelse (TLS-håndtrykk) | 413 ms — påslag ≈ 289 ms |

En ekte fornyelse på god linje koster altså **140–430 ms**.

Modellert for dårlig mobil (fornyelse = 1 forespørsel ≈ 3–4 rundturer inkl.
DNS/TCP/TLS):

| RTT per rundtur | Estimert fornyelse | Mot 1500 ms | Mot 2500 ms |
|---|---|---|---|
| 100 ms (4G, greit) | ~400 ms | greit | greit |
| 400 ms (4G, trengsel) | ~1600 ms | **BRYTER** | greit |
| 700 ms (3G/kant) | ~2800 ms | bryter | bryter |

**2500 ms** er derfor foreslått: det er 18× målt varm median, det dekker
«4G under trengsel med kald forbindelse» — den vanligste dårlige tilstanden en
Elkjøp-ansatt faktisk er i — og det slipper gjennom til knappen først når
forbindelsen er så dårlig at siden uansett må vises.

**Viktig om hva tallet ER:** 2500 ms er et SPINNER-BUDSJETT, ikke en frist på
sesjonen. Fornyelsen fortsetter i bakgrunnen etterpå; grensen bestemmer bare
når siden slutter å holde tilbake.

**Ærlig forbehold:** radene for dårlig mobil er MODELLERT, ikke målt. Jeg har
kun målt fra én maskin på ett kablet nett. Reell p95 i felt er ukjent, og kan
kun skaffes ved telemetri eller Dennis' throttlede test. Endres tallet senere,
kjør `scripts/measure-supabase-auth-rtt.mjs` på nytt først — ikke gjett.

#### 3. Delt gjenoppretting — og det trengs ingen ny mekanisme (Claude, teknisk)

Valget er DELT, ikke separat. Tre grunner, i stigende viktighet:

1. supabase-js serialiserer allerede fornyelsen selv. Målt: tre samtidige
   `getSession()` gir ETT nettverkskall og returnerer samtidig. Den delte
   gjenopprettingen finnes altså allerede under oss.
2. Tre uavhengige gjenopprettinger ville vært tre komponenter som hver
   konkluderer «sesjonen kom tilbake» om samme faktum — tre kilder til én
   sannhet, og potensielt tre hentinger.
3. **Signalet finnes fra før:** når fornyelsen lander fyrer `TOKEN_REFRESHED`
   via `onAuthStateChange`, som både `ProfileProvider` og
   `app/leaderboard/[id]/page.tsx` allerede abonnerer på.

Kombinert med punkt 1 betyr det at **det ikke skal bygges noen
gjenopprettingsmekanisme i det hele tatt.** Knappen trenger ikke at noe
«oppgraderes» automatisk — den trenger bare å vite når den kan tilbys:

    orgNotice === 'degraded'  OG  session er gyldig  OG  myOrgs bekrefter
    medlemskap i requestedOrg

Alle tre er allerede tilstand i komponenten. Knappen dukker opp når de blir
sanne, og klikket kjører den scopede hentingen. Ingen ventende promise å holde
i live, ingen ny abonnement, ingen ny tilstandsmaskin.

Det forlatte `getSession()`-promiset kan derfor forbli forlatt — verifisert
tidligere at det ikke lander i noe setState.

### Ikke i denne saken

- Retry-knappen på degraderingslinja (`window.location.reload()`) — egen sak,
  krever at `fetchData` løftes til `useCallback`. Søsken:
  `components/ErrorBoundary.tsx:39`.
- Selve 1500 ms-tallet. Å heve det bytter bare hvilken bruker som taper.

---

## GJENSTÅENDE VERIFISERING (Dennis, i nettleser)

Ende-til-ende-bekreftelsen av feiltilstanden: la fanen stå til access-tokenet er
utløpt (verifiser prosjektets `JWT expiry` i Supabase-dashbordet, default
3600 s), throttle hardt, åpne
`/leaderboard/cb28b716-1f0e-4ae7-8595-9fd4fd13d626?org=e1c72409` innlogget som
Elkjøp-medlem.

Mekanismen er allerede målt. Det som gjenstår er hvor ofte fornyelsen faktisk
overstiger 1,5 s i felt — altså hvor mye saken haster, ikke om den er ekte.

**Tillegg 26. august 2026 (fiksen bygget):** to punkter til i sjekklista:

- Knappen: throttle til degradert visning, la fornyelsen lande → knappen
  «Vi fant bedriften din — vis kollegene» skal dukke opp; lista skal IKKE
  bytte av seg selv; klikk skal gi kollegevisningen.
- Utloggings-hjørnetilfellet (atferdsendring, GODKJENT som forbedring
  26. august): logg ut via knappen på en allerede DEGRADERT ?org=-side →
  skal gi nasjonal anon-visning, IKKE redirect til /login. Ikke verifisert
  i nettleser ennå — kun i logikk-test.
