/**
 * Apply saved theme before paint (external file — MV3 CSP forbids inline scripts).
 */
(function () {
  try {
    var t = localStorage.getItem('lantern-theme');
    if (t === 'light' || t === 'dark') {
      document.documentElement.setAttribute('data-theme', t);
    } else if (
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: light)').matches
    ) {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  } catch (e) {
    /* ignore */
  }
})();
