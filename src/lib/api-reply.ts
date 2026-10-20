/**
 * What a screen says when a request or server action never reached CareerMetro (offline, or the connection dropped).
 * Shown where the person is, so a typed message or a half-done step isn't lost to the error page.
 */
export const NO_CONNECTION = "We couldn't reach CareerMetro. Check your connection and try again.";

/** What a screen says when a request or server action failed while the browser is online, so the fault is likely ours. */
export const ACTION_FAILED = "That didn't go through. Please try again, or reload the page.";

/**
 * The message for a request or server action that threw (use as `.catch(actionFailed)`): NO_CONNECTION only while the
 * browser says it is offline, else ACTION_FAILED, so a server error doesn't read as a lost connection.
 */
export function actionFailed(): string {
  return typeof navigator !== "undefined" && navigator.onLine === false ? NO_CONNECTION : ACTION_FAILED;
}

/** What our API routes answer with. Other fields depend on the route. */
export type ApiReply = { ok: boolean; error?: string; [key: string]: unknown };

const BY_STATUS: Record<number, string> = {
  413: "This file is too large. Please upload a smaller file.",
  504: "This took too long. Please try again, or paste the text instead.",
};

/**
 * Reads a reply from one of our API routes. A reply that isn't our JSON, such as a hosting error page,
 * becomes a plain message for its status instead of looking like a lost connection. An abort while the body is
 * still arriving (the caller's AbortController) is thrown on, so the caller can say it stopped waiting.
 */
export async function readApiReply(res: Response, signal?: AbortSignal): Promise<ApiReply> {
  if (res.headers.get("content-type")?.includes("application/json")) {
    try {
      return (await res.json()) as ApiReply;
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
    }
  }
  return { ok: false, error: BY_STATUS[res.status] ?? "Something went wrong. Please try again." };
}
