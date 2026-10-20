/**
 * The MIME type that marks the sample resume ("Try a sample resume", src/lib/resume/sample.ts), as BUILDER_MIME marks a
 * built one. No file has it: it only tells the screens to label the resume "Sample".
 */
export const SAMPLE_MIME = "application/vnd.careermetro.sample+json";

export const isSampleResume = (mimeType: string | null | undefined) => mimeType === SAMPLE_MIME;
