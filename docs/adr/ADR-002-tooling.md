# ADR-002: Reproducible TypeScript and Python tooling

Status: ACCEPTED by the owner in the R1-001 implementation assignment, 2026-10-21.

## Decision

Use Node.js **24.19.0**, pnpm **11.25.0**, Python **3.14.3** and uv **0.13.3**. Pin application dependencies exactly in manifests and commit both `pnpm-lock.yaml` and `services/ingestion/uv.lock`. Record runtime versions in `.node-version`, `.python-version` and `toolchain.json`; use the same versions in containers and CI.

Use pnpm workspaces for `apps/*`. Keep Python dependencies in the standalone ingestion project managed by uv. Root commands orchestrate both ecosystems without introducing another build platform. Use TypeScript 5.9, ESLint, Prettier and Vitest; use Ruff, mypy and pytest for Python. Exact dependency versions are in manifests and lock files.

Provide two modes: complete Compose (five services), and host development processes with only PostgreSQL/Redis in Docker. Explicitly load the root `.env.local` in both modes. All user-facing scripts must work in Windows PowerShell and Linux CI. Refuse conflicting ports rather than silently switching them.

## Consequences

Use frozen/locked installations. Toolchain checks fail on an incompatible version. `.env.local`, virtual environments and build artifacts are ignored. The local setup command creates random development credentials on the user's computer; no credentials are shipped in Git. CI generates its own ephemeral credentials and does not rely on a developer's machine or paid service.

References: [pnpm workspaces](https://pnpm.io/workspaces), [uv projects](https://docs.astral.sh/uv/concepts/projects/), [uv Docker integration](https://docs.astral.sh/uv/guides/integration/docker/).
