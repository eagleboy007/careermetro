/** What our API routes answer with. Other fields depend on the route. */
export type ApiReply = { ok: boolean; error?: string; [key: string]: unknown };

const BY_STATUS: Record<number, string> = {
  413: "This file is too large. Please upload a smaller file.",
  504: "This took too long. Please try again, or paste the text instead.",
};

/**
 * Reads a reply from one of our API routes. A reply that isn't our JSON, such as a hosting error page,
 * becomes a plain message for its status instead of looking like a lost connection.
 */
export async function readApiReply(res: Response): Promise<ApiReply> {
  if (res.headers.get("content-type")?.includes("application/json")) {
    try {
      return (await res.json()) as ApiReply;
    } catch {}
  }
  return { ok: false, error: BY_STATUS[res.status] ?? "Something went wrong. Please try again." };
}
