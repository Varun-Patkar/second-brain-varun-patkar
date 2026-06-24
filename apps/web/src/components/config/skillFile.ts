/**
 * Skill-file helpers for the management UI: serializing a skill to the standard
 * `skills/<name>.md` frontmatter format, parsing an uploaded skill file back into
 * the editable `BrainSkill` shape, and providing a downloadable template.
 *
 * The format mirrors the worker's `serializeSkill`/`parseSkill`
 * (`apps/worker/src/storage/config.ts`): a tiny `name` + `description`
 * frontmatter block followed by the markdown body.
 *
 * @packageDocumentation
 */

import type { BrainSkill } from "@second-brain/shared";

/** Serialize a skill to the canonical `skills/<name>.md` text. */
export function serializeSkillFile(skill: BrainSkill): string {
  return `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill.content.trimStart()}\n`;
}

/**
 * Parse an uploaded skill markdown file back into a {@link BrainSkill}. Falls back
 * to the supplied filename (without extension) for the name when no frontmatter
 * `name` is present.
 */
export function parseSkillFile(raw: string, fallbackName = "skill"): BrainSkill {
  const text = raw.replace(/^\uFEFF/, "");
  let name = fallbackName;
  let description = "";
  let body = text;
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end !== -1) {
      const header = text.slice(3, end);
      body = text.slice(end + 4).replace(/^\n+/, "");
      for (const line of header.split("\n")) {
        const idx = line.indexOf(":");
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
        if (key === "name") name = value || fallbackName;
        if (key === "description") description = value;
      }
    }
  }
  return { name, description: description || name, content: body };
}

/** The downloadable starter template shown when a user wants to author offline. */
export const SKILL_TEMPLATE = `---
name: my-skill
description: One sentence describing WHEN the agent should use this skill.
---

# My skill

Explain the domain knowledge, steps, or conventions the agent should follow.

You may reference a stored secret as {{secret:NAME}} — it is resolved server-side
and never shown to the model in plaintext.
`;

/** Trigger a client-side download of text as a file. */
export function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
