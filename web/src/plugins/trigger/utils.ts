import { Comment, Fragment, Text, isVNode, type VNode } from 'vue';
import type { Placement } from '@floating-ui/dom';
import type { TriggerPosition } from './types';

const positions: Partial<Record<TriggerPosition, Placement>> = {
  tl: 'top-start',
  tr: 'top-end',
  bl: 'bottom-start',
  br: 'bottom-end',
  lt: 'left-start',
  lb: 'left-end',
  rt: 'right-start',
  rb: 'right-end',
};

export function toPlacement(position: TriggerPosition): Placement {
  return positions[position] ?? (position as Placement);
}

export function toTriggerPosition(placement: Placement): TriggerPosition {
  return (
    (Object.keys(positions) as TriggerPosition[]).find((key) => positions[key] === placement) ??
    placement
  );
}

/** Flatten fragments without throwing away the user's other slot nodes. */
export function flattenChildren(nodes: VNode[]): VNode[] {
  return nodes.flatMap((node) =>
    node.type === Fragment && Array.isArray(node.children)
      ? flattenChildren(node.children.filter(isVNode))
      : [node]
  );
}

export function hasContent(nodes: VNode[]) {
  return flattenChildren(nodes).some(
    (node) =>
      node.type !== Comment && !(node.type === Text && String(node.children ?? '').trim() === '')
  );
}
