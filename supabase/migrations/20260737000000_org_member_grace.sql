-- Grace-periode for ansatte når en organisasjon låses (29. juli 2026)
--
-- Fram til nå mistet alle ansatte Premium i samme øyeblikk som org-en gikk til
-- subscription_status = 'locked' — uansett hvorfor. Det er riktig når en admin
-- BEVISST sier opp abonnementet, men galt når en trial løper ut uten kort eller
-- et kort blir avvist: da har ingen tatt en beslutning om å avslutte, og de
-- ansatte straffes for noe de hverken visste om eller kunne gjøre noe med.
--
-- Grace ligger på ORGANISASJONEN, ikke på hver profil. Tre grunner:
--   1. profiles.org_premium_grace_until er allerede delt av to andre årsaker
--      (fjernet medlem, slettet org). Skrev vi lås-grace der også, kunne vi
--      ikke lenger se hvilken grace som var hvilken — og påminnelses-e-posten
--      trenger både årsak og bedriftsnavn.
--   2. Én skriving i stedet for N. Elkjøp har 29 medlemmer, og skrivingen skjer
--      inne i den betalingskritiske webhooken.
--   3. Reaktivering (bedriften betaler på dag 3) rydder grace med én UPDATE på
--      org-raden. Mot N profiler kunne de kommet i utakt.
--
-- Premium-siden faller ut av seg selv: getOrgCoverage() mapper en låst org med
-- levende grace inn i det eksisterende `graceUntil`-feltet på OrgCoverage, og
-- decidePremiumState() behandler det allerede som tidsbegrenset dekning.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS member_grace_until timestamptz,
  ADD COLUMN IF NOT EXISTS member_grace_reason text,
  ADD COLUMN IF NOT EXISTS member_grace_reminded_at timestamptz;

COMMENT ON COLUMN organizations.member_grace_until IS
  'Ansattes Premium overlever låsen til dette tidspunktet. NULL = ingen grace, '
  'som er det riktige utfallet når en admin selv sa opp abonnementet '
  '(cancellation_details.reason = cancellation_requested). Settes av '
  'stripe-webhooken ved overgangen inn i låst tilstand, ryddes av '
  '/api/cron/expire-grace-periods og av enhver reaktivering.';

COMMENT ON COLUMN organizations.member_grace_reason IS
  'Hvorfor grace ble gitt: trial_expired | payment_failed | unknown. '
  'Se decideLockGrace() i lib/org-lock-grace.ts. Brukes til logging og til å '
  'velge formulering — en bedrift som mistet et kort skal ikke få samme tekst '
  'som en prøveperiode som løp ut.';

COMMENT ON COLUMN organizations.member_grace_reminded_at IS
  'Når påminnelsen om at grace snart utløper ble sendt. NULL = ikke sendt. '
  'Dedupe-stempel: cronen kjører daglig, men påminnelsen skal gå én gang. '
  'Nullstilles sammen med member_grace_until.';

-- Partielt indeks: cronen spør kun etter orger som FAKTISK har en grace, og de
-- er et lite mindretall. Samme mønster som
-- organization_members_scheduled_removal_idx.
CREATE INDEX IF NOT EXISTS organizations_member_grace_idx
  ON organizations (member_grace_until)
  WHERE member_grace_until IS NOT NULL;
