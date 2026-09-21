-- Give a chat a position that belongs to the person reading it.
--
-- The console rail has been sorting chats by last_activity_at, which means a
-- rail of working chats rearranges itself under the reader as replies land.
-- The hand-arranged order that replaced it lived in localStorage: per browser,
-- lost on a clear, and following nobody to a second machine.
--
-- A column on the conversation row rather than a per-user preferences table.
-- A conversation already carries user_id and the console lists with mine=true,
-- so for chats the row's order and the reader's order are the same thing --
-- which is precisely what the project rail's sort_order fails to be, sitting
-- as it does on a row the whole install shares.
--
-- Ascending, and NULL means never arranged. Nulls are read as newest-first and
-- shown ABOVE every placed chat, which is the opposite of the projects rule and
-- deliberate: a project you just added can wait at the bottom of a short rail,
-- a chat you just started cannot.
--
-- Ties are legal. The console renumbers only the chats it is currently showing
-- -- one archive scope at a time -- so an archived chat may hold the same value
-- as an active one. They are never displayed together except under "All", and
-- every reader breaks a tie by recency.
--
-- IF NOT EXISTS so this is idempotent.
ALTER TABLE remote_agent_conversations
  ADD COLUMN IF NOT EXISTS sort_order INTEGER;

COMMENT ON COLUMN remote_agent_conversations.sort_order IS
  'Hand-arranged rail position, ascending. NULL means never arranged; the console reads those as newest-first and shows them above every placed chat.';
