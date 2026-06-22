<script setup lang="ts">
import { ChevronDown, ChevronRight, Edit3, Plus, Save, Trash2 } from "lucide-vue-next"
import { computed, reactive, ref } from "vue"
import type { GameEventName, RuleAction, RuleCondition, RuleDefinition, RuleOperator } from "@slt/shared"

// 规则配置面板：把“用户能理解的表单字段”转换成 shared/ruleEngine 能执行的 RuleDefinition。
// 这里不直接修改 localStorage，也不直接刷新 rule library；保存/启停/删除都通过 emit 交给 content.ts。
const props = defineProps<{
  systemRules: RuleDefinition[]
  customRules: RuleDefinition[]
  error: string
}>()

const emit = defineEmits<{
  saveRule: [rule: RuleDefinition]
  toggleRule: [ruleId: string, enabled: boolean]
  removeRule: [ruleId: string]
}>()

// 表单态比 RuleDefinition 更扁平，因为 UI 每次只编辑一个触发事件、一个附加条件和一个动作。
// 提交时再由 buildCondition()/buildAction() 拼回规则引擎的结构。
type RuleForm = {
  id: string
  description: string
  enabled: boolean
  priority: number
  eventName: GameEventName
  conditionEnabled: boolean
  conditionPath: string
  conditionOp: RuleOperator
  conditionValue: string
  actionType: "emitTrackerEvent" | "decrementDrawPile" | "markCardVisible" | "moveCardZone"
  trackerAction: string
  cardRole: "card" | "fromCard" | "toCard"
  amount: number
  reason: string
  note: string
  visibility: string
  zone: string
}

// 下拉项使用显式 label，避免把内部事件名/字段路径暴露给普通使用者。
const eventOptions: Array<{ value: GameEventName; label: string }> = [
  { value: "OnSkillInvoke", label: "技能发动" },
  { value: "OnCardGain", label: "获得牌" },
  { value: "OnCardConvert", label: "转化牌" },
  { value: "OnCardUse", label: "使用牌" },
  { value: "OnCardPlay", label: "打出牌" },
  { value: "OnCardDiscard", label: "弃置牌" },
  { value: "OnCardEquip", label: "装备牌" },
  { value: "OnJudgeResult", label: "判定结果" },
  { value: "OnCardDraw", label: "暗摸牌" }
]

const pathOptions = [
  { value: "event.skill", label: "技能名" },
  { value: "event.player", label: "玩家" },
  { value: "event.gainSource", label: "获得来源" },
  { value: "event.card.name", label: "牌名" },
  { value: "event.fromCard.name", label: "原始牌" },
  { value: "event.toCard.name", label: "视为牌" },
  { value: "event.sourceZone", label: "来源区域" }
]

const operatorOptions: Array<{ value: RuleOperator; label: string }> = [
  { value: "==", label: "等于" },
  { value: "!=", label: "不等于" },
  { value: "contains", label: "包含" },
  { value: "in", label: "属于列表" },
  { value: "exists", label: "存在" }
]

const trackerActionOptions = [
  { value: "use", label: "使用" },
  { value: "play", label: "打出" },
  { value: "discard", label: "弃置" },
  { value: "equip", label: "装备" },
  { value: "judge", label: "判定" },
  { value: "gainKnown", label: "已知手牌获得" },
  { value: "ignore", label: "忽略" }
]

const form = reactive<RuleForm>(createEmptyForm())
const openIds = ref<Record<string, boolean>>({})
const editingExistingId = ref<string>("")

const systemCount = computed(() => props.systemRules.length)
const customCount = computed(() => props.customRules.length)
const editorTitle = computed(() => (editingExistingId.value ? "编辑规则" : "新增规则"))

// 默认给一个“集智扣一张牌堆”的模板，原因是这类规则最常见，
// 用户新增时能直接看懂字段之间的关系，再改成自己的技能。
function createEmptyForm(): RuleForm {
  return {
    id: `custom-${Date.now().toString(36)}`,
    description: "",
    enabled: true,
    priority: 10,
    eventName: "OnSkillInvoke",
    conditionEnabled: true,
    conditionPath: "event.skill",
    conditionOp: "==",
    conditionValue: "集智",
    actionType: "decrementDrawPile",
    trackerAction: "use",
    cardRole: "card",
    amount: 1,
    reason: "{{event.player}}发动{{event.skill}}",
    note: "",
    visibility: "owner-visible",
    zone: "hand"
  }
}

function assignForm(next: RuleForm): void {
  Object.assign(form, next)
}

function resetForm(): void {
  editingExistingId.value = ""
  assignForm(createEmptyForm())
}

function toggle(ruleId: string): void {
  openIds.value = {
    ...openIds.value,
    [ruleId]: !openIds.value[ruleId]
  }
}

// 条件值在表单里永远是字符串；提交给规则引擎前需要按操作符转成：
// - exists：不需要 value；
// - in：逗号分隔数组；
// - 纯数字：number；
// - 其他：原字符串。
function parseConditionValue(formValue: RuleForm): string | string[] | number | boolean | undefined {
  if (formValue.conditionOp === "exists") {
    return undefined
  }
  if (formValue.conditionOp === "in") {
    return formValue.conditionValue
      .split(/[，,]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  const numeric = Number(formValue.conditionValue)
  return formValue.conditionValue.trim() !== "" && Number.isFinite(numeric) ? numeric : formValue.conditionValue.trim()
}

// 所有自定义规则都至少限定 event.event，否则会对任意事件生效。
// 如果用户勾选“附加条件”，再用 all 把事件类型条件和字段条件组合起来。
function buildCondition(): RuleCondition {
  const eventCondition: RuleCondition = {
    path: "event.event",
    op: "==",
    value: form.eventName
  }
  if (!form.conditionEnabled || !form.conditionPath) {
    return eventCondition
  }
  const extra: RuleCondition = {
    path: form.conditionPath,
    op: form.conditionOp,
    value: parseConditionValue(form)
  }
  return {
    all: [eventCondition, extra]
  }
}

// 把 UI 选择的动作类型转成规则引擎动作。
// params 里以 "$event.xxx" 开头的值不是普通字符串，而是规则执行时从事件对象取值的占位符。
function buildAction(): RuleAction {
  if (form.actionType === "decrementDrawPile") {
    return {
      type: "decrementDrawPile",
      params: {
        amount: Math.max(1, Math.floor(Number(form.amount) || 1)),
        reason: form.reason || "{{event.player}}触发规则"
      }
    }
  }
  if (form.actionType === "markCardVisible") {
    return {
      type: "markCardVisible",
      params: {
        owner: "$event.player",
        zone: form.zone,
        visibility: form.visibility,
        cards: "$event.cards"
      }
    }
  }
  if (form.actionType === "moveCardZone") {
    return {
      type: "moveCardZone",
      params: {
        fromPlayer: "$event.sourcePlayer",
        toPlayer: "$event.player",
        fromZone: "$event.sourceZone",
        toZone: form.zone,
        cards: "$event.cards"
      }
    }
  }
  return {
    type: "emitTrackerEvent",
    params: {
      action: form.trackerAction,
      cardRole: form.cardRole,
      note: form.note
    }
  }
}

// submit 只负责发出 RuleDefinition。校验、去重、持久化由 content.ts 的 saveCustomRule 完成。
function submitRule(): void {
  emit("saveRule", {
    id: form.id.trim(),
    description: form.description.trim() || undefined,
    enabled: form.enabled,
    priority: Math.trunc(Number(form.priority) || 0),
    when: buildCondition(),
    actions: [buildAction()]
  })
}

// 下面几个函数用于把已保存的 RuleDefinition 反解回表单。
// 当前 UI 支持的规则是“一事件 + 一附加条件 + 一动作”的简单形态；
// 更复杂的 all/any/not 会尽量取第一个可编辑条件展示。
function findCondition(condition: RuleCondition | undefined, path: string): RuleCondition | undefined {
  if (!condition) return undefined
  if ("path" in condition && condition.path === path) return condition
  if ("all" in condition) return condition.all.map((item) => findCondition(item, path)).find(Boolean)
  if ("any" in condition) return condition.any.map((item) => findCondition(item, path)).find(Boolean)
  return undefined
}

function isLeafCondition(condition: RuleCondition | undefined): condition is Extract<RuleCondition, { path: string }> {
  return Boolean(condition && "path" in condition)
}

function firstNonEventCondition(condition: RuleCondition | undefined): RuleCondition | undefined {
  if (!condition) return undefined
  if ("path" in condition) return condition.path === "event.event" ? undefined : condition
  if ("all" in condition) return condition.all.map(firstNonEventCondition).find(Boolean)
  if ("any" in condition) return condition.any.map(firstNonEventCondition).find(Boolean)
  return undefined
}

function valueToText(value: unknown): string {
  return Array.isArray(value) ? value.join(",") : value === undefined || value === null ? "" : String(value)
}

function editRule(rule: RuleDefinition): void {
  const eventCondition = findCondition(rule.when, "event.event")
  const extraCondition = firstNonEventCondition(rule.when)
  const action = rule.actions[0]
  const params = action?.params ?? {}
  editingExistingId.value = rule.id
  assignForm({
    ...createEmptyForm(),
    id: rule.id,
    description: rule.description ?? "",
    enabled: rule.enabled !== false,
    priority: rule.priority ?? 0,
    eventName: (isLeafCondition(eventCondition) ? eventCondition.value : undefined) as GameEventName | undefined ?? "OnSkillInvoke",
    conditionEnabled: isLeafCondition(extraCondition),
    conditionPath: isLeafCondition(extraCondition) ? extraCondition.path : "event.skill",
    conditionOp: isLeafCondition(extraCondition) ? extraCondition.op : "==",
    conditionValue: isLeafCondition(extraCondition) ? valueToText(extraCondition.value) : "",
    actionType: (action?.type as RuleForm["actionType"] | undefined) ?? "decrementDrawPile",
    trackerAction: typeof params.action === "string" ? params.action : "use",
    cardRole: params.cardRole === "fromCard" || params.cardRole === "toCard" ? params.cardRole : "card",
    amount: Number(params.amount ?? 1),
    reason: typeof params.reason === "string" ? params.reason : "{{event.player}}发动{{event.skill}}",
    note: typeof params.note === "string" ? params.note : "",
    visibility: typeof params.visibility === "string" ? params.visibility : "owner-visible",
    zone: typeof params.zone === "string" ? params.zone : "hand"
  })
}

// 规则详情里的可读文案。这里不影响规则执行，只帮助用户确认配置内容。
function pathLabel(path: string): string {
  return pathOptions.find((item) => item.value === path)?.label ?? path
}

function eventLabel(eventName: unknown): string {
  return eventOptions.find((item) => item.value === eventName)?.label ?? String(eventName ?? "任意事件")
}

function opLabel(op: unknown): string {
  return operatorOptions.find((item) => item.value === op)?.label ?? String(op ?? "")
}

function describeCondition(condition: RuleCondition | undefined): string {
  if (!condition) return "无条件"
  if ("all" in condition) return condition.all.map(describeCondition).join(" 且 ")
  if ("any" in condition) return condition.any.map(describeCondition).join(" 或 ")
  if ("not" in condition) return `非 ${describeCondition(condition.not)}`
  if (condition.path === "event.event") return `事件为 ${eventLabel(condition.value)}`
  if (condition.op === "exists") return `${pathLabel(condition.path)} 存在`
  return `${pathLabel(condition.path)} ${opLabel(condition.op)} ${valueToText(condition.value)}`
}

function describePriority(rule: RuleDefinition): string {
  return `优先级 ${rule.priority ?? 0}`
}

function describeAction(action: RuleAction): string {
  const params = action.params ?? {}
  if (action.type === "decrementDrawPile") return `扣减牌堆 ${params.amount ?? 1} 张`
  if (action.type === "markCardVisible") return `标记 ${params.zone ?? "hand"} 可见牌`
  if (action.type === "moveCardZone") return `移动牌区到 ${params.toZone ?? params.zone ?? "hand"}`
  if (action.type === "emitTrackerEvent") return `投影为 ${params.action ?? "unknown"} 记牌事件`
  return action.type
}
</script>

<template>
  <section class="sgs-rule-config" aria-label="规则配置">
    <div class="sgs-rule-summary">
      <div>
        <strong>系统规则</strong>
        <span>{{ systemCount }}</span>
      </div>
      <div>
        <strong>自定义规则</strong>
        <span>{{ customCount }}</span>
      </div>
    </div>

    <div class="sgs-rule-block">
      <div class="sgs-rule-block-head">
        <h3>{{ editorTitle }}</h3>
        <button type="button" title="保存规则" @click="submitRule">
          <Save class="sgs-icon" aria-hidden="true" />
          保存
        </button>
      </div>

      <div class="sgs-rule-form">
        <label>
          <span>规则标识</span>
          <input v-model.trim="form.id" type="text" :disabled="Boolean(editingExistingId)" />
        </label>
        <label>
          <span>说明</span>
          <input v-model.trim="form.description" type="text" />
        </label>
        <label class="sgs-rule-check">
          <input v-model="form.enabled" type="checkbox" />
          <span>启用规则</span>
        </label>
        <label>
          <span>优先级</span>
          <input v-model.number="form.priority" type="number" />
        </label>
        <label>
          <span>触发事件</span>
          <select v-model="form.eventName">
            <option v-for="option in eventOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>

        <div class="sgs-rule-subgrid">
          <label class="sgs-rule-check">
            <input v-model="form.conditionEnabled" type="checkbox" />
            <span>附加条件</span>
          </label>
          <label>
            <span>字段</span>
            <select v-model="form.conditionPath" :disabled="!form.conditionEnabled">
              <option v-for="option in pathOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
          <label>
            <span>关系</span>
            <select v-model="form.conditionOp" :disabled="!form.conditionEnabled">
              <option v-for="option in operatorOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
          <label>
            <span>值</span>
            <input v-model.trim="form.conditionValue" type="text" :disabled="!form.conditionEnabled || form.conditionOp === 'exists'" />
          </label>
        </div>

        <label>
          <span>执行动作</span>
          <select v-model="form.actionType">
            <option value="decrementDrawPile">扣减牌堆</option>
            <option value="emitTrackerEvent">生成记牌事件</option>
            <option value="markCardVisible">标记可见牌</option>
            <option value="moveCardZone">移动牌区</option>
          </select>
        </label>

        <template v-if="form.actionType === 'decrementDrawPile'">
          <label>
            <span>扣减张数</span>
            <input v-model.number="form.amount" min="1" type="number" />
          </label>
          <label>
            <span>来源备注</span>
            <input v-model.trim="form.reason" type="text" />
          </label>
        </template>

        <template v-else-if="form.actionType === 'emitTrackerEvent'">
          <label>
            <span>记牌动作</span>
            <select v-model="form.trackerAction">
              <option v-for="option in trackerActionOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
          <label>
            <span>牌来源</span>
            <select v-model="form.cardRole">
              <option value="card">当前牌</option>
              <option value="fromCard">转化原始牌</option>
              <option value="toCard">转化目标牌</option>
            </select>
          </label>
          <label>
            <span>备注</span>
            <input v-model.trim="form.note" type="text" />
          </label>
        </template>

        <template v-else>
          <label>
            <span>目标区域</span>
            <select v-model="form.zone">
              <option value="hand">手牌</option>
              <option value="equip">装备区</option>
              <option value="judge">判定区</option>
              <option value="judge-area">判定区（场上）</option>
              <option value="skill-pile">武将牌上</option>
              <option value="public">公共区</option>
            </select>
          </label>
          <label v-if="form.actionType === 'markCardVisible'">
            <span>可见类型</span>
            <input v-model.trim="form.visibility" type="text" />
          </label>
        </template>

        <p v-if="error" class="sgs-rule-error">{{ error }}</p>
        <button type="button" class="sgs-rule-secondary" title="清空编辑器" @click="resetForm">
          <Plus class="sgs-icon" aria-hidden="true" />
          新建
        </button>
      </div>
    </div>

    <div v-if="customRules.length" class="sgs-rule-block">
      <div class="sgs-rule-block-head">
        <h3>自定义规则</h3>
      </div>
      <div v-for="rule in customRules" :key="rule.id" class="sgs-rule-item">
        <button type="button" class="sgs-rule-row" :title="rule.description || rule.id" @click="toggle(rule.id)">
          <ChevronDown v-if="openIds[rule.id]" class="sgs-icon" aria-hidden="true" />
          <ChevronRight v-else class="sgs-icon" aria-hidden="true" />
          <span>{{ rule.id }}</span>
          <b>{{ rule.enabled === false ? "off" : "on" }}</b>
        </button>
        <div class="sgs-rule-actions">
          <button type="button" :title="rule.enabled === false ? '启用规则' : '停用规则'" @click="emit('toggleRule', rule.id, rule.enabled === false)">
            {{ rule.enabled === false ? "开" : "关" }}
          </button>
          <button type="button" title="编辑规则" @click="editRule(rule)">
            <Edit3 class="sgs-icon" aria-hidden="true" />
          </button>
          <button type="button" title="删除规则" @click="emit('removeRule', rule.id)">
            <Trash2 class="sgs-icon" aria-hidden="true" />
          </button>
        </div>
        <div v-if="openIds[rule.id]" class="sgs-rule-detail">
          <p>{{ rule.description || "无说明" }}</p>
          <dl>
            <dt>优先级</dt>
            <dd>{{ describePriority(rule) }}</dd>
            <dt>条件</dt>
            <dd>{{ describeCondition(rule.when) }}</dd>
            <dt>动作</dt>
            <dd>{{ rule.actions.map(describeAction).join("；") }}</dd>
          </dl>
        </div>
      </div>
    </div>

    <div class="sgs-rule-block">
      <div class="sgs-rule-block-head">
        <h3>系统规则</h3>
      </div>
      <div v-for="rule in systemRules" :key="rule.id" class="sgs-rule-item">
        <button type="button" class="sgs-rule-row" :title="rule.description || rule.id" @click="toggle(rule.id)">
          <ChevronDown v-if="openIds[rule.id]" class="sgs-icon" aria-hidden="true" />
          <ChevronRight v-else class="sgs-icon" aria-hidden="true" />
          <span>{{ rule.id }}</span>
          <b>{{ rule.enabled === false ? "off" : "on" }}</b>
        </button>
        <div v-if="openIds[rule.id]" class="sgs-rule-detail">
          <p>{{ rule.description || "无说明" }}</p>
          <dl>
            <dt>优先级</dt>
            <dd>{{ describePriority(rule) }}</dd>
            <dt>条件</dt>
            <dd>{{ describeCondition(rule.when) }}</dd>
            <dt>动作</dt>
            <dd>{{ rule.actions.map(describeAction).join("；") }}</dd>
          </dl>
        </div>
      </div>
    </div>
  </section>
</template>
