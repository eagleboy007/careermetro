import { ZodError } from "zod";
import { errorFields, logEvent } from "@/lib/log";
import type { NearbyLines } from "@/lib/schemas";

/** At most this many failing field paths go in the log line, which keeps it under the log's 120-character value limit. */
const MAX_PATHS = 4;

/**
 * Nearby lines are an extra: if working them out fails (a role profile edit that breaks the schema, say), the Map and
 * Me still render without them. The log line says only which fields failed, as paths such as "lines.0.total", never
 * a skill, a role title or anything from the resume.
 */
export function nearbyOrNothing(build: () => NearbyLines): NearbyLines | undefined {
  try {
    return build();
  } catch (error) {
    if (error instanceof ZodError) {
      const paths = [...new Set(error.issues.map((i) => i.path.map(String).join(".") || "(root)"))];
      logEvent("error", "nearby_failed", { error: "zod", issues: error.issues.length, paths: paths.slice(0, MAX_PATHS).join("/") });
    } else {
      logEvent("error", "nearby_failed", errorFields(error));
    }
    return undefined;
  }
}
