# Security Policy

## Threat model

local-review is a **local, single-user** tool. By design it:

- binds only to `127.0.0.1` (loopback), so it isn't reachable from the network;
- has no authentication, no accounts, and no multi-user model;
- reads the git repositories under the `-root` folder you point it at, and shells
  out to your local `git` binary;
- stores review data in a SQLite database under `~/.local-review/` (or your
  `-data-dir`).

Because it's loopback-only and single-user, the exposed surface is small. Treat
it like any local dev server: don't expose the port to untrusted networks (e.g.
by port-forwarding, a reverse proxy, or `0.0.0.0` tunneling), and only point
`-root` at repositories you trust.

## Reporting a vulnerability

Please report suspected vulnerabilities **privately** — do not open a public
issue.

- Use GitHub's private advisory form:
  https://github.com/rosenbjerg/local-review/security/advisories/new

Include the version (release tag or commit SHA), your OS, and steps to
reproduce. You'll get an acknowledgement, and a fix or mitigation will be
released once the issue is confirmed. Responsible disclosure is appreciated.

## Supported versions

This is a fast-moving single-binary tool with no long-term support branches.
Fixes land on `main` and go out in the next release, so please reproduce against
the [latest release](https://github.com/rosenbjerg/local-review/releases/latest)
before reporting.
