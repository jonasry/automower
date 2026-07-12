const SESSION_SUMMARY_SQL = `
  SELECT
    mower_id,
    session_id,
    MIN(timestamp) AS start,
    MAX(timestamp) AS end,
    COUNT(*) AS points
  FROM positions
  WHERE mower_id = $1
    AND session_id IS NOT NULL
    AND activity = 'MOWING'
  GROUP BY mower_id, session_id
  ORDER BY MAX(timestamp) DESC
  LIMIT $2
`;

export { SESSION_SUMMARY_SQL };
