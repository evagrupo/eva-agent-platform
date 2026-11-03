Schedule flags:

```text
--cron <expr>                  Recurring 5-field cron expression
--timezone <tz>                IANA timezone for --cron
--at <datetime>                One-shot run time, preferably ISO 8601
--in <duration>                One-shot delay, e.g. 30s, 5m, 2h, 1d
```

Agent mode flags:

```text
--prompt <prompt>              Prompt to run when due
--provider <id>                Provider ID
--model <model>                Model ID
--reasoning <level>            none, low, medium, high, xhigh, ultracode, max, or ultra
--service-tier <tier>          Literal tier id the provider lists, including none
--clear-service-tier           Clear the tier; cannot combine with --service-tier
--permission-mode <mode>       accept-edits, auto, or full
--target-thread <id>           Reuse/re-prompt an existing thread
--agent <agent-id>             Post each run into your chat with this EVA agent
--new-thread                   Start a new thread for each run, even from an EVA agent chat
--environment <id-or-path>     Existing environment ID or unmanaged workspace path
--new-environment <kind>       Create a new environment (worktree)
--base-branch <branch>         Base branch for new managed worktrees
```

EVA agent chats: when you create an agent automation from inside an EVA
agent's chat (any agent except the Admin development agent) and pass no
`--target-thread`, `--environment`, `--new-environment`, or `--new-thread`,
each run is posted into that same chat, so the user gets the result where
they already talk to the agent. `--agent <id>` does the same for another
agent's chat. Each run looks up the user's current chat with the agent, so it
keeps working if that chat changes. Receiving runs does not stop a chat from
creating automations; only threads an automation started on its own are
blocked.

When `--permission-mode` is omitted, the plugin chooses Full Access (`full`)
when the provider supports it and otherwise uses Approve for me (`auto`).

Script mode flags:

```text
--script <inline>              Inline script content
--script-file <path>           Copy script content from a file on a host
--host <name-or-id>            Host that owns --script-file (default: thread host or server)
--interpreter <name>           bash, sh, node, or python3
--timeout <duration>           Bare number of milliseconds or a duration with a
                               unit (90s, 5m); default 120000, max 900000
--env-json <json>              Script variables as a string-to-string JSON object
--working-directory <value>    automation-storage, project, or an absolute server-host path
```
