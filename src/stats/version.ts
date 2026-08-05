import type { Protocol } from "../types";

/** The spec version this build implements. Must match SPEC.md's header. */
export const SPEC_VERSION = "1.1.0";

export type VersionCheck =
  | { ok: true; version: string }
  | { ok: false; reason: "missing"; build: string }
  | { ok: false; reason: "mismatch"; locked: string; build: string };

/**
 * §5.5. A protocol locked under one set of statistical rules and analyzed under
 * another is not pre-registered in any meaningful sense — the goalposts moved,
 * just not by the user's hand.
 */
export function checkSpecVersion(protocol: Protocol): VersionCheck {
  const locked = protocol.specVersion;
  if (typeof locked !== "string" || locked.trim() === "") {
    return { ok: false, reason: "missing", build: SPEC_VERSION };
  }
  if (locked !== SPEC_VERSION) return { ok: false, reason: "mismatch", locked, build: SPEC_VERSION };
  return { ok: true, version: locked };
}

export function versionWarning(check: VersionCheck): string | null {
  if (check.ok) return null;
  if (check.reason === "missing") {
    return `This protocol was locked without a spec version. It predates version tracking and cannot be verified against this build (${check.build}). Any analysis is exploratory.`;
  }
  return `This protocol was locked under spec ${check.locked}; this build implements ${check.build}. The statistical rules may have changed since you locked. Re-lock under the current spec, or treat every number below as exploratory.`;
}

export class SpecVersionError extends Error {
  readonly check: VersionCheck;
  constructor(check: VersionCheck) {
    super(versionWarning(check) ?? "spec version mismatch");
    this.name = "SpecVersionError";
    this.check = check;
  }
}

/**
 * Gate for the analysis path. Refusing is the default; `allowMismatch` is the
 * documented escape hatch that keeps old protocols readable, and it returns the
 * warning text so callers cannot proceed without something to display.
 */
export function requireSpecVersion(protocol: Protocol, allowMismatch = false): string | null {
  const check = checkSpecVersion(protocol);
  if (check.ok) return null;
  if (!allowMismatch) throw new SpecVersionError(check);
  return versionWarning(check);
}
