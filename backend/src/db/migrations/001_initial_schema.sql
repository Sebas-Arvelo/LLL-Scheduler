CREATE TABLE seasons (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  start_date date NOT NULL,
  end_date date NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seasons_date_range CHECK (end_date >= start_date)
);

CREATE TABLE group_categories (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE camp_groups (
  id text PRIMARY KEY,
  season_id text NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  category_id text NOT NULL REFERENCES group_categories(id),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  participant_count integer NULL CHECK (participant_count >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX camp_groups_season_idx ON camp_groups(season_id);

CREATE TABLE activities (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  display_category text NULL,
  description text NULL,
  max_groups integer NOT NULL CHECK (max_groups >= 1),
  max_participants integer NULL CHECK (max_participants >= 1),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE activity_eligibility (
  activity_id text NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  group_category_id text NOT NULL REFERENCES group_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (activity_id, group_category_id)
);

CREATE TABLE time_blocks (
  id text PRIMARY KEY,
  season_id text NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  start_time time NULL,
  end_time time NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_blocks_unique_order UNIQUE (season_id, sort_order),
  CONSTRAINT time_blocks_time_range CHECK (start_time IS NULL OR end_time IS NULL OR end_time > start_time)
);

CREATE TABLE schedules (
  id uuid PRIMARY KEY,
  season_id text NOT NULL REFERENCES seasons(id),
  name text NULL,
  range_start date NOT NULL,
  range_end date NOT NULL,
  seed bigint NOT NULL CHECK (seed >= 0 AND seed <= 4294967295),
  algorithm_version text NOT NULL CHECK (length(trim(algorithm_version)) > 0),
  status text NOT NULL CHECK (status IN ('draft', 'generated', 'archived')),
  configuration_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedules_date_range CHECK (range_end >= range_start)
);

CREATE INDEX schedules_season_created_idx ON schedules(season_id, created_at DESC);

CREATE TABLE assignments (
  id uuid PRIMARY KEY,
  schedule_id uuid NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  group_id text NOT NULL REFERENCES camp_groups(id),
  activity_id text NOT NULL REFERENCES activities(id),
  assignment_date date NOT NULL,
  time_block_id text NOT NULL REFERENCES time_blocks(id),
  cycle_id text NULL,
  source text NOT NULL CHECK (source IN ('automatic', 'manual', 'imported')),
  status text NOT NULL CHECK (status IN ('planned', 'confirmed', 'completed', 'cancelled')),
  locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assignments_one_group_per_slot UNIQUE (schedule_id, group_id, assignment_date, time_block_id)
);

CREATE INDEX assignments_schedule_idx ON assignments(schedule_id);

CREATE TABLE schedule_unassigned (
  id uuid PRIMARY KEY,
  schedule_id uuid NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  group_id text NOT NULL REFERENCES camp_groups(id),
  unassigned_date date NOT NULL,
  time_block_id text NOT NULL REFERENCES time_blocks(id),
  reason_code text NOT NULL CHECK (reason_code IN (
    'NO_ELIGIBLE_ACTIVITY',
    'CAPACITY_EXHAUSTED',
    'GROUP_UNAVAILABLE',
    'NO_AVAILABLE_ACTIVITY',
    'PARTICIPANT_COUNT_REQUIRED',
    'INVALID_INPUT',
    'NO_FEASIBLE_ASSIGNMENT'
  )),
  context jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_unassigned_one_group_per_slot UNIQUE (schedule_id, group_id, unassigned_date, time_block_id)
);

CREATE INDEX schedule_unassigned_schedule_idx ON schedule_unassigned(schedule_id);
