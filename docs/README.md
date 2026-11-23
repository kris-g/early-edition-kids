# Early Edition Kids docs

Start with the tours if you want to see what it does, and the spec if you want to know why.

| Page | What it covers |
|---|---|
| [The Kindle screens](kindle.md) | What the child sees: front page, today's paper, a story, back issues. |
| [Reading on an iPad](ipad.md) | Setting up the iPad reader as a home-screen app, step by step, and what the child sees. |
| [The parent dashboard](dashboard.md) | Annotated screenshots of each dashboard page. |
| [Settings](settings.md) | Every setting in `config.yaml`, what is set on the dashboard instead, and papers for more than one child. |
| [Architecture](architecture.md) | The system overview, the daily pipeline and the morning sync. |
| [Model comparison](model-comparison.md) | Four writer models tested over four days, and which one is recommended. |
| [DESIGN.md](DESIGN.md) | The spec the build started from. |
| [The Sport page](sports-page.md) | A proposal, not yet built: the Premier League table, live results and fixtures, with mockups. |
| [CONTRACT.md](CONTRACT.md) | The exact interfaces shared by the server, the plugin, the web app and the deploy manifests. |

Each part of the code has its own README for running it: [server](../server/README.md), [web](../web/README.md), [plugin](../plugin/README.md), [deploy](../deploy/README.md).

## Where things live

```
docs/
  images/
    architecture/  the system overview, light and dark, made by tools/system-diagram.mjs
    dashboard/     annotated dashboard screenshots, made by tools/annotate.mjs
    ipad/          annotated iPad setup screenshots, made by tools/annotate-ipad.mjs
    kindle/        screens from the KOReader emulator, and the feature sets made by tools/kindle-sets.mjs
    mockups/       the three original mockups the design started from
  tools/           scripts that make the images
```

## Adding to these docs

- **Diagrams:** write them as a `mermaid` code block in the page. GitHub and GitLab both draw them, and they follow light and dark mode. The system overview is the exception: it is an SVG drawn by `tools/system-diagram.mjs`.
- **Light and dark images:** wrap the pair in a `<picture>` element, as the system overview does. Where `<picture>` isn't supported, the light version shows.
- **Images:** put them under `images/<subject>/`, named in lowercase with hyphens and no spaces. Give them a solid background; transparent images look wrong in dark mode.
- **Links:** use relative paths, such as `images/kindle/front-page.png`.
- **Width:** set it with `<img src="…" width="300" alt="…">` when an image shouldn't fill the page.
