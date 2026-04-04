import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY!)

export type SendEmailOptions = {
  to: string | string[]
  subject: string
  html: string
  from?: string
  replyTo?: string
}

export async function sendEmail({
  to,
  subject,
  html,
  from = 'Quizkanonen <hei@quizkanonen.no>',
  replyTo,
}: SendEmailOptions): Promise<void> {
  const { error } = await resend.emails.send({
    from,
    to,
    subject,
    html,
    ...(replyTo ? { replyTo } : {}),
  })

  if (error) {
    throw new Error(`Failed to send email: ${error.message}`)
  }
}
