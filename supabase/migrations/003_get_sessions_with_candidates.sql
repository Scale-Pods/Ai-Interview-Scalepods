-- HR read sessions with full candidate data, bypassing RLS on the candidates table
-- via SECURITY DEFINER so the function runs with the privileges of the table owner.

CREATE OR REPLACE FUNCTION get_sessions_with_candidates()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_agg(
    json_build_object(
      'id',            s.id,
      'candidate_id',  s.candidate_id,
      'jd_id',         s.jd_id,
      'resume_id',     s.resume_id,
      'status',        s.status,
      'invite_link',   s.invite_link,
      'token_hash',    s.token_hash,
      'expires_at',    s.expires_at,
      'started_at',    s.started_at,
      'completed_at',  s.completed_at,
      'created_by',    s.created_by,
      'created_at',    s.created_at,
      'updated_at',    s.updated_at,
      'candidates',    CASE WHEN c.id IS NOT NULL THEN
        json_build_object(
          'id',           c.id,
          'external_id',  c.external_id,
          'name',         c.name,
          'email',        c.email,
          'phone',        c.phone,
          'created_at',   c.created_at,
          'updated_at',   c.updated_at,
          'metadata',     c.metadata
        )
      ELSE NULL END
    )
    ORDER BY s.created_at DESC
  ) INTO result
  FROM interview_sessions s
  LEFT JOIN candidates c ON c.id = s.candidate_id;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- Grant execute to anon and authenticated so the frontend anon-key client can call it.
GRANT EXECUTE ON FUNCTION get_sessions_with_candidates TO anon;
GRANT EXECUTE ON FUNCTION get_sessions_with_candidates TO authenticated;
