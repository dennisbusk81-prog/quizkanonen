# Quizkanonen — Oppdatering etter B2B-økt (6. april 2026)

Dette dokumentet oppsummerer hva som ble gjort i den utilgjengelige chatten om
bedriftssystem og isolert liga-oppsett. Bruk dette til å oppdatere prosjektfilene.

---

## HVA SOM BLE BYGGET (legg til i QK_2)

### B2B — BEDRIFTSSYSTEM (april 2026)
```
OK  /bedrift/registrer — selvbetjening for bedrifter
      Bedrift fyller inn navn og velger Stripe-plan
      Stripe checkout integrert (egne price IDs for B2B)
OK  organization_invites — ny databasetabell
      Felt: id, organization_id, token (uuid), email (nullable),
            role, created_by, expires_at, used_at, used_by
      RLS: org-admin kan lese/opprette/oppdatere egne invites
OK  SQL-migrasjon kjørt i Supabase:
      - organization_invites (full tabell + RLS)
      - profiles: personal_stripe_subscription_id (ny kolonne)
OK  Org-admin kan generere invitasjonslenke → ansatte klikker → havner i org-liga
OK  Dataisolasjon: ansatte i én bedrift ser ikke andre bedrifters data
```

### KJENTE UFULLSTENDIGHETER / BUGS FRA DENNE ØKTEN
```
!!  Treg lasting etter Stripe-betaling — må trykke F5 for å refreshe
    (Next.js cacher siden — mangler revalidation etter Stripe-redirect)
!!  Treg lasting ved navigasjon til admin-panel
!!  Togglene for org-innstillinger er for uklare visuelt
    (bør redesignes med tydeligere on/off-tilstand)
```

---

## ARKITEKTURAVGJØRELSER (legg til i QK_1 og QK_3)

### Spørsmål som ble avklart: Global liga + bedrift

**Spørsmål:** Bør ansatte i en bedrift også kunne delta i den globale ligaen,
eller kun spille isolert i bedriftsligaen?

**Panelets konklusjon:**
- Deltakelse i global liga er **opt-in per bruker**, ikke per bedrift
- Org-admin kan sette en **default** for nye medlemmer (global: av/på)
- Den individuelle brukeren kan overstyre dette i egne innstillinger
- Begrunnelse: ansatte er også enkeltpersoner med egne interesser —
  tvungen isolasjon ville svekke verdien av plattformen for dem

**Implementasjon:**
- Toggle i org-admin: "Tillat ansatte å delta i global liga"
- Toggle per bruker i profil: "Delta i global liga" (synlig kun for org-medlemmer)

---

## DATABASETABELLER SOM ER LAGT TIL (legg til i QK_1)

```
organization_invites (ny):
  id uuid PK
  organization_id uuid FK → organizations
  token uuid UNIQUE
  email text (nullable)
  role text DEFAULT 'member'
  created_by uuid FK → profiles
  expires_at timestamptz
  used_at timestamptz
  used_by uuid FK → profiles

profiles (oppdatert):
  + personal_stripe_subscription_id text (ny kolonne)
```

---

## OPPDATER LANSERINGS-SJEKKLISTE (QK_4)

### B2B — erstatt alle [○] med ny status:
```
[◐] Bedrift oppretter egen organisasjon (selvbetjening — /bedrift/registrer live)
[◐] Dataisolasjon — organization_invites-tabellen på plass, RLS aktivert
[○] Org-admin grensesnitt — toggles for innstillinger (påbegynt, uferdig UX)
[○] Bulk-invitasjon av ansatte (token-basert flyt påbegynt)
[○] Stripe for organisasjoner (checkout koblet, ikke live)
[✓] B2B-landingsside (/bedrift eksisterer)
```

### Legg til i teknisk gjeld (MEDIUM):
```
MEDIUM:
-  Treg lasting etter Stripe-redirect — mangler revalidation i Next.js
-  Org-admin toggles — visuelt design ikke godt nok, bør redesignes
```

---

## NESTE STEG FOR B2B (prioritert rekkefølge)

1. **Fix F5-problemet** — legg til `router.refresh()` eller `revalidatePath()` 
   etter Stripe-redirect i `/bedrift/success` eller checkout-redirect
2. **Redesign toggles** — tydelig on/off med tekstetikett, ikke bare switch
3. **Fullføre invitasjonsflyt** — ansatt klikker lenke → innlogging → havner i org
4. **Org-admin dashboard** — se medlemmer, fjerne/legge til, endre innstillinger
5. **Stripe live-modus** (gjelder også B2B)

---

---

## B2B-PAKKETABELL (gjeldende per 14. juni 2026)

| Pakke | Pris | Innhold |
|---|---|---|
| Starter | kr 499/mnd | Fredagsquiz, opptil 25 ansatte |
| Standard | kr 899/mnd | Egne quiz-tidspunkter (sett åpne/stenge-tid per bedrift), ukentlig statistikk-rapport, CSV-eksport av aktivitetsdata, eget internt leaderboard per uke og sesong |
| Pro | kr 1 499/mnd | Alt i Standard + prioritert support |
| Enterprise | fra kr 2 499/mnd | Skreddersydd, faktura, ubegrenset |

---

## SENTRALE BESLUTNINGER

- **14. juni 2026** — B2B Standard/Pro endret fra "X quizer/uke" til verktøy som allerede er bygget (org-egne tidspunkter, rapportering, CSV-eksport, internt leaderboard). Quiz-produksjonskapasitet tillot ikke det opprinnelige løftet om 3 quizer/uke (Standard) og daglig miniquiz man-tors (Pro). NB: "bedriftsliga" (bedrift-mot-bedrift, ekstern rangering) er IKKE bygget og skal ikke nevnes i pakkebeskrivelsene — kun det interne org-leaderboardet (/org/[slug]) finnes.

---

## FREMTIDIGE B2B-FEATURES (backlog)

**Quizbibliotek for org-admin** — org-admin velger fra tidligere quizer/klassikere, publiserer som egne miniquizer, poeng går KUN til `scope_type='organization'` (egen bedriftsliga). Krever duplisering av questions (ny quiz_id), ny UI i org-admin. Bygger på eksisterende season_scores scope-arkitektur. Eget lite prosjekt, ikke triviell endring. Fremtidig Pro-differensiering.

---

## MERK TIL NESTE ØKET

- Stripe er fortsatt i **Test Mode** — ikke bytt til live uten eksplisitt beskjed
- `organization_invites`-tabellen og RLS er kjørt i prod-databasen
- `personal_stripe_subscription_id` er lagt til profiles (kan være tom for alle nå)
- Filene som trolig ble opprettet/endret av Claude Code denne økten:
  - `app/bedrift/registrer/page.tsx` (ny)
  - `app/bedrift/success/page.tsx` (ny eller endret)
  - `app/api/stripe/org-checkout/route.ts` (ny, antatt)
  - `supabase/migrations/...organization_invites.sql` (ny)
