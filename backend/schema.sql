-- ===================================================================
-- Family Car Reservation App - SQL schema (Supabase / PostgreSQL)
--
-- Mirrors the JSON store in src/db.js. Notes on the differences from the
-- first version:
--   * pin_code (clear text) is now pin_hash - a scrypt hash. A PIN is never
--     stored or transmitted in the clear.
--   * reservations gained notified_end, so an end-of-trip reminder is not
--     re-sent after a server restart.
--   * Row Level Security is enabled with an explicit deny by default, because
--     an anon Supabase key is public by definition.
-- ===================================================================

-- 1. Family members
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    phone VARCHAR(30),                  -- international format, e.g. 972501234567
    color VARCHAR(7) NOT NULL DEFAULT '#0071E3' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
    pin_hash TEXT,                      -- scrypt$<salt>$<hash>; NULL for members
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT admin_has_pin CHECK (role <> 'admin' OR pin_hash IS NOT NULL),
    CONSTRAINT member_has_no_pin CHECK (role <> 'member' OR pin_hash IS NULL)
);

-- 2. Reservations
CREATE TABLE IF NOT EXISTS reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    reason TEXT NOT NULL DEFAULT 'נסיעה כללית',
    status VARCHAR(30) NOT NULL DEFAULT 'confirmed'
        CHECK (status IN ('confirmed', 'pending_approval', 'in_progress', 'completed', 'cancelled')),
    is_quick_ride BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    source VARCHAR(20) NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'whatsapp')),
    notified_end BOOLEAN NOT NULL DEFAULT FALSE,
    approved_by VARCHAR(100),
    approved_at TIMESTAMPTZ,
    rejected_by VARCHAR(100),
    rejected_at TIMESTAMPTZ,
    cancel_reason TEXT,
    returned_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT valid_times CHECK (end_time > start_time),
    CONSTRAINT reason_length CHECK (char_length(reason) <= 280)
);

-- Only CONFIRMED reservations may overlap-check against each other:
-- a pending request must not block the car before a parent approves it.
-- Back-to-back is allowed by design, so the range is [start, end).
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS no_overlapping_confirmed;
ALTER TABLE reservations ADD CONSTRAINT no_overlapping_confirmed
    EXCLUDE USING gist (tstzrange(start_time, end_time, '[)') WITH &&)
    WHERE (status IN ('confirmed', 'in_progress'));

CREATE INDEX IF NOT EXISTS idx_reservations_window ON reservations (start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations (status);
CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations (user_id);

-- 3. Waitlist (standby)
CREATE TABLE IF NOT EXISTS waitlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
    target_start TIMESTAMPTZ NOT NULL,
    target_end TIMESTAMPTZ NOT NULL,
    notified BOOLEAN NOT NULL DEFAULT FALSE,
    notified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT valid_target CHECK (target_end > target_start),
    -- One open request per person per window.
    CONSTRAINT unique_open_wait UNIQUE (user_id, target_start, target_end, notified)
);

CREATE INDEX IF NOT EXISTS idx_waitlist_open ON waitlist (notified, target_start);

-- 4. Settings
CREATE TABLE IF NOT EXISTS app_settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===================================================================
-- Row Level Security
-- The anon key ships inside the client, so without RLS these tables are
-- world-readable and world-writable. Deny by default; the backend uses the
-- service role key, which bypasses RLS.
-- ===================================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
-- No permissive policies are created on purpose: every read and write must go
-- through the Node backend, which enforces the family code, the parent PIN and
-- per-reservation ownership.

-- ===================================================================
-- Seed data
-- The PIN hashes below are for "1234" and MUST be replaced. Generate with:
--   node -e "import('./src/auth.js').then(m => console.log(m.hashPin('1234')))"
-- Each call produces a different salt, which is expected.
-- ===================================================================
INSERT INTO users (name, role, phone, color, pin_hash) VALUES
('אבא',   'admin',  '972501111111', '#0071E3', 'REPLACE_WITH_SCRYPT_HASH'),
('אמא',   'admin',  '972502222222', '#AF52DE', 'REPLACE_WITH_SCRYPT_HASH'),
('יונתן', 'member', '972503333333', '#34C759', NULL),
('נועה',  'member', '972504444444', '#FF9500', NULL),
('עומר',  'member', '972505555555', '#FF2D55', NULL)
ON CONFLICT (name) DO NOTHING;

INSERT INTO app_settings (key, value) VALUES
('family_code',              '"1234"'),
('car_name',                 '"טויוטה קורולה משפחתית"'),
('car_plate',                '"12-345-67"'),
('default_location',         '"חניה ראשית (בבית)"'),
('approval_threshold_hours', '12')
ON CONFLICT (key) DO NOTHING;
