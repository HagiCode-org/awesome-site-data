# awesome-site-data

[![last commit](https://img.shields.io/github/last-commit/HagiCode-org/awesome-site-data)](https://github.com/HagiCode-org/awesome-site-data/commits/main)

`awesome-site-data` is the curated collection data behind [awesome-site](https://github.com/HagiCode-org/awesome-site). It tells curators and translators which "awesome" collections are hosted, what each one covers, and which sources and translations back it. Readers of the site receive the result as reviewed, source-linked collections.

This repository is internal data with no end-user application of its own, and it is not a standalone product. Curators and translators of the collections use it first; the maintainers of `awesome-site` consume it as the site's `data/` submodule.

## What the data covers

- **Collection registry:** 76 hosted collections under `content/awesome/`, each with its pinned upstream source, license, route and topic.
- **Topic catalogs:** 48 topic keys with labels in English and the nine other reading languages.
- **GitHub-only candidates:** 40 qualifying repositories that are listed as GitHub links and have no hosted edition.
- **Source review:** a record of which upstream sources were reviewed and whether each was imported.
- **Reviewed mirrors:** a tracked mirror of each pinned upstream README, with source and license provenance, which is the English text the site publishes.
- **Reviewed translations:** each hosted collection is translated into the site's nine non-English reading languages (`zh-CN`, `zh-Hant`, `fr-FR`, `de-DE`, `es-ES`, `ja-JP`, `ko-KR`, `pt-BR`, `ru-RU`), alongside the English mirror, for ten reading languages in total.

## Get the data

```sh
git clone --recurse-submodules https://github.com/HagiCode-org/awesome-site-data.git
# For an existing checkout:
git submodule update --init --recursive
```

Sources are cloned from their upstream repositories at the pinned commits, so the data stays the same until a pin is deliberately moved.

## Add or update a collection or a translation

- **Add a collection:** register the upstream source at a pinned commit, add it to the collection registry and the source review record, and provide a reviewed translation for each of the nine non-English languages.
- **Update a collection:** move its source pin, refresh the mirror, and bring every translation up to date with the new mirror.
- **Update a translation:** edit the reviewed translation for the collection and language, and mark in its metadata whether it was AI-translated.

The review and translation rules are written down in [`AGENTS.md`](./AGENTS.md). Checks that validate the data run from an `awesome-site` checkout, and generated pages are owned by `awesome-site`, not by this repository.
