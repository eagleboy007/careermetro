/*
 * Spoken answers for the mock interview, with the browser's own speech-to-text running on the device (the Web Speech
 * API with `processLocally`). Offered only where the browser can recognise speech on the device, so the audio never
 * leaves it and is never sent to CareerMetro or kept; only the text the person sees goes in the answer box. Browsers
 * that send audio to a server for recognition are not offered speaking at all.
 */

type Alternative = { transcript: string };
type Result = { isFinal: boolean; 0: Alternative; length: number };
export type SpeechEvent = { resultIndex: number; results: { length: number; [i: number]: Result } };

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type Availability = "available" | "downloadable" | "downloading" | "unavailable";
type LocalOptions = { langs: string[]; processLocally: boolean };
export type RecognitionCtor = {
  new (): Recognition;
  available?: (o: LocalOptions) => Promise<Availability>;
  install?: (o: LocalOptions) => Promise<boolean>;
};

/** The browser's speech recognition, only when it can run on the device; null elsewhere and on the server. */
export function onDeviceRecognition(scope: unknown = typeof window === "undefined" ? undefined : window): RecognitionCtor | null {
  if (!scope) return null;
  const g = scope as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  const C = g.SpeechRecognition ?? g.webkitSpeechRecognition;
  return C && typeof C.available === "function" ? C : null;
}

/** Languages tried in order: English as spoken in India, then any English the device has. */
export const SPEECH_LANGS = ["en-IN", "en-US", "en-GB"] as const;

/**
 * The first language the device can recognise locally, installing its on-device pack when the browser offers that
 * (a download of the recogniser, never an upload of audio). Null when none can run on the device.
 */
export async function localLanguage(C: RecognitionCtor): Promise<string | null> {
  for (const lang of SPEECH_LANGS) {
    const options = { langs: [lang], processLocally: true };
    const state = await C.available!(options).catch((): Availability => "unavailable");
    if (state === "available") return lang;
    if (state === "downloadable" && C.install && (await C.install(options).catch(() => false))) return lang;
  }
  return null;
}

/** The finished words in a recognition event, from its first new result on. */
export function finalText(e: SpeechEvent): string {
  let out = "";
  for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) out += e.results[i][0].transcript;
  return out.trim();
}

/** The answer with spoken words added at the end, kept within the answer's limit. */
export function withSpoken(answer: string, spoken: string, max: number): string {
  if (!spoken) return answer;
  const joined = answer.trim() ? `${answer.replace(/\s+$/, "")} ${spoken}` : spoken;
  return joined.slice(0, max);
}

/**
 * Starts listening on the device; each finished phrase goes to `onText`. Returns a stop function. `onEnd` runs when
 * listening stops, for any reason, with the error name if there was one (never any audio or text).
 */
export function listen(C: RecognitionCtor, lang: string, onText: (text: string) => void, onEnd: (error: string | null) => void): () => void {
  const r = new C();
  r.lang = lang;
  r.continuous = true;
  r.interimResults = false;
  r.processLocally = true;
  let error: string | null = null;
  r.onresult = (e) => {
    const text = finalText(e);
    if (text) onText(text);
  };
  r.onerror = (e) => {
    error = e.error;
  };
  r.onend = () => onEnd(error);
  r.start();
  return () => r.stop();
}
