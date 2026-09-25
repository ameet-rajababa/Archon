-- The agent's claim that a chat's work is finished, pending a human's judgement.
--
-- `completed_at` (migration 032) records that a HUMAN said the work landed. This
-- records that the AGENT says so and nobody has confirmed it — the state between
-- "nothing is running" and "this is finished", which the rail could not express.
-- Without it a finished chat is indistinguishable from an idle one, so the only
-- way to find work waiting on a decision is to open every quiet chat and read it.
--
-- WHY THIS IS A STORED MARK AND NOT A DERIVED ONE. The tempting rule is "the
-- newest message is the agent's". It was built and removed TWICE (see the
-- console's primitives/chat-status.ts) because every finished chat ends with the
-- agent, so the mark was always on, the whole rail went amber, and `idle` became
-- a state nothing ever reached. A mark that is always on is not a signal. What
-- was missing both times was a way to turn it OFF, so this one is written by an
-- explicit act and cleared by two explicit acts: a human marking the chat done,
-- and a human sending another message (which says the work is not finished after
-- all). Migration 033 solved the same problem the same way.
--
-- THERE IS DELIBERATELY NO BACKFILL, and that is the difference from 033. There
-- the default answer was wrong for history — every existing row would have read
-- as unread and painted the rail amber on the first boot. Here NULL is the OFF
-- state and it is the truthful answer for every row that predates the column: no
-- agent has ever declared those finished, because there was no way to. So the
-- upgrade is quiet, which is what an upgrade should be.
--
-- Older binaries never write the column and leave it NULL, so a chat simply does
-- not carry the mark. That under-reports rather than over-reports, which is the
-- only direction this may fail in: a missing mark costs a glance, a false one
-- would tell you work had landed when it had not.
ALTER TABLE remote_agent_conversations
  ADD COLUMN IF NOT EXISTS ready_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN remote_agent_conversations.ready_at IS
  'When the agent declared this chat''s work finished, pending a human''s judgement. Cleared when a human marks it done or sends another message. NULL means no claim. Distinct from completed_at, which is the human''s answer.';
