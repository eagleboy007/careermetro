/** Words in an answer, as the answer box counts them: runs of non-space characters. Safe in the browser. */
export const countWords = (text: string): number => {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
};
