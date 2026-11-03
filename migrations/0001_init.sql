-- Score to Sound / Personal Accompanist: accounts, sign-in, song credits and AI reading jobs.

CREATE TABLE users (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL UNIQUE,          -- lower-case
  name             TEXT,
  google_sub       TEXT UNIQUE,                   -- Google account id, when signed in with Google
  created_at       INTEGER NOT NULL,              -- ms since epoch
  pack_songs       INTEGER NOT NULL DEFAULT 0,    -- never expire: free trial + bought packs
  monthly_songs    INTEGER NOT NULL DEFAULT 0,    -- left in the current monthly period (used first)
  plan             TEXT,                          -- NULL or 'monthly'
  plan_renews_at   INTEGER,
  stripe_customer_id TEXT
);

-- One free trial per email address for life, even if the account is deleted and re-created.
CREATE TABLE trial_claims (
  email      TEXT PRIMARY KEY,
  claimed_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,                    -- SHA-256 of the cookie value; the raw token is never stored
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE login_links (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE oauth_states (
  state      TEXT PRIMARY KEY,
  verifier   TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Every change to a user's songs, for support and accounting.
CREATE TABLE credit_ledger (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  delta      INTEGER NOT NULL,                    -- + granted, - used
  bucket     TEXT NOT NULL,                       -- 'pack' or 'monthly'
  reason     TEXT NOT NULL,                       -- 'trial', 'pack', 'monthly', 'read', 'refund', 'admin'
  ref        TEXT,                                -- job id, payment id...
  created_at INTEGER NOT NULL
);
CREATE INDEX credit_ledger_user ON credit_ledger(user_id, created_at);

-- One AI reading of one score (a PDF or a set of photos).
CREATE TABLE jobs (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  file_hash      TEXT NOT NULL,                   -- SHA-256 of the uploaded file(s): re-opening the same score is free
  file_name      TEXT,
  pages          INTEGER NOT NULL,
  songs_charged  INTEGER NOT NULL,
  from_monthly   INTEGER NOT NULL DEFAULT 0,
  from_pack      INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL,                   -- 'open', 'done', 'refunded'
  created_at     INTEGER NOT NULL,
  finished_at    INTEGER
);
CREATE INDEX jobs_user_file ON jobs(user_id, file_hash);

CREATE TABLE job_pages (
  job_id        TEXT NOT NULL,
  page          INTEGER NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL,                    -- 'reading', 'done', 'nomusic', 'error'
  text          TEXT,
  model         TEXT,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (job_id, page)
);

-- Simple fixed-window rate limits (sign-in emails, page reads, trials per network).
CREATE TABLE rate_limits (
  key          TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
