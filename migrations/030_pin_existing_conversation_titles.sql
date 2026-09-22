-- Treat every title that predates `title_pinned` as one a human chose.
--
-- Migration 029 added the column so automatic re-titling could tell a generated
-- name from one someone typed. Every row that already existed answers FALSE,
-- not because a human did not name it but because nothing was recording the
-- answer yet — so the re-titler would read "generated" for all of them and be
-- free to rename a name that was deliberate.
--
-- That is not hypothetical. At the time of writing one chat is called
-- "DONE - Upgrade Archon", twenty-one turns in and past the re-title boundary.
-- No title generator emits a "DONE - " prefix; a person put it there, and it is
-- doing work — it is how that chat is known to be finished. One more exchange
-- in it and the name could have been rewritten.
--
-- Pinning all of them is the only reading that cannot destroy something. The
-- alternative — guessing which titles "look hand-typed" — is pattern-matching
-- on prose to make a decision, which this project does not do.
--
-- The cost is that a pre-existing chat is never re-titled automatically. That
-- is acceptable because it is per-chat recoverable: `/retitle` forces a
-- reconsideration and overrides the pin, which is exactly the override the
-- feature was designed with. Chats created after this point get the right
-- answer on their own and need no backfill ever again.
--
-- Untitled rows are left alone by the WHERE clause, which is what keeps the
-- eighty-nine hidden workflow sub-chats out of it — they have no name to
-- protect and should still be named if they ever gain one.
--
-- Idempotent: the `IS NOT TRUE` guard means re-running changes no rows, and a
-- title pinned later by a human is not disturbed.
UPDATE remote_agent_conversations
SET title_pinned = TRUE
WHERE title IS NOT NULL
  AND title <> ''
  AND title_pinned IS NOT TRUE;
