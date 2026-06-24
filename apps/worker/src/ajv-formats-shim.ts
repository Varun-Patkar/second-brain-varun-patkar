/**
 * ajv-formats-shim — a no-op stand-in for the `ajv-formats` package.
 *
 * The `@modelcontextprotocol/sdk` Client constructs a default Ajv validator and
 * calls `addFormats(ajv)` on it (to register string formats like `date-time`,
 * `email`, …). The real `ajv-formats` plugin pokes at Ajv internals that don't
 * exist on our interpreter-based {@link ../ajv-shim} (it reads `opts.code`),
 * throwing `Cannot read properties of undefined (reading 'code')` and making
 * every MCP `connect()` fail in the Workers runtime.
 *
 * Our schema validation is structural (type/required/properties/items) and never
 * needs the format keyword, so this shim simply returns the Ajv instance
 * unchanged. It is aliased over `ajv-formats` in wrangler.toml, exactly like the
 * `ajv` shim.
 *
 * @packageDocumentation
 */

/** No-op `addFormats(ajv, opts?)` — returns the instance untouched. */
function addFormats<T>(ajv: T, _opts?: unknown): T {
  return ajv;
}

export default addFormats;
