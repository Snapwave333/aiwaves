import { escapeHtml, renderMarkdown } from './markdown';

describe('the aiwave411 Markdown renderer', () => {
  it('escapes everything first: no HTML from the document gets through', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(escapeHtml(`a&b"'`)).toBe('a&amp;b&quot;&#39;');
  });

  it('renders headings one level down (the document title is the panel h2), lists, quotes, code', () => {
    const html = renderMarkdown(
      '# Title\n\n## Rules\n\n- **never** change `her vocal chain`\n- a *note*\n\n> read me first\n\n```\nnpm test\n```\n\n1. one\n2. two',
    );
    expect(html).toContain('<h2>Title</h2>');
    expect(html).toContain('<h3>Rules</h3>');
    expect(html).toContain('<ul><li><strong>never</strong> change <code>her vocal chain</code></li><li>a <em>note</em></li></ul>');
    expect(html).toContain('<blockquote>read me first</blockquote>');
    expect(html).toContain('<pre><code>npm test</code></pre>');
    expect(html).toContain('<ol><li>one</li><li>two</li></ol>');
  });

  it('renders tables, keeps links as text with their address, joins paragraph lines', () => {
    const html = renderMarkdown(
      '| Section | Bars |\n|---|---|\n| intro | 0–8 |\n\nSee [the repo](https://example.com/x)\nfor more.',
    );
    expect(html).toContain('<table><thead><tr><th>Section</th><th>Bars</th></tr></thead><tbody><tr><td>intro</td><td>0–8</td></tr></tbody></table>');
    expect(html).toContain('<span class="md-link" title="https://example.com/x">the repo</span>');
    expect(html).not.toContain('<a ');
    expect(html).toContain('<p>See <span class="md-link" title="https://example.com/x">the repo</span> for more.</p>');
  });
});
