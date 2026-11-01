// Google Analytics 4 for the web app (app.nosus.foo) and the legal pages
// (privacy, terms, account deletion, served on nosus.foo and app.nosus.foo).
// Founder decision, 27 Oct 2026: GA on every page, no consent gate. One web
// stream covers nosus.foo and app.nosus.foo, so GA_MEASUREMENT_ID must match
// homepage/src/lib/links.ts (homepage/scripts/google-tags.test.cjs checks).
// The marketing site loads GA from its own shim (legacyLinkShim.ts), not here.
//
// The web app's address must never reach Google: a one-open link carries its
// key after the #, a Go pairing link its session secret, and
// app.nosus.foo/join/CODE an invite code in the path. So index.html loads this
// with data-mode="app", which only adds ga.html, a hidden frame, once the page
// has loaded. GA runs inside that frame (data-mode="frame"): its own address is
// clean, and it has no links, forms or scrolling for GA's automatic events to
// see. It sends one page view per app load, at this origin plus at most a route
// name from ROUTES (never an ID, code or key), any utm_* tags, and the
// referring site's origin only. GA cannot measure engagement time from a frame.
//
// Only on the live hosts (nosus.foo, www.nosus.foo, app.nosus.foo), like the
// app's own analytics (AnalyticsService.shouldRecord): a local or preview copy
// never counts. Never in an automated browser (navigator.webdriver: our tests,
// renders and many bots), and never in the founder's browser: ?me=1 once on a host turns
// GA off there for good, ?me=0 turns it back on (as nosus.foo's ?me=1 does).
// ?ga_debug=1 sends debug_mode, so the hit shows in GA DebugView.
(function (w, d) {
  var GA_MEASUREMENT_ID = 'G-VW75E3R383';
  // The app's link routes, by name (lib/main.dart _routeIncomingWebLink).
  var ROUTES = ['burn', 'burnfile', 'burnfiles', 'redeem', 'v', 'join', 'go', 'canary'];

  function founder(search) {
    var m = /[?&]me=([^&#]*)/.exec(search), me = m ? m[1] : null;
    try {
      var ls = w.localStorage;
      if (me === '1') ls.setItem('nosus_me', '1');
      else if (me === '0') ls.removeItem('nosus_me');
      return me === '1' || (me !== '0' && ls.getItem('nosus_me') === '1');
    } catch (e) {
      return me === '1';
    }
  }

  /** Only the utm_* pairs of a query string, as they were written. */
  function utm(search) {
    var keep = [];
    var parts = String(search || '').replace(/^\?/, '').split('&');
    for (var i = 0; i < parts.length; i++) {
      if (/^utm_(source|medium|campaign|content|term)=[^&#]*$/.test(parts[i])) keep.push(parts[i]);
    }
    return keep.join('&');
  }

  function param(search, name) {
    var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(search);
    try { return m ? decodeURIComponent(m[1]) : ''; } catch (e) { return ''; }
  }

  try {
    var script = d.currentScript;
    var mode = (script && script.getAttribute('data-mode')) || 'page';
    var l = w.location, search = l.search || '';
    if (!/^G-[A-Z0-9]+$/.test(GA_MEASUREMENT_ID) || w.navigator.webdriver) return;
    if (!/^((www|app)\.)?nosus\.foo$/.test(l.hostname || '')) return;

    if (mode === 'app') {
      if (founder(search)) return;
      var m = /^#\/?([a-z]+)\//.exec(l.hash || '') || /^\/([a-z]+)\//.exec(l.pathname || '/');
      var route = m && ROUTES.indexOf(m[1]) >= 0 ? m[1] : '';
      var ref = '';
      try {
        var r = new URL(d.referrer);
        if (r.origin !== l.origin && /^https?:$/.test(r.protocol)) ref = r.origin + '/';
      } catch (e) {}
      var src = 'ga.html?p=' + route + '&r=' + encodeURIComponent(ref) + '&u=' + encodeURIComponent(utm(search)) +
        (/[?&]ga_debug=1(?:&|$)/.test(search) ? '&d=1' : '');
      var add = function () {
        var f = d.createElement('iframe');
        f.src = src;
        f.hidden = true;
        f.tabIndex = -1;
        f.title = 'Analytics';
        f.setAttribute('aria-hidden', 'true');
        f.setAttribute('referrerpolicy', 'no-referrer');
        f.style.display = 'none';
        d.body.appendChild(f);
      };
      if (d.readyState === 'complete') add();
      else w.addEventListener('load', add);
      return;
    }

    var cfg = {};
    if (mode === 'frame') {
      var p = param(search, 'p');
      var u = utm(param(search, 'u'));
      var from = param(search, 'r');
      cfg.page_location = l.origin + '/' + (ROUTES.indexOf(p) >= 0 ? p + '/' : '') + (u ? '?' + u : '');
      if (/^https?:\/\/[^/?#]+\/$/.test(from)) cfg.page_referrer = from;
      cfg.page_title = 'NO SUS web app';
      if (param(search, 'd') === '1') cfg.debug_mode = true;
    } else {
      // A legal page: its own address, unless the fragment is anything but a
      // plain #anchor (it never should be; then nothing is sent).
      if (l.hash && !/^#[A-Za-z][\w-]*$/.test(l.hash)) return;
      if (founder(search)) return;
      if (/[?&]ga_debug=1(?:&|$)/.test(search)) cfg.debug_mode = true;
    }
    w.dataLayer = w.dataLayer || [];
    w.gtag = function () { w.dataLayer.push(arguments); };
    w.gtag('js', new Date());
    w.gtag('config', GA_MEASUREMENT_ID, cfg);
    var g = d.createElement('script');
    g.async = true;
    g.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID;
    d.head.appendChild(g);
  } catch (e) {}
})(window, document);
