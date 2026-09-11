(function (global) {
  if (typeof global.__APP_BASE__ === 'undefined') {
    var p = global.location.pathname;
    var i = p.indexOf('/admin');
    global.__APP_BASE__ = i > 0 ? p.slice(0, i) : '';
  }
  var root = global.document.documentElement;
  root.setAttribute('data-product', 'tribu');
  var theme = global.localStorage.getItem('theme');
  if (theme === 'dark') root.setAttribute('data-theme', 'dark');
})(window);
