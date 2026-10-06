# EVA Agent Platform repository map

The repository is a pnpm/Turbo monorepo. Begin at the repository root and follow its `AGENTS.md` instructions.

```text
apps/
  app/                 Main React web application and user-facing flows
  server/              HTTP API, authorization, product policy, persistence orchestration
  host-daemon/         Host-local provider sessions, workspace execution, and machine RPC
  cli/                 `bb` command-line interface
  desktop/             Desktop application shell
  mobile/              Mobile application
  web/                 Public web application
  connect/             Remote connection service
packages/
  db/                  Database schema, migrations, queries, and persistence
  domain/              Shared domain types and validation
  server-contract/     HTTP request and response contracts
  host-daemon-contract/ Server/daemon protocol contracts
  agent-runtime/       Provider-neutral agent/session runtime
  sdk/                 BB SDK
  plugin-sdk/          Plugin authoring API and types
  shared-ui/           Shared UI primitives and localization
  templates/           Generated and built-in prompt/workspace templates
  plugin-build/        Plugin build and validation tooling
plugins/
  <id>/                Built-in plugin manifest, UI, server handlers, and skills
  eva/                 EVA agent integration, delegation, and agent-facing UI
eva-agents-seed/
  <id>/                Initial files for an EVA agent workspace
    AGENTS.md          Agent-specific workspace instructions
    README.md          Workspace overview
    .bb/skills/        Optional agent-specific skills
    bin/               Optional reviewed local helpers
docs/                  Architecture, product, operations, and CLI documentation
scripts/               Build, release, and repository maintenance scripts
tests/                 Cross-package and end-to-end tests
```

## Where to make common changes

- UI behavior: `apps/app/src/` and its colocated tests.
- API behavior or authorization: `apps/server/src/` and `apps/server/test/`.
- Host execution or provider/session translation: `apps/host-daemon/src/` and the relevant shared protocol package.
- Database changes: `packages/db/src/`; generate migrations and snapshots using the repository's documented workflow.
- Shared request/response shapes: `packages/server-contract/`.
- Domain validation: `packages/domain/`.
- EVA catalog, instructions, and workspace lifecycle: `apps/server/src/agents/`.
- EVA initial agent workspace content: `eva-agents-seed/<id>/`.
- Plugin behavior: `plugins/<id>/`; follow the plugin's own instructions and Plugin Guide contracts.

Use targeted searches such as `rg -n` and `rg --files`. Do not assume the map is exhaustive: inspect package manifests, imports, and tests to confirm the owning layer before changing code.
