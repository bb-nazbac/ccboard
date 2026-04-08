/** Navigate to a path using client-side routing */
export function navigateTo(path: string) {
  const nav = (window as unknown as Record<string, unknown>).__ccboardNavigate as ((path: string) => void) | undefined;
  if (nav) {
    nav(path);
  } else {
    // Fallback: full page navigation
    window.location.href = path;
  }
}
