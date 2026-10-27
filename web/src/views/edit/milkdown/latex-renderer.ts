interface MathJaxRuntime {
  startup: { promise: Promise<void> };
  tex2svgPromise: (code: string, options: { display: boolean }) => Promise<HTMLElement>;
}

const mathJaxWindow = window as Window & { MathJax?: MathJaxRuntime | Record<string, unknown> };
let loading: Promise<MathJaxRuntime> | undefined;
let renderQueue: Promise<void> = Promise.resolve();

function loadMathJax(): Promise<MathJaxRuntime> {
  if (loading) return loading;
  loading = new Promise<MathJaxRuntime>((resolve, reject) => {
    const existing = mathJaxWindow.MathJax as MathJaxRuntime | undefined;
    if (typeof existing?.tex2svgPromise === 'function') {
      existing.startup.promise.then(() => resolve(existing), reject);
      return;
    }
    // 仅使用 bundle 内的 TeX 扩展，不自动加载远程脚本或处理页面中的其他文字。
    mathJaxWindow.MathJax = {
      startup: { typeset: false },
      tex: { packages: ['base', 'ams', 'newcommand'] },
      svg: { fontCache: 'none' },
      options: { enableMenu: false, enableAssistiveMml: false },
    };
    const script = document.createElement('script');
    script.src = `${import.meta.env.BASE_URL}vendor/tex-svg.js`;
    script.async = true;
    const timer = window.setTimeout(() => fail(), 15000);
    function cleanup() {
      window.clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
    }
    function fail() {
      cleanup();
      script.remove();
      reject(new Error('公式渲染器加载失败，请重试'));
    }
    script.onerror = fail;
    script.onload = () => {
      const runtime = mathJaxWindow.MathJax as MathJaxRuntime | undefined;
      if (!runtime?.startup?.promise) {
        fail();
        return;
      }
      runtime.startup.promise.then(() => {
        if (typeof runtime.tex2svgPromise !== 'function') {
          fail();
          return;
        }
        cleanup();
        resolve(runtime);
      }, fail);
    };
    document.head.append(script);
  }).catch((cause: unknown) => {
    loading = undefined;
    throw cause;
  });
  return loading;
}

export function renderLatex(code: string): Promise<SVGSVGElement> {
  const task = renderQueue.then(async () => {
    const runtime = await loadMathJax();
    const output = await runtime.tex2svgPromise(code, { display: true });
    const error = output.querySelector('[data-mml-node="merror"]');
    if (error) {
      const detail = error.getAttribute('data-mjx-error') ?? '';
      if (/Missing close brace/.test(detail)) throw new Error('公式缺少右花括号 }，请补全后重试');
      if (/Extra close brace/.test(detail))
        throw new Error('公式中有多余的右花括号 }，请检查后重试');
      if (/Undefined control sequence/.test(detail))
        throw new Error('公式包含不支持的 LaTeX 命令，请检查拼写');
      throw new Error('公式语法有误，请检查 LaTeX 命令、括号和环境是否完整');
    }
    const svg = output.querySelector('svg');
    if (!svg) throw new Error('公式未生成 SVG，请检查 LaTeX');
    // 仅保留公式图形，复制或展示都不依赖全局 SVG 字体缓存。
    for (const element of Array.from(svg.querySelectorAll('*'))) {
      if (
        ![
          'g',
          'path',
          'defs',
          'use',
          'rect',
          'line',
          'polygon',
          'polyline',
          'circle',
          'ellipse',
          'text',
          'tspan',
        ].includes(element.localName)
      ) {
        element.remove();
        continue;
      }
      for (const attribute of Array.from(element.attributes)) {
        if (
          /^on/i.test(attribute.name) ||
          (/(?:^|:)href$/i.test(attribute.name) && !attribute.value.startsWith('#'))
        ) {
          element.removeAttribute(attribute.name);
        }
      }
    }
    const { width, height } = svg.viewBox.baseVal;
    if (!(width > 0 && height > 0)) throw new Error('公式为空，请输入有效的 LaTeX');
    svg.style.width = `${width / 1000}em`;
    svg.style.height = `${height / 1000}em`;
    svg.style.verticalAlign = 'initial';
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    return svg;
  });
  // MathJax 转换串行执行；单次错误不阻塞后面的预览和文档节点。
  renderQueue = task.then(
    () => undefined,
    () => undefined
  );
  return task;
}
