import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultDataRoot = fileURLToPath(new URL("../", import.meta.url));
const registryRelative = "content/awesome/collections.json";
const mirrorRelative = "mirror/README.md";
const ledgerName = "mirror.json";
const collectionIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const revisionPattern = /^[0-9a-f]{40}$/u;
const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
const editKeys = ["id", "category", "reason", "reviewer", "reviewedAt", "find", "replace"];
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export class MirrorError extends Error {}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function validateRelativePath(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    path.posix.isAbsolute(value) ||
    value.includes("\\") ||
    value.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new MirrorError(`${label} must be a normalized repository-relative path`);
  }
}

async function realPathInside(parent, relative, label) {
  validateRelativePath(relative, label);
  const candidate = path.resolve(parent, relative);
  if (!isWithin(parent, candidate)) throw new MirrorError(`${label} escapes its allowed directory`);
  let actual;
  try {
    actual = await realpath(candidate);
  } catch (error) {
    if (error.code === "ENOENT") throw new MirrorError(`${label} does not exist: ${relative}`);
    throw error;
  }
  if (!isWithin(await realpath(parent), actual)) {
    throw new MirrorError(`${label} escapes its allowed directory through a symlink`);
  }
  return actual;
}

async function readOptional(filePath) {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function loadCollections(dataRoot) {
  const collections = JSON.parse(await readFile(path.join(dataRoot, registryRelative), "utf8"));
  if (!Array.isArray(collections)) throw new MirrorError(`${registryRelative} must be an array`);
  const seen = new Set();
  for (const collection of collections) {
    if (!isPlainObject(collection) || typeof collection.id !== "string" || !collectionIdPattern.test(collection.id)) {
      throw new MirrorError(`invalid collection identifier in ${registryRelative}: ${JSON.stringify(collection?.id)}`);
    }
    if (seen.has(collection.id)) throw new MirrorError(`${collection.id}: duplicate collection identifier`);
    seen.add(collection.id);
  }
  return collections;
}

function findCollection(collections, id) {
  const collection = collections.find((entry) => entry.id === id);
  if (!collection) throw new MirrorError(`${id}: not a registered collection in ${registryRelative}`);
  return collection;
}

function pinnedRevision(collection, dataRoot) {
  const entry = git(["ls-files", "--stage", "--", collection.sourceDir], dataRoot)
    .split("\n")
    .map((line) => /^160000 ([0-9a-f]{40}) 0\t(.+)$/u.exec(line))
    .find((match) => match && match[2] === collection.sourceDir);
  if (!entry) throw new MirrorError(`${collection.id}: ${collection.sourceDir} is not a pinned submodule in the data index`);
  return entry[1];
}

async function pinnedSource(collection, dataRoot) {
  const id = collection.id;
  validateRelativePath(collection.sourceDir, `${id} sourceDir`);
  const sourceDir = await realPathInside(dataRoot, collection.sourceDir, `${id} sourceDir`);
  const hasCheckout = await lstat(path.join(sourceDir, ".git")).then(() => true, () => false);
  if (!hasCheckout) {
    throw new MirrorError(`${id}: source submodule is not initialized; run git submodule update --init --recursive in the data repository`);
  }
  const pinned = pinnedRevision(collection, dataRoot);
  const head = git(["rev-parse", "HEAD"], sourceDir).trim();
  if (head !== pinned) {
    throw new MirrorError(`${id}: checked-out revision ${head} does not match pinned revision ${pinned}`);
  }
  if (git(["status", "--porcelain", "--untracked-files=all"], sourceDir).trim()) {
    throw new MirrorError(`${id}: source submodule is dirty; restore the pinned upstream checkout`);
  }
  const readme = await realPathInside(sourceDir, collection.readmePath, `${id} README`);
  return { readme, revision: pinned, bytes: await readFile(readme) };
}

function validateLedger(id, ledger) {
  const fail = (message) => {
    throw new MirrorError(`${id}: ${ledgerName} ${message}`);
  };
  if (!isPlainObject(ledger)) fail("must be an object");
  if (ledger.version !== 1) fail("version must be 1");
  if (!isPlainObject(ledger.upstream) || !revisionPattern.test(ledger.upstream.revision ?? "")) {
    fail("upstream.revision must be a 40-character hex commit");
  }
  if (typeof ledger.upstream.readmePath !== "string" || ledger.upstream.readmePath.length === 0) {
    fail("upstream.readmePath must be a nonempty string");
  }
  if (!sha256Pattern.test(ledger.upstream.digest ?? "")) fail("upstream.digest must be a SHA-256 hex digest");
  if (!isPlainObject(ledger.mirror) || ledger.mirror.path !== mirrorRelative) {
    fail(`mirror.path must be "${mirrorRelative}"`);
  }
  if (!sha256Pattern.test(ledger.mirror.digest ?? "")) fail("mirror.digest must be a SHA-256 hex digest");
  if (!Array.isArray(ledger.edits)) fail("edits must be an array");

  const editIds = new Set();
  for (const edit of ledger.edits) {
    const label = isPlainObject(edit) && typeof edit.id === "string" ? `edit "${edit.id}"` : "an edit";
    const editFail = (message) => fail(`${label} ${message}`);
    if (!isPlainObject(edit)) editFail("must be an object");
    for (const key of Object.keys(edit)) {
      if (!editKeys.includes(key)) editFail(`has unknown field "${key}"`);
    }
    for (const key of editKeys) {
      if (!Object.hasOwn(edit, key)) editFail(`is missing "${key}"`);
    }
    if (!collectionIdPattern.test(edit.id)) editFail("id must be a kebab-case identifier");
    if (editIds.has(edit.id)) editFail("id is duplicated");
    editIds.add(edit.id);
    for (const key of ["category", "reason", "reviewer"]) {
      if (typeof edit[key] !== "string" || edit[key].trim().length === 0) editFail(`${key} must be a nonempty string`);
    }
    if (!datePattern.test(edit.reviewedAt) || new Date(`${edit.reviewedAt}T00:00:00Z`).toISOString().slice(0, 10) !== edit.reviewedAt) {
      editFail("reviewedAt must be a valid YYYY-MM-DD date");
    }
    if (typeof edit.find !== "string" || edit.find.length === 0) editFail("find must be a nonempty string");
    if (typeof edit.replace !== "string") editFail("replace must be a string");
  }
  return ledger;
}

async function readLedger(id, collectionDir) {
  const bytes = await readOptional(path.join(collectionDir, ledgerName));
  if (bytes === null) return null;
  let ledger;
  try {
    ledger = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new MirrorError(`${id}: ${ledgerName} is not valid JSON`);
  }
  return validateLedger(id, ledger);
}

function findOccurrences(text, needle) {
  const offsets = [];
  let index = text.indexOf(needle);
  while (index !== -1) {
    offsets.push(index);
    index = text.indexOf(needle, index + 1);
  }
  return offsets;
}

function applyEdits(id, upstreamText, edits) {
  const placements = edits.map((edit) => {
    const offsets = findOccurrences(upstreamText, edit.find);
    if (offsets.length === 0) throw new MirrorError(`${id}: edit "${edit.id}" anchor is not present in the upstream README`);
    if (offsets.length > 1) {
      throw new MirrorError(`${id}: edit "${edit.id}" anchor occurs ${offsets.length} times in the upstream README; it must be unique`);
    }
    return { edit, start: offsets[0], end: offsets[0] + edit.find.length };
  });
  const ordered = [...placements].sort((left, right) => left.start - right.start);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].start < ordered[index - 1].end) {
      throw new MirrorError(`${id}: edits "${ordered[index - 1].edit.id}" and "${ordered[index].edit.id}" overlap`);
    }
  }
  let output = "";
  let cursor = 0;
  for (const { edit, start, end } of ordered) {
    output += upstreamText.slice(cursor, start) + edit.replace;
    cursor = end;
  }
  return output + upstreamText.slice(cursor);
}

function canonicalEdit(edit) {
  return Object.fromEntries(editKeys.map((key) => [key, edit[key]]));
}

async function regenerate(collection, dataRoot) {
  const id = collection.id;
  const collectionDir = path.join(dataRoot, "content/awesome", id);
  const source = await pinnedSource(collection, dataRoot);
  const existing = await readLedger(id, collectionDir);
  const edits = existing ? existing.edits.map(canonicalEdit) : [];
  let upstreamText;
  try {
    upstreamText = utf8.decode(source.bytes);
  } catch {
    throw new MirrorError(`${id}: upstream README is not valid UTF-8`);
  }
  const mirrorBytes = Buffer.from(applyEdits(id, upstreamText, edits), "utf8");
  const ledger = {
    version: 1,
    upstream: { revision: source.revision, readmePath: collection.readmePath, digest: sha256(source.bytes) },
    mirror: { path: mirrorRelative, digest: sha256(mirrorBytes) },
    edits,
  };
  return {
    id,
    collectionDir,
    source,
    edits,
    mirrorBytes,
    ledgerText: `${JSON.stringify(ledger, null, 2)}\n`,
  };
}

async function writeStaged(output) {
  await mkdir(output.collectionDir, { recursive: true });
  const stage = await mkdtemp(path.join(output.collectionDir, ".mirror-stage-"));
  try {
    await writeFile(path.join(stage, "README.md"), output.mirrorBytes);
    await writeFile(path.join(stage, ledgerName), output.ledgerText);
    await mkdir(path.join(output.collectionDir, "mirror"), { recursive: true });
    await rename(path.join(stage, "README.md"), path.join(output.collectionDir, mirrorRelative));
    await rename(path.join(stage, ledgerName), path.join(output.collectionDir, ledgerName));
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export async function syncMirrors({ dataRoot = defaultDataRoot, collectionId } = {}) {
  const collections = await loadCollections(dataRoot);
  const targets = collectionId ? [findCollection(collections, collectionId)] : collections;
  const outputs = [];
  for (const collection of targets) {
    outputs.push(await regenerate(collection, dataRoot));
  }
  for (const output of outputs) {
    await writeStaged(output);
  }
  return outputs.map(({ id, edits }) => ({ id, editCount: edits.length }));
}

export async function checkMirrors({ dataRoot = defaultDataRoot } = {}) {
  const collections = await loadCollections(dataRoot);
  const summary = [];
  const failures = [];
  for (const collection of collections) {
    const id = collection.id;
    try {
      const collectionDir = path.join(dataRoot, "content/awesome", id);
      const committedLedger = await readOptional(path.join(collectionDir, ledgerName));
      const committedMirror = await readOptional(path.join(collectionDir, mirrorRelative));
      if (committedLedger === null) throw new MirrorError(`${id}: ${ledgerName} is missing; run sync --collection ${id}`);
      if (committedMirror === null) throw new MirrorError(`${id}: ${mirrorRelative} is missing; run sync --collection ${id}`);
      const output = await regenerate(collection, dataRoot);
      if (output.ledgerText !== committedLedger.toString("utf8")) {
        throw new MirrorError(`${id}: ${ledgerName} does not match the pinned upstream and its edits (stale mirror); run sync --collection ${id}`);
      }
      if (!output.mirrorBytes.equals(committedMirror)) {
        throw new MirrorError(`${id}: ${mirrorRelative} was edited outside the ledger; run sync --collection ${id} or revert the edit`);
      }
      summary.push({ id, editCount: output.edits.length });
    } catch (error) {
      if (!(error instanceof MirrorError)) throw error;
      failures.push({ id, message: error.message });
    }
  }
  return { summary, failures };
}

export async function diffMirror({ dataRoot = defaultDataRoot, collectionId } = {}) {
  const collection = findCollection(await loadCollections(dataRoot), collectionId);
  const source = await pinnedSource(collection, dataRoot);
  const mirror = path.join(dataRoot, "content/awesome", collectionId, mirrorRelative);
  try {
    return git(["diff", "--no-index", "--", path.relative(dataRoot, source.readme), path.relative(dataRoot, mirror)], dataRoot);
  } catch (error) {
    if (error.status === 1) return error.stdout;
    throw error;
  }
}

function parseCollectionOption(args) {
  if (args.length === 0) return undefined;
  if (args.length === 2 && args[0] === "--collection" && args[1]) return args[1];
  throw new MirrorError(`unexpected arguments: ${args.join(" ")}`);
}

export async function main(argv, { dataRoot = defaultDataRoot } = {}) {
  const [command, ...rest] = argv;
  try {
    if (command === "sync") {
      const collectionId = parseCollectionOption(rest);
      for (const { id, editCount } of await syncMirrors({ dataRoot, collectionId })) {
        console.log(`synced ${id} (${editCount} edit${editCount === 1 ? "" : "s"})`);
      }
      return 0;
    }
    if (command === "check") {
      if (rest.length > 0) throw new MirrorError("check takes no arguments");
      const { summary, failures } = await checkMirrors({ dataRoot });
      for (const { id, editCount } of summary.filter((entry) => entry.editCount > 0)) {
        console.log(`${id}: ${editCount} edit${editCount === 1 ? "" : "s"}`);
      }
      console.log(`${summary.length} collections checked, ${summary.filter((entry) => entry.editCount > 0).length} with ledgered edits`);
      for (const { message } of failures) console.error(message);
      return failures.length === 0 ? 0 : 1;
    }
    if (command === "diff") {
      const collectionId = parseCollectionOption(rest);
      if (!collectionId) throw new MirrorError("diff requires --collection <id>");
      process.stdout.write(await diffMirror({ dataRoot, collectionId }));
      return 0;
    }
    console.error("usage: node scripts/mirror.mjs <sync [--collection <id>] | check | diff --collection <id>>");
    return 2;
  } catch (error) {
    if (!(error instanceof MirrorError)) throw error;
    console.error(error.message);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
