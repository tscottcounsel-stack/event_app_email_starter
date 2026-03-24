-- scripts/seed.sql
-- Example: insert a default admin/organizer/vendor if not exists
INSERT INTO users (email, password_hash, role)
SELECT 'admin@example.com', 'x', 'admin'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'admin@example.com');
