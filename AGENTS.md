# awesome-site-data - Agent Configuration

## Root Configuration

Inherits all behavior from `/AGENTS.md` at the monorepo root. Local rules extend or override the root file for this repository.

## Project Context

`awesome-site-data` is the content repository consumed as the `data/` submodule of `repos/awesome-site`: the collection registry, topic catalogs, GitHub-only candidates, source review ledger, reviewed translations, tracked mirrors of pinned upstream READMEs, and the tooling that produces them. The layout is a contract with `awesome-site`; the framework owns generated pages, this repo owns only inputs.

## Working Directory

Run commands from `repos/awesome-site-data/`.

## Key Commands

```bash
git submodule update --init --recursive      # initialize the nested sources/<id> submodules
node scripts/mirror.mjs sync                 # refresh all mirrors (or: --collection <id>)
node scripts/mirror.mjs check                # regenerate in memory, compare byte for byte
node scripts/mirror.mjs diff --collection <id>
node --test scripts/mirror.test.mjs
```

There is no `package.json`; scripts use Node built-ins only. Content validation (`content:check`, `content:prepare`, `content:export`) runs from the `awesome-site` checkout, not here.

## Key Paths

- `content/awesome/collections.json`, `catalogs.json`, `candidates.json`: registry, topic taxonomy (labels for `root` and nine locales), GitHub-only candidates
- `content/awesome/source-reviews.yml`: canonical source review ledger; `readme-rights-reviews.yml`: candidate rights records (not read by pipeline code)
- `content/awesome/<id>/translations.json`, `mirror.json`, `mirror/README.md`, `locales/<locale>.md`: per-collection translation metadata, mirror ledger, published English mirror, reviewed translations
- `sources/<id>`: pinned upstream sources (nested submodules, registered in `.gitmodules`); never edit
- `scripts/mirror.mjs`, `scripts/mirror.test.mjs`: mirror tooling and tests; `scripts/mcp-translate.mjs`, `scripts/_mcp/`: translation tooling for the MCP servers collection

## Agent Guidelines

- Never hand-edit `mirror/README.md`; mirrors change only through ledgered `edits` in `mirror.json` (each `find` must match upstream exactly once) followed by `node scripts/mirror.mjs sync`. `sync` needs each source initialized, clean and at its pinned commit.
- Every collection in `collections.json` needs a matching `sources/<id>` registration in `.gitmodules`, a `source-reviews.yml` entry (`imported: true`, `notImportedReason: null`), and reviewed translations for all nine non-English locales with the current `sourceDigest`, `reviewStatus: "reviewed"` and a truthful `isAITranslation`.
- Onboard a source with `git submodule add https://github.com/<owner>/<repo>.git sources/<id>`; do not run `git submodule add` for an existing source (it moves the pin).
- When a mirror edit removes a passage, remove it from every locale body too, or the content gate fails.
- Do not add generated pages here. After pushing data to `main`, bump the `data/` pin in `awesome-site`, then run its `content:check`, `check`, `build`, `test`. A data commit reaches the site only through that pin.
- Record political-sensitivity re-scans in the README audit section when pins change.

## References

- `README.md` (layout contract, source review ledger, mirror/cleanup edits, translation workflow)
- `repos/awesome-site/README.md`
