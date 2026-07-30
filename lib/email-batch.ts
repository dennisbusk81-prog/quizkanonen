/**
 * Maks antall samtidige Resend-kall i én batch.
 *
 * Resend avviser over 10 forespørsler per sekund. Fram til 30. juli 2026 sto
 * tallet 20 seks ulike steder i kodebasen, hvert som sin egen lokale konstant
 * — og det slo til i produksjon 18. og 19. juli:
 * «Too many requests. You can only make 10 requests per second.»
 *
 * VIKTIG: dette tallet begrenser SAMTIDIGHET, ikke gjennomstrømning. Fullfører
 * en batch på 250 ms, går neste av gårde umiddelbart, og den vedvarende raten
 * blir ~32/s uansett hvor lav batchen er. Konstanten fjerner burst-toppen og
 * gjør at små utsendinger holder seg innenfor, men den GARANTERER ikke at
 * grensen holdes ved mange mottakere. En reell garanti krever pacing mellom
 * batchene — ikke bygget, se loggkartleggingen 30. juli 2026.
 *
 * HVORFOR EGEN FIL, ikke `lib/email.ts`: ni testfiler gjør `mock.module(
 * '@/lib/email', …)` for å slippe ekte nettverkskall. Lå konstanten der, måtte
 * hver eneste mock også eksportere den — ellers feiler importen med
 * «does not provide an export named». En ren konstant hører ikke hjemme bak
 * en mock-grense som finnes for I/O.
 */
export const EMAIL_BATCH_SIZE = 8
