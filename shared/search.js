/**
 * Web search provider implementations.
 * Each provider exports a search(query, settings) function that returns
 * a JSON string with { query, results: [...], note }.
 */

function normalize(endpoint) {
  return (endpoint || '').replace(/\/+$/, '');
}

function formatResults(results) {
  return JSON.stringify(
    {
      query: results._query || '',
      results: (results._list || []).slice(0, 8).map(function (r, i) {
        return {
          n: i + 1,
          title: r.title || '',
          url: r.url || '',
          content: (r.content || r.snippet || '').slice(0, 400),
          engine: r.engine || '',
        };
      }),
      note: results._list && results._list.length
        ? 'Use read_url on promising links for full text.'
        : 'No results. Try a different query.',
    },
    null,
    2
  );
}

/** SearXNG — self-hosted meta-search engine */
function searchSearxng(settings, query) {
  var base = normalize(settings.searxngUrl || 'http://192.168.1.129:55001');
  var url = base + '/search?q=' + encodeURIComponent(query) + '&format=json';
  return fetch(url, { headers: { Accept: 'application/json' } }).then(function (res) {
    if (!res.ok) {
      return res.text().then(function (t) {
        throw new Error('SearXNG error (' + res.status + '): ' + (t || res.statusText).slice(0, 200));
      });
    }
    return res.json().then(function (data) {
      return formatResults({
        _query: query,
        _list: (data.results || []).map(function (r) {
          return { title: r.title, url: r.url, content: r.content, engine: r.engine || (r.engines && r.engines[0]) || '' };
        }),
      });
    });
  });
}

/** Exa (exa.ai) — neural search API */
function searchExa(settings, query) {
  var key = (settings.keyExa || '').trim();
  if (!key) return Promise.resolve(JSON.stringify({ error: 'Exa API key not set. Add it in Settings.' }));
  return fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'x-api-key': key,
    },
    body: JSON.stringify({ query: query, numResults: 8, contents: { text: true } }),
  }).then(function (res) {
    if (!res.ok) {
      return res.text().then(function (t) {
        throw new Error('Exa error (' + res.status + '): ' + (t || res.statusText).slice(0, 200));
      });
    }
    return res.json().then(function (data) {
      var results = (data.results || []).map(function (r) {
        return { title: r.title || '', url: r.url || '', content: (r.text || r.snippet || '').slice(0, 400), engine: 'exa' };
      });
      return formatResults({ _query: query, _list: results });
    });
  });
}

/** ParallelSearch — AI-powered search */
function searchParallel(settings, query) {
  var key = (settings.keyParallel || '').trim();
  if (!key) return Promise.resolve(JSON.stringify({ error: 'Parallel API key not set. Add it in Settings.' }));
  return fetch('https://api.parallelsearch.com/v1/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': 'Bearer ' + key,
    },
    body: JSON.stringify({ query: query, num_results: 8, include_snippets: true }),
  }).then(function (res) {
    if (!res.ok) {
      return res.text().then(function (t) {
        throw new Error('Parallel error (' + res.status + '): ' + (t || res.statusText).slice(0, 200));
      });
    }
    return res.json().then(function (data) {
      var results = (data.results || data.data || []).map(function (r) {
        return { title: r.title || '', url: r.url || r.link || '', content: (r.snippet || r.content || '').slice(0, 400), engine: 'parallel' };
      });
      return formatResults({ _query: query, _list: results });
    });
  });
}

/** Tinyfish — lightweight search API */
function searchTinyfish(settings, query) {
  var key = (settings.keyTinyfish || '').trim();
  if (!key) return Promise.resolve(JSON.stringify({ error: 'Tinyfish API key not set. Add it in Settings.' }));
  return fetch('https://api.tinyfish.io/v1/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': 'Bearer ' + key,
    },
    body: JSON.stringify({ q: query, count: 8 }),
  }).then(function (res) {
    if (!res.ok) {
      return res.text().then(function (t) {
        throw new Error('Tinyfish error (' + res.status + '): ' + (t || res.statusText).slice(0, 200));
      });
    }
    return res.json().then(function (data) {
      var results = (data.results || data.data || []).map(function (r) {
        return { title: r.title || '', url: r.url || r.link || '', content: (r.snippet || r.text || '').slice(0, 400), engine: 'tinyfish' };
      });
      return formatResults({ _query: query, _list: results });
    });
  });
}

/** Dispatch to the active search provider */
export function webSearch(settings, query) {
  var provider = (settings.searchProvider || 'searxng').trim();
  var q = String(query || '').trim();
  if (!q) return Promise.resolve(JSON.stringify({ error: 'Missing query' }));
  switch (provider) {
    case 'exa': return searchExa(settings, q);
    case 'parallel': return searchParallel(settings, q);
    case 'tinyfish': return searchTinyfish(settings, q);
    default: return searchSearxng(settings, q);
  }
}
