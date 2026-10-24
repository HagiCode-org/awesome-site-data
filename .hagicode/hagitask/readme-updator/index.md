---
public: true
multilingual: false
style: product
---

# README requirements

## Product focus

- Introduce `awesome-site-data` as the curated collection data behind [awesome-site](https://github.com/HagiCode-org/awesome-site): the registry of hosted "awesome" collections, topic catalogs, GitHub-only candidates, reviewed translations in the site's ten reading languages, and reviewed mirrors of pinned upstream READMEs with source and license provenance.
- State the capability it gives its direct users: curators can see which collections are hosted, what each one covers, and which sources and translations back it, and the site's readers receive the result as reviewed, source-linked collections. This repository is internal data with no end-user application of its own; say so plainly and do not present it as a standalone product.
- Address curators and translators of the collections first, and the maintainers of `awesome-site` as the consumer.
- Lead with what the dataset provides and who relies on it before any detail of how it is organized.

## Required content

- Open with a short description of the dataset, the link to `awesome-site`, and the badge the current README carries.
- Describe what the data covers: the collection registry, topic catalogs, GitHub-only candidates, source-reviewed upstream sources, mirrors, and reviewed translations in the ten reading languages. Use only counts and names that match `content/awesome/`.
- Explain, at usage level, how a curator adds or updates a collection or a translation and where to read the review and translation rules, as the current README does.
- Keep the clone and initialize instructions as the one usage step a reader needs to get the data.

## Exclusions

- Exclude tokens, secret values, internal hosts, machine-specific paths and private links.
- Do not list features or collections the repository does not show.
- Keep repository maintenance instructions out of the README: repository layout and path contract tables, internal pipeline and ledger formats, CI, pin-bump procedure and audit records.
