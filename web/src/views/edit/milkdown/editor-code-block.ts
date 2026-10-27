import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  syntaxHighlighting,
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { closeSearchPanel, openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { EditorState, Prec } from '@codemirror/state';
import {
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  EditorView as CodeMirror,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import {
  codeBlockComponent,
  codeBlockConfig,
  codeBlockView,
  type CodeMirrorBlock,
} from '@milkdown/kit/component/code-block';
import { editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { DOMSerializer } from '@milkdown/kit/prose/model';
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark';
import { $view } from '@milkdown/kit/utils';
import { prism } from '@milkdown/plugin-prism';
import pageIcon from '@/assets/svg/page.svg?raw';
import searchIcon from '@/assets/svg/search.svg?raw';
import closeIcon from '@/assets/svg/close.svg?raw';
import chevronIcon from '@/assets/svg/chevron-right.svg?raw';

const plainText = LanguageDescription.of({
  name: 'Text',
  alias: ['text', 'txt', 'plaintext', 'plain'],
  support: new LanguageSupport(
    StreamLanguage.define({
      token(stream) {
        stream.skipToEnd();
        return null;
      },
    })
  ),
});
const languageValue = (language: LanguageDescription) =>
  language.alias.find((alias) => /^[a-z0-9_+#.-]+$/i.test(alias)) ??
  language.name
    .toLowerCase()
    .replace(/[^a-z0-9_+#.-]+/g, '-')
    .replace(/^-|-$/g, '');
const codeLanguages = [
  plainText,
  ...languages.map((language) =>
    language.alias.includes(languageValue(language))
      ? language
      : LanguageDescription.of({
          name: language.name,
          alias: [...language.alias, languageValue(language)],
          extensions: language.extensions,
          filename: language.filename,
          load: () => language.load(),
        })
  ),
];
const codeHighlight = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--editor-muted)' },
  { tag: [tags.keyword, tags.tagName, tags.attributeName], color: 'var(--editor-accent)' },
  { tag: [tags.string, tags.character, tags.inserted], color: 'var(--editor-code-string)' },
  { tag: [tags.number, tags.bool, tags.null, tags.regexp], color: 'var(--editor-code-value)' },
  { tag: [tags.function(tags.variableName), tags.typeName], color: 'var(--editor-code-function)' },
  { tag: [tags.operator, tags.punctuation], color: 'var(--editor-secondary)' },
  { tag: [tags.deleted, tags.invalid], color: 'var(--editor-code-deleted)' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
]);

export function createEditorCodeBlock(options: {
  readonly: () => boolean;
  enabled: () => boolean;
  collaborative?: () => boolean;
  history?: (kind: 'undo' | 'redo') => boolean;
  notify: (message: string, tone: 'success' | 'error' | 'info') => void;
}) {
  const blocks = new Set<CodeMirrorBlock>();
  const canEdit = (block: CodeMirrorBlock) =>
    !options.readonly() && block.view.editable && !block.view.isDestroyed;

  // Reuse the official factory and lifecycle; adapt its toolbar to the app's native select.
  const enhancedView = $view(codeBlockSchema.node, () => {
    const createView = codeBlockView.view;
    return (...args) => {
      if (!options.enabled()) {
        const [node, view] = args;
        // Let ProseMirror own ordinary code editing through the existing schema's contentDOM.
        return DOMSerializer.renderSpec(view.dom.ownerDocument, node.type.spec.toDOM!(node));
      }
      const block = createView(...args) as CodeMirrorBlock;
      const root = block.dom;
      const document = root.ownerDocument;
      const controller = new AbortController();
      const { signal } = controller;
      let destroyed = false;
      let copying = false;
      blocks.add(block);
      root.classList.add('milkdown-editor__code-block');
      const enhanceToolbar = () => {
        if (destroyed) return;
        root.dataset.readonly = String(!canEdit(block));
        const toolbar = root.querySelector<HTMLElement>('.tools');
        if (!toolbar) return;
        let select = toolbar.querySelector<HTMLSelectElement>('.milkdown-editor__code-language');
        if (!select) {
          select = document.createElement('select');
          select.className = 'milkdown-editor__code-language';
          select.setAttribute('aria-label', '代码语言');
          select.title = '代码语言';
          for (const language of codeLanguages) {
            const option = document.createElement('option');
            option.value = languageValue(language);
            option.textContent = language === plainText ? '纯文本' : language.name;
            select.append(option);
          }
          select.addEventListener(
            'change',
            () => {
              if (canEdit(block) && select) block.setLanguage(select.value);
              enhanceToolbar();
            },
            { signal }
          );
          toolbar.prepend(select);
        }
        const value = String(block.node.attrs.language || 'text');
        const known = codeLanguages.find((language) =>
          language.alias.includes(value.toLowerCase())
        );
        const selectedValue = known ? languageValue(known) : value;
        const previousCustom = select.querySelector('option[data-custom]');
        if (previousCustom && previousCustom.getAttribute('value') !== selectedValue)
          previousCustom.remove();
        if (!known && !select.querySelector('option[data-custom]')) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = value;
          option.dataset.custom = 'true';
          select.append(option);
        }
        select.value = selectedValue;
        select.disabled = !canEdit(block);
        const group = toolbar.querySelector('.tools-button-group');
        if (group && !group.querySelector('.milkdown-editor__code-search')) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'milkdown-editor__code-search';
          button.title = '查找代码（Ctrl/Cmd + F）';
          button.setAttribute('aria-label', '查找代码');
          button.innerHTML = searchIcon;
          button.addEventListener(
            'click',
            () => {
              if (block.cm) openSearchPanel(block.cm);
            },
            { signal }
          );
          group.prepend(button);
        }
        const copy = toolbar.querySelector<HTMLButtonElement>('.copy-button');
        if (copy) {
          copy.title = '复制代码';
          copy.disabled = copying;
        }
        const field = root.querySelector<HTMLInputElement>('.cm-search input[name="search"]');
        if (field && !field.parentElement?.querySelector('.milkdown-editor__code-clear-search')) {
          const clear = document.createElement('button');
          clear.type = 'button';
          clear.className = 'milkdown-editor__code-clear-search';
          clear.textContent = '清空';
          clear.setAttribute('aria-label', '清空查找内容');
          clear.addEventListener(
            'click',
            () => {
              field.value = '';
              field.dispatchEvent(new Event('change', { bubbles: true }));
              field.focus();
            },
            { signal }
          );
          field.after(clear);
        }
      };
      const observer = new MutationObserver(enhanceToolbar);
      observer.observe(root, { childList: true, subtree: true });
      const copyCode = async () => {
        if (copying) return;
        copying = true;
        enhanceToolbar();
        try {
          if (!navigator.clipboard) throw new Error('Clipboard unavailable');
          await navigator.clipboard.writeText(block.node.textContent);
          if (!destroyed) options.notify('代码已复制', 'success');
        } catch {
          if (!destroyed && block.cm) {
            block.cm.focus();
            block.cm.dispatch({ selection: { anchor: 0, head: block.cm.state.doc.length } });
            options.notify('已选中代码，请按 Ctrl/Cmd + C 复制', 'info');
          }
        } finally {
          copying = false;
          enhanceToolbar();
        }
      };
      root.addEventListener(
        'click',
        (event) => {
          const target = event.target instanceof Element ? event.target : null;
          if (target?.closest('.copy-button')) {
            event.preventDefault();
            event.stopImmediatePropagation();
            void copyCode();
          }
        },
        { capture: true, signal }
      );
      const update = block.update.bind(block);
      block.update = (node) => {
        const result = update(node);
        enhanceToolbar();
        return result;
      };
      const destroy = block.destroy.bind(block);
      block.destroy = () => {
        destroyed = true;
        observer.disconnect();
        controller.abort();
        blocks.delete(block);
        destroy();
      };
      enhanceToolbar();
      return block;
    };
  });
  return {
    // Plain code blocks keep syntax colors without mounting a CodeMirror instance.
    plugins: [...prism, ...codeBlockComponent, enhancedView],
    enabledChanged(ctx: Ctx) {
      const view = ctx.get(editorViewCtx);
      if (view.isDestroyed) return;
      const render = enhancedView.view;
      // A new constructor makes ProseMirror dispose old node views without changing EditorState.
      view.setProps({
        nodeViews: {
          ...view.props.nodeViews,
          [codeBlockSchema.type(ctx).name]: (...args) => render(...args),
        },
      });
    },
    readonlyChanged() {
      // The parent first updates ProseMirror.editable; refresh even when the document is unchanged.
      queueMicrotask(() => {
        for (const block of blocks) {
          if (block.view.isDestroyed) continue;
          if (block.cm?.dom.isConnected) closeSearchPanel(block.cm);
          block.update(block.node);
        }
      });
    },
    configure(ctx: Ctx) {
      ctx.update(codeBlockConfig.key, (config) => ({
        ...config,
        languages: codeLanguages,
        copyText: '复制',
        copyIcon: pageIcon,
        expandIcon: chevronIcon,
        searchIcon,
        clearSearchIcon: closeIcon,
        searchPlaceholder: '搜索语言',
        noResultText: '没有匹配的语言',
        previewLabel: '预览',
        previewLoading: '正在加载预览',
        extensions: [
          ...config.extensions,
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          highlightSpecialChars(),
          indentOnInput(),
          indentUnit.of('  '),
          bracketMatching(),
          foldGutter(),
          syntaxHighlighting(codeHighlight),
          search({ top: true }),
          // Milkdown forwards only while the code content owns focus; search replaces need the same path.
          CodeMirror.updateListener.of((update) => {
            if (
              !update.docChanged ||
              update.view.hasFocus ||
              options.readonly() ||
              !update.transactions.some((transaction) => transaction.isUserEvent('input.replace'))
            )
              return;
            const active = update.view.dom.ownerDocument.activeElement;
            update.view.focus();
            queueMicrotask(() => {
              if (active instanceof HTMLElement && active.isConnected)
                active.focus({ preventScroll: true });
            });
          }),
          EditorState.phrases.of({
            Find: '查找',
            Replace: '替换',
            next: '下一个',
            previous: '上一个',
            all: '选中全部',
            'match case': '区分大小写',
            regexp: '正则表达式',
            'by word': '全词匹配',
            replace: '替换',
            'replace all': '全部替换',
            close: '关闭查找',
            'Go to line': '跳转到行',
            go: '跳转',
            'current match': '当前匹配',
            'on line': '所在行',
            'replaced match on line $': '已替换第 $ 行的匹配',
            'replaced $ matches': '已替换 $ 处匹配',
            'Fold line': '折叠此行',
            'Unfold line': '展开此行',
            'Folded lines': '已折叠的行',
          }),
          // Official bindings own ProseMirror history and Mod-Enter; disallow these edits in readonly.
          Prec.highest(
            keymap.of(
              ['Mod-z', 'Shift-Mod-z', 'Mod-y', 'Mod-Enter', 'Backspace'].map((key) => ({
                key,
                run: (view) => {
                  if (options.readonly() || view.state.readOnly) return true;
                  if (
                    options.collaborative?.() &&
                    ['Mod-z', 'Shift-Mod-z', 'Mod-y'].includes(key)
                  ) {
                    options.history?.(key === 'Mod-z' ? 'undo' : 'redo');
                    return true;
                  }
                  return false;
                },
              }))
            )
          ),
          keymap.of([...searchKeymap, ...foldKeymap, ...defaultKeymap, indentWithTab]),
          CodeMirror.contentAttributes.of((view) => ({
            'aria-label': '代码内容',
            'aria-readonly': String(view.state.readOnly),
            'aria-description':
              'Tab 缩进；按 Escape 后再按 Tab 离开代码区；Ctrl/Cmd + Enter 继续正文。',
          })),
        ],
      }));
    },
  };
}
