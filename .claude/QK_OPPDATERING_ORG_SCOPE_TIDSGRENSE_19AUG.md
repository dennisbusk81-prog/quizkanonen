# QK_0/QK_4-oppdatering: org-scope-tidsgrensen har en PÅVIST feiltilstand

**Dato:** 19. august 2026
**Commits:** `fb6eb5a` (tidsgrensen innført), `986779e` (servedOrgSlug),
`be0603c` (måleskript)

## STATUS: BLOKKERT AV DATO, IKKE AV PRIORITET

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

1. `fetchData` beholder 1500 ms-grensen for å slippe siden fram.
2. Ved timeout: IKKE gi opp sesjonsoppslaget. La det løpe videre.
3. Lander sesjonen etterpå med gyldig token OG `orgSlug` er satt: hent
   `/api/leaderboard/[id]?...&org=` på nytt, `setServedOrgSlug(orgSlug)`.
4. Teksten følger med automatisk via `decideOrgScopeNotice`.
5. Lander den aldri (eller uten sesjon): dagens degraderte visning står, som nå.

### Åpne spørsmål som må avgjøres FØR bygging

- **Skal oppgraderingen bytte lista under føttene på en bruker som allerede
  leser?** En liste som stille bytter fra nasjonal til org etter 3 sekunder kan
  være mer forvirrende enn den er hjelpsom. Alternativ: la degraderingslinja bli
  til en handling («Vi fant bedriften din — vis kollegene») i stedet for et
  automatisk bytte. Dette er et produktvalg, ikke et teknisk.
- **Øvre grense for hvor lenge vi venter.** Uendelig venting gjeninnfører en
  variant av den hengende tilstanden, bare uten spinner.
- **Skal `loadSession` og `ProfileProvider` dele det samme oppgraderte
  resultatet?** De henger allerede sammen (målt); tre uavhengige
  gjenopprettinger ville vært tre kilder til samme sannhet.

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
