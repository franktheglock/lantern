import { build } from 'esbuild';

await build({
  entryPoints: {
    'youtube-transcript': 'src/youtube-transcript-wrapper.js',
  },
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  outdir: 'lib',
  sourcemap: false,
  minify: false,
  logLevel: 'info',
});
