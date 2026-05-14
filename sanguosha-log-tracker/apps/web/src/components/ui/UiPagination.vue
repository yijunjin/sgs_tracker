<script setup lang="ts">
import { computed } from "vue"

const props = withDefaults(
  defineProps<{
    page: number
    pageSize?: number
    pageSizeOptions?: number[]
    total: number
  }>(),
  {
    pageSize: 10,
    pageSizeOptions: () => [10, 20, 50]
  }
)

const emit = defineEmits<{
  (event: "update:page", value: number): void
  (event: "update:pageSize", value: number): void
}>()

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
const currentPage = computed(() => Math.min(Math.max(1, props.page), totalPages.value))

function goToPage(page: number): void {
  emit("update:page", Math.min(Math.max(1, page), totalPages.value))
}

function changePageSize(value: string): void {
  emit("update:pageSize", Number(value))
  emit("update:page", 1)
}
</script>

<template>
  <div class="ui-pagination">
    <span class="ui-pagination-total">共 {{ total }} 条</span>
    <button class="ui-page-button" type="button" :disabled="currentPage <= 1" @click="goToPage(currentPage - 1)">
      ‹
    </button>
    <span class="ui-page-current">{{ currentPage }}</span>
    <span class="ui-page-count">/ {{ totalPages }}</span>
    <button class="ui-page-button" type="button" :disabled="currentPage >= totalPages" @click="goToPage(currentPage + 1)">
      ›
    </button>
    <select class="ui-page-size" :value="pageSize" @change="changePageSize(($event.target as HTMLSelectElement).value)">
      <option v-for="option in pageSizeOptions" :key="option" :value="option">{{ option }} 条/页</option>
    </select>
  </div>
</template>
