export interface MinimapPlaceholderRule {
  selector: string;
  kind: string;
}

const transientClasses =
  /^(?:ProseMirror-(?:focused|selectednode)|selectedCell|resize-cursor|milkdown-editor__image--(?:selected|resizing)|milkdown-attachment--selected)$/;

export function stableClassName(value: string | null): string {
  return (value ?? '')
    .split(/\s+/)
    .filter((name) => name && !transientClasses.test(name))
    .join(' ');
}

export function createMinimapCloner(options: {
  content: HTMLElement;
  placeholders: MinimapPlaceholderRule[];
  ignoreSelectors: string[];
  onPlaceholder: (element: Element, rect: DOMRect) => void;
}) {
  const { content, onPlaceholder } = options;
  const ignoreSelector = [
    'script',
    'style',
    'link',
    'template',
    '.dom-minimap',
    ...options.ignoreSelectors,
  ].join(',');
  const rules: MinimapPlaceholderRule[] = [
    ...options.placeholders,
    { selector: 'table', kind: 'table' },
    { selector: 'pre', kind: 'code' },
    { selector: 'img, svg, canvas, picture', kind: 'image' },
    { selector: 'video, audio, iframe, object, embed, input, textarea, select', kind: 'media' },
  ];

  function ignored(element: Element): boolean {
    const match = element.closest(ignoreSelector);
    return !!match && content.contains(match);
  }

  function placeholderRoot(element: Element): Element | null {
    let root: Element | null = null;
    for (
      let current: Element | null = element;
      current && current !== content;
      current = current.parentElement
    ) {
      if (rules.some((rule) => current!.matches(rule.selector))) root = current;
    }
    return root;
  }

  function placeholder(source: Element, kind: string): HTMLElement {
    const rect = source.getBoundingClientRect();
    const computed = window.getComputedStyle(source);
    const inline = computed.display.startsWith('inline');
    const clone = document.createElement(inline ? 'span' : 'div');
    clone.className = 'document-minimap-placeholder';
    clone.dataset.minimapPlaceholder = kind;
    clone.dataset.kind = kind;
    Object.assign(clone.style, {
      display: computed.display === 'none' ? 'none' : inline ? 'inline-block' : 'block',
      boxSizing: 'border-box',
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      marginTop: computed.marginTop,
      marginRight: computed.marginRight,
      marginBottom: computed.marginBottom,
      marginLeft: computed.marginLeft,
      verticalAlign: computed.verticalAlign,
      cssFloat: computed.cssFloat,
      clear: computed.clear,
      flex: computed.flex,
      gridArea: computed.gridArea,
    });
    onPlaceholder(source, rect);
    return clone;
  }

  function cloneNode(source: Node): Node {
    if (!(source instanceof Element)) return source.cloneNode(false);
    if (source !== content && ignored(source)) return document.createComment('');
    const rule =
      source === content ? undefined : rules.find(({ selector }) => source.matches(selector));
    if (rule) return placeholder(source, rule.kind);

    const clone = source.cloneNode(false) as Element;
    // Clones are inert presentation only; no editable controls, focus or original IDs.
    for (const attribute of Array.from(clone.attributes)) {
      if (
        /^on/i.test(attribute.name) ||
        ['autofocus', 'contenteditable', 'tabindex', 'draggable'].includes(attribute.name)
      ) {
        clone.removeAttribute(attribute.name);
      }
    }
    if (clone.hasAttribute('class'))
      clone.setAttribute('class', stableClassName(clone.getAttribute('class')));
    if (source === content) {
      clone.setAttribute('data-minimap-clone', '');
      clone.setAttribute('aria-hidden', 'true');
      clone.setAttribute('inert', '');
    }
    for (const child of source.childNodes) clone.appendChild(cloneNode(child));
    return clone;
  }

  return { cloneNode, ignored, placeholderRoot };
}
