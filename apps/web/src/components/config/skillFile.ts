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
 * Parse the `key: value` lines of a skill's frontmatter into a record, tolerating
 * YAML block scalars (`key: >` folded / `key: |` literal, with optional `+`/`-`
 * chomping) whose value continues on the following indented lines. Quotes around
 * simple single-line values are stripped. Keys are lower-cased.
 */
function parseFrontmatterFields(block: string): Record<string, string> {
  const lines = block.split("\n");
  const fields: Record<string, string> = {};
  let i = 0;
  while (i < lines.length) {
    const m = /^([A-Za-z0-9_-]+)[ \t]*:[ \t]*(.*)$/.exec(lines[i]!);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1]!.toLowerCase();
    let value = m[2]!.trim();
    if (/^[>|][+-]?$/.test(value)) {
      // Block scalar: collect the following more-indented (or blank) lines.
      const literal = value.startsWith("|");
      const collected: string[] = [];
      let indent = -1;
      i++;
      while (i < lines.length) {
        const l = lines[i]!;
        if (l.trim() === "") {
          collected.push("");
          i++;
          continue;
        }
        const lead = l.length - l.trimStart().length;
        if (indent === -1) indent = lead;
        if (lead < indent) break; // dedent → next key / end of block
        collected.push(l.slice(indent));
        i++;
      }
      while (collected.length && collected[collected.length - 1] === "") collected.pop();
      value = literal ? collected.join("\n") : collected.join(" ").replace(/\s+/g, " ").trim();
    } else {
      value = value.replace(/^["']|["']$/g, "");
      i++;
    }
    fields[key] = value;
  }
  return fields;
}

/**
 * Parse an uploaded skill markdown file back into a {@link BrainSkill}, tolerating
 * messy formatting: a leading BOM, Windows (CRLF) line endings, blank lines or
 * spaces around the `---` fences, `key : value` frontmatter with arbitrary
 * spacing, and YAML block-scalar descriptions (`description: >` spanning several
 * indented lines). Falls back to the supplied filename (without extension) for
 * the name when no frontmatter `name` is present.
 */
export function parseSkillFile(raw: string, fallbackName = "skill"): BrainSkill {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let body = text.trimStart();
  let name = fallbackName;
  let description = "";
  // Match an opening `---` fence (allowing trailing spaces), the frontmatter
  // block, and a closing `---` fence.
  const fm = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?/.exec(body);
  if (fm) {
    body = body.slice(fm[0].length).replace(/^\n+/, "");
    const fields = parseFrontmatterFields(fm[1]!);
    if (fields.name) name = fields.name;
    if (fields.description) description = fields.description;
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
