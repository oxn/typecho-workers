// @ts-ignore KaTeX auto-render does not ship TypeScript declarations.
import renderMathInElement from 'katex/contrib/auto-render';
declare global { interface Window { __oxnMarkdownMathRuntime?: { initialize(root: Element): void } } }
const rendered = new WeakSet<Element>();
const delimiters = [
 {left:'$$',right:'$$',display:true},
 {left:'\\[',right:'\\]',display:true},
 {left:'\\(',right:'\\)',display:false},
 {left:'$',right:'$',display:false},
];
function initialize(root: Element): void {
 if (rendered.has(root)) return;
 rendered.add(root);
 renderMathInElement(root,{
  delimiters,throwOnError:false,strict:'ignore',
  ignoredTags:['script','noscript','style','textarea','pre','code','option'],
  ignoredClasses:['katex','tex2jax_ignore','mathjax_ignore'],
 });
}
window.__oxnMarkdownMathRuntime = {initialize};
