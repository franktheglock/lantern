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
      results: (results._list || []).slice(0, 8).map((r, i) => ({
        n: i + 1,
        title: r.title || '',
        url: r.url || '',
        content: (r.content || r.snippet || '').slice(0, 400),
        engine: r.engine || '',
      })),
      note: results._list && results._list.length
        ? 'Use read_url on promising links for full text.'
        : 'No results. Try a different query.',
    },
    null,
    2
  );
}

/** SearXNG — self-hosted meta-search engine */
async function searchSearxng(settings, query) {
  const base = normalize(settings.searxngUrl || 'http://192.168.1.129:55001');
  const url = `${base}/search?q=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`SearXNG error (${res.status}): ${(t || res.statusText).slice(0, 200)}`);
  }
  const data = await res.json();
  return formatResults({
    _query: query,
    _list: (data.results || []).map((r) => ({
      title: r.title,
      url: r.url,
      content: r.content,
      engine: r.engine || (r.engines && r.engines[0]) || '',
    })),
  });
}

/** Exa (exa.ai) — neural search API */
async function searchExa(settings, query) {
  const key = (settings.keyExa || '').trim();
  if (!key) return JSON.stringify({ error: 'Exa API key not set. Add it in Settings.' });
  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'x-api-key': key,
    },
    body: JSON.stringify({ query, numResults: 8, contents: { text: true } }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Exa error (${res.status}): ${(t || res.statusText).slice(0, 200)}`);
  }
  const data = await res.json();
  const results = (data.results || []).map((r) => ({
    title: r.title || '',
    url: r.url || '',
    content: (r.text || r.snippet || '').slice(0, 400),
    engine: 'exa',
  }));
  return formatResults({ _query: query, _list: results });
}

/** ParallelSearch — AI-powered search */
async function searchParallel(settings, query) {
  const key = (settings.keyParallel || '').trim();
  if (!key) return JSON.stringify({ error: 'Parallel API key not set. Add it in Settings.' });
  const res = await fetch('https://api.parallelsearch.com/v1/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({ query, num_results: 8, include_snippets: true }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Parallel error (${res.status}): ${(t || res.statusText).slice(0, 200)}`);
  }
  const data = await res.json();
  const results = (data.results || data.data || []).map((r) => ({
    title: r.title || '',
    url: r.url || r.link || '',
    content: (r.snippet || r.content || '').slice(0, 400),
    engine: 'parallel',
  }));
  return formatResults({ _query: query, _list: results });
}

/** Tinyfish — lightweight search API */
async function searchTinyfish(settings, query) {
  const key = (settings.keyTinyfish || '').trim();
  if (!key) return JSON.stringify({ error: 'Tinyfish API key not set. Add it in Settings.' });
  const url = `https://api.search.tinyfish.ai?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'X-API-Key': key,
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Tinyfish error (${res.status}): ${(t || res.statusText).slice(0, 200)}`);
  }
  const data = await res.json();
  const results = (data.results || []).map((r) => ({
    title: r.title || '',
    url: r.url || '',
    content: (r.snippet || '').slice(0, 400),
    engine: 'tinyfish',
  }));
  return formatResults({ _query: query, _list: results });
}

/** Dispatch to the active search provider */
export async function webSearch(settings, query) {
  const provider = (settings.searchProvider || 'searxng').trim();
  const q = String(query || '').trim();
  if (!q) return JSON.stringify({ error: 'Missing query' });
  switch (provider) {
    case 'exa': return searchExa(settings, q);
    case 'parallel': return searchParallel(settings, q);
    case 'tinyfish': return searchTinyfish(settings, q);
    default: return searchSearxng(settings, q);
  }
}
