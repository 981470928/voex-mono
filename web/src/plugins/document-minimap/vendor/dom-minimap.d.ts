export interface DomMinimapOptions {
  content: HTMLElement;
  host: HTMLElement;
  scrollElement: HTMLElement;
  width?: number;
  enabled?: boolean;
  managed?: boolean;
  position?: 'fixed' | 'absolute';
  zIndex?: number;
  background?: string;
  borderColor?: string;
  sliderColor?: string;
  sliderHoverColor?: string;
  cloneNode?: (source: Node) => Node;
}
export interface DomMinimapInstance {
  readonly element: HTMLElement;
  refresh(): void;
  resize(): void;
  spliceChildren(start: number, removeCount: number, addCount: number): boolean;
  setEnabled(value: boolean): void;
  destroy(): void;
}
export function create(options: DomMinimapOptions): DomMinimapInstance;
