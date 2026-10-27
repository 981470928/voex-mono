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
  /** Plain text; the content slot takes precedence. */
  content?: string | number;
  /** Numbers are CSS pixels; strings accept CSS lengths. */
  maxWidth?: number | string;
}

export type TooltipSlots = TriggerSlots;
