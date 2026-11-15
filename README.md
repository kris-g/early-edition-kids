# Early Edition Kids

> [!IMPORTANT]
> ## 🤖 This is an AI-assisted project
>
> **Most of the code, docs and diagrams in this repo were written by AI.** The design came out of a chat with Claude on claude.ai, and the server, KOReader plugin, parent dashboard, tests and docs were then built with Claude Code (Anthropic's coding agent). A person directed the work, made the decisions, and tested it on a real Kindle and a home k3s cluster.
>
> It runs every morning for one family. Read the code before you rely on it, and treat it as a starting point rather than a finished product.
>
> The daily stories themselves are also written by an AI model, and checked by a second AI call before they reach the Kindle. See [the model comparison](docs/model-comparison.md) for how well that works.

Early Edition Kids is a daily news brief for a child's jailbroken Kindle: a small server picks about six stories each morning from kids' and UK news feeds, rewrites them at an 8 year old's reading level with an LLM, and checks them for safety. A KOReader plugin downloads the issue when the Kindle is woken, shows a headline list, and reports what was read so a parent can see it and tomorrow's selection can follow it.

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
| `deploy/` | Example Kubernetes manifests (`deploy/k8s/`) and a local multi-arch build script. |
| `.github/workflows/image.yml` | Builds the multi-arch image and publishes it to `ghcr.io/kris-g/early-edition-kids`. |
| `.gitlab-ci.yml` | The same build for the author's private GitLab mirror. |
| `docs/` | Tours with screenshots, architecture diagrams and the model comparison. Start at [`docs/README.md`](docs/README.md). |
| [`docs/DESIGN.md`](docs/DESIGN.md) | The spec. |
| [`docs/CONTRACT.md`](docs/CONTRACT.md) | The exact interfaces shared by server, plugin and deploy. |
| `reports/` | Raw results of the model comparison runs. |

## Getting started

You need:

- **A computer that stays on,** with Docker: a home server, a NAS or a Raspberry Pi 4 or 5. The image runs on amd64 and arm64.
- **An LLM key:** an [Anthropic API key](https://console.anthropic.com/), an [OpenRouter](https://openrouter.ai/) key, or both. With Claude Opus writing and checking, a paper costs about $0.35, so about $10 a month. Cheaper models can be chosen on the dashboard.
- **A jailbroken Kindle running [KOReader](https://koreader.rocks/),** on the same network as the server.

### 1. Run the server

```bash
docker run -d --name early-edition-kids --restart unless-stopped \
  -p 8080:8080 -p 127.0.0.1:8081:8081 \
  -v early-edition-kids:/data \
  -e LLM_API_KEY=sk-ant-... \
  -e GENERATE_AT=05:30 \
  ghcr.io/kris-g/early-edition-kids:latest
```

- **`GENERATE_AT`** makes the paper every morning at that time, London time. If the server starts later in the day and there's no paper yet, it makes one straight away.
- **Port 8080** is for the Kindle, so it's open to your network.
- **Port 8081** is the parent dashboard, at <http://localhost:8081/dashboard/>. The dashboard has no login of its own, so this command only opens it on the computer itself. To use it from your phone, put it behind a proxy that asks for a login, such as Authelia or Tailscale, rather than opening the port.
- **Data** (issues, reading history, settings) lives in the `early-edition-kids` Docker volume.
- **OpenRouter:** use `-e OPENROUTER_API_KEY=...` instead of, or as well as, `LLM_API_KEY`.
- **To try it with no key at all,** use `-e LLM_BASE_URL=stub` instead of `LLM_API_KEY`. The stories are placeholder text under the real headlines.

`docker logs early-edition-kids` should then show a line like `schedule: issue for 2026-11-16: created`.

**Make it your child's paper.** The built-in settings are an example, for an 8-year-old football fan in the UK. Copy [`server/config.example.yaml`](server/config.example.yaml), change the age, topics, favourite team and players, and feeds, then run the command again with `-v "$PWD/config.yaml:/config/config.yaml:ro"` added. Everything runs on London time and the feeds are British, so it suits a UK reader best.

### 2. Install the plugin on the Kindle

Follow [`plugin/README.md`](plugin/README.md): copy the plugin folder to the Kindle, and set `server_url` in its `config.lua` to the server's address on your network, such as `http://192.168.1.50:8080`.

### 3. Open the dashboard

Open the dashboard to see what was read, hide or add stories, pick topics, and choose which AI model writes the paper. [The dashboard tour](docs/dashboard.md) shows each page.

### Running it on Kubernetes instead

If you already run a Kubernetes cluster, [`deploy/README.md`](deploy/README.md) has example manifests: a Deployment, a CronJob for the morning run, an HTTPS ingress for the dashboard behind Authelia, and nightly backups. It's more work than Docker, and it's how the author runs it, on k3s.

### Working on the code

[`server/README.md`](server/README.md) runs the server from source, [`web/README.md`](web/README.md) the dashboard with a mock API, and [`plugin/README.md`](plugin/README.md) covers the plugin's tests and the KOReader emulator.

## Important: leave the Kindle in KOReader overnight

KOReader only runs plugins while it is in the foreground. If the Kindle is left in the stock Kindle interface, or KOReader is closed, Early Edition Kids cannot fetch anything.

The Kindle also cannot wake itself to download. The server makes the paper early (05:30 in the example), but the Kindle fetches it only when it is woken in the morning, after Wi-Fi reconnects, so the headlines appear a few seconds after it is picked up, not before.

## Licence

The code is under the [MIT licence](LICENSE).

- **Masthead font:** the plugin bundles Playfair Display, which is under the SIL Open Font License ([`OFL.txt`](plugin/earlyeditionkids.koplugin/fonts/OFL.txt)).
- **News content:** the test fixtures in `server/tests/fixtures/` are saved copies of public RSS feeds, and `reports/` quotes short excerpts from news articles. That content belongs to its publishers and isn't covered by the MIT licence.
