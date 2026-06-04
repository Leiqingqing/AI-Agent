-- Migration number: 0002 	 2026-05-27T00:00:00.000Z
CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users_new (id, name, email, password_hash, role, created_at)
SELECT id, name, email, '', 'user', COALESCE(created_at, CURRENT_TIMESTAMP)
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
