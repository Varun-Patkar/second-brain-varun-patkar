/**
 * ajv-shim — a tiny, interpreter-based JSON-Schema validator that is a drop-in
 * replacement for the subset of Ajv the agent framework uses to validate tool
 * arguments.
 *
 * Ajv compiles schemas to validator functions via `new Function`, which the
 * Cloudflare Workers runtime forbids ("Code generation from strings disallowed").
 * That made EVERY tool call fail with `invalid-arguments` before the tool even
 * ran. This shim validates by walking the schema at runtime instead of compiling
 * code, so tool-argument validation works on Workers. It is aliased over the
 * `ajv` package in wrangler.toml.
 *
 * Only the features our tool schemas use are implemented (type / properties /
 * required / items, with nested objects + arrays). Anything unrecognized passes,
 * matching the framework's lenient `strict: false` configuration.
 *
 * @packageDocumentation
 */

interface AjvError {
  instancePath: string;
  message: string;
}

interface ValidateFn {
  (data: unknown): boolean;
  errors: AjvError[] | null;
}

type Schema = Record<string, unknown>;

/** Does `data` satisfy the JSON-Schema primitive type `t`? */
function matchesType(t: string, data: unknown): boolean {
  switch (t) {
    case "object":
      return data !== null && typeof data === "object" && !Array.isArray(data);
    case "array":
      return Array.isArray(data);
    case "string":
      return typeof data === "string";
    case "number":
    case "integer":
      return typeof data === "number";
    case "boolean":
      return typeof data === "boolean";
    case "null":
      return data === null;
    default:
      return true;
  }
}

/** Recursively validate `data` against `schema`, collecting errors. */
function walk(schema: unknown, data: unknown, path: string, errors: AjvError[]): void {
  if (!schema || typeof schema !== "object") return;
  const s = schema as Schema;

  if (s.type) {
    const types = Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
    if (!types.some((t) => matchesType(t, data))) {
      errors.push({ instancePath: path, message: `must be ${types.join(" or ")}` });
      return; // further checks assume the type matched
    }
  }

  // Object: required + nested property schemas.
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    for (const req of (s.required as string[] | undefined) ?? []) {
      if (!(req in obj)) errors.push({ instancePath: `${path}/${req}`, message: "is a required property" });
    }
    const props = s.properties as Record<string, unknown> | undefined;
    if (props) {
      for (const [key, sub] of Object.entries(props)) {
        if (key in obj) walk(sub, obj[key], `${path}/${key}`, errors);
      }
    }
  }

  // Array: validate each item against `items`.
  if (Array.isArray(data) && s.items) {
    data.forEach((item, i) => walk(s.items, item, `${path}/${i}`, errors));
  }
}

/** Minimal Ajv-compatible class: `new Ajv(opts).compile(schema)` → validator. */
export default class Ajv {
  // Options are accepted for API compatibility but ignored.
  constructor(_options?: unknown) {}

  compile(schema: unknown): ValidateFn {
    const fn = ((data: unknown): boolean => {
      const errors: AjvError[] = [];
      walk(schema, data, "", errors);
      fn.errors = errors.length > 0 ? errors : null;
      return errors.length === 0;
    }) as ValidateFn;
    fn.errors = null;
    return fn;
  }
}
