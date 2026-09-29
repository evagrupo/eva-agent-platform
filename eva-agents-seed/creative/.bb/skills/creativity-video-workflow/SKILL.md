---
name: creativity-video-workflow
description: Create and iterate programmatic videos in the Creativity agent using the local Remotion project, shared composition registry, and BB's current-thread preview tabs. Use when the user asks to make a video, add or change a Remotion composition/template, create a vertical or social video, add voiceover with ElevenLabs, use OpenAI for video-supporting content, preview a video in BB, or render/export a composition.
---

# Creativity video workflow

Use this skill as the default production loop for videos in the Creativity
agent. Keep the work inside the local Remotion project and the current BB
thread. Do not open a separate dashboard or hosted preview unless the user
explicitly asks for one.

## First inspect the workspace

1. Read the root `AGENTS.md` and any relevant project instructions.
2. Locate the Remotion project, normally
   `remotion-bb-live-preview/`, and inspect its composition registry before
   adding a new file.
3. Check for product, brand, copy, logo, and asset context in the workspace.
   Use supplied assets and approved copy; do not invent claims, testimonials,
   logos, or guaranteed outcomes.
4. Treat `.env.local` and other dotenv files as secret-bearing. Never print,
   cat, grep, or include their values in responses, diffs, prompts, or logs.

## Plan the composition

Before coding, choose the target and format:

- `16:9` for wide product/demo or presentation video.
- `9:16` for Reels, Stories, Shorts, and other vertical social placements.
- `1:1` for square social or editorial cards.

Use a short beat sheet for anything beyond a simple card: hook, setup,
demonstration or idea, payoff, and closing frame. Keep essential text inside
platform-safe margins. Prefer a small number of intentional visual beats over
decorative motion.

Every composition must have typed `defaultProps` and explicit metadata in the
shared registry: stable `id`, human-readable `title`, description, component,
duration, fps, width, height, and input props.

## Implement Remotion markup

- Drive animation from `useCurrentFrame()`, `useVideoConfig()`,
  `interpolate()`, and `spring()` where appropriate.
- Use Remotion timeline primitives such as `Sequence` and `Series` for timed
  beats. Do not use CSS animations or CSS transitions for video motion.
- Keep composition components deterministic and render-safe. Avoid browser
  APIs, random values, network calls, or time-dependent values during render.
- Use `AbsoluteFill` and explicit layout styles. Preserve readability and
  contrast across the whole frame.
- Keep external media local and validate dimensions, duration, and format
  before using it. Load captions, maps, multimedia, or voiceover guidance
  only when that task requires it.

## Add or change a template

For an existing template, edit its component and keep its registry `id`
stable. For a new template:

1. Add a typed React component under `src/` (use `src/Templates.tsx` for small
   reusable starters or a dedicated file for a larger composition).
2. Add one entry to `src/composition-registry.ts` with its full metadata and
   `defaultProps`.
3. Keep the component passed to BB `Player` and the component registered in
   `src/Root.tsx` sourced from that same registry. `Root.tsx` already maps the
   catalog into Remotion `<Composition>` elements.
4. Run the checks, build the plugin, and reload it. New entries then appear in
   both Remotion Studio and BB's Templates picker automatically.

Do not reuse an existing `id` for a different video. Existing BB tabs keep
their persisted `compositionId`; editing a component updates those tabs after
the new bundle is loaded, while adding a new entry leaves existing tabs
unchanged.

## Preview in BB

Use the Remotion Preview header action or the thread panel action. The panel is
available only in the Creativity project when the ready Remotion workspace is
present. It is a host-owned BB thread tab, not a plugin sidebar page.

The Templates picker opens a different composition with a different
`compositionId`. BB focuses an existing matching tab or creates a sibling tab
in the same thread, so several videos can remain open and be arranged with BB
split controls. Keep the preview layout bounded by the side-panel height,
preserve aspect ratio with letterboxing when needed, and do not introduce a
scrolling video surface.

This project intentionally uses a bundled `@remotion/player` preview. Do not
start `remotion studio`, `bb plugin dev`, or another development server unless
the user explicitly requests hot reload. The normal update loop is:

```console
npm run lint
npm test -- --run
npm run check:plugin
npm run build:plugin
bb plugin reload remotion-live-preview
```

## Voiceover and AI-assisted production

Use `ELEVENLABS_API_KEY` only on the server or in a local generation script;
never embed it in a client bundle or video props. Generate audio to a local,
ignored output path, inspect its duration, and use the appropriate Remotion
audio/media guidance before syncing beats or calculating duration.

Use `OPENAI_API_KEY` only for explicitly requested OpenAI API work such as
script drafts, structured shot lists, metadata, or other production support.
Do not send private workspace assets or secret values to an external API unless
the user has requested that operation. Keep generated copy grounded in the
brief and review it for unsupported claims before placing it in a video.

## Render and hand off

Before rendering, verify the target composition by stable `id` and inspect a
still or short output when the change is visual. For a local export, use the
project's Remotion render command with the explicit composition id and output
path. Do not overwrite an existing export without the user's instruction.

For an explicitly requested cloud render, use the checked-in Lambda wrapper:

    npm run lambda:setup
    npm run lambda:render -- --composition SocialLaunch

The wrapper always starts renders with the configured primary AWS account and
tries the configured fallback only when the primary fails before a render
starts. Setup provisions matching Remotion Lambda/site resources for both
accounts by default; use --target primary or --target fallback when needed.
Finished MP4s use Remotion's S3-compatible output provider and go to the
configured Cloudflare R2 bucket. The bucket name must be supplied in the
ignored .env.remotion.local. Never choose an account by guessing, expose a
credential in a command, or print a dotenv file.

Report the composition id, format, duration, output path, and any assumptions.
Never publish or upload the asset unless the user explicitly asks for that
separate action.

## Finish checklist

- The requested format, duration, and safe margins are correct.
- All motion is frame-driven and deterministic.
- Text is legible and uses approved copy or clearly labeled neutral copy.
- Audio/captions are timed and their local files are not committed as secrets.
- The BB preview is in the current thread, fits the panel, and has no video
  scroll.
- New templates are present in the shared registry and have unique ids.
- Lint, tests, plugin type checks, and production build pass.
- Secret-bearing files remain ignored and their values were not exposed.
