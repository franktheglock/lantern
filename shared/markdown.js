/**
 * Markdown → HTML for trusted model output (escaped first).
 */
export function renderMarkdown(src) {
  if (!src) return '';
  let s = escapeHtml(String(src));

  // Fenced code blocks (keep placeholders so inner markdown is not processed)
  const blocks = [];
  s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const i = blocks.length;
    blocks.push(
      `<pre class="md-code"><code class="lang-${lang || 'text'}">${code.replace(/\n$/, '')}</code></pre>`
    );
    return `\u0000BLOCK${i}\u0000`;
  });

  // Inline code
  s = s.replace(/`([^`\n]+)`/g, '<code class="md-inline">$1</code>');

  // Images ![alt](url)
  s = s.replace(
    /!\[([^\]]*)\]\((https?:[^)\s]+)\)/g,
    '<img class="md-img" src="$2" alt="$1" loading="lazy" />'
  );

  // Links [text](url)
  s = s.replace(
    /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  // Autolink bare URLs (not already in href)
  s = s.replace(
    /(^|[^"'>])(https?:\/\/[^\s<]+)/g,
    '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>'
  );

  // Bold / italic / strike (bold first)
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  s = s.replace(/_([^_\n]+)_/g, '<em>$1</em>');

  // Headings
  s = s.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
  s = s.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
  s = s.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  s = s.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  s = s.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^# (.+)$/gm, '<h3>$1</h3>');

  // Horizontal rule
  s = s.replace(/^(?:---|\*\*\*|___)\s*$/gm, '<hr class="md-hr" />');

  // Blockquotes
  s = s.replace(/^(?:> ?(.+)(?:\n|$))+?/gm, (block) => {
    const lines = block
      .trim()
      .split('\n')
      .map((l) => l.replace(/^> ?/, ''))
      .join('<br>');
    return `<blockquote class="md-quote">${lines}</blockquote>`;
  });

  // Tables (simple GFM)
  s = s.replace(
    /(?:^|\n)((?:\|.+\|\n)+)/g,
    (full, table) => {
      const rows = table.trim().split('\n').filter(Boolean);
      if (rows.length < 2) return full;
      if (!/^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(rows[1].trim())) return full;
      const parseRow = (row) =>
        row
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim());
      const head = parseRow(rows[0]);
      const body = rows.slice(2).map(parseRow);
      let html = '<table class="md-table"><thead><tr>';
      head.forEach((c) => {
        html += `<th>${c}</th>`;
      });
      html += '</tr></thead><tbody>';
      body.forEach((r) => {
        html += '<tr>';
        r.forEach((c) => {
          html += `<td>${c}</td>`;
        });
        html += '</tr>';
      });
      html += '</tbody></table>';
      return '\n' + html + '\n';
    }
  );

  // Unordered lists
  s = s.replace(/^(?:[-*+] .+(?:\n|$))+?/gm, (block) => {
    const items = block
      .trim()
      .split('\n')
      .map((line) => line.replace(/^[-*+] /, ''))
      .map((item) => `<li>${item}</li>`)
      .join('');
    return `<ul>${items}</ul>`;
  });

  // Ordered lists
  s = s.replace(/^(?:\d+\. .+(?:\n|$))+?/gm, (block) => {
    const items = block
      .trim()
      .split('\n')
      .map((line) => line.replace(/^\d+\. /, ''))
      .map((item) => `<li>${item}</li>`)
      .join('');
    return `<ol>${items}</ol>`;
  });

  // Paragraphs / line breaks
  s = s
    .split(/\n{2,}/)
    .map((para) => {
      const t = para.trim();
      if (!t) return '';
      if (/^<(h[3-6]|ul|ol|pre|blockquote|table|hr)/.test(t)) return t;
      if (t.includes('\u0000BLOCK')) return t.replace(/\n/g, '');
      return `<p>${para.replace(/\n/g, '<br>')}</p>`;
    })
    .join('');

  // Restore code blocks
  s = s.replace(/\u0000BLOCK(\d+)\u0000/g, (_, i) => blocks[Number(i)] || '');

  return s;
}

/** Pretty-print tool JSON for display */
export function formatToolPayload(value) {
  if (value == null) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  const str = String(value);
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function toolLabel(name) {
  if (name === 'web_search') return 'Web search';
  if (name === 'read_url') return 'Read URL';
  return name || 'Tool';
}
