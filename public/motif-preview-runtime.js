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
        return h('div', { style: grid ? { display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start', padding: 24 } : { padding: 24 } },
          props.items.map(function (item) {
            var element;
            try {
              element = h(Item, { component: componentOf(item), props: item.props });
            } catch (error) {
              element = h('pre', { style: errorStyle }, error.message);
            }
            return h('div', { key: item.key, style: { display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' } },
              item.label ? h('span', { style: { font: '11px ui-monospace, monospace', color: '#71717a' } }, item.label) : null,
              h(Boundary, { key: JSON.stringify(item.props) }, element));
          }));
      }

      var currentId = 0;
      var reportHeight = function () {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            post({ type: 'rendered', id: currentId, height: Math.ceil(rootElement.getBoundingClientRect().height) });
          });
        });
      };
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(reportHeight).observe(rootElement);

      window.addEventListener('message', function (event) {
        if (event.source !== window.parent) return;
        var message = event.data;
        if (!message || message.type !== 'render') return;
        currentId = message.id;
        document.documentElement.classList.toggle('dark', !!message.dark);
        document.documentElement.style.colorScheme = message.dark ? 'dark' : 'light';
        overrides.textContent = message.overrides || '';
        root.render(h(App, { items: message.items, layout: message.layout }));
        reportHeight();
      });

      post({ type: 'ready' });
    }).catch(fail);
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createRegistry: createRegistry, toCjs: toCjs };
  else boot();
})();
