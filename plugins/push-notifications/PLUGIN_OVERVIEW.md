Get a notification when an agent asks a question, finishes a turn, or stops on an error. Plugins and the CLI can send their own too. Choose mobile, web, and desktop delivery independently in Settings → Push notifications.

## Delivery

Mobile devices receive push messages through Expo, including when the app is closed. Web browsers and the desktop app receive system notifications over bb's live connection while a tab or window stays open; web delivery needs HTTPS (or localhost) and notification permission. Mobile WebViews use mobile push only.

Each thread has a level: `all` (questions, approvals, errors, finished turns), `replies` (questions, approvals, and finished turns that ended with an assistant reply; no errors), `input-only` (questions, approvals, errors; no finished turns), or `muted`. A thread uses its own level, else `childLevel` if it has a parent, else `replies` if it is an EVA agent chat (a top-level thread assigned to an agent other than `admin`) unless `defaultLevel` is quieter, else `defaultLevel`; every ancestor's own level caps it. Caps rank `muted` < `input-only` < `replies` < `all`; since `replies` and `input-only` each keep something the other drops, this order is an approximation. Muting a parent mutes its whole subtree, but a parent never makes workers louder. The level applies on top of the suppressions below.

Click a notification to open its thread, or bb when it has none; in the desktop app the click also restores and focuses the window. With the `skipFocusedThreadNotifications` experiment (on for early adopters), a thread open in a visible, focused window or tab is not notified. Events arriving together are combined, with pending questions taking priority. Read, archived, deleted, and hidden threads are suppressed. Tabs of the same origin deduplicate delivery.

## Thread menu

Every thread menu (header, sidebar row, right-click, compact drawer, optional row quick action) has a **Notifications** entry for unarchived threads: Default, All activity, Replies only, Needs input only, Muted. Agent chats show only Replies only, All activity, and Mute, with the effective level selected (Replies only until you pick another). The entry shows the current level; Default names its fallback; a footnote says when a parent limits it. Thread plugin metadata stores only a thread's own level, `{ "notifications": { "own" } }`; limits are read from the current parent chain. Menus fetch levels for threads on screen in batches.

## Settings

- `mobileEnabled` / **Mobile notifications**: send to registered phones and tablets. Default: true.
- `webEnabled` / **Web notifications**: notify connected browsers with permission. Default: true.
- `desktopEnabled` / **Desktop notifications**: notify running desktop clients. Default: true.
- `defaultLevel` / **Default notifications**: `all`, `replies`, `input-only`, or `muted`, for threads you haven't set. Default: `all`. Unset agent chats use `replies` unless this is quieter.
- `childLevel` / **Child thread notifications**: `inherit` (same as `defaultLevel`), `all`, `replies`, `input-only`, or `muted`. Default: `input-only`.
- `expoPushUrl` / **Expo push relay URL**: mobile relay endpoint. Defaults to `https://exp.host/--/api/v2/push/send`.

Channel switches apply to this server and save immediately. Browser permission is granted per device with **Allow notifications**. **Send test notification** confirms broadcast, not OS display.

## CLI and SDK

`bb push-notifications` manages mobile devices, shows status, sends and tests notifications, and reads or sets a thread's level; `bb plugin config push-notifications` changes the settings above. The bundled `push-notifications` skill documents every command and RPC method. Plugins and agents send notifications with the discoverable `notifications.send` RPC; `bb plugin rpc inspect push-notifications notifications.send` prints its schemas. Permission requests still require a click in the target client.
