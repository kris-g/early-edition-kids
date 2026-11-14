# Model comparison

Four models were tested as the paper's writer over four days, 9 to 12 November 2026. **The result: use Claude Opus 5.5 as the writer, with Claude Opus 5.5 at high effort as the checker.** Either can be changed on the dashboard's AI page.

## How it was run

- Each day, every model chose from the same candidate articles.
- Every model then rewrote the same six articles once, at medium effort, with the production prompts.
- Every story went through the automatic checks and then the Claude Opus 5.5 checker at high effort.
- Nothing was published. The four runs cost about $3.44 in total.

## Results over four days

24 stories per model. "Clean first time" means the story passed the automatic checks and the checker with no rewrite.

| Writer | Passed automatic checks | Passed checker | Clean first time | Avg words | Writing cost per day | Time per story |
|---|---:|---:|---:|---:|---:|---:|
| **Claude Opus 5.5** (Anthropic) | 22 (92%) | 22 (92%) | **21 (88%)** | 147 | $0.239 | 10.5s |
| Claude Sonnet 5.5 (Anthropic) | 19 (79%) | 18 (75%) | 15 (63%) | 137 | $0.076 | 3.9s |
| DeepSeek V4 Pro (OpenRouter) | 16 (67%) | 13 (54%) | 8 (33%) | 139 | $0.094 | 20.5s |
| GLM 5.3 (OpenRouter) | 9 (38%) | 10 (42%) | 3 (13%) | 151 | $0.011 | 3.1s |

Why stories would have been sent back. A story can have more than one reason.

| Writer | Invented detail | Number not in the source | Length or format | Other | Refused |
|---|---:|---:|---:|---:|---:|
| Claude Opus 5.5 | 2 | 1 | 1 | 0 | 0 |
| Claude Sonnet 5.5 | 6 | 4 | 1 | 0 | 0 |
| DeepSeek V4 Pro | 11 | 1 | 7 | 0 | 0 |
| GLM 5.3 | 14 | 3 | 13 | 1 | 0 |

Checking cost about $0.11 a day whichever model wrote the stories. No model refused a story, and the checker marked every story safe.

## What it showed

- **Opus was the most reliable writer every day:** 5, 5, 6 and 5 of 6 stories clean first time. Its two invented details were small.
- **Sonnet looked as good as Opus on the first day, then slipped.** Over four days the checker found invented details in 6 of its 24 stories, including one plain science mistake.
- **GLM 5.3 came last on all four days.** It broke the title, teaser or word-count limits 13 times and got facts wrong.
- **DeepSeek V4 Pro was third and slow,** at about 20 seconds a story. It also presented a reworded sentence as a direct quote.
- **The Opus checker caught what mattered:** invented dates, numbers made by adding other numbers, reworded quotes and overstated claims.

## What it costs

One run a day, measured averages over the four days. Monthly figures are 30 days.

| Option | Per day | Per month |
|---|---:|---:|
| **Opus writer and Opus checker (recommended)** | about $0.35 | about $10.40, or about $12 with rewrites |
| Sonnet writer and Opus checker | about $0.18 | about $5.40, or about $7 with rewrites |

## How far to trust it

- **Small sample:** 24 stories per model, one attempt each.
- **The gaps are overstated for real runs.** In production a failed story gets one rewrite with the reasons, so fewer stories are finally lost than "clean first time" suggests. The figures do show how often each model needs correcting.
- **Some articles repeat across days,** because the comparison keeps no story history. That wouldn't happen in production, where stories used in the last 14 days are skipped.
- **The first day had only 6 candidates,** so the models' picks overlap heavily that day.

## The raw results

| File | What it is |
|---|---|
| [`model-comparison-2026-11-09.json`](../reports/model-comparison-2026-11-09.json) | Monday's run: candidates, picks, every story from every model, checker verdicts and costs |
| [`model-comparison-2026-11-10.json`](../reports/model-comparison-2026-11-10.json) | Tuesday's run |
| [`model-comparison-2026-11-11.json`](../reports/model-comparison-2026-11-11.json) | Wednesday's run |
| [`model-comparison-2026-11-12.json`](../reports/model-comparison-2026-11-12.json) | Thursday's run |
| [`model-comparison-2026-11-09-to-12.html`](../reports/model-comparison-2026-11-09-to-12.html) | The full four-day report, with every story side by side |
| [`model-comparison-2026-11-09.html`](../reports/model-comparison-2026-11-09.html) | The first day's report |

GitHub and GitLab show the HTML reports as source. Download one and open it in a browser to read it.

To run a comparison yourself, see [`server/scripts/compare-models.ts`](../server/scripts/compare-models.ts) and [`deploy/k8s/compare-job.yaml`](../deploy/k8s/compare-job.yaml).
