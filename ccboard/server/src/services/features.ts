/**
 * Feature tracking system — reads/writes .md files in {cwd}/.ccboard/features/
 */

import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { execSync } from "child_process";
import { createLogger } from "../lib/logger.js";

const log = createLogger("features");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Feature {
  slug: string;
  status: "active" | "completed" | "paused";
  branch: string;
  created: string;
  title: string;
  description: string;
  acceptanceCriteria: Array<{ text: string; done: boolean }>;
  progress: Array<{ text: string; done: boolean }>;
  raw: string;
}

// ---------------------------------------------------------------------------
// Frontmatter parser (no yaml dependency)
// ---------------------------------------------------------------------------

interface Frontmatter {
  status?: string;
  branch?: string;
  created?: string;
}

function parseFrontmatter(raw: string): { frontmatter: Frontmatter; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };

  const fm: Frontmatter = {};
  const lines = (match[1] ?? "").split("\n");
  for (const line of lines) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv?.[1] && kv[2] !== undefined) {
      const key = kv[1] as keyof Frontmatter;
      fm[key] = kv[2].trim();
    }
  }
  return { frontmatter: fm, body: match[2] ?? "" };
}

function serializeFrontmatter(fm: Frontmatter): string {
  const lines: string[] = ["---"];
  if (fm.status) lines.push(`status: ${fm.status}`);
  if (fm.branch) lines.push(`branch: ${fm.branch}`);
  if (fm.created) lines.push(`created: ${fm.created}`);
  lines.push("---");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Markdown parser
// ---------------------------------------------------------------------------

function parseCheckboxes(section: string): Array<{ text: string; done: boolean }> {
  const items: Array<{ text: string; done: boolean }> = [];
  const re = /- \[([ xX])\]\s*(.+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(section)) !== null) {
    const done = m[1] !== " ";
    const text = (m[2] ?? "").trim();
    items.push({ done, text });
  }
  return items;
}

function parseFeatureBody(body: string): Pick<Feature, "title" | "description" | "acceptanceCriteria" | "progress"> {
  // Title: first # heading
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim() ?? "";

  // Description: text between title line and the first ## heading
  let description = "";
  if (titleMatch) {
    const afterTitle = body.slice((titleMatch.index ?? 0) + titleMatch[0].length);
    const nextHeading = afterTitle.search(/^##\s+/m);
    description = (nextHeading === -1 ? afterTitle : afterTitle.slice(0, nextHeading)).trim();
  }

  // Acceptance criteria section
  const acMatch = body.match(/## Acceptance [Cc]riteria\s*\n([\s\S]*?)(?=\n## |\n*$)/);
  const acceptanceCriteria = acMatch ? parseCheckboxes(acMatch[1] ?? "") : [];

  // Progress section
  const progressMatch = body.match(/## Progress\s*\n([\s\S]*?)(?=\n## |\n*$)/);
  const progress = progressMatch ? parseCheckboxes(progressMatch[1] ?? "") : [];

  return { title, description, acceptanceCriteria, progress };
}

function parseFeatureFile(slug: string, raw: string): Feature {
  const { frontmatter, body } = parseFrontmatter(raw);
  const parsed = parseFeatureBody(body);

  return {
    slug,
    status: (frontmatter.status as Feature["status"]) ?? "paused",
    branch: frontmatter.branch ?? "",
    created: frontmatter.created ?? "",
    title: parsed.title,
    description: parsed.description,
    acceptanceCriteria: parsed.acceptanceCriteria,
    progress: parsed.progress,
    raw,
  };
}

// ---------------------------------------------------------------------------
// Feature directory helpers
// ---------------------------------------------------------------------------

function featuresDir(cwd: string): string {
  return join(cwd, ".ccboard", "features");
}

async function ensureFeaturesDir(cwd: string): Promise<void> {
  await mkdir(featuresDir(cwd), { recursive: true });
}

function detectBranch(cwd: string): string {
  try {
    return execSync(`git -C ${cwd} branch --show-current`, { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function listFeatures(cwd: string): Promise<Feature[]> {
  const dir = featuresDir(cwd);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const features: Feature[] = [];
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    try {
      const raw = await readFile(join(dir, file), "utf-8");
      const slug = file.replace(/\.md$/, "");
      features.push(parseFeatureFile(slug, raw));
    } catch {
      // skip unreadable files
    }
  }
  return features;
}

export async function getActiveFeature(cwd: string): Promise<Feature | null> {
  const all = await listFeatures(cwd);
  return all.find((f) => f.status === "active") ?? null;
}

export async function createFeature(cwd: string, slug: string, content: string): Promise<Feature> {
  await ensureFeaturesDir(cwd);
  const filePath = join(featuresDir(cwd), `${slug}.md`);
  await writeFile(filePath, content, "utf-8");
  log.info({ slug, cwd }, "feature created");
  return parseFeatureFile(slug, content);
}

export async function updateFeature(cwd: string, slug: string, content: string): Promise<Feature> {
  await ensureFeaturesDir(cwd);
  const filePath = join(featuresDir(cwd), `${slug}.md`);
  await writeFile(filePath, content, "utf-8");
  log.info({ slug, cwd }, "feature updated");
  return parseFeatureFile(slug, content);
}

export async function completeFeature(cwd: string, slug: string): Promise<void> {
  const filePath = join(featuresDir(cwd), `${slug}.md`);
  const raw = await readFile(filePath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(raw);
  frontmatter.status = "completed";
  const updated = serializeFrontmatter(frontmatter) + "\n" + body;
  await writeFile(filePath, updated, "utf-8");
  log.info({ slug, cwd }, "feature completed");
}

/**
 * Generate markdown content for a new feature from structured input.
 */
export function generateFeatureMarkdown(opts: {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  branch?: string;
  cwd: string;
}): string {
  const branch = opts.branch || detectBranch(opts.cwd);
  const created = new Date().toISOString().split("T")[0] ?? new Date().toISOString();

  const fm = serializeFrontmatter({ status: "active", branch, created });
  const acLines = opts.acceptanceCriteria.map((c) => `- [ ] ${c}`).join("\n");

  return `${fm}
# ${opts.title}

${opts.description}

## Acceptance criteria
${acLines}

## Progress
`;
}

/**
 * Pause all features except the given slug, and set the given slug to active.
 */
export async function switchFeature(cwd: string, slug: string): Promise<void> {
  const all = await listFeatures(cwd);
  for (const f of all) {
    if (f.status === "active" && f.slug !== slug) {
      const { frontmatter, body } = parseFrontmatter(f.raw);
      frontmatter.status = "paused";
      const updated = serializeFrontmatter(frontmatter) + "\n" + body;
      await writeFile(join(featuresDir(cwd), `${f.slug}.md`), updated, "utf-8");
    }
  }
  // Set the target feature to active
  const target = all.find((f) => f.slug === slug);
  if (target && target.status !== "active") {
    const { frontmatter, body } = parseFrontmatter(target.raw);
    frontmatter.status = "active";
    const updated = serializeFrontmatter(frontmatter) + "\n" + body;
    await writeFile(join(featuresDir(cwd), `${slug}.md`), updated, "utf-8");
  }
  log.info({ slug, cwd }, "feature switched to active");
}
