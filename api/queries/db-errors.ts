// The database library wraps every failure as "Failed query: ...", and the real reason (for example
// "Duplicate column name" or "Duplicate entry") sits in the error's cause. Checking only the outer message
// silently misses it, so anything that needs to recognise a specific database error reads the whole chain.
export function dbErrorText(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      const code = (cur as { code?: unknown }).code;
      if (typeof code === "string") parts.push(code);
      cur = (cur as { cause?: unknown }).cause;
    } else {
      parts.push(String(cur));
      break;
    }
  }
  return parts.join(" | ");
}
