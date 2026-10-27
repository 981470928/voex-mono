export interface ContextMenuOption {
  value: string;
  label: string;
  icon?: string;
  description?: string;
  disabled?: boolean;
  danger?: boolean;
  children?: ContextMenuItem[];
  separator?: false;
}

export type ContextMenuItem = ContextMenuOption | { separator: true };
