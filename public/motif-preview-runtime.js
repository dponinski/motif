/*
 * Runs inside the sandboxed preview iframe. Loads the packages a component needs from the CDN, runs the
 * repository's modules from a small registry, and renders them on request from Motif.
 */
(function () {
  'use strict';

  var processShim = { env: { NODE_ENV: 'production' } };
  var importMeta = { env: { MODE: 'production', DEV: false, PROD: true, BASE_URL: '/', SSR: false }, url: '' };
  var hasOwn = Object.prototype.hasOwnProperty;

  // An ES module namespace, as CommonJS callers expect to see it: named exports plus a real default.
  function toCjs(ns) {
    return Object.assign(Object.create(null), ns, { __esModule: true });
  }

  function createRegistry(data, externals) {
    var cache = Object.create(null);

    function external(spec) {
      var found = externals[spec];
      if (!found) throw new Error('The package "' + spec + '" was not loaded');
      return found;
    }

    function makeRequire(from) {
      var imports = data.modules[from].imports;
      return function (spec) {
        if (hasOwn.call(imports, spec)) {
          var target = imports[spec];
          return target === null ? {} : load(target);
        }
        return external(spec);
      };
    }

    function load(path) {
      if (cache[path]) return cache[path].exports;
      var mod = data.modules[path];
      if (!mod) throw new Error('Module not found: ' + path);
      var module = { exports: {} };
      // Registered before it runs so an import cycle sees the exports made so far.
      cache[path] = module;
      var fn = new Function('module', 'exports', 'require', '__importMeta', 'process', mod.code + '\n//# sourceURL=motif:///' + path);
      fn.call(module.exports, module, module.exports, makeRequire(path), importMeta, processShim);
      return module.exports;
    }

    return { require: load };
  }

  function boot() {
    var post = function (message) { window.parent.postMessage(message, '*'); };
    var fail = function (error) {
      post({ type: 'error', message: (error && error.message) || String(error) });
    };
    window.addEventListener('error', function (event) { fail(event.error || event.message); });
    window.addEventListener('unhandledrejection', function (event) { fail(event.reason); });

    var data = JSON.parse(document.getElementById('motif-data').textContent);
    var externals = Object.create(null);

    var loading = Object.keys(data.externals).map(function (spec) {
      return import(data.externals[spec]).then(
        function (ns) { externals[spec] = toCjs(ns); },
        function (error) { throw new Error('Could not load "' + spec + '" from the CDN: ' + ((error && error.message) || error)); }
      );
    });

    Promise.all(loading).then(function () {
      var React = externals['react'];
      var createRoot = externals['react-dom/client'].createRoot;
      var registry = createRegistry(data, externals);
      var lastRender = null;
      var editOn = false;
      var canvasOn = false;
      var selectedKey = null;
      var hovered = null;
      var updates = Promise.resolve();
      var rootElement = document.getElementById('root');
      var overrides = document.getElementById('motif-overrides');
      var root = createRoot(rootElement);
      var h = React.createElement;
      var errorStyle = { color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: 12, margin: 0, font: '12px/1.5 ui-monospace, monospace', whiteSpace: 'pre-wrap', maxWidth: 480 };

      class Boundary extends React.Component {
        constructor(props) { super(props); this.state = { error: null }; }
        static getDerivedStateFromError(error) { return { error: error }; }
        componentDidCatch(error) { fail(error); }
        render() {
          if (this.state.error) return h('pre', { style: errorStyle }, String((this.state.error && this.state.error.message) || this.state.error));
          return this.props.children;
        }
      }

      function componentOf(item) {
        var mod = registry.require(item.path);
        var component = item.exportName === 'default' ? mod.default : mod[item.exportName];
        if (!component) throw new Error(item.exportName + ' is not exported from ' + item.path);
        return component;
      }

      function Item(props) {
        return h(props.component, props.props);
      }

      function App(props) {
        var grid = props.layout === 'grid';
        var stack = props.layout === 'stack';
        var bare = props.layout === 'bare';
        var outer = bare ? { display: props.fit ? 'inline-block' : 'block', verticalAlign: 'top' } : grid ? { display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start', padding: 24 }
          : stack ? { display: 'flex', flexDirection: 'column', gap: 32, padding: 24 }
          : { padding: 24 };
        return h('div', { style: outer },
          props.items.map(function (item) {
            var element;
            try {
              element = h(Item, { component: componentOf(item), props: item.props });
            } catch (error) {
              element = h('pre', { style: errorStyle }, error.message);
            }
            var body = h(Boundary, { key: JSON.stringify(item.props) }, element);
            return h('div', { key: item.key, style: { display: 'flex', flexDirection: 'column', gap: 8, alignItems: stack ? 'stretch' : 'flex-start' } },
              item.label ? h('span', { style: { font: '11px ui-monospace, monospace', color: '#71717a' } }, item.label) : null,
              // A block wrapper lets full-width components fill the row while inline ones keep their size.
              stack ? h('div', null, body) : body);
          }));
      }

      var currentId = 0;
      var measure = function () {
        // A component that fits its content is measured by the box around it, not by the page.
        var fit = lastRender && lastRender.layout === 'bare' && lastRender.fit && rootElement.firstElementChild;
        var rect = (fit || rootElement).getBoundingClientRect();
        post({ type: 'rendered', id: currentId, height: Math.ceil(rect.height), width: Math.ceil(rect.width) });
        draw();
      };
      var reportHeight = function () {
        requestAnimationFrame(function () { requestAnimationFrame(measure); });
        // A page that is scrolled out of view doesn't get animation frames, but its size should still be known.
        setTimeout(measure, 150);
        setTimeout(measure, 800);
      };
      var sizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(reportHeight) : null;
      if (sizeObserver) sizeObserver.observe(rootElement);

      // What is drawn over the page while editing: outlines, and for the selected element its size, its padding, margin and gap, and
      // handles to change them. It is a layer of its own, never part of the page, and drawn at the size the canvas's zoom calls for,
      // so lines stay thin and handles easy to hit at any zoom.
      var zoom = 1;
      var layer = document.createElement('div');
      layer.setAttribute('aria-hidden', 'true');
      layer.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483647';
      document.body.appendChild(layer);
      var pool = [];
      // A box in the layer, from a pool so that drawing again doesn't make new elements. `width` null is as wide as its text.
      function shape(index, left, top, width, height, css, handle) {
        var el = pool[index];
        if (!el) { el = document.createElement('div'); layer.appendChild(el); pool[index] = el; }
        el.style.cssText = 'position:fixed;display:block;box-sizing:border-box;pointer-events:' + (handle ? 'auto' : 'none') + ';left:' + left + 'px;top:' + top + 'px;' +
          'width:' + (width === null ? 'auto' : width + 'px') + ';height:' + (height === null ? 'auto' : height + 'px') + ';' + css;
        if (handle) el.setAttribute('data-motif-handle', handle); else el.removeAttribute('data-motif-handle');
        el.textContent = '';
        return el;
      }
      function matching(key) {
        return Array.prototype.filter.call(document.querySelectorAll('[data-motif]'), function (el) { return el.getAttribute('data-motif') === key; });
      }
      var num = function (v) { return parseFloat(v) || 0; };
      function sides(cs, name, suffix) {
        var s = suffix || '';
        return { t: num(cs[name + 'Top' + s]), r: num(cs[name + 'Right' + s]), b: num(cs[name + 'Bottom' + s]), l: num(cs[name + 'Left' + s]) };
      }
      // The children that gaps are between: in flow, and shown.
      function flowChildren(el) {
        return Array.prototype.filter.call(el.children, function (c) {
          var cs = getComputedStyle(c);
          return cs.display !== 'none' && cs.position !== 'absolute' && cs.position !== 'fixed';
        });
      }
      var MARGIN = 'background:rgba(251,146,60,0.30)';
      var PADDING = 'background:rgba(34,197,94,0.30)';
      var GAP = 'background:rgba(236,72,153,0.30)';
      var gesture = null;
      var transient = [];
      var clearTimer = null;
      var kept = false;

      // The selected element's measurements and the handles on them. Returns how many boxes of the pool are in use.
      function designOverlay(el, used) {
        var cs = getComputedStyle(el);
        var r = el.getBoundingClientRect();
        var line = 1 / zoom;
        var m = sides(cs, 'margin'), p = sides(cs, 'padding'), b = sides(cs, 'border', 'Width');
        var band = function (left, top, w, h, css) { if (w > 0 && h > 0) shape(used++, left, top, w, h, css); };
        band(r.left - m.l, r.top - m.t, r.width + m.l + m.r, m.t, MARGIN);
        band(r.left - m.l, r.bottom, r.width + m.l + m.r, m.b, MARGIN);
        band(r.left - m.l, r.top, m.l, r.height, MARGIN);
        band(r.right, r.top, m.r, r.height, MARGIN);
        var ix = r.left + b.l, iy = r.top + b.t, iw = r.width - b.l - b.r, ih = r.height - b.t - b.b;
        band(ix, iy, iw, p.t, PADDING);
        band(ix, iy + ih - p.b, iw, p.b, PADDING);
        band(ix, iy + p.t, p.l, ih - p.t - p.b, PADDING);
        band(ix + iw - p.r, iy + p.t, p.r, ih - p.t - p.b, PADDING);

        var flex = /flex/.test(cs.display);
        var row = /row/.test(cs.flexDirection);
        var kids = flex ? flowChildren(el) : [];
        for (var i = 0; i < kids.length - 1; i++) {
          var a = kids[i].getBoundingClientRect(), c = kids[i + 1].getBoundingClientRect();
          if (row) band(a.right, Math.min(a.top, c.top), c.left - a.right, Math.max(a.bottom, c.bottom) - Math.min(a.top, c.top), GAP);
          else band(Math.min(a.left, c.left), a.bottom, Math.max(a.right, c.right) - Math.min(a.left, c.left), c.top - a.bottom, GAP);
        }

        // Its size, or what is being dragged.
        var badge = shape(used++, r.left + r.width / 2, r.bottom + 8 * line, null, null,
          'transform:translateX(-50%);white-space:nowrap;background:#6366f1;color:#fff;border-radius:' + 3 * line + 'px;padding:' + 2 * line + 'px ' + 6 * line + 'px;font:600 ' + 11 * line + 'px/1.3 ui-monospace,monospace');
        badge.textContent = gesture && gesture.label ? gesture.label : Math.round(r.width) + ' × ' + Math.round(r.height);

        var S = 9 * line;
        var square = 'background:#fff;border:' + 1.5 * line + 'px solid #6366f1;border-radius:' + 2 * line + 'px';
        shape(used++, r.right - S / 2, r.top + r.height / 2 - S / 2, S, S, square + ';cursor:ew-resize', 'right');
        shape(used++, r.left + r.width / 2 - S / 2, r.bottom - S / 2, S, S, square + ';cursor:ns-resize', 'bottom');
        shape(used++, r.right - S / 2, r.bottom - S / 2, S, S, square + ';cursor:nwse-resize', 'corner');

        // Padding: a dot on each side, just inside the padding (and at least a little way in, so it isn't on the edge's own handle).
        // Only on an element with room for them on screen: on a small one they would sit over it and be in the way of picking it.
        var roomy = r.width * zoom >= 80 && r.height * zoom >= 56;
        var D = 8 * line;
        var dot = 'background:#22c55e;border:' + 1.5 * line + 'px solid #fff;border-radius:50%';
        var inset = function (pad, border, length) { return Math.min(Math.max(pad + border, 16 * line), length / 2); };
        if (roomy) {
          shape(used++, r.left + r.width / 2 - D / 2, r.top + inset(p.t, b.t, r.height) - D / 2, D, D, dot + ';cursor:ns-resize', 'pad-top');
          shape(used++, r.right - inset(p.r, b.r, r.width) - D / 2, r.top + r.height / 2 - D / 2, D, D, dot + ';cursor:ew-resize', 'pad-right');
          shape(used++, r.left + r.width / 2 - D / 2, r.bottom - inset(p.b, b.b, r.height) - D / 2, D, D, dot + ';cursor:ns-resize', 'pad-bottom');
          shape(used++, r.left + inset(p.l, b.l, r.width) - D / 2, r.top + r.height / 2 - D / 2, D, D, dot + ';cursor:ew-resize', 'pad-left');
        }

        // Gap: a pill between the first two children.
        if (kids.length >= 2) {
          var k0 = kids[0].getBoundingClientRect(), k1 = kids[1].getBoundingClientRect();
          var pill = 'background:#ec4899;border:' + 1.5 * line + 'px solid #fff;border-radius:' + 4 * line + 'px';
          if (row) shape(used++, (k0.right + k1.left) / 2 - 3 * line, k0.top + k0.height / 2 - 10 * line, 6 * line, 20 * line, pill + ';cursor:ew-resize', 'gap');
          else shape(used++, k0.left + k0.width / 2 - 10 * line, (k0.bottom + k1.top) / 2 - 3 * line, 20 * line, 6 * line, pill + ';cursor:ns-resize', 'gap');
        }
        return used;
      }

      function draw() {
        var used = 0;
        var line = 1 / zoom;
        if (editOn) {
          var els = selectedKey ? matching(selectedKey) : [];
          els.forEach(function (el) {
            var r = el.getBoundingClientRect();
            shape(used++, r.left, r.top, r.width, r.height, 'border:' + 2 * line + 'px solid #6366f1;background:rgba(99,102,241,0.06);border-radius:' + 2 * line + 'px');
          });
          if (els.length) used = designOverlay(els[0], used);
          if (hovered && hovered.getAttribute('data-motif') !== selectedKey) {
            var hr = hovered.getBoundingClientRect();
            shape(used++, hr.left, hr.top, hr.width, hr.height, 'border:' + line + 'px dashed #6366f1');
          }
        }
        for (var i = used; i < pool.length; i++) pool[i].style.display = 'none';
      }
      window.addEventListener('scroll', draw, true);
      window.addEventListener('resize', draw);

      // While a handle is dragged the page shows the new size straight away, as styles on the element (nothing is rebuilt); when it
      // is let go, one message says what was asked, and the styles stay until the edited code has arrived (or the editor says
      // nothing changed).
      function setStyle(el, prop, value) {
        if (!transient.some(function (t) { return t.el === el && t.prop === prop; })) {
          transient.push({ el: el, prop: prop, old: el.style.getPropertyValue(prop), priority: el.style.getPropertyPriority(prop) });
        }
        el.style.setProperty(prop, value, 'important');
      }
      function clearTransient() {
        transient.forEach(function (t) { if (t.old) t.el.style.setProperty(t.prop, t.old, t.priority); else t.el.style.removeProperty(t.prop); });
        transient = [];
        kept = false;
        if (clearTimer) { clearTimeout(clearTimer); clearTimer = null; }
        draw();
      }
      var handleOf = function (event) { return event.target && event.target.closest ? event.target.closest('[data-motif-handle]') : null; };
      var PAD_PROP = { top: 'padding-top', right: 'padding-right', bottom: 'padding-bottom', left: 'padding-left' };
      var OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
      // These run before the ones that stop clicks reaching the component, so the handles get their pointer.
      window.addEventListener('pointerdown', function (event) {
        if (!editOn || event.button !== 0 || !selectedKey) return;
        var h = handleOf(event);
        var el = h && matching(selectedKey)[0];
        if (!el) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        clearTransient();
        var cs = getComputedStyle(el), r = el.getBoundingClientRect();
        var p = sides(cs, 'padding'), b = sides(cs, 'border', 'Width');
        var row = /row/.test(cs.flexDirection);
        gesture = {
          kind: h.getAttribute('data-motif-handle'), key: selectedKey, id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, label: null, edits: null, row: row,
          // The width and height that CSS `width` and `height` mean for this element.
          width: cs.boxSizing === 'border-box' ? r.width : r.width - p.l - p.r - b.l - b.r,
          height: cs.boxSizing === 'border-box' ? r.height : r.height - p.t - p.b - b.t - b.b,
          pad: { top: p.t, right: p.r, bottom: p.b, left: p.l },
          gap: row ? num(cs.columnGap) : num(cs.rowGap)
        };
        try { h.setPointerCapture(event.pointerId); } catch (e) { /* the drag still works while the pointer is over the page */ }
        post({ type: 'dragging', on: true });
      }, true);
      window.addEventListener('pointermove', function (event) {
        var g = gesture;
        if (!g || event.pointerId !== g.id) return;
        var dx = event.clientX - g.x, dy = event.clientY - g.y;
        if (!g.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
        g.moved = true;
        event.preventDefault();
        var els = matching(g.key), edits = [];
        var all = function (prop, value) { els.forEach(function (el) { setStyle(el, prop, value + 'px'); }); };
        g.label = null;
        if (g.kind === 'right' || g.kind === 'corner') {
          var w = Math.max(8, Math.round(g.width + dx));
          all('width', w);
          edits.push({ group: 'w', px: w });
        }
        if (g.kind === 'bottom' || g.kind === 'corner') {
          var hh = Math.max(8, Math.round(g.height + dy));
          all('height', hh);
          edits.push({ group: 'h', px: hh });
        }
        if (g.kind.indexOf('pad-') === 0) {
          var side = g.kind.slice(4);
          // The dot sits at the inner edge: moving it inward makes the padding bigger.
          var delta = side === 'top' ? dy : side === 'bottom' ? -dy : side === 'left' ? dx : -dx;
          var v = Math.max(0, Math.round(g.pad[side] + delta));
          all(PAD_PROP[side], v);
          if (event.altKey) {
            // Alt: the opposite side with it.
            all(PAD_PROP[OPPOSITE[side]], v);
            edits.push({ group: side === 'left' || side === 'right' ? 'px' : 'py', px: v });
          } else edits.push({ group: 'p' + side.charAt(0), px: v });
          g.label = 'Padding ' + v;
        }
        if (g.kind === 'gap') {
          var gv = Math.max(0, Math.round(g.gap + (g.row ? dx : dy)));
          all('gap', gv);
          edits.push({ group: 'gap', px: gv });
          g.label = 'Gap ' + gv;
        }
        g.edits = edits;
        draw();
      }, true);
      function endGesture(event, cancel) {
        var g = gesture;
        if (!g || (event && event.pointerId !== g.id)) return;
        gesture = null;
        post({ type: 'dragging', on: false });
        if (cancel || !g.moved || !g.edits || g.edits.length === 0) { clearTransient(); return; }
        kept = true;
        clearTimer = setTimeout(clearTransient, 2500);
        post({ type: 'gesture', key: g.key, edits: g.edits });
      }
      window.addEventListener('pointerup', function (event) { endGesture(event, false); }, true);
      window.addEventListener('pointercancel', function (event) { endGesture(event, true); }, true);

      var pick = function (event) { return event.target && event.target.closest ? event.target.closest('[data-motif]') : null; };
      // While editing, the page is for picking: nothing the component does on click or submit should happen.
      ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'submit', 'dblclick', 'contextmenu'].forEach(function (name) {
        window.addEventListener(name, function (event) { if (editOn) { event.preventDefault(); event.stopPropagation(); } }, true);
      });
      window.addEventListener('click', function (event) {
        if (!editOn) return;
        event.preventDefault();
        event.stopPropagation();
        var el = pick(event);
        if (el) post({ type: 'select', key: el.getAttribute('data-motif') });
      }, true);
      window.addEventListener('mouseover', function (event) {
        if (!editOn) return;
        var el = pick(event);
        if (el !== hovered) { hovered = el; draw(); }
      }, true);
      document.addEventListener('mouseleave', function () { hovered = null; draw(); });

      // A right click on an element, and the keys of editing, go to the editor, which knows what an element can do.
      window.addEventListener('contextmenu', function (event) {
        if (!editOn) return;
        var el = pick(event);
        if (el) post({ type: 'menu', key: el.getAttribute('data-motif'), clientX: event.clientX, clientY: event.clientY });
      }, true);
      var EDIT_KEYS = { Delete: 1, Backspace: 1, Escape: 1, Enter: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };
      window.addEventListener('keydown', function (event) {
        if (!editOn || typing(event.target)) return;
        var withModifier = event.metaKey || event.ctrlKey;
        if (!(EDIT_KEYS[event.key] || (withModifier && /^[dczvx]$/i.test(event.key)))) return;
        event.preventDefault();
        post({ type: 'key', key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey });
      }, true);

      function renderLast() {
        if (!lastRender) return;
        root.render(h(App, { items: lastRender.items, layout: lastRender.layout, fit: !!lastRender.fit }));
        reportHeight();
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            // The box around a fitted component changes size without the page changing size.
            if (sizeObserver && rootElement.firstElementChild) sizeObserver.observe(rootElement.firstElementChild);
            // What a handle was dragged to is in the code now.
            if (kept) clearTransient(); else draw();
          });
        });
      }

      function handle(message) {
        if (!message) return;
        if (message.type === 'render') {
          currentId = message.id;
          lastRender = message;
          document.body.style.margin = message.layout === 'bare' ? '0' : '';
          document.documentElement.classList.toggle('dark', !!message.dark);
          document.documentElement.style.colorScheme = message.dark ? 'dark' : 'light';
          overrides.textContent = message.overrides || '';
          renderLast();
        } else if (message.type === 'modules') {
          // New code can need packages the page didn't start with; they are loaded before it runs. Messages are
          // handled one after another so a slow load can't be overtaken by the next edit.
          var extra = message.externals || {};
          var wanted = Object.keys(extra).filter(function (spec) { return !externals[spec]; });
          updates = updates.then(function () {
            return Promise.all(wanted.map(function (spec) {
              return import(extra[spec]).then(
                function (ns) { externals[spec] = toCjs(ns); },
                function (error) { throw new Error('Could not load "' + spec + '" from the CDN: ' + ((error && error.message) || error)); }
              );
            }));
          }).then(function () {
            Object.assign(data.modules, message.modules);
            // A fresh registry runs the changed modules again; the old one is dropped.
            registry = createRegistry(data, externals);
            renderLast();
          }).catch(fail);
        } else if (message.type === 'css') {
          // A stylesheet that is already on the page has its text replaced; a new one is added before the overrides.
          var files = message.files || {};
          Object.keys(files).forEach(function (path) {
            var found = null;
            document.querySelectorAll('style[data-motif-css]').forEach(function (el) {
              if (el.getAttribute('data-motif-css') === path) found = el;
            });
            if (!found) {
              found = document.createElement('style');
              found.setAttribute('data-motif-css', path);
              document.head.insertBefore(found, overrides);
            }
            found.textContent = files[path];
          });
          if (kept) clearTransient(); else draw();
        } else if (message.type === 'zoom') {
          zoom = message.zoom > 0 ? message.zoom : 1;
          draw();
        } else if (message.type === 'gestureEnd') {
          if (!message.changed) clearTransient();
        } else if (message.type === 'canvas') {
          canvasOn = !!message.on;
        } else if (message.type === 'edit') {
          editOn = !!message.on;
          selectedKey = message.selected || null;
          if (!editOn) hovered = null;
          draw();
        }
      }

      // On a canvas that pans and zooms, the wheel and the Space key go to the page under the pointer, not to the
      // canvas around it, so they are passed up: scrolling and pinching move the canvas, Space turns dragging
      // into panning. A component that scrolls inside itself keeps its own scrolling.
      function scrollsItself(el, dx, dy) {
        for (; el && el.nodeType === 1 && el !== document.documentElement; el = el.parentElement) {
          var style = getComputedStyle(el);
          if (dy && /auto|scroll/.test(style.overflowY) && el.scrollHeight > el.clientHeight &&
              (dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1)) return true;
          if (dx && /auto|scroll/.test(style.overflowX) && el.scrollWidth > el.clientWidth &&
              (dx < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1)) return true;
        }
        return false;
      }
      var typing = function (el) {
        var tag = el && el.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A' || !!(el && el.isContentEditable);
      };
      window.addEventListener('wheel', function (event) {
        if (!canvasOn) return;
        if (!event.ctrlKey && !event.metaKey && scrollsItself(event.target, event.deltaX, event.deltaY)) return;
        event.preventDefault();
        post({ type: 'wheel', deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, ctrlKey: event.ctrlKey, metaKey: event.metaKey, clientX: event.clientX, clientY: event.clientY });
      }, { passive: false, capture: true });
      window.addEventListener('keydown', function (event) {
        if (!canvasOn || event.key !== ' ' || typing(event.target)) return;
        event.preventDefault();
        if (!event.repeat) post({ type: 'space', down: true });
      }, true);
      window.addEventListener('keyup', function (event) { if (canvasOn && event.key === ' ') post({ type: 'space', down: false }); }, true);
      window.addEventListener('blur', function () { if (canvasOn) post({ type: 'space', down: false }); });

      window.addEventListener('message', function (event) {
        if (event.source !== window.parent) return;
        handle(event.data);
      });

      post({ type: 'ready' });
      // A page that is shown without a parent to ask it (an exported docs site) is told what to show in its data.
      if (data.initial) handle(data.initial);
    }).catch(fail);
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createRegistry: createRegistry, toCjs: toCjs };
  else boot();
})();
