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

      // Outlines for the element under the pointer and the selected one, drawn over the page, never part of it.
      var layer = document.createElement('div');
      layer.setAttribute('aria-hidden', 'true');
      layer.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483647';
      document.body.appendChild(layer);
      var boxes = [];
      function box(index, rect, selected) {
        var el = boxes[index];
        if (!el) { el = document.createElement('div'); layer.appendChild(el); boxes[index] = el; }
        el.style.cssText = 'position:fixed;pointer-events:none;box-sizing:border-box;border-radius:2px;left:' + rect.left + 'px;top:' + rect.top + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;' +
          (selected ? 'border:2px solid #6366f1;background:rgba(99,102,241,0.08)' : 'border:1px dashed #6366f1');
      }
      function matching(key) {
        return Array.prototype.filter.call(document.querySelectorAll('[data-motif]'), function (el) { return el.getAttribute('data-motif') === key; });
      }
      function draw() {
        var used = 0;
        if (editOn) {
          if (selectedKey) matching(selectedKey).forEach(function (el) { box(used++, el.getBoundingClientRect(), true); });
          if (hovered && hovered.getAttribute('data-motif') !== selectedKey) box(used++, hovered.getBoundingClientRect(), false);
        }
        for (var i = used; i < boxes.length; i++) boxes[i].style.display = 'none';
      }
      window.addEventListener('scroll', draw, true);
      window.addEventListener('resize', draw);

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

      function renderLast() {
        if (!lastRender) return;
        root.render(h(App, { items: lastRender.items, layout: lastRender.layout, fit: !!lastRender.fit }));
        reportHeight();
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            // The box around a fitted component changes size without the page changing size.
            if (sizeObserver && rootElement.firstElementChild) sizeObserver.observe(rootElement.firstElementChild);
            draw();
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
          draw();
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
