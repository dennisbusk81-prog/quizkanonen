# Klikktest — synlig 14-dagers prøveperiode (lokalt, FØR push)

Skrevet 12. august 2026. Kjøres lokalt mot `npm run dev`, før
prøveperiode-UI-et og 526b9dc pushes. Poenget er å se flyten virke i
koden slik den står i arbeidstreet, ikke å teste en deploy.

**«Lokalt» betyr ikke «på liksom».** Dev-serveren peker mot
**prod-Supabase** og **Stripe i live mode** — det finnes ingen
staging-database og ingen test-modus å falle tilbake på. En aktivering
her oppretter et ekte Stripe-abonnement på den ekte kontoen, og setter
`profiles.has_used_trial = true` i produksjonsdatabasen. Det eneste som
er lokalt, er koden som kjører.

Ingen penger flytter seg — prøveperioden opprettes uten kortinfo, og
abonnementene kanselleres i oppryddingen. Men `has_used_trial` er
permanent, og skal IKKE nulles etterpå. Det er nettopp den vi tester.

Du trenger **to ferske kontoer** (ulike e-postadresser). Grunnen står i
steg 4: én konto kan bare bevise aktivering én gang.

Bruk engangsadresser du selv kontrollerer — `+trial1` / `+trial2` på din
egen Gmail. Da lander alle e-postene testen utløser (aktivering,
kansellering) i din innboks, og du kan lese dem som en del av testen i
stedet for å måtte unngå dem. Se oppryddingen nederst.

---

## Steg 0 — før du begynner

Start dev-serveren og gå til `http://localhost:3000`:

```
npm run dev
```

Ha `.claude/QK_TESTQUIZ_OPPSKRIFT.md` klar hvis du vil teste
upsell-kortet (steg 2). Det krever en spilt quiz, og testquizen er laget
for å ikke forurense poeng og rapporter.

---

## Steg 1 — kvalifisert bruker ser tilbudet (konto A)

1. Logg inn med konto A (fersk, aldri hatt prøveperiode).
2. Gå til forsiden. Kontroller de tre flatene:
   - Sesong-kortets outline-knapp: **«Prøv Premium gratis i 14 dager»**
   - Historikk-flisa i snarveisrutenettet: merket sier **«Prøv gratis»**
     (ikke «Premium»), og flisa er like høy som de to andre — ingen
     ombrekking
   - «Dette får du med Premium»-kortet nederst:
     **«Prøv Premium gratis i 14 dager →»**
3. Gå til `/premium`. Gull primærknapp **«Prøv gratis i 14 dager»**, og
   «Gå til betaling» skal stå under den som outline — ikke gull.
   Nøyaktig ett gull-element på skjermen.

Ser du «Oppgrader til Premium» / «Se Premium →» i stedet, er kontoen
ikke kvalifisert (allerede Premium, eller `has_used_trial` er true).

## Steg 2 — upsell-kortet (valgfritt, krever spilt quiz)

Spill testquizen med konto A. På resultatskjermen skal kortet nederst
si **«Prøv Premium gratis i 14 dager»** med knappen
**«Prøv gratis — ingen kortinfo →»**.

Kortet vises kun for innlogget, ikke-Premium — så dette må gjøres
FØR steg 3.

## Steg 3 — aktivering og bekreftelse (konto A)

1. `/premium` → klikk **«Prøv gratis i 14 dager»**.
2. Knappen skal si «Starter...», og deretter skal en bekreftelse dukke
   opp øverst på siden med gull ramme:
   **«Prøveperioden din er aktiv i 14 dager»** + «Til forsiden →».
   Siden skal scrolle til toppen av seg selv.
3. Kontroller i Stripe (Dashboard → Customers → konto A):
   ett abonnement, status `trialing`, trial_end ca. 14 dager fram,
   ingen betalingsmetode.
4. Kontroller i Supabase at `profiles` for konto A nå har
   `premium_status = true`, `premium_source = 'founders'`,
   `has_used_trial = true`, og at `personal_stripe_subscription_id`
   matcher abonnementet i Stripe.
5. Gå tilbake til forsiden. CTA-ene skal nå være **borte** (de rendres
   kun for ikke-Premium), og Historikk-flisa skal være åpen med pil i
   stedet for merke.

6. Sjekk innboksen. E-posten skal ha emnet **«Prøveperioden din er i
   gang — Quizkanonen»**, overskrift «Prøveperioden din er i gang», og
   linja **«Du har full tilgang til Premium i 14 dager — fram til
   \<dato\> kl. \<klokkeslett\>»**. Ingen omtale av Founders noe sted.

   Klokkeslettet skal være norsk tid, og det skal stemme med
   `trial_end` på abonnementet i Stripe (som er UTC — legg til to timer
   nå i august). Stripe setter `trial_end` til aktiveringstidspunktet
   pluss 14 døgn på sekundet, ikke til døgnslutt, så tidspunktet i
   e-posten skal ligge omtrent på klokkeslettet du klikket.

   Står det «Founders Access aktivert» / «Du er blant de første», kjører
   du en gammel versjon av koden — e-posten sendes av den lokale
   serveren, så den skal alltid følge arbeidstreet.

## Steg 4 — auto-fortsettelse etter innlogging (konto B)

Dette er stien som ikke kan testes med konto A, fordi den forutsetter
at brukeren er **utlogget** når hen trykker.

1. Logg helt ut.
2. Gå til `/premium` som anonym besøkende. Knappen skal vises —
   eligibility er ukjent utlogget, og da skal tilbudet stå.
3. Klikk **«Prøv gratis i 14 dager»**. Du skal havne på
   `/login?next=%2Fpremium`.
4. Logg inn med **konto B** (fersk).
5. Uten flere klikk skal du lande på `/premium` og se bekreftelsen
   **«Prøveperioden din er aktiv i 14 dager»**.

Lander du på forsiden i stedet (kan skje via Google-innlogging hvis
`?next=` går tapt), skal du bli sendt videre til `/premium` automatisk
og aktiveringen skal fullføre der.

## Steg 5 — 409, altså live-beviset på sperren (konto A)

Nå bruker vi konto A igjen, som har `has_used_trial = true`.

1. Logg ut.
2. `/premium` som anonym → klikk **«Prøv gratis i 14 dager»**.
3. Logg inn med **konto A**.
4. Auto-fortsettelsen kjører, ruten svarer 409, og siden skal vise
   denne teksten rolig, uten feilfarger eller teknisk formulering:

   > Du har allerede hatt en gratis prøveperiode på denne kontoen.
   > Prøveperioden kan brukes én gang per konto, men du kan starte et
   > vanlig Premium-abonnement når du vil.

5. Kontroller i Stripe at konto A **ikke** fikk et nytt abonnement.

Dette er samtidig beviset på at sperren fra ce6ccb5 virker i live drift.

Merk hvorfor omveien via utlogging er nødvendig: en innlogget konto med
`has_used_trial = true` får `eligible: false` og ser derfor ikke knappen
i det hele tatt. 409-en er backstop for tilfellet der klienten ikke
KUNNE vite — som er nøyaktig det utlogget-tilstanden er.

---

## Opprydding — la e-posten komme

**Ingen kanselleringsmåte i Stripe-dashbordet er stille.** Kansellerer
du et kortløst trial-abonnement manuelt, setter Stripe
`cancellation_details.reason = 'cancellation_requested'`, og
`shouldSendCancellationEmail` (lib/subscription-lifecycle.ts) sender da
«Premium-abonnementet ditt er avsluttet». Unntaket den har krever
`canceled_at === trial_end` på sekundet — et fingeravtrykk bare Stripes
egen auto-kansellering på dag 14 lager, og som ikke kan etterlignes fra
dashbordet.

Det finnes en måte å gjøre webhooken blind på (nulle
`stripe_customer_id` og `personal_stripe_subscription_id` i prod før
kansellering), **men den skal ikke brukes.** Det er nøyaktig
NULL-tvetydigheten hull 1 måtte lukke 28. juli, og den etterlater en
`no profile found for customer=…` i loggen som ser ut som en ekte
hendelse for den som finner den om tre måneder.

Riktig løsning er å ikke ha noe å skjule: **bruk testkontoer på
engangsadresser du selv kontrollerer**, og la kanselleringse-posten
lande i din egen innboks. Da er den et kvitteringsspor, ikke støy.

**1.** Opprett kontoene på adresser du eier — f.eks.
`dennisbusk81+trial1@gmail.com` og `+trial2`. Gmail leverer alt etter
`+` til samme innboks, og adressene er unike for Supabase og Stripe.

**2.** Kanseller abonnementene i Stripe (Dashboard → Subscriptions →
Cancel immediately). Du får «Premium-abonnementet ditt er avsluttet» til
`+trial1` og `+trial2`. Det er forventet — noter gjerne at den kom, som
bekreftelse på at kanselleringsvarslingen fortsatt virker.

**3.** Slett testkontoene via `/profil` → slett konto. Ruten kansellerer
i Stripe selv først, men abonnementet er allerede borte fra steg 2, så
den finner ingenting å gjøre. `has_used_trial` forsvinner sammen med
profilraden — det er greit, kontoen skal ikke gjenbrukes.

Ingen SQL, ingen manuell nulling, ingen forvirrende logglinjer.

---

## Dag 14 — hva som skjer når prøveperioden går ut

Ikke en del av klikktesten (den tar 14 dager), men verdt å vite mens du
tester: `founders-activate` setter ikke
`trial_settings.end_behavior.missing_payment_method`, så Stripes default
`create_invoice` gjelder. Et kortløst abonnement får da en faktura som
ikke kan betales, `invoice.payment_failed` fyrer, og brukeren får
«Prøveperioden din er over». Webhooken undertrykker samtidig
«abonnementet ditt er avsluttet», så det blir én e-post, ikke to.

Ingen penger kan trekkes — det finnes ikke noe kort. Egen sak, ikke rørt
i denne runden.
