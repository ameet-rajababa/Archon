-- Record that a human named this chat, so nothing renames it behind their back.
--
-- Titles are generated from a chat's FIRST message and then never revisited, so
-- a long conversation carries the name of whatever opened it. Re-titling on
-- topic drift fixes that, and immediately creates the problem this column
-- solves: the AI and the user write the same `title` column through the same
-- function, so an automatic re-titler cannot tell a generated name from one
-- someone typed, and would silently undo the rename.
--
-- Exactly the shape migration 025 used for `brief_pinned` before that feature
-- was dropped: the automation stops on a pinned row, so a user's words are
-- never replaced without being asked for.
--
-- Pinned means "a human chose this", not "frozen". An explicit request to
-- re-title still overrides it — the rule is that automation respects the edit
-- and a direct instruction does not have to.
--
-- Nullable with a DEFAULT rather than NOT NULL: an older binary writing this
-- table knows nothing about the column, and every existing row predates the
-- feature, so absent and false have to mean the same thing. Readers treat NULL
-- as not pinned.
--
-- IF NOT EXISTS so this is idempotent.
ALTER TABLE remote_agent_conversations
  ADD COLUMN IF NOT EXISTS title_pinned BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN remote_agent_conversations.title_pinned IS
  'A human named this chat. Automatic re-titling skips the row; an explicit request still overrides it. NULL means not pinned.';
