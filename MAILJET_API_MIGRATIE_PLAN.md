# Mailjet API als extra optie (uitvoering morgen)

## Doel
Een extra mailprovider-optie toevoegen via Mailjet API, naast de bestaande SMTP/Resend/Sendgrid paden.

## Waarom
- SMTP geeft nu wel 250 queued, maar activity-visibility in Mailjet dashboard/API is inconsistent.
- Met Mailjet API krijgen we expliciete response-data per send (MessageUUID, MessageID, status).
- Betere traceability en minder discussie bij incidenten.

## Scope
- Backend-only wijziging in de mailservice.
- Geen functionele wijziging in stemflow.
- Providerselectie via bestaande setting EMAIL_PROVIDER.

## Implementatieplan
1. Voeg providerkeuze toe: mailjet-api
- Bestand: backend/src/services/email.js
- Nieuwe branch in sendMail:
  - if provider === 'mailjet-api' -> verstuur via Mailjet v3.1 send endpoint.
- Hergebruik bestaande FROM/TO/SUBJECT/HTML payload.

2. Nieuwe settings gebruiken
- Vereiste keys:
  - MAILJET_API_KEY
  - MAILJET_API_SECRET
- Bestaande SMTP keys blijven bestaan voor fallback.

3. Logging uitbreiden
- Log altijd:
  - provider
  - recipient
  - MessageUUID
  - MessageID
  - status
- Bij fouten: volledige API-foutcode + message in serverlog.

4. Admin settings endpoint uitbreiden
- Bestand: backend/src/routes/admin.js
- Voeg keys toe aan settings whitelist:
  - MAILJET_API_KEY
  - MAILJET_API_SECRET
- Masking in GET /api/admin/settings zoals bij andere secrets.

5. Veiligheid en validatie
- Geen secrets loggen.
- Alleen lengtes/fingerprint loggen bij debug.
- Fallbackgedrag:
  - als mailjet-api call faalt: duidelijke 500 met generieke melding naar frontend.

## Testplan
1. Unit-level smoke
- provider=smtp -> bestaand gedrag ongewijzigd.
- provider=mailjet-api -> succesvolle POST naar Mailjet endpoint.

2. Integratie
- Registreer stemmer op https://utregsetop100.nl.
- Verwacht response: verificatiecode verstuurd.
- Controleer serverlog op MessageUUID/MessageID.

3. Admin testmail
- Vanuit instellingen testmail sturen met provider=mailjet-api.
- Bevestig message identifiers in logs.

4. Fallback check
- Ongeldige MAILJET_API_SECRET invoeren.
- Verwacht nette foutmelding en geen crash.

## Acceptatiecriteria
- Mailflow werkt met provider=mailjet-api.
- Provider=smtp blijft werken zoals nu.
- Per verzonden mail is een uniek MessageUUID zichtbaar in logs.
- Geen plaintext secrets in logs of responses.

## Rollout
1. Implementeren in branch.
2. Backend deploy.
3. PM2 restart met update-env.
4. Productie smoke test (1 register + 1 testmail).
5. Pas daarna provider default optioneel omzetten naar mailjet-api.

## Rollback
- EMAIL_PROVIDER terug op smtp.
- PM2 restart.

## Notities
- Huidige actieve SMTP key fingerprint (server): prefix 1ac2, suffix 8fc2.
- Resend key momenteel leeg gehouden om vervuiling/ByteString-fouten te voorkomen.
