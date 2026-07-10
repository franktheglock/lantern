// Deprecated — service worker is now background.js at the extension root.
// Left so old cache references fail loudly with a clear message if misconfigured.
throw new Error(
  'Lantern: update manifest to use background.js (remove background/service-worker.js path)'
);
