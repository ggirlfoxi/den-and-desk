-- Den & Desk — PostgreSQL schema (Phase 0 + Phase 1).
-- Used when DATABASE_URL is set. The in-memory store mirrors these tables
-- for local development only and must not be used for a shared deployment.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL REFERENCES users(id),
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Owner', 'Pet', 'Switch', 'Curious')),
  pet_type TEXT CHECK (pet_type IN ('Kitty', 'Puppy')),
  meeting_mode TEXT NOT NULL DEFAULT 'Both' CHECK (meeting_mode IN ('Online', 'InPerson', 'Both')),
  region TEXT
);
CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  blocker_user_id TEXT NOT NULL REFERENCES users(id),
  blocked_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (blocker_user_id, blocked_user_id)
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_user_id TEXT NOT NULL REFERENCES users(id),
  reported_user_id TEXT NOT NULL REFERENCES users(id),
  category TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  urgent BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS invite_codes (
  code TEXT PRIMARY KEY,
  used_by_user_id TEXT REFERENCES users(id),
  used_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS likes (
  id TEXT PRIMARY KEY,
  liker_user_id TEXT NOT NULL REFERENCES users(id),
  liked_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (liker_user_id, liked_user_id)
);
CREATE TABLE IF NOT EXISTS passes (
  id TEXT PRIMARY KEY,
  passer_user_id TEXT NOT NULL REFERENCES users(id),
  passed_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (passer_user_id, passed_user_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  sender_user_id TEXT NOT NULL REFERENCES users(id),
  recipient_user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL CHECK (char_length(body) >= 1 AND char_length(body) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS ratings (
  id TEXT PRIMARY KEY,
  rater_user_id TEXT NOT NULL REFERENCES users(id),
  rated_user_id TEXT NOT NULL REFERENCES users(id),
  score INTEGER NOT NULL CHECK (score >= 1 AND score <= 5),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rater_user_id, rated_user_id)
);

-- Phase 1 migration for a database created from the Phase 0 schema only
-- (fresh databases created from this file need nothing extra):
-- ALTER TABLE profiles ADD COLUMN IF NOT EXISTS meeting_mode TEXT NOT NULL DEFAULT 'Both' CHECK (meeting_mode IN ('Online', 'InPerson', 'Both'));
-- ALTER TABLE profiles ADD COLUMN IF NOT EXISTS region TEXT;
-- ALTER TABLE reports ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved'));
-- Then run the CREATE TABLE statements for likes, passes, messages and ratings above.

-- Phase 2 tables: contracts, duties, rewards, bookings, aftercare,
-- video-hello requests, scheduled check-ins. A database created from
-- the Phase 0/1 schema needs only the CREATE TABLE statements below
-- (fresh databases created from this file need nothing extra).
CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  proposer_user_id TEXT NOT NULL REFERENCES users(id),
  partner_user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  limits TEXT NOT NULL DEFAULT '',
  safeword TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'ended')),
  signed_user_ids TEXT[] NOT NULL DEFAULT '{}',
  resume_user_ids TEXT[] NOT NULL DEFAULT '{}',
  paused_by_user_id TEXT REFERENCES users(id),
  safeword_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS duties (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  assigned_to_user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('open', 'submitted', 'approved')),
  proof_note TEXT NOT NULL DEFAULT '',
  review_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS rewards (
  id TEXT PRIMARY KEY,
  duty_id TEXT NOT NULL REFERENCES duties(id),
  granted_by_user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (duty_id)
);
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  proposer_user_id TEXT NOT NULL REFERENCES users(id),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  meeting_mode TEXT NOT NULL CHECK (meeting_mode IN ('Online', 'InPerson', 'Both')),
  region TEXT,
  work_description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('proposed', 'confirmed', 'declined', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_at > start_at)
);
CREATE TABLE IF NOT EXISTS aftercare_plans (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  closure_phrase TEXT NOT NULL,
  self_care_prompts TEXT[] NOT NULL DEFAULT '{}',
  check_in_minutes INTEGER NOT NULL CHECK (check_in_minutes >= 0 AND check_in_minutes <= 1440),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS aftercare_checkins (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  plan_id TEXT REFERENCES aftercare_plans(id),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('prompt', 'scheduled')),
  note TEXT NOT NULL DEFAULT '',
  due_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS video_hellos (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  requester_user_id TEXT NOT NULL REFERENCES users(id),
  recipient_user_id TEXT NOT NULL REFERENCES users(id),
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('requested', 'accepted', 'declined', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS scheduled_checkins (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  creator_user_id TEXT NOT NULL REFERENCES users(id),
  recipient_user_id TEXT NOT NULL REFERENCES users(id),
  note TEXT NOT NULL DEFAULT '',
  due_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Phase 3 tables: owner commands, daily routine items, gear wishlist
-- (no prices, no payments), safe lost-pet alerts, lost-game settings
-- and game-area tokens, and private praise notes. Lost alerts carry
-- only a user-typed general-area label — never a precise location,
-- never a phone number, never coordinates.
CREATE TABLE IF NOT EXISTS owner_commands (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  sender_user_id TEXT NOT NULL REFERENCES users(id),
  recipient_user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('Come home', 'Bedtime', 'Cage time', 'Eat', 'Walk', 'Potty break')),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('sent', 'done', 'need-help', 'passed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS routine_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  label TEXT NOT NULL CHECK (label IN ('Eat', 'Walk', 'Potty', 'Nap', 'Play')),
  status TEXT NOT NULL CHECK (status IN ('open', 'done', 'passed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, date, label)
);
CREATE TABLE IF NOT EXISTS wishlist_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('collar', 'leash', 'outfit', 'den', 'toy', 'other')),
  note TEXT NOT NULL DEFAULT '',
  shared BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS lost_alerts (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  pet_user_id TEXT NOT NULL REFERENCES users(id),
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  general_area TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('lost', 'home', 'resolved')),
  resolved_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  found_by_user_id TEXT REFERENCES users(id),
  found_at TIMESTAMPTZ,
  reward TEXT NOT NULL DEFAULT 'badge' CHECK (reward IN ('badge', 'thank-you', 'treat', 'wishlist-gift'))
);
CREATE TABLE IF NOT EXISTS lost_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  sound_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  game_area TEXT
);
CREATE TABLE IF NOT EXISTS praise_notes (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  sender_user_id TEXT NOT NULL REFERENCES users(id),
  recipient_user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('praise', 'correction')),
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pet-sitting tables (test/dev build): bounded temporary sits on top
-- of an active contract. No home address, no keys, no real-world
-- access detail is stored anywhere in this schema, by design.
CREATE TABLE IF NOT EXISTS sittings (
  id TEXT PRIMARY KEY,
  base_contract_id TEXT NOT NULL REFERENCES contracts(id),
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  pet_user_id TEXT NOT NULL REFERENCES users(id),
  sitter_user_id TEXT REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('requested', 'awaiting-agreement', 'active', 'paused', 'ended', 'expired')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  routine_summary TEXT NOT NULL DEFAULT '',
  limits TEXT NOT NULL DEFAULT '',
  safeword_note TEXT NOT NULL DEFAULT '',
  agreed_user_ids TEXT[] NOT NULL DEFAULT '{}',
  notes JSONB NOT NULL DEFAULT '[]'::jsonb,
  handover_report TEXT NOT NULL DEFAULT '',
  badge_awarded BOOLEAN NOT NULL DEFAULT FALSE,
  ended_reason TEXT,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);
