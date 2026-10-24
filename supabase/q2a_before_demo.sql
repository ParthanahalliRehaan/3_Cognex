-- ============================================================================
-- Q2(a) "BEFORE" screenshot helper. Creates a throwaway table that stores a
-- password the insecure way, purely so you can screenshot it. Then drop it.
-- (The real `users` table never stores plain text.)
-- ============================================================================
create table if not exists users_plaintext_demo (id serial primary key, email text, password text);
insert into users_plaintext_demo (email, password) values ('demo@example.com', 'Summer2026!');
select * from users_plaintext_demo;      -- <-- screenshot this  (q2a-before)

-- When done:
-- drop table users_plaintext_demo;
-- AFTER screenshot (run once you've registered a user through the API):
-- select id, email, password_hash, role, mfa_enabled, left(totp_secret, 12) || '...' as totp_secret from users;
