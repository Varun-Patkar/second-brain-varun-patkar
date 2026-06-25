---
id: node_f9ce98db9ec5428ba73beac335d3ac9e
type: task
title: "Build Windows Activity Time Tracker"
summary: "Build always-on Windows app to track YouTube/gaming/work time with daily, weekly, monthly reports including phone YouTube via API."
createdAt: 2026-06-25T15:48:13.426Z
updatedAt: 2026-06-25T15:48:13.426Z
startDate: 2026-06-27
tags: ["windows", "productivity", "tracking", "youtube-api", "side-project"]
edges:
  - { to: node_3c1c1233d8994e6c9c5753eeb0d13090, type: authored_by }
---

Build from scratch. Key components:

1. **Windows activity monitor** — poll active window title/process, classify into categories (YouTube, game, work, other)
2. **Phone YouTube tracking** — YouTube Data API to pull watch history or activity
3. **Storage** — local DB (SQLite?) logging time buckets per category per day
4. **Reports** — daily end-of-day summary, weekly digest, monthly overview
5. **Always-on** — runs as background process / system tray app on Windows

Stack TBD. Python (psutil for window tracking) likely. YouTube Data API v3 for phone usage.