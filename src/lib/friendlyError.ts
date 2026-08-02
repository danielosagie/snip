/** Strip Convex's transport/debug wrapper before showing an error to a user. */
export function friendlyError(error: unknown, fallback: string): string {
  const data =
    typeof error === "object" && error !== null && "data" in error
      ? (error as { data?: unknown }).data
      : undefined;
  if (typeof data === "object" && data !== null && "message" in data) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }

  const raw = error instanceof Error ? error.message : String(error ?? "");
  const uncaught = raw.match(/Uncaught Error:\s*([^\n]+)/)?.[1];
  const message = (uncaught ?? raw)
    .replace(/^\[CONVEX[^\n]*\]\s*/g, "")
    .replace(/^Server Error\s*/i, "")
    .split("\n")[0]
    .trim();
  return (message || fallback).slice(0, 240);
}
