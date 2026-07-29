-- Kontekst-kolonne på admin_actions (29. juli 2026)
--
-- admin_actions har til nå kun lagret HVA som skjedde (action_type) og HVOR
-- (scope_type/scope_id), ikke detaljene. For handlinger der før/etter-verdien
-- er hele poenget — navneendring og planbytte — var det ingen måte å lagre
-- «fra hva, til hva» på.
--
-- Kolonnen er valgfri. Ruter som ikke setter den fungerer uendret, og en
-- logging som feiler har aldri blokkert selve handlingen.

ALTER TABLE admin_actions
  ADD COLUMN IF NOT EXISTS details jsonb;

COMMENT ON COLUMN admin_actions.details IS
  'Valgfri kontekst for handlingen. Eksempler: '
  '{"fra":"Acme AS","til":"Acme Norge AS"} ved org_name_changed, '
  '{"fra":"starter","til":"standard","retning":"up"} ved org_plan_changed.';
