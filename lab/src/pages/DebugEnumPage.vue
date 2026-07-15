<script setup lang="ts">
import { ref } from 'vue'
import { JsonForms } from '@jsonforms/vue'
import { renderers } from '../lab/renderers'

/**
 * The enum reflection check.
 *
 * An enum control wrapped by InflowControlRenderer must behave exactly like the
 * same control rendered by vanilla alone: the <select> shows the data, and it
 * keeps showing it when the data changes from outside the form. The failure
 * this guards against is silent — the wrapped select renders fine and simply
 * stops tracking its value — so the two panels are always side by side, and
 * "set protocol = wss" is the button that used to break the left one.
 */
const schema = {
  type: 'object',
  properties: {
    protocol: {
      type: 'string',
      title: 'Protocol',
      enum: ['http', 'https', 'ws', 'wss'],
      default: 'https',
    },
    host: { type: 'string', title: 'Host', default: 'localhost' },
  },
}

// A: protocol carries x-inflow-ui, so InflowControlRenderer wraps it.
const uiWrapped = {
  type: 'VerticalLayout',
  elements: [
    {
      type: 'Control',
      scope: '#/properties/protocol',
      'x-inflow-ui': { action: { name: 'noop' }, button: { position: 'append', label: 'noop' } },
    },
    { type: 'Control', scope: '#/properties/host' },
  ],
}

// B: no x-inflow-ui anywhere — the control never reaches our renderer.
const uiPlain = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Control', scope: '#/properties/protocol' },
    { type: 'Control', scope: '#/properties/host' },
  ],
}

const dataA = ref<Record<string, any>>({ protocol: 'https', host: 'localhost' })
const dataB = ref<Record<string, any>>({ protocol: 'https', host: 'localhost' })

function patch(target: 'a' | 'b') {
  const next = { protocol: 'wss', host: 'patched.example.com' }
  if (target === 'a') dataA.value = { ...dataA.value, ...next }
  else dataB.value = { ...dataB.value, ...next }
}

function reset() {
  dataA.value = { protocol: 'https', host: 'localhost' }
  dataB.value = { protocol: 'https', host: 'localhost' }
}
</script>

<template>
  <div class="page-head">
    <h1>Debug Enum</h1>
    <p>
      Same schema, same renderer set, one difference: on the left the protocol control carries
      <code>x-inflow-ui</code> and is wrapped by <code>InflowControlRenderer</code>; on the right it
      is a plain vanilla enum. The two panels must stay identical in behaviour. Change a select by
      hand, then patch the data from outside — if a <code>&lt;select&gt;</code> ever stops showing
      the value beneath it, that is the bug this page exists to catch.
    </p>
  </div>

  <div class="card">
    <div class="row">
      <button class="btn primary" id="patchA" @click="patch('a')">Patch A → wss</button>
      <button class="btn primary" id="patchB" @click="patch('b')">Patch B → wss</button>
      <button class="btn" @click="reset">Reset both</button>
    </div>
    <p class="hint" style="margin: 10px 0 0">
      Root cause when this last broke: JSON Forms holds the renderers array in a
      <code>reactive()</code> context, so an un-<code>markRaw</code>ed component gets Proxy-wrapped,
      its identity churns, and reflection dies. See <code>src/lab/renderers.ts</code>.
    </p>
  </div>

  <div class="grid-2">
    <div class="card">
      <div class="card-title">
        A — wrapped
        <span class="badge accent">x-inflow-ui</span>
      </div>
      <JsonForms
        :data="dataA"
        :schema="schema"
        :uischema="uiWrapped"
        :renderers="renderers"
        @change="(e: any) => (dataA = e.data)"
      />
      <pre class="json" id="dataA">{{ JSON.stringify(dataA, null, 2) }}</pre>
    </div>

    <div class="card">
      <div class="card-title">
        B — plain
        <span class="badge">vanilla</span>
      </div>
      <JsonForms
        :data="dataB"
        :schema="schema"
        :uischema="uiPlain"
        :renderers="renderers"
        @change="(e: any) => (dataB = e.data)"
      />
      <pre class="json" id="dataB">{{ JSON.stringify(dataB, null, 2) }}</pre>
    </div>
  </div>
</template>
