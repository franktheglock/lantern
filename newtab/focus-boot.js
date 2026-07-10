/**
 * Early focus attempt on the search field (before module loads).
 * Omnibox may still steal focus — newtab.js continues reclaiming.
 */
(function () {
  function focusQuery() {
    var el = document.getElementById('query');
    if (!el) return;
    try {
      el.focus({ preventScroll: true });
    } catch (e) {
      try {
        el.focus();
      } catch (e2) {
        /* ignore */
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', focusQuery);
  } else {
    focusQuery();
  }
  setTimeout(focusQuery, 0);
  setTimeout(focusQuery, 50);
  setTimeout(focusQuery, 150);
  setTimeout(focusQuery, 400);
})();
