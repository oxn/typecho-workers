# CY HTML Enhancement — Preservation Contract

This document is a regression contract for the optional正文 HTML / CSS / JavaScript enhancement in `src/plugins/typecho-plugin-warm-cy`.

It must be carried forward in every later CY plugin/theme update. Do not remove or weaken these requirements when changing video players, Markdown handling, sanitization, navigation, or other plugin features.

## Scope and isolation

- The feature applies only to article and standalone-page body content, scoped to `.warm-prose` containers that are not marked `.warm-note-prose`.
- Runtime and enhancement styles may be injected only when `typecho-theme-warm-cy` is the active theme; the companion plugin must not affect other themes.
- Note content is rendered and owned by the independent notes plugin and is explicitly outside this feature's scope.
- Browser hydration must query and walk only `.warm-prose:not(.warm-note-prose)`; it must never scan note bodies, the whole document body, comments, navigation, footer, or other site chrome.
- It must not process comments.
- It must not take ownership of video players or alter the theme's native iframe behavior.
- Each feature switch is independent. Turning this feature off must not disable or alter unrelated CY features.
- Turning this feature off must bypass this feature's content protection, restoration, hydration, CSS, and JavaScript injection. It must not hide content that the normal theme pipeline would display.
- Turning it on must not change content outside the feature's documented scope.

## Required behavior when enabled

1. Preserve supported HTML structure and nesting through Markdown parsing and the core sanitizer.
2. Preserve common safe HTML attributes, including class, id, title, role, data-*, aria-*, dimensions, and permitted inline styles.
3. Preserve safe inline CSS and style blocks; reject dangerous CSS constructs and external resource tricks.
4. Preserve SVG viewBox casing and supported SVG geometry/paint attributes without passing unsafe SVG nodes through.
5. Support trusted administrator-authored inline JavaScript and explicitly supported external scripts, with deterministic execution order and safe URL/type validation.
6. Preserve iframe markup and safe iframe attributes such as src, width, height, title, allow, allowfullscreen, loading, referrerpolicy, and sandbox only when allowed by the content policy. The enhancement must not rewrite provider URLs or player attributes.
7. Keep code fences, inline code, pre/code blocks, and examples inert; never execute scripts contained in code examples.
8. Handle nested block HTML across Markdown blank lines without introducing invalid paragraph nesting.

## Security requirements

- This is an opt-in trusted-author feature, not an unrestricted sanitizer bypass.
- Do not restore event-handler attributes (for example onclick/onerror), javascript: URLs, unsafe data URLs, or unsafe SVG references.
- Validate URL protocols and script source origins according to the explicit policy.
- Do not execute content from comments or untrusted users.
- If a fragment fails validation, fail safely without breaking the rest of the article.

## Regression tests required

At minimum, tests must cover:
- switch OFF: content hooks do not protect/restore/hydrate, no enhancement runtime/style is injected, and visible content is not hidden;
- switch ON: nested HTML, classes/IDs/data/aria attributes, inline CSS, style blocks, SVG, and scripts survive the intended pipeline;
- script examples inside code remain inert;
- iframe tags and safe attributes survive without player rewriting;
- malformed or unsafe HTML/URLs/scripts are rejected safely;
- changing the setting invalidates any render cache so ON/OFF changes take effect immediately;
- unrelated plugin features continue to work when this feature is OFF.

## Update rule

Any future refactor that touches Markdown filters, sanitizer options, content rendering hooks, archive footer injection, or plugin settings must run these tests and preserve this contract. Do not delete this document as cleanup without replacing it with an equivalent contract and regression suite.
## CSS and script execution boundaries

- Restored style blocks must be parsed by the browser CSSOM and every ordinary style selector must be scoped beneath .warm-prose:not(.warm-note-prose). Grouping rules such as media/supports/container/layer must retain their structure while their nested style rules are scoped.
- Global descriptor rules and unsupported at-rules (including imports, font-face, page, namespace, and unknown rule types) must be rejected rather than injected unscoped. If CSSOM parsing or scoping is unavailable, discard the style block (fail closed).
- Keyframe step selectors are not ordinary document selectors and must not be prefixed. Their definitions remain global CSS identifiers; article-authored animation names are trusted-author content and may collide with other page styles.
- Inline and external scripts are trusted administrator-authored code, not sandboxed content. They execute in the page's normal JavaScript context and can access the full document. Never describe body-scoped extraction as DOM sandboxing. Keep type/protocol/origin validation and preserve deterministic order.