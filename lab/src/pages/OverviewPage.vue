<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <div class="page-head">
    <h1>inflow-js lab</h1>
    <p>
      A place to drive the packages by hand — no backend, no engine, no inspector. Everything here
      runs on data that ships with the repo, and consumes the packages through their built
      entrypoints exactly as an installed app does. If a page here is broken, the package is broken.
    </p>
  </div>

  <div class="grid-2">
    <div class="card">
      <div class="card-title">
        @inflowenger/plugin-form-builder
        <span class="badge accent">Vue</span>
      </div>
      <p class="hint" style="margin-bottom: 14px">
        JSON Forms renders a form from a schema. Inflow schemas carry an extra key,
        <code>x-inflow-ui</code>, for behaviour a plain form has no vocabulary for — put a button on
        this field, and run this action when it's clicked. These pages are that renderer, live.
      </p>
      <p style="margin: 0 0 8px">
        <RouterLink to="/form-builder/preview">Form Preview →</RouterLink>
      </p>
      <p class="hint" style="margin: 0 0 14px">
        Edit a schema/UI-schema pair and watch the form follow, with every action call and its patch
        listed as it happens. Same sample the inspector seeds a new extension with.
      </p>
      <p style="margin: 0 0 8px">
        <RouterLink to="/form-builder/debug-enum">Debug Enum →</RouterLink>
      </p>
      <p class="hint" style="margin: 0">
        A wrapped enum next to a plain one. Guards a reflection bug whose only symptom is a
        <code>&lt;select&gt;</code> that quietly stops showing its own value.
      </p>
    </div>

    <div class="card">
      <div class="card-title">
        @inflowenger/flow-trace
        <span class="badge">framework-free</span>
      </div>
      <p class="hint" style="margin-bottom: 14px">
        The engine publishes an event per meaningful thing that happens while a flow runs. This is
        the consumer half: feed it the stream, get movement and completion. No dependencies, no
        framework — the lab happens to be Vue; the package does not care.
      </p>
      <p style="margin: 0 0 8px">
        <RouterLink to="/flow-trace/replay">Run Replay →</RouterLink>
      </p>
      <p class="hint" style="margin: 0">
        A captured run — a contract branch, a plugin failure, a GoTo, a loop — played into a tracker
        one message at a time. Reorder it, drop from it, or pollute it with junk, and see the
        tracker's answer.
      </p>
    </div>
  </div>

  <div class="card">
    <div class="card-title">Running it</div>
    <pre class="json">pnpm install
pnpm -r build      # the lab consumes dist, so build the packages first
pnpm --filter @inflowenger/lab dev</pre>
    <p class="hint" style="margin-top: 10px">
      Changing a package? Leave <code>pnpm --filter @inflowenger/&lt;pkg&gt; dev</code> running
      alongside — it rebuilds on save and Vite picks the new dist up.
    </p>
  </div>
</template>
