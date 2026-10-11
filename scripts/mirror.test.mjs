import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { MirrorError, checkMirrors, diffMirror, syncMirrors } from "./mirror.mjs";

const README = [
  "# Sample",
  "",
  "- [Keep](https://example.com/keep)",
  "- [Drop](https://example.com/drop)",
  "- [Replace](https://example.com/old)",
  "",
].join("\n");

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

function git(args, cwd) {
  return execFileSync(
    "git",
    ["-c", "commit.gpgsign=false", "-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function pin(dataRoot, id) {
  const sha = git(["rev-parse", "HEAD"], path.join(dataRoot, "sources", id));
  git(["update-index", "--add", "--cacheinfo", `160000,${sha},sources/${id}`], dataRoot);
  return sha;
}

async function createDataRoot(t, sources) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "mirror-data-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  git(["init", "-q"], dataRoot);
  const registry = [];
  for (const [id, readme] of Object.entries(sources)) {
    const sourceDir = path.join(dataRoot, "sources", id);
    await mkdir(sourceDir, { recursive: true });
    git(["init", "-q"], sourceDir);
    await writeFile(path.join(sourceDir, "README.md"), readme);
    git(["add", "README.md"], sourceDir);
    git(["commit", "-q", "-m", "upstream"], sourceDir);
    pin(dataRoot, id);
    registry.push({ id, sourceDir: `sources/${id}`, readmePath: "README.md" });
  }
  await mkdir(path.join(dataRoot, "content/awesome"), { recursive: true });
  await writeFile(path.join(dataRoot, "content/awesome/collections.json"), `${JSON.stringify(registry, null, 2)}\n`);
  return dataRoot;
}

async function writeEdits(dataRoot, id, edits) {
  const dir = path.join(dataRoot, "content/awesome", id);
  await mkdir(dir, { recursive: true });
  const ledger = {
    version: 1,
    upstream: { revision: "0".repeat(40), readmePath: "README.md", digest: "0".repeat(64) },
    mirror: { path: "mirror/README.md", digest: "0".repeat(64) },
    edits: edits.map((edit) => ({
      category: "political-sensitive",
      reason: "Test reason.",
      reviewer: "Test reviewer",
      reviewedAt: "2026-10-11",
      ...edit,
    })),
  };
  await writeFile(path.join(dir, "mirror.json"), `${JSON.stringify(ledger, null, 2)}\n`);
}

const mirrorPath = (dataRoot, id) => path.join(dataRoot, "content/awesome", id, "mirror/README.md");
const ledgerPath = (dataRoot, id) => path.join(dataRoot, "content/awesome", id, "mirror.json");

test("unedited collection mirrors upstream byte for byte and records its binding", async (t) => {
  const dataRoot = await createDataRoot(t, { sample: README });
  const revision = git(["rev-parse", "HEAD"], path.join(dataRoot, "sources/sample"));
  assert.deepEqual(await syncMirrors({ dataRoot }), [{ id: "sample", editCount: 0 }]);
  assert.equal(await readFile(mirrorPath(dataRoot, "sample"), "utf8"), README);
  const ledger = JSON.parse(await readFile(ledgerPath(dataRoot, "sample"), "utf8"));
  assert.deepEqual(ledger, {
    version: 1,
    upstream: { revision, readmePath: "README.md", digest: sha256(README) },
    mirror: { path: "mirror/README.md", digest: sha256(README) },
    edits: [],
  });
  assert.equal(git(["status", "--porcelain"], path.join(dataRoot, "sources/sample")), "");
  assert.deepEqual(await checkMirrors({ dataRoot }), { summary: [{ id: "sample", editCount: 0 }], failures: [] });
});

test("removal edit drops exactly the anchored text", async (t) => {
  const dataRoot = await createDataRoot(t, { sample: README });
  const find = "- [Drop](https://example.com/drop)\n";
  await writeEdits(dataRoot, "sample", [{ id: "remove-drop", find, replace: "" }]);
  await syncMirrors({ dataRoot });
  assert.equal(await readFile(mirrorPath(dataRoot, "sample"), "utf8"), README.replace(find, ""));
  assert.deepEqual(await checkMirrors({ dataRoot }), { summary: [{ id: "sample", editCount: 1 }], failures: [] });
});

test("replacement edit substitutes the anchored text", async (t) => {
  const dataRoot = await createDataRoot(t, { sample: README });
  await writeEdits(dataRoot, "sample", [
    { id: "retarget", find: "https://example.com/old", replace: "https://example.com/new" },
  ]);
  await syncMirrors({ dataRoot });
  const mirror = await readFile(mirrorPath(dataRoot, "sample"), "utf8");
  assert.equal(mirror, README.replace("https://example.com/old", "https://example.com/new"));
});

test("missing anchor fails naming the collection and edit", async (t) => {
  const dataRoot = await createDataRoot(t, { sample: README });
  await writeEdits(dataRoot, "sample", [{ id: "gone", find: "not in the upstream text", replace: "" }]);
  await assert.rejects(syncMirrors({ dataRoot }), (error) =>
    error instanceof MirrorError && /sample/u.test(error.message) && /"gone"/u.test(error.message) && /not present/u.test(error.message),
  );
});

test("ambiguous anchor fails naming the collection and edit", async (t) => {
  const dataRoot = await createDataRoot(t, { sample: README });
  await writeEdits(dataRoot, "sample", [{ id: "ambiguous", find: "- [", replace: "" }]);
  await assert.rejects(syncMirrors({ dataRoot }), (error) =>
    error instanceof MirrorError && /sample/u.test(error.message) && /"ambiguous"/u.test(error.message) && /occurs 3 times/u.test(error.message),
  );
});

test("overlapping edits are rejected", async (t) => {
  const dataRoot = await createDataRoot(t, { sample: README });
  await writeEdits(dataRoot, "sample", [
    { id: "first", find: "- [Drop](https://example.com/drop)", replace: "" },
    { id: "second", find: "(https://example.com/drop)\n- [Replace]", replace: "" },
  ]);
  await assert.rejects(syncMirrors({ dataRoot }), (error) =>
    error instanceof MirrorError && /overlap/u.test(error.message) && /"first"/u.test(error.message) && /"second"/u.test(error.message),
  );
});

test("re-sync with unchanged inputs produces identical files", async (t) => {
  const dataRoot = await createDataRoot(t, { sample: README });
  await writeEdits(dataRoot, "sample", [{ id: "remove-drop", find: "- [Drop](https://example.com/drop)\n", replace: "" }]);
  await syncMirrors({ dataRoot });
  const first = [await readFile(mirrorPath(dataRoot, "sample")), await readFile(ledgerPath(dataRoot, "sample"))];
  await syncMirrors({ dataRoot });
  const second = [await readFile(mirrorPath(dataRoot, "sample")), await readFile(ledgerPath(dataRoot, "sample"))];
  assert.deepEqual(second, first);
});

test("failed sync leaves every collection's files unchanged", async (t) => {
  const dataRoot = await createDataRoot(t, { alpha: README, beta: README });
  await syncMirrors({ dataRoot });
  await writeEdits(dataRoot, "alpha", [{ id: "retarget", find: "https://example.com/old", replace: "https://example.com/new" }]);
  await writeEdits(dataRoot, "beta", [{ id: "broken", find: "absent anchor", replace: "" }]);
  const alphaBefore = [await readFile(mirrorPath(dataRoot, "alpha")), await readFile(ledgerPath(dataRoot, "alpha"))];
  await assert.rejects(syncMirrors({ dataRoot }), (error) => error instanceof MirrorError && /beta/u.test(error.message));
  assert.deepEqual([await readFile(mirrorPath(dataRoot, "alpha")), await readFile(ledgerPath(dataRoot, "alpha"))], alphaBefore);
  assert.equal(await readFile(mirrorPath(dataRoot, "beta"), "utf8"), README);
});

test("sync --collection touches only the named collection", async (t) => {
  const dataRoot = await createDataRoot(t, { alpha: README, beta: README });
  await syncMirrors({ dataRoot, collectionId: "alpha" });
  await assert.rejects(readFile(mirrorPath(dataRoot, "beta")), { code: "ENOENT" });
});

test("ledger validation names the collection and the edit", async (t) => {
  const dataRoot = await createDataRoot(t, { sample: README });
  await writeEdits(dataRoot, "sample", [{ id: "bad-date", find: "- [Drop]", replace: "", reviewedAt: "2026-02-30" }]);
  await assert.rejects(syncMirrors({ dataRoot }), (error) =>
    error instanceof MirrorError && /sample/u.test(error.message) && /"bad-date"/u.test(error.message) && /reviewedAt/u.test(error.message),
  );
});

test("check reports a hand-edited mirror", async (t) => {
  const dataRoot = await createDataRoot(t, { sample: README });
  await syncMirrors({ dataRoot });
  await writeFile(mirrorPath(dataRoot, "sample"), README.replace("Keep", "Kept"));
  const { failures } = await checkMirrors({ dataRoot });
  assert.deepEqual(failures.map((failure) => failure.id), ["sample"]);
  assert.match(failures[0].message, /edited outside the ledger/u);
});

test("check reports a stale revision after a pin bump", async (t) => {
  const dataRoot = await createDataRoot(t, { sample: README });
  await syncMirrors({ dataRoot });
  const sourceDir = path.join(dataRoot, "sources/sample");
  await writeFile(path.join(sourceDir, "README.md"), README.replace("Keep", "Kept"));
  git(["commit", "-q", "-am", "upstream change"], sourceDir);
  pin(dataRoot, "sample");
  const { failures } = await checkMirrors({ dataRoot });
  assert.deepEqual(failures.map((failure) => failure.id), ["sample"]);
  assert.match(failures[0].message, /stale mirror/u);
});

test("check reports a missing mirror with the collection", async (t) => {
  const dataRoot = await createDataRoot(t, { sample: README });
  const { failures } = await checkMirrors({ dataRoot });
  assert.deepEqual(failures.map((failure) => failure.id), ["sample"]);
  assert.match(failures[0].message, /is missing; run sync --collection sample/u);
});

test("diff prints only ledgered lines and is empty for unedited collections", async (t) => {
  const dataRoot = await createDataRoot(t, { edited: README, plain: README });
  await writeEdits(dataRoot, "edited", [{ id: "remove-drop", find: "- [Drop](https://example.com/drop)\n", replace: "" }]);
  await syncMirrors({ dataRoot });
  const editedDiff = await diffMirror({ dataRoot, collectionId: "edited" });
  assert.match(editedDiff, /^-- \[Drop\]\(https:\/\/example\.com\/drop\)$/mu);
  assert.doesNotMatch(editedDiff, /^[-+]- \[Keep\]/mu);
  assert.equal(await diffMirror({ dataRoot, collectionId: "plain" }), "");
});
