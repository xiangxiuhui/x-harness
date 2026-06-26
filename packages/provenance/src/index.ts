/**
 * @x_harness/provenance — AI-touch watermark for filesystem objects (ADR-0009).
 *
 * Surface: TypeScript. Implementation: shells out to macOS `xattr(1)` and
 * Linux `setfattr/getfattr/attr`. A future Rust kernel binding can drop in
 * later (see crates/x_kernel) — this package's API is stable so callers
 * don't change.
 *
 * Why not a Rust binding NOW:
 *   - Adds a build-time dep (cargo) for ~10 lines of OS syscalls.
 *   - JSONL is the source of truth; xattr is only the forward index.
 *   - Once kernel work makes Rust mandatory for other reasons, we keep this
 *     module's signature and swap the implementation.
 *
 * Rule: every (read|write|remove)Provenance call MUST be paired with a
 * JSONL `provenance.attach` / `provenance.read` entry by the caller. The
 * caller owns audit; this module owns bytes.
 */
export * from './types.js';
export * from './xattr.js';
export * from './provenance.js';
