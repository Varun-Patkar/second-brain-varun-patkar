---
id: node_5cbf12b58e384fe9ab7cde48e5c969cf
type: task
title: "Token Counter in Agent Activity Panel"
summary: "Add a token counter at the top right of agent activity showing current tokens used, model token limit, and estimated compaction point."
createdAt: 2026-06-21T04:21:55.561Z
updatedAt: 2026-06-21T05:11:24.769Z
status: done
tags: ["token counter", "agent activity", "ui", "context window", "compaction", "second brain"]
edges:
  - { to: node_dee4723d1ba64b8b9fafe2d3c7099055, type: relates_to }
  - { to: node_14dc88be8ff54571b8e4b88661728586, type: relates_to }
---

# Token Counter in Agent Activity Panel

## Description
Add a token counter widget to the **top right of the Agent Activity panel** that gives real-time visibility into context usage.

## Requirements
- Display **tokens used so far** in the current conversation
- Display the **model's token limit** (context window size)
- Show a **progress indicator** (bar or ratio) so the user can see how full the context is
- Show **when compaction will occur** (e.g. "Compacts at ~80% — ~2,400 tokens away")
- Updates live as agent activity streams in

## Implementation Notes
- Pull token counts from the API response metadata (most LLM APIs return `usage.input_tokens` / `usage.output_tokens`)
- Track a rolling total across the conversation turns
- Compaction threshold may be configurable — check current compact logic for the threshold value
- Consider colour coding: 🟢 < 50%, 🟡 50–80%, 🔴 > 80%

## Status
- [ ] Not started