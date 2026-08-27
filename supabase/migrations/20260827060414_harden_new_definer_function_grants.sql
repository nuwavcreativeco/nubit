-- Same lesson this schema already learned once for place_bid: revoking from
-- PUBLIC is not enough on its own, because anon and authenticated are granted
-- the REST surface independently. Name the roles.
--
-- These two are trigger bodies. Nothing should ever call them over REST.
revoke all on function notify_followers_of_slot() from public, anon, authenticated;
revoke all on function on_message_sent()          from public, anon, authenticated;

-- Membership check is for signed-in callers only; anon has no thread to be in.
revoke all on function is_conversation_participant(uuid) from public, anon;
grant execute on function is_conversation_participant(uuid) to authenticated;

-- start_conversation raises for a null auth.uid() anyway, but there is no
-- reason for it to be reachable signed-out.
revoke all on function start_conversation(uuid,uuid) from public, anon;
grant execute on function start_conversation(uuid,uuid) to authenticated;

-- is_following and my_reels are likewise signed-in only.
revoke all on function is_following(uuid) from public, anon;
grant execute on function is_following(uuid) to authenticated;

revoke all on function my_reels() from public, anon;
grant execute on function my_reels() to authenticated;
