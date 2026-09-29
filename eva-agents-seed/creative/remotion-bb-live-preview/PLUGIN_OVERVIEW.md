## What you get

Remotion Live Preview opens the local composition catalog inside the current BB
thread's native side panel. It uses Remotion Player and shares the same React
components as Remotion Studio, so each video has one source of truth.

The starter includes three compositions: `BBLivePreview` (wide motion title
card), `SocialLaunch` (vertical launch card), and `QuoteCard` (square
quote card). The catalog is intentionally small so it is quick to replace with
your own templates.

The Preview control is scoped to the Creativity agent and requires a ready BB
environment containing this Remotion project. Outside that context, the header
control is hidden and a stale panel tab renders no video.

## How it works

Use the **Preview** control in the current thread header, or choose
**Remotion Preview** from the thread panel's Actions list. BB opens a closable
panel tab attached to that thread; the plugin does not add a sidebar page.

The tab's video controls are live in BB. The Templates picker displays every
entry in `src/composition-registry.ts`. Selecting a different entry calls
BB's current-thread panel navigation with a different `compositionId`, so
BB creates or focuses that composition's sibling tab. Several compositions can
therefore stay open in one thread and be placed side-by-side with BB's split
controls.

After editing a composition, run `npm run build:plugin` and
`bb plugin reload remotion-live-preview` to load the new bundle into
the open thread tabs.

## Add another composition

1. Create a frame-driven React component in `src/` and give it typed
   `defaultProps`.
2. Add its dimensions, duration, fps, component, and input props to
   `src/composition-registry.ts`.
3. Build and reload the plugin. It will appear in Remotion Studio and the BB
   Templates picker automatically.

## Requirements

- BB 0.40 or newer.
- Node.js and npm.
- The project's `node_modules` installed with `npm install`.

The plugin does not require an external service or a hosted preview URL.
