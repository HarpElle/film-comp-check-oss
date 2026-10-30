# Film Comp Check

Check whether each film on your comp slide belongs there. You enter the 3 to 10 film comps from a pitch deck, and the app uses Qloo taste data to test whether they fit together and draw a similar audience.

Live site: https://filmcompcheck.com

License: MIT. See `LICENSE`.

See it working: open [the live site](https://filmcompcheck.com) and click "Try the Pennywell sample".

## Who it's for

Indie producers and small distributors building a pitch deck. One slide lists comps, past films they say are like theirs, picked to show investors there's an audience. Film funds such as [Telefilm Canada](https://telefilm.ca/wp-content/uploads/canada-feature-film-fund-distribution-terms-contract-requirements-.pdf) and the [New Zealand Film Commission](https://www.nzfilm.co.nz/assets/resources/Distribution20Grant20Guidelines_August20202020FINAL.pdf) ask for comparable films. Paid comp reports measure box office, not whether the comps fit together or draw a similar audience.

It checks comps. It does not predict box office, revenue or audience size.

## Try it in 3 steps

1. **Open a sample deck.** On https://filmcompcheck.com, click "Try the Pennywell sample" (or the Dream Hackers sample when it is shown). Samples replay recorded Qloo results, so they make no new Qloo calls. The page says "No new Qloo calls." and shows the recording date.
2. **Read the verdict and Agent steps.** The verdict names the lowest-fit comp and any audience outlier, labeled "Qloo's estimate". Under "Agent steps", each step is tagged "Always runs" (fixed code) or "Claude chose" (a lookup Claude picked), with the Qloo value it was based on.
3. **Remove a comp, or enter your own.** Click the x on a comp row to remove it and see the rest re-scored. On a sample this uses the recording. Then click "Edit comps", type 3 to 10 comps (one per line, year and director optional, for example `Get Out | 2017 | Jordan Peele`) and click "Check comps". Your own deck runs live on Qloo. Each visitor gets 5 live checks a day, and the limit resets at midnight Central time.

Export: the Export menu prints a comp-check sheet or downloads Markdown or CSV.

## How it works

Two kinds of steps run on every check.

**Fixed code steps (always run, in order):**
1. **Match.** Each comp is looked up with Qloo search. A record matches if the normalized title is the same, the year is within 1 year, and it names the director if you gave one. Otherwise the comp is marked Unmatched.
2. **Deck fit.** Each comp is scored against all the other comps, leaving one out at a time. The lowest comp is labeled "Consider cutting" when its gap to the next comp is larger than the spread of the rest, and "Lowest fit, close call" otherwise. At least 3 matched comps are needed for a fit score.
3. **Audience skew.** Qloo's age and gender estimate for each comp. At most one comp per deck is flagged, the one furthest from the deck average, and only if it is more than 0.3 away.
4. **Labels.** The verdict labels come from fixed rules in code.

**Extra lookups chosen by Claude:** after the fixed steps, an agent on Claude may pick from a small tool set: `look_at_tags` (one comp's Qloo tags against the rest of the deck), `check_pageviews` (English Wikipedia pageviews as popularity context, not a Qloo score), `rerun_after_set_aside`, and `stop`. Steps are capped by count and tokens.

**The model never sets a score.** Every score and label is computed in plain code (`lib/tools.ts`) before Claude runs. Claude gets a frozen copy of the results and only chooses the next lookup and writes a one-line reason. Every number and comp name in that reason is a placeholder that code fills from a tool result, and a reason that cites anything else is rejected (`lib/agent.ts`). With no model key, a built-in rule-following stub (`StubProvider`) runs the same rules.

## Qloo endpoints used

All calls go to `https://hackathon.api.qloo.com` with the `X-Api-Key` header, from the server only (`lib/qloo.ts`).

| Endpoint | Parameters | Feeds | Source |
|---|---|---|---|
| `GET /search` | `query` (comp title), `types=urn:entity:movie`, `take=20` | Match: picks the Qloo movie record for each comp | `lib/qloo.ts` `searchMovies`, rules in `lib/match.ts` |
| `GET /v2/insights` | `filter.type=urn:entity:movie`, `signal.interests.entities` (the other comps), `filter.results.entities` (the comp being scored) | Deck fit: the comp's affinity given the rest of the deck, leave one out | `lib/qloo.ts` `deckFitAffinity`, `lib/deckfit.ts` |
| `GET /v2/insights` | `filter.type=urn:demographics`, `signal.interests.entities` (one comp) | Audience skew: age and gender estimate per comp | `lib/qloo.ts` `demographics`, `lib/skew.ts` |

The `look_at_tags` lookup uses the tags on the record `/search` already returned, so it makes no new Qloo call (`lib/tools.ts`). Pageviews come from the Wikimedia REST API, not Qloo (`lib/pageviews.ts`).

## Run locally

Requires Node 20 or newer.

```
npm install
cp .env.example .env.local   # names only, fill in your own values
npm run dev                  # http://localhost:3000
npm test                     # vitest, mocked and synthetic data only
npm run build
```

Settings (all optional, server only, see `.env.example`):

- `QLOO_API_KEY`: live Qloo checks. Unset means no Qloo calls.
- `QLOO_LIVE`: `0` pauses live Qloo checks.
- `AGENT_PROVIDER`: unset runs the built-in stub. `claude` runs the agent on Claude with `QLOO_ANTHROPIC_API_KEY` (or `ANTHROPIC_API_KEY`).
- `AGENT_MODEL`, `AGENT_MAX_STEPS`, `AGENT_MAX_TOKENS`: model choice and spend cap.
- `STORE_FILE_DIR`, or one pair of `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or `KV_REST_API_URL` and `KV_REST_API_TOKEN`: the store. Unset means an empty in-memory store.
- `IP_DAILY_LIVE_CHECKS`, `IP_HASH_SALT`, `FIREWALL_RATE_LIMIT_ID`: per-visitor daily limits.
- `COMP_CACHE_DIR`: local cache of raw Qloo responses (git-ignored, off on Vercel).

Recorded Qloo results and agent replays are not in this repo. We keep Qloo response data out of the public repo, so the hosted site keeps its sample recordings in private server storage. A fresh copy starts with no samples until you run checks with your own key. The repo holds synthetic test data only.

## Layout

- `app/`: the page and the server route `app/api/check/route.ts`
- `lib/qloo.ts`: Qloo client
- `lib/match.ts`, `lib/deckfit.ts`, `lib/skew.ts`, `lib/pageviews.ts`: matching and scoring
- `lib/agent.ts`, `lib/tools.ts`, `lib/providers/`: agent loop, checks and providers
- `test/`: vitest, mocked data only

## Design spec

The design spec is kept private.
