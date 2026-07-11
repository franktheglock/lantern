/**
 * Thin wrapper around youtube-transcript for bundling.
 * Exposes fetchTranscript globally so background.js (classic script)
 * can access it via importScripts().
 */
import { YoutubeTranscript } from 'youtube-transcript';

globalThis.__ytFetchTranscript = function (videoId) {
  return YoutubeTranscript.fetchTranscript(videoId)
    .then(function (segments) {
      if (!Array.isArray(segments) || !segments.length) return null;
      return segments
        .map(function (s) { return s.text; })
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    })
    .catch(function () {
      return null;
    });
};
