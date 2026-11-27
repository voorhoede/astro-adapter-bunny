# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-27

The first release on npm.

### Added
- An Astro adapter that builds a site for bunny.net: an Edge Script for its on-demand routes, the files for a storage zone, and a build manifest a deploy tool reads.
- `defineConfig` from `astro-adapter-bunny/config` types a site's `bunny.config.ts`, which the actions read.
- GitHub Actions in `actions/` that deploy a build to bunny.net, record it in GitHub's Deployments, clean up, tear down a branch and roll back. They share this package's version tags.
- `astro preview` runs the built script under Deno, with `dist/client` standing in for the storage zone. It needs Deno installed.

### Changed
- The package ships JavaScript built into `dist/`, with type declarations, instead of its TypeScript sources. Installing it needs no registry besides npmjs.org.

[Unreleased]: https://github.com/voorhoede/astro-adapter-bunny/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/voorhoede/astro-adapter-bunny/releases/tag/v0.1.0
