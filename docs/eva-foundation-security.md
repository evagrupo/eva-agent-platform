# EVA foundation security slice

This fork's first EVA foundation slice makes the core server authoritative for
browser identity and access. Better Auth stores users, credential accounts,
sessions, and verification rows in the server database. Browser sessions use
HTTP-only, same-site cookies; sign-up is disabled; sign-in responses do not
return a session token in JSON; and authentication telemetry is disabled.

Production starts with core authentication required. The first administrator is
created only when `BB_AUTH_OWNER_EMAIL` and `BB_AUTH_OWNER_PASSWORD` are set
together on the first boot. The password must contain at least 12 characters.
`BB_AUTH_SECRET` is required in production and must be kept in the deployment's
secret store. The configured owner password is used only to create the initial
credential hash and is never returned or logged.

The server resolves a fresh policy for every authenticated request. Resolution
starts with a default-deny policy and combines the principal's policy with
group policies and user/group agent grants. Policies cover agent, provider,
model, reasoning, permission, terminal, tool, plugin, bootstrap, and thread
read/write capabilities. Fixed execution policies require their configured
execution tuple; provider, model, reasoning, and permission values are checked
at the request boundary and again while building execution commands.

Agent grants narrow the principal's provider, model, and reasoning rules by
intersection; enabling a provider in the base policy does not override a
conflicting grant. Check `GET /api/v1/access/bootstrap` for the effective
agent tuples and `GET /api/v1/system/execution-options?agentId=<agent>&providerId=<provider>`
for the user's composer catalog. A denied provider returns 403; a permitted
provider whose models do not match the effective rules returns an empty catalog.
Agent assignment initially creates grants from the agent's catalog defaults,
so those grants may need editing after a base policy changes.

Model rules accept an exact ID or a trailing `*` prefix pattern. Bare catalog
IDs and provider-prefixed runtime IDs match each other, while two explicitly
different namespaces remain distinct. Policy/group/grant intersections retain
the narrower model rule and any explicit namespace. Fixed model selection uses
the same matching rules. Cursor models that advertise only the ACP-managed
`medium` placeholder retain policy-allowed reasoning choices when that
placeholder does not intersect the policy; providers with native reasoning
choices remain limited to their advertised choices.

Threads created by an authenticated user store their owner ID. Existing thread
routes, direct-ID lookups, project thread summaries, queued-message deletion,
terminal access, and realtime subscriptions check current ownership or an
explicit access row. A policy or session revocation therefore applies to
existing threads and queued execution attempts; a stored thread snapshot is
not authority. Tool calls from the authenticated host-daemon session are
rechecked against the thread owner's current tool policy.

Plugin-specific routes require both the browser core session and the current
plugin allow-list before reading or changing a plugin. Aggregate plugin
responses are filtered or denied, while plugin token and local route
authentication remain nested under the browser policy. Owned-thread runtime
configuration filters plugin tools, metadata, instructions, provider
environment entries, and skills against the owner's current plugin policy.

The existing signed daemon bearer path under `/internal` remains the transport
for optional remote host ingress. It is separate from browser identity and does
not replace the core session gate for the standalone app. In development,
`BB_AUTH_REQUIRED` defaults to false to preserve local unauthenticated BB
compatibility; a supplied but invalid or revoked core session cookie still
returns unauthorized. Production cannot disable the core gate.

## Database changes

Migrations `0126_boring_thaddeus_ross` through `0130_secret_mariko_yashida`
add Better Auth session/account/verification tables, principals, policies,
groups, group membership, agent grants, thread access, resource access,
instructions, invitations, audit events, nullable thread ownership/agent
selection, and agent-bound plugin scopes. The policy role index is intentionally
non-unique so administrators can provision multiple policies for the same role.

## Focused validation

From the repository root, the focused security suite is:

```bash
pnpm exec turbo run test --filter=@bb/server --output-logs=errors-only -- test/security/core-auth-foundation.test.ts
```

If the host's `/tmp` quota prevents Vitest fixtures from being written, run the
package-local fallback with a writable temporary directory:

```bash
mkdir -p .tmp-test
(cd apps/server && TMPDIR="$(cd .. && pwd)/.tmp-test" pnpm exec vitest run \
  --config vitest.config.ts --pool=threads --maxWorkers=1 \
  test/security/core-auth-foundation.test.ts)
```

The suite covers anonymous denial, administrator bootstrap, owner isolation and
direct ID/API bypasses, fixed execution constraints, policy downgrade, and
session revocation.

## Current boundaries and next slices

The continuation adds policy-management APIs and an EVA-branded admin surface,
the typed built-in agent catalog and sanitized workspace scaffolds, connector
capability manifests, and a standalone Docker/Coolify packaging path. The next
slices are concrete connector implementations, deployment-specific secret
rotation and observability, and production rollout procedures. Legacy threads
with no owner remain available only to server-authorized compatibility paths;
authenticated non-administrators do not inherit them by default.

See `docs/eva-standalone.md` for the container and reverse-proxy contract. The
admin surface is intentionally a small operational foundation; it does not
replace a later audit/event explorer or a full connector administration UI.
