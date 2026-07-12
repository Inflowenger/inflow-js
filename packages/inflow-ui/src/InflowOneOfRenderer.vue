<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  rendererProps,
  useJsonFormsOneOfControl,
  DispatchRenderer,
} from '@jsonforms/vue'
import {
  createCombinatorRenderInfos,
  createDefaultValue,
} from '@jsonforms/core'
import type {
  ControlElement,
} from '@jsonforms/core'

const props = defineProps(rendererProps<ControlElement>())

const { control, handleChange } = useJsonFormsOneOfControl(props)

const selectedIndex = ref(control.value.indexOfFittingSchema)
const selectIndex = ref(selectedIndex.value)

const indexedOneOfRenderInfos = computed(() => {
  const result = createCombinatorRenderInfos(
    control.value.schema.oneOf!,
    control.value.rootSchema,
    'oneOf',
    control.value.uischema,
    control.value.path,
    control.value.uischemas
  )
  return result
    .filter((info) => info.uischema)
    .map((info, index) => ({ ...info, index }))
})

function handleSelectChange(event: Event) {
  const target = event.target as HTMLSelectElement
  const newIndex = parseInt(target.value, 10)

  selectIndex.value = newIndex

  // Switch immediately without confirmation dialog
  handleChange(
    control.value.path,
    createDefaultValue(
      indexedOneOfRenderInfos.value[newIndex].schema,
      control.value.rootSchema
    )
  )
  selectedIndex.value = newIndex
}
</script>

<template>
  <div v-if="control.visible" class="inflow-oneof">
    <!-- Combinator properties (shared fields across oneOf options) -->
    <DispatchRenderer
      :schema="control.schema"
      :uischema="{
        type: 'VerticalLayout',
        elements: []
      }"
      :path="path"
      :enabled="control.enabled"
      :renderers="control.renderers"
      :cells="control.cells"
    />

    <div class="inflow-oneof-control">
      <label v-if="control.label" class="inflow-oneof-label">
        {{ control.label }}
        <span v-if="control.required" class="inflow-required">*</span>
      </label>

      <select
        :id="control.id + '-input'"
        class="inflow-oneof-select"
        :value="selectedIndex"
        :disabled="!control.enabled"
        @change="handleSelectChange"
      >
        <option
          v-for="optionElement in indexedOneOfRenderInfos"
          :key="optionElement.index"
          :value="optionElement.index"
          :label="optionElement.label"
        ></option>
      </select>

      <div v-if="control.errors" class="inflow-oneof-error">
        {{ control.errors }}
      </div>
    </div>

    <!-- Render the selected oneOf sub-schema -->
    <DispatchRenderer
      v-if="selectedIndex !== undefined && selectedIndex !== null"
      :schema="indexedOneOfRenderInfos[selectedIndex].schema"
      :uischema="indexedOneOfRenderInfos[selectedIndex].uischema"
      :path="control.path"
      :renderers="control.renderers"
      :cells="control.cells"
      :enabled="control.enabled"
    />
  </div>
</template>
