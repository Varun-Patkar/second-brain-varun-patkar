-- Task scheduling: optional start/end days and a completion timestamp.
-- Markdown frontmatter remains the source of truth; these columns make the
-- Tasks-page timeline (future-by-start-day / today / past-by-completion-day)
-- groupable without reading every markdown file (one D1 read instead of N).
ALTER TABLE nodes ADD COLUMN start_date   TEXT;  -- YYYY-MM-DD; NULL = active immediately
ALTER TABLE nodes ADD COLUMN end_date     TEXT;  -- YYYY-MM-DD; NULL = indefinite (shows daily until done)
ALTER TABLE nodes ADD COLUMN completed_at TEXT;  -- ISO timestamp set when a task is marked done
