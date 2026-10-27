import { onBeforeUnmount, onMounted, type Ref } from 'vue';

interface KeyboardShortcut {
  key: string;
  enabled?: () => boolean;
  run: () => void;
}

interface KeyboardShortcutOptions {
  scope: Ref<HTMLElement | null>;
  enabled?: () => boolean;
  shortcuts: readonly KeyboardShortcut[];
}

/** Page-scoped single-key shortcuts; text entry and modal layers always take priority. */
export function useKeyboardShortcuts(options: KeyboardShortcutOptions) {
  let composing = false;

  function startComposition() {
    composing = true;
  }

  function endComposition() {
    composing = false;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.isComposing ||
      composing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      options.enabled?.() === false
    )
      return;

    const shortcut = options.shortcuts.find(
      (item) => item.key.toLowerCase() === event.key.toLowerCase()
    );
    if (!shortcut || shortcut.enabled?.() === false) return;

    const scope = options.scope.value;
    const target = event.composedPath()[0];
    if (!scope || !(target instanceof HTMLElement)) return;
    if (target !== document.body && target !== document.documentElement && !scope.contains(target))
      return;
    if (
      target.isContentEditable ||
      target.closest('input, textarea, select, [role="textbox"], [role="combobox"], [inert]') ||
      target.closest('[role="menu"], [role="listbox"]') ||
      document.querySelector(
        'dialog[open], [role="dialog"][aria-modal="true"], [popover]:popover-open'
      )
    )
      return;

    event.preventDefault();
    shortcut.run();
  }

  onMounted(() => {
    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('compositionstart', startComposition);
    document.addEventListener('compositionend', endComposition);
    window.addEventListener('blur', endComposition);
  });

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', handleKeydown);
    document.removeEventListener('compositionstart', startComposition);
    document.removeEventListener('compositionend', endComposition);
    window.removeEventListener('blur', endComposition);
  });
}
