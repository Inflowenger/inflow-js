# lab

A playground for the packages in this repo. Not published, not a package anyone depends on — a place to drive `plugin-form-builder` and `flow-trace` by hand, with no backend, no engine, and no inspector in the way.

```sh
pnpm install
pnpm -r build                      # the lab consumes dist, not src
pnpm --filter @inflowenger/lab dev
```

Working on a package at the same time? Leave its watcher running alongside:

```sh
pnpm --filter @inflowenger/plugin-form-builder dev   # rebuilds on save
```

The lab depends on both packages through `workspace:*`, which resolves to their **built** entrypoints. That is deliberate: it exercises the exports map, the types, and `style.css` — the surface a real consumer gets — so a packaging mistake surfaces here rather than in someone else's app. It is why the build step is not optional.

## Pages

| Page | Package | What it's for |
|---|---|---|
| **Form Preview** | plugin-form-builder | A schema / UI-schema pair, edited live, rendered through the Inflow renderers. Every action call is listed with what it saw and the patch it wrote. |
| **Debug Enum** | plugin-form-builder | A wrapped enum beside a plain one. A regression check with a UI. |
| **Run Replay** | flow-trace | A captured engine run fed to a tracker one message at a time, with controls to reorder, drop, and pollute the stream. |

### Form Preview

The samples are `params.schema` / `params.ui` pairs — what an extension record actually carries. The Jira Connector one is the same sample the inspector seeds a new extension with; keep them in step, it is the one people recognise.

The action registry lives in [`src/main.ts`](src/main.ts) and is the whole set of functions these schemas may call by name. The "Unknown action" sample names something outside it on purpose: the button is inert rather than fatal, which is the point of resolving actions by name.

### Debug Enum

Ported from the inspector's `DebugEnum.vue`. Both panels use the same schema and the same renderer set; only the left one carries `x-inflow-ui`. They must behave identically — a `<select>` that stops reflecting its data means `markRaw` slipped in [`src/lab/renderers.ts`](src/lab/renderers.ts), which is the bug this page catches early.

### Run Replay

The mock data is `packages/flow-trace/test/fixtures/real-run.jsonl` — a real captured run covering a contract branch, a plugin failure, a GoTo across flows, and a loop. The lab imports the fixture rather than shipping its own events, for the same reason the tests use it: hand-written events drift from what the engine really emits, and this way the parser's tests fail before the lab can lie.

The stream controls exist to show the parts of the contract a clean run never reaches:

- **Reorder** swaps neighbours, as a concurrent publisher does. Nothing is lost, so the tracker absorbs it and final state is unchanged.
- **Drop seq** removes an event for good. The reorder window fills, a `gap` is reported, and the run continues without it.
- **Non-events** are ordinary shared-transport traffic. They land on `skip` with a reason and never disturb the run.
- **Reorder window: Infinity** holds everything behind a hole indefinitely — nothing resolves without *Flush*. That is exactly what `replay()` does at the end of a batch.

## Adding a page

Drop a component in `src/pages/`, add a route in `src/router/index.ts`, add a link in `src/App.vue`. Form pages should import the shared `renderers` from `src/lab/renderers.ts` rather than assembling their own — the `markRaw` note there is load-bearing.
