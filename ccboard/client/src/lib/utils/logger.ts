/**
 * Frontend dev logger.
 *
 * In dev mode (Vite): logs everything with colored prefixes.
 * In production: completely stripped by Vite's dead code elimination (import.meta.env.DEV === false).
 */

const isDev = import.meta.env.DEV;

const COLORS: Record<string, string> = {
  sse: "#2B8FCC",
  api: "#F57C25",
  render: "#6AB547",
  error: "#D93B3B",
  nav: "#9B59B6",
};

function makeLogger(module: string) {
  const color = COLORS[module] ?? "#8A8A8A";
  const prefix = `%c[${module}]`;
  const style = `color:${color};font-weight:bold`;

  return {
    debug: (...args: unknown[]) => { if (isDev) console.debug(prefix, style, ...args); },
    info: (...args: unknown[]) => { if (isDev) console.log(prefix, style, ...args); },
    warn: (...args: unknown[]) => { if (isDev) console.warn(prefix, style, ...args); },
    error: (...args: unknown[]) => console.error(prefix, style, ...args), // errors always log
  };
}

export const sseLog = makeLogger("sse");
export const apiLog = makeLogger("api");
export const renderLog = makeLogger("render");
export const errorLog = makeLogger("error");
export const navLog = makeLogger("nav");
