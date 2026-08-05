import { describe, expect, it } from "vitest";
import { canonicalJson, hashProtocol } from "./canonical";
import {
  SPEC_VERSION,
  SpecVersionError,
  checkSpecVersion,
  requireSpecVersion,
  versionWarning,
} from "./version";
import { makeProtocol } from "./fixtures";

describe("item 6: specVersion", () => {
  it("is inside the hashed object, so the lock covers it", () => {
    const json = canonicalJson(makeProtocol());
    expect(json).toContain('"specVersion"');
  });

  it("changing it changes the hash", async () => {
    const a = await hashProtocol(makeProtocol());
    const b = await hashProtocol({ ...makeProtocol(), specVersion: "9.9.9" });
    expect(a).not.toBe(b);
  });

  it("passes when the protocol matches the build", () => {
    const check = checkSpecVersion(makeProtocol());
    expect(check).toEqual({ ok: true, version: SPEC_VERSION });
    expect(versionWarning(check)).toBeNull();
    expect(requireSpecVersion(makeProtocol())).toBeNull();
  });

  it("refuses to analyze a protocol locked under a different spec", () => {
    const stale = { ...makeProtocol(), specVersion: "1.0.0" };
    expect(() => requireSpecVersion(stale)).toThrow(SpecVersionError);
  });

  it("names both versions in the warning so the user can see what moved", () => {
    const stale = { ...makeProtocol(), specVersion: "1.0.0" };
    const warning = requireSpecVersion(stale, true);
    expect(warning).toContain("1.0.0");
    expect(warning).toContain(SPEC_VERSION);
  });

  it("treats a missing version as unverifiable rather than current", () => {
    const legacy = { ...makeProtocol(), specVersion: "" };
    const check = checkSpecVersion(legacy);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe("missing");
    expect(() => requireSpecVersion(legacy)).toThrow(SpecVersionError);
    expect(requireSpecVersion(legacy, true)).toContain("exploratory");
  });
});
