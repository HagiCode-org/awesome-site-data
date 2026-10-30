// Read-only source discovery for the doc-translation skill (contract: references/profile-spec.md in the skill).
// One document per collection and locale: the English source is the tracked mirror (content/awesome/<id>/mirror/README.md),
// or the pinned upstream README (sources/<id>/README.md) for collections that have no mirror but already carry translations.
// `doc` is the output path under content/awesome/ (<id>/locales/<locale>.md), so profile `output.template` is "content/awesome/{doc}".
// Run from the repository root: node translations/discover.mjs --locale zh-CN
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const flag = process.argv.indexOf("--locale");
const locale = flag > -1 ? process.argv[flag + 1] : undefined;
if (!locale) {
  console.error("usage: node translations/discover.mjs --locale <site-locale>");
  process.exit(2);
}
const repo = path.resolve(import.meta.dirname, "..");
const awesome = path.join(repo, "content/awesome");
console.log(JSON.stringify({ _meta: {
  sourceRevision: execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  sourceRoot: ".",
} }));
const ids = readdirSync(awesome, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
for (const id of ids) {
  const mirror = path.join("content/awesome", id, "mirror/README.md");
  const upstream = path.join("sources", id, "README.md");
  const hasTranslations = existsSync(path.join(awesome, id, "translations.json"));
  let source;
  if (existsSync(path.join(repo, mirror))) source = mirror;
  else if (hasTranslations && existsSync(path.join(repo, upstream))) source = upstream;
  else continue; // no English source in this checkout (e.g. collections translated by scripts/mcp-translate.mjs)
  const text = readFileSync(path.join(repo, source), "utf8");
  console.log(JSON.stringify({
    doc: `${id}/locales/${locale}.md`,
    path: source,
    bytes: Buffer.byteLength(text),
    sha256: createHash("sha256").update(text).digest("hex"),
    external: false,
  }));
}
