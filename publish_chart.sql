-- Teststem goedkeuren
UPDATE registrations SET approved = 1 WHERE email = 'test@domstadradio.nl' AND list_id = 1;

-- Chart publiceren: bereken scores en sla op in chart_history (week 20, 2026)
INSERT OR REPLACE INTO chart_history (list_id, track_id, week, year, position, score, vote_count)
SELECT
  v.list_id,
  v.track_id,
  20,
  2026,
  ROW_NUMBER() OVER (ORDER BY SUM(l.max_votes + 1 - v.position) DESC),
  SUM(l.max_votes + 1 - v.position),
  COUNT(DISTINCT v.registration_id)
FROM votes v
JOIN registrations r ON r.id = v.registration_id
JOIN lists l ON l.id = v.list_id
WHERE v.list_id = 1 AND r.approved = 1
GROUP BY v.track_id
ORDER BY SUM(l.max_votes + 1 - v.position) DESC;

SELECT 'Chart gepubliceerd:', COUNT(*) FROM chart_history WHERE list_id = 1;
