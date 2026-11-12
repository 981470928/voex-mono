import type { VoexTriggerProps, TriggerSlots } from '../trigger/types';

export interface VoexTooltipProps extends Pick<
  VoexTriggerProps,
  | 'popupVisible'
  | 'defaultPopupVisible'
  | 'position'
  | 'disabled'
  | 'showArrow'
  | 'popupOffset'
  | 'mouseEnterDelay'
  | 'mouseLeaveDelay'
  | 'focusDelay'
  | 'popupContainer'
  | 'renderToBody'
  | 'popupZIndex'
  | 'strategy'
> {
  /** Plain text; the content slot takes precedence. / 纯文本内容；content 插槽优先。 */
  content?: string | number;
  /** Numbers are CSS pixels; strings accept CSS lengths. / 数值表示 CSS 像素；字符串支持 CSS 长度值。 */
  maxWidth?: number | string;
}

export type TooltipSlots = TriggerSlots;
