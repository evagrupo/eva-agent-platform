# Remotion Live Preview for BB

This is a small Remotion project packaged as a BB plugin. A shared composition
catalog powers Remotion Studio and the plugin's native BB side-panel tabs. BB
shows the preview only in the Creativity agent when its ready Remotion
workspace is present.

## Commands

Install dependencies:

``@@BT@console
npm install
``@@BT@

Start Remotion Studio:

``@@BT@console
npm run dev
``@@BT@

Build and reload the BB plugin after editing:

``@@BT@console
npm run build:plugin
bb plugin reload remotion-live-preview
``@@BT@

Install the local plugin once with `bb plugin install .`, then work in any
existing BB thread. Use the **Preview** button in that thread's header, or
choose **Remotion Preview** from the thread panel Actions list. The first
composition opens in that thread's host-owned side-panel tab—there is no
separate sidebar page.

Inside the preview, the **Templates** picker opens each composition as a
separate sibling tab in the same thread. That lets you keep multiple videos
open at once and arrange them with BB's normal tab/split controls.

Render a composition:

``@@BT@console
npx remotion render
``@@BT@

Render through AWS Lambda and upload the finished MP4 to Cloudflare R2:

    npm run lambda:setup
    npm run lambda:render -- --composition SocialLaunch --key social/launch.mp4

Renders always start with AWS account 1 and use account 2 only as a
pre-render fallback. Setup provisions matching Lambda/site resources for both
accounts by default. The local ignored configuration uses the R2 bucket
named store and the supplied public R2 domain.

Verify the plugin:

``@@BT@console
npm run check:plugin
npm test
npm run build:plugin
``@@BT@

The BB plugin owns only the thread action and video content. BB continues to own
the side-panel chrome, split placement, tab persistence, resizing, and keyboard
behavior.

## Compositions

The catalog currently includes:

- `BBLivePreview` — an 8-second, 1280×720 motion system title card.
- `SocialLaunch` — a 6-second, 1080×1920 vertical launch card.
- `QuoteCard` — a 5-second, 1080×1080 square editorial card.

Add or edit entries in `src/composition-registry.ts`. Each entry supplies the
Remotion component, dimensions, frame rate, duration, and `defaultProps`;
`src/Root.tsx` maps the catalog into Remotion `<Composition>` elements
automatically. The BB picker reads the same catalog, so a new entry becomes
available as another same-thread preview tab after the plugin is rebuilt and
reloaded.

## License

This starter is private and intended for local development.
