/** Escape HTML special characters. Always coerces to string first. */
export function escapeHtml(s: unknown): string {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Shorten a file path for display */
export function shortenPath(p: string, maxLen = 40): string {
  if (p.length <= maxLen) return p;
  const parts = p.split("/");
  if (parts.length <= 2) return p;
  return ".../" + parts.slice(-2).join("/");
}
