import { onMounted, onUnmounted, ref, type Ref } from 'vue'

/** 手机/小屏断点，与样式里的 @media (max-width: 640px) 保持一致 */
const MOBILE_QUERY = '(max-width: 640px)'
/** 矮屏断点（含手机横屏），与样式里的 @media (max-height: 500px) 保持一致 */
const SHORT_QUERY = '(max-height: 500px)'

function useMedia(query: string): Ref<boolean> {
  const match = ref(false)
  let mq: MediaQueryList | null = null
  const onChange = (e: MediaQueryListEvent): void => {
    match.value = e.matches
  }
  onMounted(() => {
    mq = window.matchMedia(query)
    match.value = mq.matches
    mq.addEventListener('change', onChange)
  })
  onUnmounted(() => {
    mq?.removeEventListener('change', onChange)
  })
  return match
}

/**
 * 是否移动端（视口 ≤640px）。监听断点变化，组件卸载时自动清理。
 * 仅在纯 CSS 无法覆盖的场合使用（如手牌重叠公式）。
 */
export function useIsMobile(): Ref<boolean> {
  return useMedia(MOBILE_QUERY)
}

/** 是否矮屏（视口高 ≤500px，典型为手机横屏） */
export function useIsShort(): Ref<boolean> {
  return useMedia(SHORT_QUERY)
}
