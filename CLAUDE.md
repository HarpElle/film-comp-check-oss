# CLAUDE.md

## Build and test

```
npm ci
npm test                      # vitest, mocked and synthetic data only
npm run build
bash e2e/run-handoff.sh       # acceptance, remove, steps, share, draft and error specs; no keys, 0 Qloo calls
bash e2e/run-recorded.sh      # recorded-mode specs; run after run-handoff, not at the same time (shared port)
bash e2e/run-live-sample.sh   # "Run live on Qloo" on the samples, against a mocked Qloo
```

Run tests with the Qloo, Anthropic and KV variables unset. The e2e runners need `npm run build` first and a
recorded store (`HANDOFF_STORE`, see the script header).

Before a commit, run the public scan: `npx vitest run --config scripts/vitest.scripts.config.ts scripts/scan-public.ts`
(`SCAN_SYNTHETIC=1` without the local Qloo cache). Never commit keys, `.env*` values, `.cache/`, `.data/` or `qa/`.

## Styles

Design tokens live in `app/styles/tokens.css` and `app/styles/base.css`, app aliases in `app/globals.css` `:root`,
and the results-mode layout in `app/styles/layout.css`. Use the tokens; no raw colors or sizes in components.
