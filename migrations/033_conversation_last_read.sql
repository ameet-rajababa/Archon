-- Record when a human last read a chat, so an unread reply can stop being unread.
--
-- The rail needs to say "there is something here you have not seen". The only
-- signal available without this column is "the newest message is the agent's" —
-- and that rule has been built and removed twice (see the console's
-- primitives/chat-status.ts), because every finished chat ends with the agent,
-- so the whole rail went amber forever and `idle` became a state nothing ever
-- reached. A mark that is always on is not a signal.
--
-- A read marker is what makes the rule survivable: unread is
-- `last_activity_at > last_read_at`, so reading a chat clears it and the mark
-- goes back off. Without this column the signal can only ever turn on.
--
-- THE BACKFILL IS THE OTHER HALF, and it is why this is a DO block rather than
-- a bare ADD COLUMN IF NOT EXISTS. Every chat that predates this column answers
-- "never read" for want of anywhere to record the answer, not because nobody
-- read it. Left alone, the first boot after the upgrade paints the entire
-- history amber at once — which is precisely the failure this column exists to
-- prevent, arriving on day one. Treating existing activity as already seen is
-- the only reading that does not, and it is the same judgement migrations 030
-- (`title_pinned`) and 032 (`completed_at`) made about their own histories.
--
-- The guard is load-bearing. This file is re-executed on EVERY boot, so a
-- standing UPDATE would not be a migration, it would be a rule that runs
-- forever — and it would mark every chat read on every restart, silently
-- deleting the feature. Running it only in the boot that ADDS the column makes
-- it what it claims to be: a one-time reading of history. The SQLite adapter
-- holds the same pair inside the same guard.
--
-- Rows created AFTER this keep NULL until someone reads them, which is correct:
-- a new chat that has spoken and never been opened is unread. Older binaries
-- never write the column and leave it NULL, which over-reports rather than
-- hides a message — the only direction this may fail in.
DO $migration_033$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'remote_agent_conversations' AND column_name = 'last_read_at'
  ) THEN
    ALTER TABLE remote_agent_conversations ADD COLUMN last_read_at TIMESTAMP WITH TIME ZONE;
    UPDATE remote_agent_conversations
    SET last_read_at = last_activity_at
    WHERE last_activity_at IS NOT NULL;
  END IF;
END
$migration_033$;

COMMENT ON COLUMN remote_agent_conversations.last_read_at IS
  'When a human last read this chat to the end. Unread is last_activity_at > last_read_at; NULL means never read.';
