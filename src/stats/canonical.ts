import type { Protocol } from "../types";

/**
 * §4.1. Canonical JSON: object keys sorted recursively, arrays in order, no
 * whitespace. Numbers use ECMAScript shortest round-trip form (JSON.stringify),
 * which is fully deterministic for a given value; non-finite numbers are refused
 * rather than silently serialized as null.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "number":
      if (!Number.isFinite(value)) throw new Error("canonicalJson: non-finite number");
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "object": {
      if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
      const obj = value as Record<string, unknown>;
      const parts: string[] = [];
      for (const key of Object.keys(obj).sort()) {
        if (obj[key] === undefined) continue;
        parts.push(JSON.stringify(key) + ":" + canonicalJson(obj[key]));
      }
      return "{" + parts.join(",") + "}";
    }
    default:
      throw new Error(`canonicalJson: cannot serialize a ${typeof value}`);
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The hash that gets locked, displayed, and (if the user chooses) posted publicly. */
export function hashProtocol(protocol: Protocol): Promise<string> {
  return sha256Hex(canonicalJson(protocol));
}
