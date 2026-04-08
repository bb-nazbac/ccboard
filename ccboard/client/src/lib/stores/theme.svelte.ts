/** Theme store — syncs with localStorage and data-theme attribute */

const STORAGE_KEY = "ccboard-theme";

function getInitialTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  return (localStorage.getItem(STORAGE_KEY) as "dark" | "light") ?? "dark";
}

let current = $state<"dark" | "light">(getInitialTheme());

function applyTheme(theme: "dark" | "light") {
  document.documentElement.setAttribute("data-theme", theme);
  if (theme === "light") {
    document.body.classList.add("no-crt");
  } else {
    document.body.classList.remove("no-crt");
  }
}

// Apply on load
if (typeof window !== "undefined") applyTheme(current);

export function toggleTheme() {
  current = current === "dark" ? "light" : "dark";
  localStorage.setItem(STORAGE_KEY, current);
  applyTheme(current);
}

export function getTheme(): "dark" | "light" {
  return current;
}
