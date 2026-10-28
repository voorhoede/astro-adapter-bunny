# Contributing
To setup and test, follow these steps:

```sh
git clone https://github.com/voorhoede/astro-adapter-bunny.git
cd astro-adapter-bunny
npm ci
npm run check
```

`npm run check` runs formatting, lint, the type check and the tests. The pre-commit hook in `.husky/` runs the same before every commit.

Add an entry under `[Unreleased]` in [`changelog.md`](changelog.md) for every change a user of the package would notice.

## General Prerequisites
Node.js, the version in [`.node-version`](.node-version).
