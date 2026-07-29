-- Planlagt fjerning av org-medlemmer (29. juli 2026)
--
-- Org-admin kan sette en fremtidig dato for når et medlem skal fjernes.
-- /api/cron/scheduled-removals plukker opp forfalte rader daglig og kaller
-- den delte removeOrgMemberById() — samme kodesti som «Fjern nå» i panelet,
-- så grace-periode (7 dager) og e-post er identisk med manuell fjerning.
--
-- NULL = ingen plan. Å avbryte en plan setter kolonnen tilbake til NULL, og
-- NULL blir aldri plukket opp av cronen (NULL <= '<dato>' er NULL, ikke true).

ALTER TABLE organization_members
  ADD COLUMN IF NOT EXISTS scheduled_removal_at timestamptz;

COMMENT ON COLUMN organization_members.scheduled_removal_at IS
  'Fremtidig tidspunkt medlemmet skal fjernes automatisk. NULL = ingen plan. '
  'Settes av /api/org/members/[id]/schedule-removal, utføres av '
  '/api/cron/scheduled-removals via den delte removeOrgMemberById().';

-- Partielt indeks: cronen spør kun etter rader som FAKTISK har en plan, og de
-- er et lite mindretall. Uten WHERE-klausulen ville indeksen dekket hele
-- tabellen for en spørring som nesten aldri treffer noe.
CREATE INDEX IF NOT EXISTS organization_members_scheduled_removal_idx
  ON organization_members (scheduled_removal_at)
  WHERE scheduled_removal_at IS NOT NULL;
