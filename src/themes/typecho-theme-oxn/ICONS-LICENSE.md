# 图标使用与授权说明 / Icon Usage and Licensing

本文说明 OXN Simple 主题中图标资源的来源、授权及使用要求。
This document describes the sources, licenses, and usage requirements for icon assets included in the OXN Simple theme.

## 1. GitHub Primer Octicons

OXN Simple 使用 GitHub Primer Octicons 图标库提供的 SVG 图标。项目依赖为 `@primer/octicons`，图标目录及 SVG 输出逻辑位于 `components/octicons.ts`。

OXN Simple uses SVG icons from the GitHub Primer Octicons library. The project dependency is `@primer/octicons`. The icon catalogue and SVG rendering logic are located in `components/octicons.ts`.

- 项目 / Project: [Primer Octicons](https://github.com/primer/octicons)
- 官方网站 / Official website: [primer.style/octicons](https://primer.style/octicons/)
- 授权协议 / License: MIT License
- 版权归属 / Copyright: GitHub, Inc.

Octicons 的 MIT 许可证全文见本目录中的 [OCTICONS-LICENSE.txt](./OCTICONS-LICENSE.txt)。
The full MIT license for Octicons is included in [OCTICONS-LICENSE.txt](./OCTICONS-LICENSE.txt) in this directory.

按照 MIT 许可证的要求，复制或再分发 Octicons 图标或其重要部分时，必须一并保留相应的版权声明和许可证文本。请勿删除或替换上游许可证中的版权及许可声明。
When copying or redistributing Octicons icons or substantial portions of them, you must include the applicable copyright notice and permission notice. Do not remove or replace the copyright and license notices in the upstream license text.

## 2. OXN theme assets

本主题目录中的 OXN 品牌资源（例如 `assets/favicon.svg` 和 `assets/favicon.ico`）不属于 GitHub Primer Octicons 图标库，也不因 Octicons 的 MIT 许可证而自动获得相同授权。

OXN-branded assets in this theme directory (for example, `assets/favicon.svg` and `assets/favicon.ico`) are not part of the GitHub Primer Octicons library and are not automatically covered by the Octicons MIT license.

使用、修改或再分发这些资源时，应遵循其各自适用的版权和授权条件；如未另行明确授权，请勿将 Octicons 的 MIT 许可视为这些资源的授权。
Use, modification, or redistribution of these assets must follow their own applicable copyright and licensing terms. Unless a separate license is expressly provided, do not treat the Octicons MIT license as permission to use these assets.

## 3. User-provided icons and custom SVG/HTML

主题允许在部分自定义链接等位置输入 Octicons 名称、SVG 或 HTML 片段。由主题使用者自行提供的图标、SVG、HTML 及其他素材，不属于 Octicons 图标库的授权范围，也不会因为被主题输出而改变其原有授权。

The theme allows users to provide Octicons names, SVG, or HTML fragments in certain custom-link fields. Icons, SVG, HTML, and other materials supplied by users are not covered by the Octicons license, and their original licensing terms are not changed merely because the theme renders them.

使用者应自行确认其拥有相关素材的使用、修改和发布权利，并遵守素材原作者或权利人的授权要求。
Users are responsible for ensuring that they have the necessary rights to use, modify, and publish the materials they provide, and for complying with the terms set by the original authors or rights holders.

## 4. Scope of this notice

本说明仅针对图标及相关视觉资源，不替代 OXN Simple 主题本身的许可证，也不改变主题中其他第三方依赖或资源各自适用的授权条件。如不同资源附有独立许可证，应以该资源对应的许可证为准。

This notice applies only to icons and related visual assets. It does not replace the license of the OXN Simple theme or alter the licenses applicable to other third-party dependencies or assets included in the theme. Where an asset has its own license, that asset's license governs.

---

**提示 / Note:** 再分发包含 Octicons 的主题副本时，请同时保留本说明及 `OCTICONS-LICENSE.txt`。
When redistributing a copy of the theme that includes Octicons, retain this notice and `OCTICONS-LICENSE.txt`.
