import type { Placement, Strategy } from '@floating-ui/dom';
import type { CSSProperties, HTMLAttributes, VNode } from 'vue';

export type TriggerEvent = 'hover' | 'click' | 'focus' | 'contextMenu';
export type TriggerPosition = Placement | 'tl' | 'tr' | 'bl' | 'br' | 'lt' | 'lb' | 'rt' | 'rb';
export type TriggerPopupTranslate =
  [number, number] | Partial<Record<TriggerPosition, [number, number]>>;

export interface VoexTriggerProps {
  popupVisible?: boolean;
  defaultPopupVisible?: boolean;
  trigger?: TriggerEvent | TriggerEvent[];
  fallbackTrigger?: 'click';
  position?: TriggerPosition;
  strategy?: Strategy;
  disabled?: boolean;
  popupOffset?: number;
  popupTranslate?: TriggerPopupTranslate;
  showArrow?: boolean;
  alignPoint?: boolean;
  popupHoverStay?: boolean;
  blurToClose?: boolean;
  clickToClose?: boolean;
  clickOutsideToClose?: boolean;
  escapeToClose?: boolean;
  unmountOnClose?: boolean;
  contentClass?: HTMLAttributes['class'];
  wrapClass?: HTMLAttributes['class'];
  arrowClass?: HTMLAttributes['class'];
  openedClass?: HTMLAttributes['class'];
  contentStyle?: CSSProperties;
  arrowStyle?: CSSProperties;
  popupStyle?: CSSProperties;
  animationName?: string;
  duration?: number | { enter: number; leave: number };
  mouseEnterDelay?: number;
  mouseLeaveDelay?: number;
  focusDelay?: number;
  autoFitPopupWidth?: boolean;
  autoFitPopupMinWidth?: boolean;
  /** Observe trigger/content size and layout changes. Enabled by default. */
  autoFixPosition?: boolean;
  popupContainer?: string | HTMLElement;
  updateAtScroll?: boolean;
  autoFitTransformOrigin?: boolean;
  hideEmpty?: boolean;
  autoFitPosition?: boolean;
  renderToBody?: boolean;
  preventFocus?: boolean;
  popupZIndex?: number;
}

export interface TriggerSlotProps {
  visible: boolean;
  show: () => void;
  hide: () => void;
  update: () => Promise<unknown>;
}

export interface TriggerSlots {
  default?: (props: TriggerSlotProps) => VNode[];
  content?: (props: TriggerSlotProps) => VNode[];
}
