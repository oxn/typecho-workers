import mermaid from 'mermaid';
declare global { interface Window { __oxnMarkdownMermaidRuntime?: { mermaid: typeof mermaid } } }
// Separate bundle: downloaded only if an enabled page contains Mermaid blocks.
window.__oxnMarkdownMermaidRuntime = {mermaid};
