-- Founders-farvel-flaten — varig «sett/lukket»-stempel (19. august 2026)
--
-- Beslutningsdokumentet for Founders-avviklingen spesifiserte en engangsflate
-- ved første innlogging etter utløp. Den ble aldri bygget, og de ~67 tidligere
-- Founders-brukerne ble stille nedgradert til gratis-UI uten forklaring.
--
-- Flaten gates på RENT DB-SIGNAL: has_used_trial=true AND ikke Premium AND
-- denne kolonnen er NULL. Bevisst INGEN bruk av lib/founders-farewell-list.json:
-- listen ble generert 11. august og er allerede foreldet (to brukere utenfor
-- listen står i identisk tilstand), og den inneholder e-postadresser som aldri
-- skal nå en klient-bundle. Populasjonen er lukket — founders-activate er
-- trial-sperret og UI-et fjernet — så has_used_trial peker ikke på noen
-- framtidig, ukjent gruppe.
--
-- Stempelet ligger i DATABASEN, ikke i localStorage som WelcomeBanner/
-- ConsentBanner: «vises kun én gang» skal gjelde per PERSON, ikke per enhet.
-- Samme persistens-prinsipp som GlobalLeagueChoiceBanner sitt besvarte valg.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS founders_farewell_dismissed_at timestamptz;

COMMENT ON COLUMN profiles.founders_farewell_dismissed_at IS
  'Når brukeren lukket founders-farvel-flaten (X, «Ikke nå» eller Premium-CTA '
  '— alle tre stempler). NULL = ikke lukket ennå; flaten vises da for brukere '
  'med has_used_trial=true uten Premium-dekning. Settes én gang av '
  'POST /api/profile/founders-farewell-seen (kun der verdien er NULL — første '
  'stempel bevares) og skal aldri nullstilles: flaten er en engangsmelding, '
  'ikke en kampanjeflate.';
