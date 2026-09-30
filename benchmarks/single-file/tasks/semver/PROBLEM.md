# Task: semver

Write a JavaScript module `solution.js` in this directory that exports a function `compareSemver(a, b)`.

Rules:
- `a` and `b` are semantic version strings: `MAJOR.MINOR.PATCH` with optional `-prerelease` and `+build`.
- Returns `-1` if `a < b`, `1` if `a > b`, `0` if equal.
- Compare numerically on major, then minor, then patch.
- A version with a prerelease is lower than the same version without one (`1.0.0-alpha < 1.0.0`).
- Prereleases compare dot-separated identifiers left to right: numeric identifiers compare numerically, alphanumeric compare lexically (ASCII), numeric < alphanumeric. A shorter prerelease is lower if all preceding identifiers are equal (`1.0.0-alpha < 1.0.0-alpha.1`).
- Build metadata (`+...`) is ignored.

Use CommonJS (`module.exports`). Do not modify `test.js`.
