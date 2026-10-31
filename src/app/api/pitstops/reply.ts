import { OWN_PITSTOP_MESSAGES, type OwnPitstopError } from "@/lib/schemas";

/*
 * Shared by the own-pitstop routes (FR-58): how a refusal becomes a response. Each carries the code and the words for
 * it, never what the person typed. Logs take the code only.
 */

/** Largest body an add or edit sends: a goal id, a 40-character name (spaces and escapes allowed) and a course id. */
export const BODY_MAX = 1_000;

const STATUS: Record<OwnPitstopError, number> = {
  invalid: 400,
  title: 400,
  link: 400,
  course: 400,
  not_found: 404,
  goal_closed: 409,
  per_goal: 409,
  max: 409,
  no_path: 409,
  limit: 429,
};

export const refuse = (code: OwnPitstopError) => Response.json({ ok: false, code, error: OWN_PITSTOP_MESSAGES[code] }, { status: STATUS[code] });
export const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });

/** The JSON body, read only up to BODY_MAX characters; undefined for a body that is too large or not JSON. */
export async function readBody(request: Request): Promise<{ tooLarge: true } | { tooLarge: false; body: unknown }> {
  if (Number(request.headers.get("content-length") ?? 0) > BODY_MAX) return { tooLarge: true };
  const text = await request.text().catch(() => "");
  if (text.length > BODY_MAX) return { tooLarge: true };
  try {
    return { tooLarge: false, body: JSON.parse(text) };
  } catch {
    return { tooLarge: false, body: undefined };
  }
}
