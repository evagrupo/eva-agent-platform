# EVA Orchestrator: delegate work to agents as BB child threads

Status: implemented locally; not committed. This document records the original
plan and the implementation delivered against it.

## Goal

From a Master Orchestrator conversation, a user can select an EVA agent with an
`@agent` mention and give it a concrete task. The Orchestrator delegates that
task through BB's native child-thread mechanism, can inspect the child and its
result, and then reports back in the parent conversation.

Example: `@crm prioritize the new leads and return a short call-preparation
summary` should cause the Orchestrator to start a CRM child thread, not merely
add CRM as passive prompt context or open an unrelated existing CRM thread.

## Existing BB lifecycle and observed gap

- The previous `plugins/eva/server.ts` mention provider was visible only when
  users could access plugin data. It has been replaced with a first-party EVA
  mention source, so a specialist grant does not require broad access to the
  EVA plugin.
- `apps/server/src/agents/eva-agent-tools.ts` already defines
  `eva_delegate_to_agent`, plus tools to list agents/threads, read a result,
  and message an existing agent thread. Delegation creates a child through the
  normal server thread-creation service with `parentThreadId` set to the
  current thread.
- `apps/server/src/services/threads/thread-runtime-config.ts` exposes these
  tools only in authenticated EVA-agent threads and filters them through the
  current owner's allowed-agent and allowed-tool policy.
- BB validates parent-thread relationships and limits hierarchy depth in
  `apps/server/src/services/threads/thread-parent.ts`.
- The supplied screenshot's mention menu shows thread and workspace results,
  but no EVA agent result. That makes mention-provider availability a required
  first verification, not an assumption that the server lacks child threads.

## Implementation record

- Added policy-filtered `GET /api/v1/eva/agent-mentions/contributions` and
  `GET /api/v1/eva/agent-mentions/search` endpoints. They expose only registered
  agents allowed to the signed-in user and validate the selected/current agent;
  fixed-execution users must select an allowed agent before search. Delegation
  mentions are offered only when that active agent is allowed to use
  `eva_delegate_to_agent`.
- The app now loads first-party EVA mentions separately from plugin
  contributions, so plugin-data denial does not hide otherwise authorized EVA
  specialists. New-thread search sends the selected agent ID; existing-thread
  search uses the authorized thread's agent ID.
- Resolving an EVA mention re-checks the thread owner's current policy and adds
  bounded agent-only context without disclosing workspace filesystem paths.
  The legacy plugin-owned mention provider was removed to avoid duplicate or
  policy-gated results.
- Strengthened the shared EVA collaboration prompt and Master Orchestrator
  instructions: an allowed `@agent` plus a concrete task delegates through the
  existing `eva_delegate_to_agent` BB child-thread tool; a mention alone does
  not start work, and the parent must read the child result before claiming
  completion.
- Added server security coverage for agent filtering, plugin-data-independent
  mention access, fixed-policy selection, denied mention resolution, and a real
  Orchestrator-to-specialist child-thread relationship. Runtime configuration
  coverage proves an authorized Orchestrator receives the child-delegation
  tools and instructions. App coverage verifies selected-agent propagation and
  the core mention endpoint. Browser testing with a live model was not run.

## Original delivery plan

### 1. Reproduce and identify the missing link

- Start a new Master Orchestrator conversation with an authorized account.
- Inspect the `@` menu and confirm whether it includes an `EVA Agents` group
  with allowed agents such as `CRM & Call Center (@crm)`.
- Inspect the resolved Orchestrator session's advertised tools and confirm
  `eva_delegate_to_agent`, `eva_list_agents`, and result-reading tools are
  present. Check both an administrator and a restricted user whose policy
  grants the Orchestrator, target agent, and collaboration tools.
- Follow the actual policy/plugin-loading path if either surface is missing.
  Keep the existing server-side policy checks authoritative; do not solve a
  missing grant by broadening all users' permissions.

### 2. Make mentions select a delegation target

- Keep BB's structured mention flow and use a first-party EVA agent mention
  source; don't treat a free-form string such as `@crm` as trusted
  authorization.
- Ensure the selected mention resolves to a stable EVA agent ID and reaches
  the Orchestrator's prompt context in new and existing EVA conversations.
- Update the Orchestrator's runtime instructions so a specific `@agent` plus
  an explicit work request is a delegation request: validate the agent is
  available, formulate a bounded task with expected output, and call
  `eva_delegate_to_agent` with that agent ID.
- A mention alone, an unclear task, or an unavailable/unauthorized agent must
  not start work; ask a concise clarification or explain the policy denial.
  Do not dispatch directly from the mention picker, which would run work before
  the user submits a task.

### 3. Use BB's native child lifecycle

- Reuse the existing `eva_delegate_to_agent` handler and BB thread-creation
  path (`parentThreadId`); do not create a parallel task table, custom child
  API, or simulated child conversation.
- Preserve per-agent workspace and effective execution defaults. The server
  must continue checking the parent owner, target-agent grant, execution tuple,
  allowed tool, visibility, and thread-write access at execution time.
- Keep delegated children visible and inspectable by default, nested beneath
  the Orchestrator thread. Respect BB's existing child-depth limit and current
  thread ownership/access rules.
- Return the created child thread ID and agent to the parent. Use BB's native
  child status/notification behavior where available; once complete, let the
  Orchestrator use `eva_read_agent_thread` for the bounded result and summarize
  it to the user. If the native parent notification is insufficient, identify
  the smallest missing lifecycle integration rather than polling indefinitely.
- Confirm the current personal-project placement used for EVA children remains
  the intended BB configuration and that users can navigate to a child from
  its parent; change placement only if that verification exposes a real issue.

### 4. Add end-to-end and security coverage

- Mention-provider test: allowed EVA agents appear with stable IDs; denied
  agents do not leak through search or resolution.
- Runtime-config test: authorized Orchestrator sessions receive the required
  collaboration tools, while non-EVA or disallowed sessions do not.
- Server delegation tests: a valid call creates a real child with the expected
  `parentThreadId`, `agentId`, owner, workspace/environment, and execution
  tuple; the parent can list/read it and receive its result.
- Negative tests: unknown or ungranted target, missing task, revoked owner,
  missing tool grant, inaccessible parent, invalid execution tuple, and child
  depth limit all fail closed without creating a thread.
- UI/browser verification: choose `@crm`, submit a bounded task, confirm a
  child appears under the Orchestrator, verify it runs in the CRM workspace,
  then confirm the parent reports the child's result rather than claiming work
  completed before the child does.

## Acceptance criteria

1. The Orchestrator's `@` picker visibly offers the user's permitted EVA agents
   separately from thread and workspace references.
2. Sending `@crm` with a concrete task results in exactly one inspectable BB
   child thread linked to the current Orchestrator thread and assigned to
   `crm`.
3. The Orchestrator can report the child ID/status, read its completed output,
   and give the user a concise, accurate summary.
4. Mentioning an agent never bypasses target-agent, tool, execution, ownership,
   or thread-access policy, and does not silently run a task without a submitted
   user request.
5. Existing standalone agent conversations and ordinary BB mentions continue
   to work unchanged.

## Out of scope

- Replacing BB's child-thread implementation or changing BB's global mention
  system.
- Letting the Orchestrator perform a specialist's external side effects or
  override that specialist's mandate; existing human-approval boundaries remain
  in force.
- Delegating to arbitrary non-EVA providers or agents without an explicit
  product and policy design.
