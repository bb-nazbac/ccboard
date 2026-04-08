import { marked } from "marked";

// highlight.js is loaded from CDN in index.html to avoid 1MB bundle
declare const hljs: { getLanguage: (lang: string) => unknown; highlight: (code: string, opts: { language: string }) => { value: string } } | undefined;

const renderer = new marked.Renderer();
renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  if (lang && typeof hljs !== "undefined" && hljs.getLanguage(lang)) {
    const highlighted = hljs.highlight(text, { language: lang }).value;
    return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
  }
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<pre><code>${escaped}</code></pre>`;
};

marked.use({ renderer, gfm: true, breaks: true });

export function renderMarkdown(text: string): string {
  return marked.parse(text) as string;
}
