<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { rendererProps, useJsonFormsEnumControl } from '@jsonforms/vue'
import type { ControlElement } from '@jsonforms/core'

const props = defineProps(rendererProps<ControlElement>())
const { control, handleChange } = useJsonFormsEnumControl(props)

const selected = ref<string | number | boolean | undefined>(control.value.data)

watch(
  () => control.value.data,
  (val) => {
    selected.value = val
  }
)

const options = computed(() => control.value.options || [])

function onSelectChange() {
  handleChange(control.value.path, selected.value)
}
</script>

<template>
  <div v-if="control.visible" class="inflow-enum-control">
    <label v-if="control.label" :for="control.id + '-input'">
      {{ control.label }}
      <span v-if="control.required" class="inflow-required">*</span>
    </label>
    <select
      :id="control.id + '-input'"
      v-model="selected"
      class="inflow-select"
      :disabled="!control.enabled"
      @change="onSelectChange"
    >
      <option value=""></option>
      <option
        v-for="opt in options"
        :key="String(opt.value)"
        :value="opt.value"
        :label="opt.label"
      />
    </select>
    <div v-if="control.errors" class="inflow-error">
      {{ control.errors }}
    </div>
  </div>
</template>
