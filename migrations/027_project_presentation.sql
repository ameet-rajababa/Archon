-- Give a project its own identity and brief.
--
-- The console has been storing three things in localStorage: the chosen icon
-- and colour, the hand-arranged rail order, and the three-part brief (why /
-- doing / where). That was the right call to ship the rail without a restart,
-- and it has one consequence that cannot be designed around: none of it
-- follows you to another machine, and a cleared browser loses all of it.
--
-- One JSONB column rather than five typed ones. These are presentation, not
-- domain data — nothing queries by icon, nothing joins on sort order — and a
-- shape that will keep growing as the console grows should not cost a
-- migration each time. The server treats it as opaque; the console owns the
-- shape.
--
-- `sort_order` is separate because it IS queried: a list ordered in SQL cannot
-- reach inside a JSON blob to do it, and ordering in the client means the rail
-- flashes the server's order before the user's.
--
-- IF NOT EXISTS on both so this is idempotent.
ALTER TABLE remote_agent_codebases
  ADD COLUMN IF NOT EXISTS presentation JSONB;

ALTER TABLE remote_agent_codebases
  ADD COLUMN IF NOT EXISTS sort_order INTEGER;

-- Null sorts last in Postgres by default, which is what we want: a project
-- that has never been dragged sits after every project that has, rather than
-- jumping to the top of the rail.
COMMENT ON COLUMN remote_agent_codebases.presentation IS
  'Console presentation: {icon, color, brief:{why,doing,where,updatedAt}}. Opaque to the server.';
COMMENT ON COLUMN remote_agent_codebases.sort_order IS
  'Hand-arranged rail position. NULL means never dragged, and sorts last.';
