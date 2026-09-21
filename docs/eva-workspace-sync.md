# EVA workspace Git synchronization

EVA workspace synchronization preserves the files an agent creates under
`BB_DATA_DIR/eva-agents/<agent-id>`. It stores the repository inside that
workspace and uses Git's existing noninteractive authentication for the EVA
service user. It does not synchronize the EVA source checkout, the database,
authentication state, threads, queues, logs, provider sessions, or arbitrary
agent process deployments.

## Configure a private remote

An administrator can configure a remote from the EVA agent detail page, the
CLI, or the SDK. Use a repository URL without credentials embedded in it:

```text
https://github.com/example-org/private-eva-workspaces.git
ssh://git@gitlab.example.com/example-org/private-eva-workspaces.git
git@bitbucket.org:example-org/private-eva-workspaces.git
```

For example:

```text
bb eva sync configure campaign-review \
  --remote git@github.com:example-org/private-eva-workspaces.git \
  --branch main
```

The server rejects URL passwords, tokens, unsupported transports, local or
private-network hosts, unsafe repository paths, and non-default ports. Do not
put a token, password, private key, or other secret in the URL. Configure the
service user's SSH agent/key or noninteractive HTTPS credential helper on the
server instead, with permissions appropriate for the private repository. EVA
does not store those credentials in its database.

After configuring the remote, initialize the repository without removing the
scaffolded files:

```text
bb eva sync initialize campaign-review
bb eva sync status campaign-review
```

## Safe manual operations

Sync is explicit and administrator-only by default. Review the status and its
fingerprint before each mutation:

```text
bb eva sync status campaign-review --json
bb eva sync commit campaign-review "Checkpoint workspace" --fingerprint <status-fingerprint>
bb eva sync push campaign-review --fingerprint <status-fingerprint>
bb eva sync pull campaign-review --fingerprint <status-fingerprint> --allow-nonempty
```

The control plane serializes operations per agent, disables Git hooks, disables
credential prompts, bounds Git time and output, and uses only the resolved
registered workspace path. Pull/restore fetches the selected branch and uses
fast-forward-only merge semantics. It refuses a dirty or conflicted workspace,
requires a fresh status fingerprint, and requires an explicit confirmation for
a nonempty restore. On a new machine, the initialized destination must be
empty or contain only files whose contents and executable modes exactly match
the remote tree; EVA creates only missing remote files and adopts the fetched
commit after that precondition passes. It never force-pushes, resets hard,
cleans, deletes files, or silently resolves conflicts. A rejected push,
non-fast-forward restore, unsafe remote tree, or mismatched local file leaves
the workspace recoverable and reports an actionable error.

The service blocks suspicious files rather than attempting to sanitize them.
This includes environment files, private keys and certificates, databases,
logs, sockets, credentials and token files, runtime directories, symlinks,
special files, and content matching common API or cloud credential patterns.
Remove a blocked file from the workspace and refresh status before committing.

## Move workspaces to another machine

Git synchronization is a workspace backup and migration mechanism, not a full
BB migration:

1. On the original machine, use `bb eva sync status <agent-id>`, commit the
   reviewed allowed files, and push the selected branch.
2. Back up the local workspace repository as an additional recoverable copy if
   required by the operations policy.
3. Install the same EVA release on the new machine, create or register the
   agent, and ensure `BB_DATA_DIR/eva-agents/<agent-id>` is owned by the EVA
   service user.
4. Configure the same remote and branch using the new service user's
   noninteractive Git credentials, initialize the workspace, review status,
   and explicitly pull/restore it.

Verify ownership and permissions before starting the service. The systemd
runbook uses `/var/lib/eva-agent-platform` and the `eva-agent-platform` user;
the data directory and workspace directories should not be writable by
untrusted users. Keep credentials in the service user's approved SSH or Git
credential mechanism with restrictive permissions, never in the workspace or
remote URL.

Back up the complete `BB_DATA_DIR` separately using the organization's
database-consistent backup procedure. Git workspace sync does not include the
SQLite database, Better Auth state, agent definitions and RBAC, threads,
queues, server logs, provider sessions, or other runtime state. Restoring a
workspace repository alone does not restore those records.

## Files that must stay out of a workspace repository

Do not place `.env` files, API keys, passwords, SSH or signing keys, GitHub,
GitLab, Bitbucket, Codex, Cloudflare, or provider credentials, databases,
logs, sockets, `node_modules`, build output, caches, generated runtime files,
or service state in an EVA workspace. The sync denylist is a safety net, not a
replacement for normal secret management or a repository review.

EVA's mini-app registry remains registry-only. Workspace synchronization does
not deploy arbitrary agent processes or turn a workspace into a deployment
surface.
