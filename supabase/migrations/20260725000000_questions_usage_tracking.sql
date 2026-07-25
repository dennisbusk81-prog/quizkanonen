-- ============================================================
-- questions — bruksstatistikk for spørsmålsbanken (/admin/sporsmal)
--
-- usage_count (INTEGER): antall ganger spørsmålet er lagret som en rad i en
--   quiz — telles ved INSERT (ny rad), ikke ved PATCH (vanlig autolagring av
--   tekst/svar skal ikke blåse opp tallet). Når et spørsmål gjenbrukes fra
--   banken inn i en annen quiz, økes kildens usage_count med 1 i tillegg til
--   at den nye raden får usage_count=1 — se app/api/admin/classics/copy/route.ts.
--
-- last_used_at (TIMESTAMPTZ): tidspunkt for siste bruk, samme telletidspunkt
--   som usage_count over.
--
-- created_at (TIMESTAMPTZ): fantes ikke fra før på questions (bekreftet
--   empirisk mot prod 25. juli 2026 — tabellen har ingen created_at-kolonne).
--   Lagt til for å støtte "sorter etter nyeste" i spørsmålsbanken.
-- ============================================================

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS usage_count   integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_used_at  timestamptz,
  ADD COLUMN IF NOT EXISTS created_at    timestamptz NOT NULL DEFAULT now();
