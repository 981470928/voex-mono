/* eslint-disable */
/* Local adapter of @gavinlees/dom-minimap 0.6.0; see README.md and LICENSE. */
/*!
 * dom-minimap v0.6.0
 * A true-render minimap for HTML documents.
 *
 * Unlike canvas-based approximations, dom-minimap renders a scaled live clone
 * of the page content, so SVG diagrams, math markup, images, and syntax
 * highlighting appear pixel-faithful in miniature. No dependencies.
 *
 * Usage:
 *   var mm = DomMinimap.create({ content: document.body, width: 88 });
 *   mm.refresh();          // call after the content changes
 *   mm.spliceChildren(i, 1, 1);  // ...or patch just what changed
 *   mm.setEnabled(false);  // hide/show
 *   mm.destroy();
 *
 * Pass { enabled: false } to create() to skip the initial clone entirely —
 * for a caller that starts with the minimap turned off, so the strip is
 * hidden but nothing is ever built until setEnabled(true).
 *
 * License: MIT
 * Upstream: https://github.com/gavinlees/dom-minimap
 */
const global = window;

// Each create() call gets its own id-rewrite prefix (see sanitize()/
// rewriteIds() below), so multiple minimap instances on one page never
// collide with each other's rewritten ids either.
var instanceCount = 0;

var DEFAULTS = {
  cloneNode: null, // Local adapter: skips heavy subtrees before cloning.
  managed: false, // Local adapter owns refresh/resize batching.
  position: 'fixed',
  content: null, // element to miniaturize (default: document.body)
  host: null, // element the minimap strip is attached to
  // (default: document.documentElement, which survives
  // wholesale replacement of body.innerHTML)
  scrollElement: null, // element that scrolls the content (default:
  // document.scrollingElement, i.e. the page itself)
  enabled: true, // false: no initial clone/refresh at all, until
  // setEnabled(true) — see create()'s doc comment
  width: 88, // strip width in px
  zIndex: 2147483000,
  background: 'transparent',
  borderColor: 'rgba(128, 128, 128, 0.25)',
  sliderColor: 'rgba(128, 128, 128, 0.20)',
  sliderHoverColor: 'rgba(128, 128, 128, 0.32)',
};

function create(options) {
  var opts = {};
  for (var k in DEFAULTS) {
    opts[k] = DEFAULTS[k];
  }
  for (var o in options || {}) {
    opts[o] = options[o];
  }

  var content = opts.content || document.body;
  var host = opts.host || document.documentElement;
  instanceCount += 1;
  var idPrefix = 'dom-minimap-' + instanceCount + '-';
  var scrollEl = opts.scrollElement || document.scrollingElement || document.documentElement;
  var isPageScroll =
    scrollEl === document.scrollingElement || scrollEl === document.documentElement;
  // Element scroll events don't bubble, so listen on the element itself;
  // only the page scroller reports its events on window.
  var scrollTarget = isPageScroll ? global : scrollEl;

  var destroyed = false;
  var enabled = !!opts.enabled;
  var scale = 1;
  var slideOffset = 0;
  var dragging = false;
  var refreshQueued = false;
  var refreshRaf = 0;
  var moveRaf = 0;
  // Content width the miniature was last built at. A change to it
  // rescales everything, so there is nothing a partial patch can salvage.
  var cloneWidth = -1;

  // scrollHeight/clientHeight/getBoundingClientRect() all force a
  // synchronous layout pass when read. A drag fires scrollFromPointer
  // on every pointermove (coalesced to one scrollTo per frame, but
  // still up to ~60/s), and none of these values change mid-drag —
  // only scrollTop does — so re-forcing layout for them on every event
  // is pure waste. On a long/complex document (this preview can be
  // 30000+ px with heavy syntax highlighting) that waste is real
  // main-thread cost, and compounds over a slow drag that fires many
  // more events than a quick flick — matching reports of jank growing
  // over the course of a drag and, in the worst case, the WKWebView
  // compositor dropping unpainted tiles (a blank preview) under
  // sustained layout thrash. Cache them and only recompute on actual
  // layout-affecting changes (content resize, window resize).
  var geomCache = { docH: 1, viewH: 0, stripH: 0, rectTop: 0, rectHeight: 0 };

  function refreshGeometryCache() {
    geomCache.docH = Math.max(scrollEl.scrollHeight, 1);
    geomCache.viewH = isPageScroll ? global.innerHeight : scrollEl.clientHeight;
    geomCache.stripH = root.clientHeight;
    var r = root.getBoundingClientRect();
    geomCache.rectTop = r.top;
    geomCache.rectHeight = r.height;
    var contentRect = content.getBoundingClientRect();
    var viewportRect = isPageScroll ? { top: 0 } : scrollEl.getBoundingClientRect();
    var offset =
      contentRect.top -
      viewportRect.top +
      scrollEl.scrollTop -
      (isPageScroll ? 0 : scrollEl.clientTop);
    mini.style.paddingTop = Math.max(0, offset) + 'px';
    mini.style.paddingBottom = Math.max(0, geomCache.docH - offset - contentRect.height) + 'px';
  }

  var root = document.createElement('div');
  root.className = 'dom-minimap';
  root.setAttribute('aria-hidden', 'true');
  setStyle(root, {
    position: opts.position,
    top: '0',
    right: '0',
    bottom: '0',
    display: enabled ? '' : 'none',
    width: opts.width + 'px',
    overflow: 'hidden',
    zIndex: String(opts.zIndex),
    background: opts.background,
    borderLeft: '1px solid ' + opts.borderColor,
    cursor: 'default',
    touchAction: 'none',
    userSelect: 'none',
    webkitUserSelect: 'none',
  });

  // Two layers: the inner one carries a static scale() so its raster is
  // cached, the outer one carries the per-scroll translate3d() so scroll
  // updates stay compositor-only. Combining both in one transform makes
  // WebKit re-rasterize the scaled text every frame (visible shimmer).
  var slideLayer = document.createElement('div');
  slideLayer.className = 'dom-minimap-slide';
  setStyle(slideLayer, {
    position: 'absolute',
    top: '0',
    left: '0',
    pointerEvents: 'none',
    willChange: 'transform',
  });

  var mini = document.createElement('div');
  mini.className = 'dom-minimap-content';
  setStyle(mini, {
    transformOrigin: '0 0',
    pointerEvents: 'none',
  });

  var slider = document.createElement('div');
  slider.className = 'dom-minimap-slider';
  setStyle(slider, {
    position: 'absolute',
    top: '0',
    left: '0',
    right: '0',
    background: opts.sliderColor,
    pointerEvents: 'none',
    willChange: 'transform',
  });

  slideLayer.appendChild(mini);
  root.appendChild(slideLayer);
  root.appendChild(slider);
  host.appendChild(root);

  function setStyle(el, styles) {
    for (var p in styles) {
      el.style[p] = styles[p];
    }
  }

  function contentWidth() {
    var rect = content.getBoundingClientRect();
    return rect.width || 1;
  }

  // The strip's on-screen width is CSS-controlled (host stylesheets can
  // resize it, e.g. narrower in portrait) rather than fixed at creation,
  // so read the live rendered width instead of trusting opts.width.
  function stripWidth() {
    return root.clientWidth || opts.width;
  }

  function docHeight() {
    return geomCache.docH;
  }

  function viewHeight() {
    return geomCache.viewH;
  }

  function cloneSource(source) {
    return opts.cloneNode ? opts.cloneNode(source) : source.cloneNode(true);
  }

  function resize() {
    if (destroyed || !enabled) {
      return;
    }
    var clone = mini.firstChild;
    if (!clone) {
      refresh();
      return;
    }
    var w = contentWidth();
    scale = (stripWidth() - 1) / w;
    clone.style.width = w + 'px';
    mini.style.width = w + 'px';
    mini.style.transform = 'scale(' + scale + ')';
    cloneWidth = w;
    refreshGeometryCache();
    update();
  }

  function refresh() {
    if (destroyed || !enabled) {
      return;
    }
    var w = contentWidth();
    scale = (stripWidth() - 1) / w; // -1 for the border
    refreshGeometryCache();

    var clone = cloneSource(content);
    sanitize(clone);
    clone.style.margin = '0';
    clone.style.width = w + 'px';
    clone.style.maxWidth = 'none';
    clone.style.boxSizing = 'border-box';
    clone.style.pointerEvents = 'none';

    mini.style.width = w + 'px';
    mini.style.transform = 'scale(' + scale + ')';
    while (mini.firstChild) {
      mini.removeChild(mini.firstChild);
    }
    mini.appendChild(clone);
    cloneWidth = w;
    update();
  }

  /* Patch the miniature in place instead of rebuilding it.

           refresh() deep-clones the whole of `content` and rewrites every id
           in the copy, so it costs the same for a one-character edit as for a
           fresh document — on a 225 KB note on a Raspberry Pi 5 that is about
           two seconds, every time. For an editor preview, where the content is
           re-rendered on a debounce while someone types, that dwarfs the edit
           itself.

           The clone's childNodes mirror `content`'s one for one, so a caller
           that knows which top-level children changed can say so:

               mm.spliceChildren(start, removeCount, addCount);

           called AFTER `content` has been updated, with the same arguments an
           Array#splice on its childNodes would have taken. Edits are
           (i, 1, 1), an inserted block is (i, 0, 1), a deleted one (i, 1, 0).

           Returns true if the patch was applied. If anything does not line up
           — the caller's counts disagree with the DOM, the content width
           changed, the miniature has not been built yet — it falls back to a
           full refresh() and returns false, so a caller can use this without
           having to reason about when it is safe.

           One limitation, deliberate: ids are rewritten per patched subtree
           (see rewriteIds), so a reference from a patched child to an id in a
           *different* child is not remapped to the clone's copy. Mermaid and
           KaTeX keep their ids and references within one block, which is the
           case this exists for. */
  function spliceChildren(start, removeCount, addCount) {
    if (destroyed || !enabled) {
      return false;
    }

    var clone = mini.firstChild;
    if (!clone) {
      refresh();
      return false;
    }
    if (contentWidth() !== cloneWidth) {
      refresh();
      return false;
    }

    var src = content.childNodes;
    var dst = clone.childNodes;
    start = start | 0;
    removeCount = removeCount | 0;
    addCount = addCount | 0;

    // The miniature must still hold the pre-splice content, or the
    // indices mean something different to each side.
    if (
      start < 0 ||
      removeCount < 0 ||
      addCount < 0 ||
      dst.length !== src.length - addCount + removeCount ||
      start + removeCount > dst.length ||
      start + addCount > src.length
    ) {
      refresh();
      return false;
    }
    if (removeCount === 0 && addCount === 0) {
      return true;
    }

    // Captured as a node, not an index: the removals below shift dst.
    var anchor = dst[start + removeCount] || null;
    var i;
    for (i = 0; i < removeCount; i++) {
      clone.removeChild(dst[start]);
    }
    for (i = 0; i < addCount; i++) {
      var fresh = cloneSource(src[start + i]);
      if (fresh.nodeType === 1) {
        sanitize(fresh);
      }
      clone.insertBefore(fresh, anchor);
    }

    // The document got taller or shorter, so the slider and the cached
    // geometry both have to catch up.
    if (!opts.managed) {
      refreshGeometryCache();
      update();
    }
    return true;
  }

  function sanitize(clone) {
    /* Substituted with an empty comment rather than removed outright.
               A comment renders nothing and matches no selector, so the
               miniature and any querySelectorAll-based consumer code see
               exactly what they saw when these were deleted — but the clone
               keeps one node per node of `content`, which is the invariant
               spliceChildren() needs to address children by index. Dropping
               them instead left the two sides permanently misaligned for any
               content with a <script> in it, which includes the common
               `content: document.body` case. */
    var scripts = clone.querySelectorAll('script, .dom-minimap');
    for (var i = scripts.length - 1; i >= 0; i--) {
      scripts[i].parentNode.replaceChild(clone.ownerDocument.createComment(''), scripts[i]);
    }
    // Ids are kept (not stripped) — see rewriteIds()'s comment.
    rewriteIds(clone, idPrefix);
  }

  // Ids are kept (not stripped): SVG content generated by tools like
  // Mermaid depends on id-scoped <style> rules and url(#...)/
  // href="#..." references — stripping ids outright would break
  // markers, gradients, clip paths, and per-diagram style scoping in
  // the miniature, destroying the one thing this library is for.
  //
  // But leaving the *same* ids in the clone duplicates every id in
  // the document, and "the minimap sits after content in document
  // order so lookups resolve to the original" (the old reasoning
  // here) is a guarantee about the *default* config, not one the API
  // enforces:
  //   - a `host` positioned earlier than `content` in the DOM (a
  //     documented option) makes the clone win getElementById/#anchor
  //     lookups instead of the original, silently and invisibly.
  //   - querySelectorAll-based code (counting/iterating matches)
  //     always sees both, regardless of ordering.
  //   - `content` defaults to document.body, so by default this
  //     duplicates ids for the whole app, not a scoped subtree.
  //   - duplicate ids trip tooling (axe-core's duplicate-id rule,
  //     Testing Library's getByRole/getByLabelText throwing on
  //     multiple matches, HTML validators) even when runtime
  //     behavior happens to be fine.
  //
  // So: every id in the clone is rewritten to a prefix unique to
  // this instance (idPrefix, assigned once per create() call), and
  // every reference to those ids *within the clone* is rewritten to
  // match, so intra-clone references keep resolving to the clone's
  // own copies while the original document's ids stay unique.
  //
  // Reference forms rewritten:
  //   - `id` attributes themselves (on the clone root too, not just
  //     its descendants).
  //   - `url(#x)` inside ANY attribute value — covers fill, stroke,
  //     filter, clip-path, mask, marker-start/mid/end, cursor, the
  //     style attribute's inline CSS, and anything else that can
  //     carry a CSS/SVG url() reference, without having to name every
  //     presentation attribute individually — and the same pattern
  //     inside <style> element text.
  //   - `href` / `xlink:href`, but only when the *entire* value is a
  //     fragment reference (e.g. `href="#foo"`, as used by <use>,
  //     <a>, <textPath>). A value like `href="page.html#foo"` is left
  //     alone: its fragment isn't a same-document id reference to
  //     begin with, and rewriting only whole-value matches avoids
  //     corrupting an external URL that happens to share a fragment
  //     name with a local id.
  //   - idref attributes that take one id or a space-separated list
  //     of ids: `for`, `list`, `itemref`, `headers`,
  //     `aria-labelledby`, `aria-describedby`, `aria-controls`,
  //     `aria-owns`, `aria-flowto`, `aria-activedescendant`,
  //     `aria-details`, `aria-errormessage`.
  //   - bare `#id` selectors inside <style> element text (e.g.
  //     Mermaid's `#mermaid-svg-1 .node rect{...}`).
  // Only ids that actually exist in the clone are ever substituted —
  // a reference to an id outside the cloned subtree (rare, but
  // possible if `content` doesn't cover it) is left untouched and
  // keeps resolving wherever it did before.
  //
  // Deliberately NOT covered — not observed in practice from
  // Mermaid/KaTeX/Prism output, and each has sharp enough edges that
  // a regex-only rewrite would be a false sense of coverage rather
  // than a real one:
  //   - SMIL syncbase timing, e.g. `begin="otherId.click"` on
  //     <animate>/<animateTransform> — the id is embedded inside an
  //     arbitrary timing expression grammar, not a clean token.
  //   - CSS selectors more exotic than a plain `#ident` token in a
  //     <style> block (escaped characters, `[id="..."]` attribute
  //     selectors).
  function rewriteIds(clone, idPrefix) {
    var nodes = [clone];
    var descendants = clone.querySelectorAll('*');
    var i;
    for (i = 0; i < descendants.length; i++) {
      nodes.push(descendants[i]);
    }

    var idMap = Object.create(null); // no prototype: ids like "constructor" can't collide with Object.prototype
    var el, id;
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      if (el.hasAttribute('id')) {
        id = el.getAttribute('id');
        idMap[id] = idPrefix + id;
      }
    }
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      if (el.hasAttribute('id')) {
        el.setAttribute('id', idMap[el.getAttribute('id')]);
      }
    }
    for (i = 0; i < nodes.length; i++) {
      rewriteElementRefs(nodes[i], idMap);
    }
  }

  // url(#x), with or without quotes/whitespace inside the parens.
  var URL_REF_RE = /url\(\s*(['"]?)#([^'")]+)\1\s*\)/g;
  // Same, plus a bare "#ident" token — used only against <style>
  // element text, where a bare #id is a plausible id selector; using
  // it against arbitrary attribute values (e.g. href on an external
  // link) would risk mistaking an unrelated "#fragment" for an id
  // reference, so it's kept separate from rewriteUrlRefs below.
  var STYLE_TEXT_REF_RE = /url\(\s*(['"]?)#([^'")]+)\1\s*\)|#([A-Za-z_][\w-]*)/g;
  var IDREF_LIST_ATTRS = [
    'for',
    'list',
    'itemref',
    'headers',
    'aria-labelledby',
    'aria-describedby',
    'aria-controls',
    'aria-owns',
    'aria-flowto',
    'aria-activedescendant',
    'aria-details',
    'aria-errormessage',
  ];

  function rewriteUrlRefs(text, idMap) {
    return text.replace(URL_REF_RE, function (match, quote, id) {
      var mapped = idMap[id];
      return mapped ? 'url(' + quote + '#' + mapped + quote + ')' : match;
    });
  }

  function rewriteHrefAttr(el, name, idMap) {
    if (!el.hasAttribute(name)) {
      return;
    }
    var value = el.getAttribute(name);
    if (value.charAt(0) !== '#') {
      return;
    } // not a same-document fragment ref
    var mapped = idMap[value.slice(1)];
    if (mapped) {
      el.setAttribute(name, '#' + mapped);
    }
  }

  function rewriteIdrefListAttr(el, name, idMap) {
    if (!el.hasAttribute(name)) {
      return;
    }
    var parts = el.getAttribute(name).split(/\s+/);
    var changed = false;
    for (var i = 0; i < parts.length; i++) {
      var mapped = idMap[parts[i]];
      if (mapped) {
        parts[i] = mapped;
        changed = true;
      }
    }
    if (changed) {
      el.setAttribute(name, parts.join(' '));
    }
  }

  function rewriteElementRefs(el, idMap) {
    var attrs = el.attributes;
    for (var i = 0, len = attrs.length; i < len; i++) {
      var attr = attrs[i];
      if (attr.value.indexOf('url(') !== -1) {
        var rewritten = rewriteUrlRefs(attr.value, idMap);
        if (rewritten !== attr.value) {
          el.setAttribute(attr.name, rewritten);
        }
      }
    }

    rewriteHrefAttr(el, 'href', idMap);
    rewriteHrefAttr(el, 'xlink:href', idMap);
    for (var j = 0; j < IDREF_LIST_ATTRS.length; j++) {
      rewriteIdrefListAttr(el, IDREF_LIST_ATTRS[j], idMap);
    }

    if (el.tagName && el.tagName.toLowerCase() === 'style') {
      el.textContent = el.textContent.replace(
        STYLE_TEXT_REF_RE,
        function (match, quote, urlId, bareId) {
          if (urlId !== undefined) {
            var mapped = idMap[urlId];
            return mapped ? 'url(' + (quote || '') + '#' + mapped + (quote || '') + ')' : match;
          }
          var mappedBare = idMap[bareId];
          return mappedBare ? '#' + mappedBare : match;
        }
      );
    }
  }

  function scheduleRefresh() {
    if (refreshQueued || destroyed || !enabled) {
      return;
    }
    refreshQueued = true;
    refreshRaf = global.requestAnimationFrame(function () {
      refreshRaf = 0;
      refreshQueued = false;
      refresh();
    });
  }

  // When the miniature is taller than the strip, it slides so the
  // visible region stays in view (Monaco "fit" behavior).
  function slideOffsetForScrollY(scrollY) {
    var docH = docHeight();
    var viewH = viewHeight();
    var stripH = geomCache.stripH;
    var miniH = docH * scale;
    var maxScroll = Math.max(docH - viewH, 0);
    var ratio = maxScroll > 0 ? Math.min(scrollY / maxScroll, 1) : 0;
    return Math.max(miniH - stripH, 0) * ratio;
  }

  // Position the miniature and the viewport slider for a given scroll
  // position. Used both by the real 'scroll' listener (update(),
  // below) and — with a not-yet-applied drag target — by the drag
  // handler, so the two always render with the same formula and never
  // visibly disagree once the (now throttled) real scrollTo() catches
  // up to the last drag target.
  function renderForScrollY(scrollY) {
    var viewH = viewHeight();
    var offset = slideOffsetForScrollY(scrollY);
    var dpr = global.devicePixelRatio || 1;
    var snap = function (v) {
      return Math.round(v * dpr) / dpr;
    };
    slideLayer.style.transform = 'translate3d(0, ' + -snap(offset) + 'px, 0)';
    slider.style.transform = 'translate3d(0, ' + snap(scrollY * scale - offset) + 'px, 0)';
    slider.style.height = Math.max(viewH * scale, 12) + 'px';
    return snap(offset);
  }

  // Position the miniature and the viewport slider for the current scroll.
  function update() {
    if (destroyed || !enabled) {
      return;
    }
    slideOffset = renderForScrollY(scrollEl.scrollTop);
  }

  // History: earlier versions ran raw clientY samples through a
  // rolling-median filter and a reverse-direction dead-band before
  // using them, to hide corrupted samples caused by scrollTo() on
  // document.scrollingElement during an active touch (see
  // writeScrollTarget below). Logged 9 real drags of varying
  // length/speed (35-225 samples each) on a scrollElement-based host
  // post-migration with zero reversal spikes >5px, including a 233px
  // single-frame jump on a fast flick that was a legitimate move, not
  // a spike — confirming raw samples are already clean there, so
  // filtering them only added lag. Removed both filters entirely
  // (same call as the throttle removal above: simpler code, one
  // consistent recommendation — use scrollElement to sidestep the
  // touch-corruption mechanism rather than paper over it). Page-scroll
  // hosts (the default) on iOS WKWebView remain exposed to the
  // original artifact with no mitigation now; see README.
  //
  // Extracts the touch-local y as a plain number, synchronously, at
  // the moment the event is dispatched. Callers must not hold onto the
  // PointerEvent itself across a requestAnimationFrame/task boundary
  // and read .clientY from it later — WebKit's touch-to-pointer-event
  // pipeline is not guaranteed to leave a retained event's properties
  // untouched once further native touch samples arrive before the
  // deferred read happens, so a value read "late" from a stashed event
  // can silently reflect a different sample than the one that was live
  // when it fired. Extract the number now; pass the number around.
  function extractY(e) {
    var coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    var srcEvent = coalesced.length ? coalesced[coalesced.length - 1] : e;
    return srcEvent.clientY - geomCache.rectTop;
  }

  // History: calling scrollTo() on document.scrollingElement while a
  // touch is still active used to corrupt the clientY WebKit reports
  // for further samples of that same touch, because the top-level
  // page scroll and the touch-delivery pipeline share the same native
  // UIScrollView (confirmed by logging clientY with the write
  // disabled vs. enabled). 0.3.0 worked around this by throttling
  // real scroll writes to ~120ms. Since 0.4.0, a scrollElement passed
  // by the host (an overflow:auto container) has its own separate
  // scroll/compositor node and isn't part of that touch pipeline, so
  // the corruption — and the need to throttle — goes away for that
  // mode. Page-scroll hosts on iOS WKWebView may still hit the
  // original artifact; see the scrollElement option and README.
  function writeScrollTarget(target) {
    scrollEl.scrollTop = target;
  }

  function scrollFromPointer(rawY) {
    var tolerance = 32;
    if (rawY < -tolerance || rawY > geomCache.rectHeight + tolerance) {
      return;
    }
    // Invert the *rendered* miniature coordinates, including its fit translation.
    // The content need not fill the track, so a track fraction is not a document fraction.
    var documentY = (rawY + slideOffset) / scale;
    var target = documentY - viewHeight() / 2;
    var maxScroll = Math.max(docHeight() - viewHeight(), 0);
    target = Math.min(Math.max(target, 0), maxScroll);
    slideOffset = renderForScrollY(target);
    writeScrollTarget(target);
  }

  var activePointerId = null;
  var dragStartY = 0;
  var dragStartScrollY = 0;
  var dragTravel = 1;

  function scrollFromDrag(rawY) {
    var maxScroll = Math.max(docHeight() - viewHeight(), 0);
    var target = Math.min(
      Math.max(dragStartScrollY + ((rawY - dragStartY) * maxScroll) / dragTravel, 0),
      maxScroll
    );
    slideOffset = renderForScrollY(target);
    writeScrollTarget(target);
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) {
      return;
    }
    if (dragging) {
      return;
    }
    dragging = true;
    activePointerId = e.pointerId !== undefined ? e.pointerId : null;
    refreshGeometryCache();
    update();
    slider.style.background = opts.sliderHoverColor;
    if (root.setPointerCapture && e.pointerId !== undefined) {
      try {
        root.setPointerCapture(e.pointerId);
      } catch (err) {
        /* inactive pointer */
      }
    }
    var rawY = extractY(e);
    var sliderRect = slider.getBoundingClientRect();
    // Grabbing the viewport must preserve its position, including an off-center grab.
    var insideSlider = e.clientY >= sliderRect.top && e.clientY <= sliderRect.bottom;
    if (!insideSlider) {
      scrollFromPointer(rawY);
    }
    dragStartY = rawY;
    dragStartScrollY = scrollEl.scrollTop;
    dragTravel = Math.max(
      Math.min(docHeight() * scale, geomCache.stripH) - viewHeight() * scale,
      1
    );
    e.preventDefault();
  }

  // Coalesce to one scrollTo per animation frame. touchmove/pointermove
  // can fire faster than the display refreshes; calling scrollTo (which
  // forces a reflow/re-tile of the whole document) once per raw event
  // instead of once per frame can starve WebKit's compositor on a large
  // document, showing blank unpainted tiles until it catches up — which
  // looks identical to the scroll position randomly jumping.
  var pendingMoveY = null;
  var moveRafQueued = false;
  function onPointerMove(e) {
    if (!dragging) {
      return;
    }
    if (activePointerId !== null && e.pointerId !== undefined && e.pointerId !== activePointerId) {
      return;
    }
    e.preventDefault();
    pendingMoveY = extractY(e);
    if (moveRafQueued) {
      return;
    }
    moveRafQueued = true;
    moveRaf = global.requestAnimationFrame(function () {
      moveRaf = 0;
      moveRafQueued = false;
      if (!dragging || pendingMoveY === null) {
        return;
      }
      scrollFromDrag(pendingMoveY);
      pendingMoveY = null;
    });
  }

  function onPointerUp(e) {
    if (
      activePointerId !== null &&
      e &&
      e.pointerId !== undefined &&
      e.pointerId !== activePointerId
    ) {
      return;
    }
    // Commit the final sample on a normal release; cancel/teardown discard it.
    if (e && e.type === 'pointerup' && dragging && pendingMoveY !== null) {
      scrollFromDrag(pendingMoveY);
    }
    dragging = false;
    activePointerId = null;
    pendingMoveY = null;
    slider.style.background = opts.sliderColor;
  }

  function onWheel(e) {
    if (e.ctrlKey || e.metaKey) {
      return;
    }
    scrollEl.scrollTop += e.deltaY;
    e.preventDefault();
  }

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerUp);
  root.addEventListener('wheel', onWheel, { passive: false });
  scrollTarget.addEventListener('scroll', update, { passive: true });
  if (!opts.managed) {
    global.addEventListener('resize', scheduleRefresh);
  }

  // Async layout changes (image loads, font-size changes) resize the
  // content without any render callback firing.
  var observer = null;
  if (!opts.managed && typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(scheduleRefresh);
    observer.observe(content);
  }

  function setEnabled(value) {
    if (destroyed) {
      return;
    }
    enabled = !!value;
    root.style.display = enabled ? '' : 'none';
    // Lets host stylesheets reserve a column for the strip (e.g. via
    // padding-right) only while it's actually showing.
    host.classList.toggle('dom-minimap-active', enabled);
    if (enabled) {
      refresh();
    }
  }

  function destroy() {
    if (destroyed) {
      return;
    }
    destroyed = true;
    if (refreshRaf) {
      global.cancelAnimationFrame(refreshRaf);
    }
    if (moveRaf) {
      global.cancelAnimationFrame(moveRaf);
    }
    if (
      activePointerId !== null &&
      root.hasPointerCapture &&
      root.hasPointerCapture(activePointerId)
    ) {
      root.releasePointerCapture(activePointerId);
    }
    onPointerUp();
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', onPointerUp);
    root.removeEventListener('pointercancel', onPointerUp);
    root.removeEventListener('wheel', onWheel);
    if (observer) {
      observer.disconnect();
    }
    scrollTarget.removeEventListener('scroll', update);
    global.removeEventListener('resize', scheduleRefresh);
    host.classList.remove('dom-minimap-active');
    if (root.parentNode) {
      root.parentNode.removeChild(root);
    }
  }

  // Disabled at creation: no initial clone/refresh, and no
  // dom-minimap-active class, so a host stylesheet's padding-right
  // reservation for the strip doesn't kick in either
  // (mde-preview-minimap-clones-when-disabled). setEnabled(true)
  // builds it, exactly as it does for a later toggle.
  if (enabled) {
    host.classList.add('dom-minimap-active');
    refresh();
  }

  return {
    refresh: refresh,
    resize: resize,
    spliceChildren: spliceChildren,
    setEnabled: setEnabled,
    destroy: destroy,
    get element() {
      return root;
    },
  };
}

export { create };
