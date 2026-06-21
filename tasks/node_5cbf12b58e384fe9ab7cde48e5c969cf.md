---
id: node_5cbf12b58e384fe9ab7cde48e5c969cf
type: task
title: "Token Counter in Agent Activity Panel"
summary: "Add a token counter at the top right of agent activity showing current tokens used, model token limit, and estimated compaction point."
createdAt: 2026-06-21T04:21:55.561Z
updatedAt: 2026-06-21T05:12:42.881Z
tags: ["token counter", "agent activity", "ui", "context window", "compaction", "second brain", "done"]
---

# Token Counter in Agent Activity Panel

## Description
Add a token counter widget to the **top right of the Agent Activity panel** that gives real-time visibility into context usage.

## Requirements
- [x] Display **tokens used so far** in the current conversation
- [x] Display the **model's token limit** (context window size)
- [x] Show a **progress indicator** (bar or ratio)
- [x] Show **when compaction will occur** (e.g. "Compacts at ~80% — ~2,400 tokens away")
- [x] Updates live as agent activity streams in
- [x] Colour coded: 🟢 <50% · 🟡 50–80% · 🔴 >80%

## Status
✅ **Done** — Token counter live in agent activity panel.