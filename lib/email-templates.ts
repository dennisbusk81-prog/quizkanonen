function formatNorwegianDate(isoString: string): string {
  const date = new Date(isoString)
  const days = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag']
  const months = [
    'januar', 'februar', 'mars', 'april', 'mai', 'juni',
    'juli', 'august', 'september', 'oktober', 'november', 'desember',
  ]
  const dayName = days[date.getDay()]
  const day = date.getDate()
  const month = months[date.getMonth()]
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${dayName} ${day}. ${month} kl. ${hours}:${minutes}`
}

export function trialEndingEmail(daysLeft: number): string {
  const dayWord = daysLeft === 1 ? 'dag' : 'dager'

  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${daysLeft} ${dayWord} igjen av prøveperioden</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo / header -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <!-- Title -->
              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                ${daysLeft} ${dayWord} igjen av prøveperioden
              </p>

              <!-- Divider -->
              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <!-- Body text -->
              <p style="margin:0 0 16px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Din gratis prøveperiode på Quizkanonen utløper om <strong style="color:#ffffff;">${daysLeft} ${dayWord}</strong>.
              </p>
              <p style="margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#6a6860;">
                Du mister tilgangen til
              </p>

              <!-- Feature list -->
              <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:28px;">
                <tr><td style="padding:6px 0;font-size:15px;color:#e0e0e0;">📊&nbsp; Quizhistorikk og score-utvikling</td></tr>
                <tr><td style="padding:6px 0;font-size:15px;color:#e0e0e0;">🏆&nbsp; Detaljert statistikk og beste streak</td></tr>
                <tr><td style="padding:6px 0;font-size:15px;color:#e0e0e0;">🔒&nbsp; Private ligaer med venner og kolleger</td></tr>
              </table>

              <p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Ingen automatisk trekk — du velger selv om du vil fortsette.
              </p>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://www.quizkanonen.no/premium"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#0f0f10;text-decoration:none;letter-spacing:0.02em;">
                      Fortsett med Premium
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#9a9590;line-height:1.7;">
                Du mottar denne e-posten fordi du er registrert på Quizkanonen.<br />
                Spørsmål? Svar på denne e-posten.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function quizReminderEmail(nextQuizDate: string): string {
  const formattedDate = formatNorwegianDate(nextQuizDate)

  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Quizen åpner snart!</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#1a1c23;font-family:'Instrument Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1c23;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo / header -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-family:'Libre Baskerville',Georgia,serif;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:0.04em;">
                Quizkanonen
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#21242e;border:1px solid #2a2d38;border-radius:20px;padding:40px 36px;">

              <!-- Title -->
              <p style="margin:0 0 8px;font-family:'Libre Baskerville',Georgia,serif;font-size:26px;font-weight:700;color:#ffffff;line-height:1.3;">
                Quizen åpner snart!
              </p>

              <!-- Divider -->
              <div style="height:2px;background:linear-gradient(90deg,#c9a84c 0%,transparent 100%);margin:16px 0 24px;border-radius:2px;"></div>

              <!-- Body text -->
              <p style="margin:0 0 8px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Hei! En ny quiz er på vei på Quizkanonen.
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#e0e0e0;line-height:1.7;">
                Sett av tid — quizen åpner
                <strong style="color:#ffffff;">${formattedDate}</strong>.
                Vær klar fra første sekund for best mulig plassering.
              </p>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#c9a84c;border-radius:10px;">
                    <a href="https://www.quizkanonen.no"
                       style="display:inline-block;padding:13px 32px;font-family:'Instrument Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#0f0f10;text-decoration:none;letter-spacing:0.02em;">
                      Gå til Quizkanonen
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#9a9590;line-height:1.7;">
                Du mottar denne e-posten fordi du har slått på quiz-påminnelser.<br />
                Du kan skru det av under
                <a href="https://www.quizkanonen.no/profil" style="color:#c9a84c;text-decoration:none;">profilen din</a>.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
