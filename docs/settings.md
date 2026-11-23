# Settings

Early Edition Kids is set up in three places:

- **`config.yaml`** says what each child's paper is: their age, how long the stories are, what they like and where the news comes from. Most of this page is about this file.
- **The dashboard** holds the choices a parent changes from day to day, such as pinning a topic or picking the AI model ([Set on the dashboard](#set-on-the-dashboard)).
- **Environment variables** hold the keys and the server's own settings ([Set in the environment](#set-in-the-environment)).

## How the file works

- **Start from the example.** Copy [`server/config.example.yaml`](../server/config.example.yaml) and change it. With Docker, mount your copy with `-v "$PWD/config.yaml:/config/config.yaml:ro"`. Elsewhere, `EARLY_EDITION_KIDS_CONFIG` says where the file is.
- **Restart after a change.** The server reads the file once, when it starts. With Docker, run `docker restart early-edition-kids`. On Kubernetes, restart the Deployment after changing the ConfigMap.
- **Mistakes stop the server.** A wrong value stops it at start with a message that names the setting, such as `config: story_words: max must be at least min`. `docker logs early-edition-kids` shows it.
- **Never put a child's name in it.** The AI sees the age, topics and favourite players from this file, and nothing in it should identify a child.
- **Every setting can be set per child,** except the two in [Shared by every child](#shared-by-every-child). [More than one child](#more-than-one-child) explains how.

## The child and the paper

| Setting | Default | What it does |
|---|---|---|
| `title` | `Early Edition` | The name on the masthead. |
| `child_age` | `8` | The reader's age. The AI writes at this reading age and checks every story is suitable for it. |
| `story_count` | `6` | Stories in each day's paper. A paper is published when at least 3 of them pass their checks, or all of them when `story_count` is 1 or 2. |
| `story_words` | `{ min: 100, max: 160 }` | How long each story is, in words. A story outside the range is sent back to be rewritten. The example file uses 120 to 200. |
| `reading_wpm` | `90` | How many words a minute the child reads. It sets the "2 min" shown on each story, and with `min_reading` how long a story has to be open before it counts as properly read. |
| `min_reading` | `0.5` | A story read to the end in less than this share of its expected reading time was read too fast: it isn't engaged (topic weighting), doesn't count toward opening Sport, and is marked on the readers and the dashboard. `0` means any speed. The starting value: change it for each child under Not too fast on the dashboard's Reading page. |
| `reader_mode` | `pages` | How the iPad reader shows a story: `pages` turns pages like the Kindle, with no scrolling; `scroll` runs the whole paper down one long page. The Kindle is not affected. |

**On the iPad** the type size follows `child_age`: largest for 6 and under, middle for 7 and 8, smallest for 9 and over. The reader keeps its reading log on the iPad, like the Kindle, so My week there shows what was read on that iPad.

## Interests

| Setting | Default | What it does |
|---|---|---|
| `topics` | Nine starting topics, all weight 1 | The topics the paper is chosen from. Each has a `name`, a `base_weight` (default 1), and optional `description` and `notes`. |
| `favourite_players` | none | Stories about these players are preferred, and the writer may mention them when the article does. |
| `favourite_team` | none | The child's team. It only does something together with `rival_clubs`. |
| `rival_clubs` | none | With `favourite_team`, a story about a rival club may carry one friendly line from a fan's point of view, such as "Not the best night for them!" |
| `sports` | off | The [Sport page](sports-page.md): the Premier League table, the latest matchday's results and the next fixtures, fetched once a day with the paper. `enabled: true` turns it on; `read_first` (default `0.5`) is how much of today's paper to read before it opens, These are starting values: change them for each child on the dashboard's Sport page. (`sports.min_reading` is the old name for `min_reading`, and still works.) `favourite_team` marks the child's club on it. |
| `mens_football_only` | `false` | When `true`, the AI leaves out women's and girls' football. Add `exclude_title_patterns` to the football feeds as well, as the example does, so the obvious headlines never reach the AI. |

**Topics in more detail:**

- **Names are free text.** The nine starting topics are Liverpool FC, England, Football, Science, Space, Animals and nature, Games and tech, Weather and Weird but true. The Kindle has an icon for each of these; any other name gets a plain one.
- **Weights shift with reading.** A topic's weight moves between half and one and a half times its `base_weight`, depending on how much of it the child read properly in the last 14 days. Pinning a topic or turning it off on the dashboard overrides this.
- **The description is for you.** One short line, shown under the topic's name on the dashboard's Topics page. The AI never sees it.
- **Notes go to the AI that picks the stories.** The dashboard never shows them. Use them to say what a topic covers or how often it should appear, such as "One a day at most".
- **Renaming a topic starts it afresh.** Reading history is matched by name, so a renamed topic loses its past weighting.

## Sources and safety

| Setting | Default | What it does |
|---|---|---|
| `feeds` | none | The RSS feeds stories come from. With no feeds there is nothing to choose from, so set at least one. |
| `blocklist` | none | Words and phrases that are never allowed. A feed item whose headline or summary contains one is dropped before the AI sees it, and a finished story containing one is rejected. Matching is by whole word and ignores case. |

Each feed has these settings:

| Setting | Default | What it does |
|---|---|---|
| `name` | required | Shown as the story's source. |
| `url` | required | The feed's address. `file:///path/feed.xml` works for testing. |
| `kids_source` | `false` | Marks a feed written for children. When two feeds cover the same event, the children's one is chosen. Its stories are still rewritten and checked like any other. |
| `topic_hint` | none | A topic the feed's items probably belong to. It must be one of `topics`, or the server will not start. |
| `exclude_url_patterns` | none | Items whose link matches any of these are skipped, such as `/videos/`. |
| `exclude_title_patterns` | none | Items whose headline matches any of these are skipped, such as `^Quiz`. |

Patterns are regular expressions and ignore case. The blocklist is a blunt first pass; a second AI call checks every story for anything unsuitable, so the list doesn't need to be long.

## Fine tuning

These rarely need changing.

| Setting | Default | What it does |
|---|---|---|
| `reserves` | `4` | Extra stories picked each morning, used when a story fails its checks. |
| `max_age_hours` | `48` | Feed items older than this are ignored. |
| `dedupe_days` | `14` | A story used in this many days is not chosen again, matched by link and headline. |
| `fallback_days` | `7` | When the AI can't make a paper, a catch-up paper is made from unopened stories of the last this-many days. |
| `min_source_words` | `150` | An article with less readable text than this is swapped for a reserve, and refused when a parent adds it. |
| `source_char_limit` | `6000` | Article text is cut to this many characters before the AI sees it. |
| `llm_concurrency` | `3` | How many stories are rewritten at the same time. |

## Shared by every child

These two can't be set in a profile; the server won't start if one is.

| Setting | Default | What it does |
|---|---|---|
| `llm_prices` | Claude Opus 5.5 $4 / $20, Sonnet 5.5 $2 / $10, Haiku 5.5 $0.10 / $0.50 | US dollars per million input and output tokens, for the dashboard's cost figures and the monthly limit. Entries add to the defaults or replace them. A model with no price is counted as free and noted in the log. |
| `openrouter_models` | Six models (see the example file) | The models offered through OpenRouter. Setting it replaces the whole default list. |

## More than one child

Add a `profiles:` list. Each entry has an `id` and any settings that differ for that child; everything else comes from the rest of the file.

```yaml
profiles:
  - id: older
  - id: younger
    child_age: 6
    story_count: 4
    title: Little Edition
    story_words: { min: 80, max: 130 }
```

- **The id** is lowercase letters, digits and hyphens, up to 40 characters. Use something neutral like `older` or `younger`, never a name: it appears in the Kindle's address and on the dashboard.
- **A list replaces, it doesn't add.** A profile that sets `topics`, `feeds` or `blocklist` must list all of its own. Copy the full list from the top of the file and change it.
- **List the child who already reads it first.** The first profile listed the first time keeps the existing paper, reading history and Kindle address. The server records which one in `profiles.json` in its data folder, so reordering the list later moves nothing. If that profile is removed, its data is left alone and the log says so.
- **Each other child's Kindle** uses the same server address with `/p/<id>` added, such as `http://192.168.1.50:8080/p/younger`.
- **Each child's iPad reader** is that address with `/read/` added, such as `http://192.168.1.50:8080/p/younger/read/`. The dashboard's Devices page has it, with a QR code.
- **The dashboard** gets a switcher at the top. Each child has their own pages, and nothing adds them together.
- **Each child costs the same again.** Every profile makes its own paper each morning, with its own calls to the AI, so two children cost about twice as much. The monthly limit on the dashboard is set per child.

## Set on the dashboard

These are kept in each child's own database, so with more than one child each has their own:

- **Topics page:** pin a topic so it appears more, or block it so it never appears.
- **AI page:** the model that writes and the one that checks, how hard each thinks, and a monthly spending limit. Until these are set, the `LLM_MODEL` and related environment variables apply.
- **Sport page:** whether the child has the Sport page, how much of today's paper to read before it opens, and how quickly a story can be read and still count. Until these are set, the `sports` block in `config.yaml` applies.
- **Stories:** hidden stories and articles a parent has added.

## Set in the environment

These are shared by every child. The full list, with defaults, is in the [server README](../server/README.md#configuration).

| Variable | What it does |
|---|---|
| `LLM_API_KEY` | Your Anthropic key. |
| `OPENROUTER_API_KEY` | Your OpenRouter key, instead of or as well as the Anthropic one. |
| `GENERATE_AT` | The time each morning the papers are made, London time, such as `05:30`. |
| `DASHBOARD_PASSWORD` | Makes the dashboard ask for a password. `DASHBOARD_USER` adds a user name. |
| `KINDLE_BASE_URL` | The Kindle port's address on your network, such as `http://192.168.1.50:8080`. The dashboard's "Read on an iPad" card uses it for the reader's address and QR code. Unset, it is worked out from the dashboard's own address, which is right for a plain `docker run` but not behind a proxy. |
| `EARLY_EDITION_KIDS_CONFIG` | Where `config.yaml` is. `/config/config.yaml` in the Docker image. |
