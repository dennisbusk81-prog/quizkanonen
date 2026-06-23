-- Lagrer den shufflede spørsmålsrekkefølgen per attempt slik at
-- /api/quiz/[id]/questions kan hente ett spørsmål av gangen direkte by id
-- i stedet for å hente HELE spørsmålssettet (med fasit) på hvert kall.
--
-- jsonb-array av question_id (tekst). NULL = rekkefølge ikke bestemt ennå;
-- questions-ruten bygger og lagrer den atomisk ved første kall (kun hvis NULL).
ALTER TABLE attempts
  ADD COLUMN IF NOT EXISTS question_order jsonb;
