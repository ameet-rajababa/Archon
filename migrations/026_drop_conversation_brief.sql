-- Remove the chat brief.
--
-- The brief was an agent-maintained summary of what a chat was for and where it
-- got to: a text column, the timestamp that let the UI date it, and the flag
-- that stopped the agent overwriting a human edit (migration 025).
--
-- Dropped on request, 2026-09-19. Three of 128 conversations held one; their
-- contents were exported before this ran and are not recoverable from the
-- database afterwards.
--
-- IF EXISTS on every statement so this is idempotent and so a database that
-- never ran 025 is not an error.
ALTER TABLE remote_agent_conversations DROP COLUMN IF EXISTS brief;
ALTER TABLE remote_agent_conversations DROP COLUMN IF EXISTS brief_updated_at;
ALTER TABLE remote_agent_conversations DROP COLUMN IF EXISTS brief_pinned;
