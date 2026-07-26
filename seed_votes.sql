-- Teststem: geef elk van de 25 curated tracks 1 stem (positie = volgorde ut-01..ut-25)

-- Maak een testregistratie aan
INSERT OR IGNORE INTO registrations (list_id, email, name, verified, verify_token)
VALUES (1, 'test@domstadradio.nl', 'Test Stem', 1, 'test-token-seed-vote-001');

-- Haal het registratie-id op en voeg stemmen in
INSERT OR IGNORE INTO votes (registration_id, list_id, track_id, position)
SELECT
  (SELECT id FROM registrations WHERE email='test@domstadradio.nl' AND list_id=1),
  1,
  lt.id,
  ROW_NUMBER() OVER (ORDER BY lt.external_id)
FROM list_tracks lt
WHERE lt.list_id = 1
ORDER BY lt.external_id;

SELECT 'Stemmen ingevoerd:', COUNT(*) FROM votes;
