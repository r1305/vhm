(function (global) {
  if (typeof global.__APP_BASE__ === 'undefined') {
    var p = global.location.pathname;
    var i = p.indexOf('/admin');
    global.__APP_BASE__ = i > 0 ? p.slice(0, i) : '';
  }
})(window);
