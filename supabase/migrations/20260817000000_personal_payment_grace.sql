-- Karensperiode for personlig (B2C) Premium ved ufrivillig betalingsfeil
-- (17. august 2026)
--
-- Fram til nå mistet en B2C-kunde Premium i samme minutt som første kortbelastning
-- feilet: Stripe flipper abonnementet til 'past_due', den statusen er ikke med i
-- LIVE_STRIPE_STATUSES, og webhookens B2C-gren behandlet alt som ikke er
-- active/trialing som en kansellering. Samtidig sa betalingsfeil-e-posten vår at
-- tilgangen bestod og at kortet bare måtte oppdateres — og Stripe purret videre i
-- 14 dager. Samme begrunnelse som organizations.member_grace_until (29. juli):
-- et avvist kort er ikke en beslutning noen har tatt.
--
-- Karensen ligger på PROFILEN, ikke på organisasjonen, fordi det er brukerens eget
-- abonnement som feilet. Den er BEVISST en egen kolonne og ikke gjenbruk av
-- profiles.org_premium_grace_until: den kolonnen bæres av org-dekningen
-- (getOrgCoverage), og en bruker kan ha begge samtidig — org-en de er medlem av
-- kan bli låst i samme uke som deres eget kort avvises. Slås de sammen, kan vi ikke
-- lenger se hvilken karens som er hvilken, og den ene ville overskrevet den andre.
--
-- Premium-siden faller ut av seg selv: getPersonalGrace() leser kolonnen inn i
-- decidePremiumState(), som allerede behandler tidsbegrenset dekning riktig.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS personal_grace_until timestamptz,
  ADD COLUMN IF NOT EXISTS personal_grace_reason text;

COMMENT ON COLUMN profiles.personal_grace_until IS
  'Personlig Premium overlever en ufrivillig betalingsfeil til dette tidspunktet. '
  'NULL = ingen karensperiode, som er riktig utfall både for en frivillig '
  'oppsigelse og etter at Stripe har gitt opp innkrevingen. Settes av '
  'stripe-webhooken ved overgangen til past_due/unpaid, og ryddes av samme '
  'webhook ved enhver reaktivering eller kansellering. Lengden (14 dager, '
  'PERSONAL_GRACE_DAYS i lib/personal-grace.ts) skal følge dunning-vinduet i '
  'Stripe-dashbordet — karensen må ikke utløpe mens Stripe fortsatt prøver å '
  'trekke.';

COMMENT ON COLUMN profiles.personal_grace_reason IS
  'Hvorfor karensperioden ble gitt. I dag alltid payment_failed — kolonnen '
  'finnes for symmetri med organizations.member_grace_reason og for at loggen '
  'skal kunne skille en framtidig årsak fra dagens ene.';

-- Partielt indeks: kun et lite mindretall har noen gang en karensperiode.
-- Samme mønster som organizations_member_grace_idx.
CREATE INDEX IF NOT EXISTS profiles_personal_grace_idx
  ON profiles (personal_grace_until)
  WHERE personal_grace_until IS NOT NULL;
