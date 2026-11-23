<script setup>
/**
 * 形态开关：双形态皮肤（同一皮肤有 L2D 与 spine 两套资源）的 L2D/ANI 切换胶囊，
 * 对齐游戏内同款控件；仅双形态条目渲染（父层 v-if 控制）。
 */
defineProps({
  /** 当前形态：'l2d' | 'ani' */
  form: { type: String, required: true },
  /** 切换过渡进行中禁点 */
  switching: { type: Boolean, default: false },
})

const emit = defineEmits(['change'])
</script>

<template>
  <div class="form-toggle" :class="{ switching }" role="radiogroup" aria-label="皮肤形态">
    <button class="seg" :class="{ on: form === 'l2d' }" type="button" role="radio" :aria-checked="form === 'l2d'"
      title="Live2D 形态" @click="emit('change', 'l2d')">
      L2D
    </button>
    <button class="seg" :class="{ on: form === 'ani' }" type="button" role="radio" :aria-checked="form === 'ani'"
      title="Ani（spine）形态" @click="emit('change', 'ani')">
      ANI
    </button>
  </div>
</template>

<style scoped>
/* 骑在舞台右上角的胶囊：暗底两段式，选中段亮色填充，主题对齐 SkinTab chips；层级低于调试面板（z:6），面板展开时被盖住 */
.form-toggle {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 5;
  display: flex;
  padding: 3px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  background: rgba(16, 16, 20, 0.72);
  backdrop-filter: blur(12px);
  user-select: none;
}

.form-toggle.switching {
  pointer-events: none;
  opacity: 0.6;
}

.seg {
  min-width: 56px;
  padding: 6px 12px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #a8a8b2;
  font: 700 13px/1.4 system-ui, sans-serif;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.seg:hover {
  color: #e8e8ee;
}

/* 选中段：主题色实底 + 深色文字（对齐 SkinTab chip.on） */
.seg.on {
  background: #4fc08d;
  color: #0e2016;
}
</style>
