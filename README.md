# Early Edition Kids

Early Edition Kids is a daily news brief for a child's jailbroken Kindle: a small server on the home k3s cluster picks about six stories each morning from kids' and UK news feeds, rewrites them at an 8 year old's reading level with an LLM, and checks them for safety. A KOReader plugin downloads the issue when the Kindle is woken, shows a headline list, and reports what was read so a parent can see it and tomorrow's selection can follow it.

| Front page | Today's paper | End of a story | Back issues |
|:---:|:---:|:---:|:---:|
| <img src="docs/images/kindle/front-page.png" width="200" alt="Kindle front page"> | <img src="docs/images/kindle/todays-paper.png" width="200" alt="Today's paper"> | <img src="docs/images/kindle/story-finished.png" width="200" alt="End of a story"> | <img src="docs/images/kindle/back-issues.png" width="200" alt="Back issues"> |

![The parent dashboard's overview page, annotated](docs/images/dashboard/overview.png)

More in the docs: [the Kindle screens](docs/kindle.md), [the parent dashboard](docs/dashboard.md), [architecture diagrams](docs/architecture.md) and [the model comparison](docs/model-comparison.md).

## How it fits together

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/architecture/system-dark.svg">
  <img src="docs/images/architecture/system-light.svg" alt="How Early Edition Kids fits together: feeds and AI models into the server on the home cluster, out to the Kindle and the parent's phone">
</picture>

## Layout

| Path | What it is |
|---|---|
| `server/` | Node.js + TypeScript (Express) server: feeds, selection, rewriting, checking, SQLite, the Kindle API and the dashboard API. `server/Dockerfile` builds the image from the repo root and includes the built `web/` app. |
| `web/` | The parent dashboard: a React PWA served by the server at `/dashboard/`. |
| `plugin/` | `earlyeditionkids.koplugin`, the KOReader plugin for the Kindle. |
| `deploy/` | Kubernetes manifests (`deploy/k8s/`), local multi-arch build script. |
| `.gitlab-ci.yml` | Builds and pushes the multi-arch server image. |
| `docs/` | Tours with screenshots, architecture diagrams and the model comparison. Start at [`docs/README.md`](docs/README.md). |
| [`docs/DESIGN.md`](docs/DESIGN.md) | The spec. |
| [`docs/CONTRACT.md`](docs/CONTRACT.md) | The exact interfaces shared by server, plugin and deploy. |
| `reports/` | Raw results of the model comparison runs. |

## Quick start

- **Server:** see [`server/README.md`](server/README.md) to run it locally (with `LLM_BASE_URL=stub` it needs no LLM).
- **Cluster:** see [`deploy/README.md`](deploy/README.md) to create the secret, apply the example manifests to a k3s cluster and run a generation by hand.
- **Kindle:** see [`plugin/README.md`](plugin/README.md) to install the plugin and set `server_url` to the server's LAN address, such as `http://192.168.1.50:8080`.
- **Dashboard:** `https://<your-dashboard-host>/dashboard/`, behind an authenticating proxy such as Authelia. The server serves it on a second port (8081) that is not on the LAN LoadBalancer; the app itself has no login.

## Important: leave the Kindle in KOReader overnight

KOReader only runs plugins while it is in the foreground. If the Kindle is left in the stock Kindle interface, or KOReader is closed, Early Edition Kids cannot fetch anything.

The Kindle also cannot wake itself to download. The server generates the issue at 05:30, but the Kindle fetches it only when it is woken in the morning, after Wi-Fi reconnects, so the headlines appear a few seconds after it is picked up, not before.

## Licence

The code is under the [MIT licence](LICENSE).

- **Masthead font:** the plugin bundles Playfair Display, which is under the SIL Open Font License ([`OFL.txt`](plugin/earlyeditionkids.koplugin/fonts/OFL.txt)).
- **News content:** the test fixtures in `server/tests/fixtures/` are saved copies of public RSS feeds, and `reports/` quotes short excerpts from news articles. That content belongs to its publishers and isn't covered by the MIT licence.
