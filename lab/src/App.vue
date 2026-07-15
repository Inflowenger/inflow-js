<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="lab">
    <nav class="lab-nav">
      <div class="lab-brand">inflow-js lab</div>
      <div class="lab-brand-sub">packages, driven by hand</div>

      <RouterLink to="/">Overview</RouterLink>

      <div class="lab-nav-group">plugin-form-builder</div>
      <RouterLink to="/form-builder/preview">Form Preview</RouterLink>
      <RouterLink to="/form-builder/debug-enum">Debug Enum</RouterLink>

      <div class="lab-nav-group">flow-trace</div>
      <RouterLink to="/flow-trace/replay">Run Replay</RouterLink>
    </nav>

    <main class="lab-main">
      <RouterView />
    </main>
  </div>
</template>
