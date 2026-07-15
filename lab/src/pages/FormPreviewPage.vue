<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { JsonForms } from '@jsonforms/vue'
import { renderers } from '../lab/renderers'
import { samples, buildDefaults, type Sample } from '../lab/samples'
import { actionLog, clearActionLog } from '../lab/actionLog'

const sampleId = ref(samples[0].id)
const sample = computed<Sample>(() => samples.find((s) => s.id === sampleId.value) ?? samples[0])

const schemaJson = ref('')
const uiJson = ref('')
const data = ref<Record<string, any>>({})

// The preview renders the last *parsable* pair, not the raw text — otherwise
// every keystroke mid-edit blows the form away and you cannot see what you are
// doing. The badges say whether what you are looking at is current.
const liveSchema = ref<any>({})
const liveUi = ref<any>({})

const schemaError = ref<string | null>(null)
const uiError = ref<string | null>(null)

function loadSample(s: Sample) {
  schemaJson.value = JSON.stringify(s.schema, null, 2)
  uiJson.value = JSON.stringify(s.ui, null, 2)
  liveSchema.value = s.schema
  liveUi.value = s.ui
  schemaError.value = null
  uiError.value = null
  reseed()
}

function reseed() {
  data.value = buildDefaults(liveSchema.value) ?? {}
}

watch(sample, loadSample, { immediate: true })

watch(schemaJson, (text) => {
  try {
    liveSchema.value = JSON.parse(text)
    schemaError.value = null
  } catch (e) {
    schemaError.value = e instanceof Error ? e.message : 'Invalid JSON'
  }
})

watch(uiJson, (text) => {
  try {
    liveUi.value = JSON.parse(text)
    uiError.value = null
  } catch (e) {
    uiError.value = e instanceof Error ? e.message : 'Invalid JSON'
  }
})

function onChange(event: any) {
  data.value = event.data
}

function time(at: number) {
  return new Date(at).toLocaleTimeString()
}
</script>

<template>
  <div class="page-head">
    <h1>Form Preview</h1>
    <p>
      An extension's <code>params.schema</code> and <code>params.ui</code>, rendered the way the
      inspector renders them: JSON Forms plus the <code>x-inflow-ui</code> renderers. Edit either
      side and the form follows. Fields without <code>x-inflow-ui</code> fall through to the vanilla
      renderer set untouched — that is the whole opt-in design, visible here.
    </p>
  </div>

  <div class="card">
    <div class="row">
      <select v-model="sampleId" class="lab-select">
        <option v-for="s in samples" :key="s.id" :value="s.id">{{ s.label }}</option>
      </select>
      <button class="btn" @click="loadSample(sample)">Reset to sample</button>
      <button class="btn" @click="reseed">Reseed data from defaults</button>
    </div>
    <p class="hint" style="margin: 10px 0 0">{{ sample.about }}</p>
  </div>

  <div class="grid-2">
    <div class="card">
      <div class="card-title">
        JSON Schema
        <span v-if="schemaError" class="badge err">{{ schemaError }}</span>
        <span v-else class="badge ok">valid</span>
      </div>
      <textarea v-model="schemaJson" class="editor" spellcheck="false"></textarea>
    </div>

    <div class="card">
      <div class="card-title">
        UI Schema
        <span v-if="uiError" class="badge err">{{ uiError }}</span>
        <span v-else class="badge ok">valid</span>
      </div>
      <textarea v-model="uiJson" class="editor" spellcheck="false"></textarea>
    </div>
  </div>

  <div class="grid-2">
    <div class="card">
      <div class="card-title">Preview</div>
      <JsonForms
        :data="data"
        :schema="liveSchema"
        :uischema="liveUi"
        :renderers="renderers"
        @change="onChange"
      />
    </div>

    <div>
      <div class="card">
        <div class="card-title">Form data</div>
        <pre class="json">{{ JSON.stringify(data, null, 2) }}</pre>
      </div>

      <div class="card">
        <div class="card-title">
          Action log
          <span class="badge accent">{{ actionLog.length }}</span>
          <span class="spacer"></span>
          <button class="btn" :disabled="!actionLog.length" @click="clearActionLog">Clear</button>
        </div>
        <p class="hint" style="margin-bottom: 10px">
          Every action the registry ran, what it saw in <code>ctx.data</code>, and the patch it sent
          to <code>updateData</code>. Effects only ever travel through that patch — the action
          contract returns <code>void</code>.
        </p>
        <div v-if="!actionLog.length" class="empty">Nothing fired yet. Press a button.</div>
        <div v-else class="scroll-y">
          <table class="lab-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Saw</th>
                <th>Wrote</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in actionLog" :key="entry.id">
                <td class="mono">{{ time(entry.at) }}</td>
                <td>
                  <span class="badge accent">{{ entry.action }}</span>
                  <div class="hint mono">{{ entry.path || '(root)' }}</div>
                  <div v-if="entry.note" class="hint">{{ entry.note }}</div>
                </td>
                <td class="mono">{{ entry.saw === undefined ? '—' : JSON.stringify(entry.saw) }}</td>
                <td class="mono">{{ entry.wrote ? JSON.stringify(entry.wrote) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
