# Audit Bugfix Implementation Plan

**Goal:** 修复 2026-09-08 审查确认的全部 10 类问题，优先消除错误文件操作，再修复扫描误报、漏报、CLI 判定及报告展示。

**Architecture:** 保留八个扫描器、集中 action policy、修复确认和验证链。引用索引修复在公共入口完成；Markdown 修复按真实语法位置操作，CLI 复用必要的纯解析能力；YAML 使用标准解析器。展示修复不改变 fingerprint 或扫描判定。

**Tech Stack:** TypeScript、Obsidian API、Vitest、esbuild、CSS；拟新增构建依赖 `mdast-util-from-markdown`，将已有间接依赖 `js-yaml` 声明为直接构建依赖。

**Baseline:** `main` at `f1fa6502b9d50c2e848ebd6aed0230910497daa7`。PR #166 已合并；当前产品版本 0.8.0。基线完整门禁通过：56 个测试文件、780 项测试、8 个 npm 打包文件。

**Status:** 仅计划；下列执行项均未实施。本计划不授权自动发布版本或操作真实库中的内容。

## 1. 完整问题清单与提交映射

编号沿用审查的逻辑顺序。10 类问题展开为 11 个修复提交；最后 1 个文档与整体验收提交，总计 12 个实现提交。计划文档自身如需提交，单独使用 `docs: add audit bugfix implementation plan`，不计入实现提交。

| 问题 | 优先级 | 明确覆盖的根因/场景 | 提交 |
|---|---|---|---|
| B01 引用索引遗漏片段引用 | P1 | PDF `#page`、笔记 `#heading`、块 `#^id`、同文件片段；body link/embed/frontmatter 三种入口 | C01 |
| B02 修复链接越界改写 | P1 | 缩进代码块、转义字面量；保留已有围栏、行内代码、HTML 注释保护 | C02 |
| B03 有效块引用误报 | P2 | `cache.blocks` 已存在却只查 headings；CLI 同样需要提供 blocks | C03 |
| B04 同文件标题链接漏报 | P2 | Wiki/Markdown 的空文件部分没有回到 sourcePath | C04 |
| B05 外链合法右括号被截断 | P2 | 平衡括号保留、句末多余括号去除、metadata/body 重复提取 | C08 |
| B06 CLI fail-on 优先级错误 | P2 | 显式 `--fail-on any` 与默认 any 无法区分 | C05 |
| B07 CLI 合法链接误报 | P2 | B07a URL 编码路径；B07b 平衡括号目标，两个独立根因 | C06、C07 |
| B08 CLI YAML 类型误报 | P2 | B08a 行尾注释；B08b 无缩进 sequence；兼顾标量、嵌套结构和错误输入 | C09 |
| B09 新增摘要口径错误 | P2 | headline 少算 candidate/unverified/info；CTA 与摘要、既存筛选一致 | C10 |
| B10 含逗号路径拆坏 | P2 | 展示、点击跳转、Markdown 导出均误拆 evidence.paths | C11 |

不把以下事项混入已确认 bug：并发编辑覆盖窗口、真实桌面 metadata 更新时序、Canvas 损坏与 Resolved 同时出现。这些仅作为针对性观察项，不能靠推测修改领域行为。CSS/Dataview 等明确未支持的引用来源不扩展到本轮。

## 2. 修复顺序与边界

按 C01 → C02 → C03 → C04 → C05 → C06 → C07 → C08 → C09 → C10 → C11 → C12 顺序集成。

- 第一阶段 C01–C04：文件操作安全与插件链接正确性。C02 新建解析模块，C03 的 CLI 块提取、C07 的 Markdown 提取可复用它。
- 第二阶段 C05–C09：CLI 退出码、路径和 YAML；外链仍保持独立 scanner commit。
- 第三阶段 C10–C11：摘要和路径展示。两个展示提交不掺入 scanner 修改。
- 第四阶段 C12：全问题复现、包验证、真实 Obsidian 验收及文档收尾。
- 测试设计可以并行，但修改 `cli/local-vault.ts` 的 C03/C06/C07/C09 必须串行集成，禁止多人同时重写该文件。
- 不做大规模架构重构，不增加扫描器、设置模式、修复命令或网络默认开关。
- 不更改公开 `Issue` / CLI JSON 字段类型；尤其不把 `evidence.paths` 从字符串改为数组。
- 不放宽 blocked/review-required、duplicate keep choice、preflight、最终验证和 CLI read-only 边界。
- 本轮不直接 bump 产品版本、打 tag、发布 npm 或 release；发布应在这些修复合并并验收后单独规划。

### 扫描基线兼容性

B01/B03/B04/B05/B07/B08 会改变发现集合，必须防止旧结果被当作可靠的 new/resolved 对照。C01 将 `COMPARISON_VERSION` 从当前 2 提升到 3，并补充本轮语义变化注释；保持 `SNAPSHOT_SCHEMA_VERSION = 1` 和 CLI `schemaVersion = 1`。

```ts
export const COMPARISON_VERSION = 3;
```

必须验证旧 comparisonVersion=2 的插件 snapshot 得到 `semantics-changed`，不输出假的 resolved；旧 CLI profile baseline 返回 2，包含明确重新生成提示，`--fail-on none` 也不能覆盖不兼容错误。legacy baseline 维持现有 fingerprint-only 警告和行为。

版本 3 覆盖同一未发布修复系列。若拆分 PR 且中途有版本发布，后续新的检测语义必须再提升 comparisonVersion，不能复用已经对外发布的语义编号。执行前核对最新 main 的编号，避免覆盖并行变更。

## 3. 公共执行和验证约定

每个 Cxx 都执行以下检查条目；任务内另外列出专属 fixture 和命令：

- [ ] 确认本次修改的 source/test/doc 文件范围和前置提交。
- [ ] 将下面列出的输入与预期写入持久回归测试，不依赖审查时 `/tmp` 文件。
- [ ] 先运行专属测试，确认失败原因就是该 bug，而非 fixture/import 错误。
- [ ] 实施方案，运行专属测试并确认通过。
- [ ] 复查本次 diff，运行完整提交门禁并提交本任务涉及的文件。

每个实现提交前的完整门禁：

```bash
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test && npm pack --dry-run
```

预期全部退出 0；`npm pack --dry-run` 仍为既定 8 个文件。测试数量会增加，不能以“仍为 780”作为验收标准。缓存不可写时可用独立临时 npm cache；loopback 测试因权限失败时须在允许本地监听的环境重跑，不得删测试或禁用规则。

所有提交 conventional commits，英文、描述实际修改。不得 `eslint-disable obsidianmd/*`。工作分支建议 `fix/audit-correctness`；当前请求只产生计划，不创建实现分支。

## 4. C01 — 修复引用索引并建立新的比较基线

**Commit:** `fix: preserve fragment references in the reference index`

**Files:** `src/scanner/reference-index.ts`；`src/snapshot/scan-snapshot.ts`；`src/tests/reference-index.test.ts`、`scanner-precision.test.ts`、`action-policy.test.ts`、`result-diff.test.ts`、`scan-snapshot.test.ts`、`cli.test.ts`。

**方案：**

1. 在 `resolveTarget` 中剥离 `#` 子路径后，再调用 desktop `getFirstLinkpathDest`，不让每个 scanner 各自补救。
2. 先判断原始值是否 URI，保留相对路径、大小写解析交给 Obsidian；不要对普通文件名盲目 URI decode。
3. 对 `#Heading`/`#^block`，使用 sourcePath 作为当前文件引用。空字符串仍不构造引用。
4. Obsidian resolver 存在而返回 null 时，不转入自定义 basename 猜测；fallback 只服务没有该 API 的适配器。
5. test double 必须像 desktop 一样拒绝未剥离的片段，不能自动帮被测代码修复参数。

核心改法：

```ts
const fragmentAt = link.indexOf("#");
const linkpath = fragmentAt === -1 ? link : link.slice(0, fragmentAt);
const target = linkpath || (fragmentAt === 0 ? sourcePath : "");
if (!target) return null;
return ctx.metadataCache.getFirstLinkpathDest(target, sourcePath)?.path ?? null;
```

保留现有 URI guard 和无 API fallback 分支；将比较版本修改与本次第一个检测修复原子提交。

**回归输入/断言：**

- `![[manual.pdf#page=2]]` → `inboundByPath.get("manual.pdf").count === 1`，不再报告可删除孤立附件。
- `[[Target#Heading]]`、`[[Target#^block]]`、frontmatter 中同样引用 → 指向 Target.md，reference kind 正确。
- 同页 `[[#Heading]]` → sourcePath；不能计到空路径。
- 包含普通链接和片段链接的重复组 → 被引用副本保留策略与 impact 计数正确。
- 缺失缓存/坏 Canvas → coverageComplete 仍为 false；不能因片段归一化把失败当成功。
- snapshot v2→v3、CLI baseline v2→v3 的不兼容行为按第 2 节验证。

```bash
npm test -- src/tests/reference-index.test.ts src/tests/scanner-precision.test.ts src/tests/action-policy.test.ts src/tests/result-diff.test.ts src/tests/scan-snapshot.test.ts src/tests/cli.test.ts
```

**验收：** 真实 Obsidian 的 PDF 页面嵌入 fixture 不出现 trash action；错误引用数为 0 的原始用例先红后绿。

## 5. C02 — 将链接修复限制在当前文本中的有效语法范围

**Commit:** `fix: restrict link fixes to parsed source ranges`

**Files:** 新建 `src/utils/markdown-source.ts`、`src/tests/markdown-source.test.ts`；修改 `src/fix/fix-executor.ts`、`src/tests/fix-executor.test.ts`、`src/tests/fix-runner.test.ts`、`package.json`、`package-lock.json`。

**方案选择：** 不继续叠加全文 regex 的代码块例外。使用 `mdast-util-from-markdown` 解析当前读取的原文，获得源位置；直接按源区间拼接替换，绝不 AST stringify 整篇笔记。该库提供 Markdown AST，支持浏览器构建，但需由现有 esbuild 打包，不能把 ESM 外部依赖留给 Obsidian 运行时。

```ts
export type SourceRange = { start: number; end: number };
export type MarkdownSourceLink = SourceRange & {
  kind: "link" | "image";
  original: string;
  destination: string;
};
// 三个导出均在本任务实现并独立测试。
export function markdownLinks(content: string): MarkdownSourceLink[];
export function wikiLinkRanges(content: string): SourceRange[];
export function blockIds(content: string): string[];
```

接口职责和算法：

- `markdownLinks`：遍历 AST 中标准 `link`/`image` 节点，读取 offset 与 URL；只返回 offset 完整且 `content.slice(start,end)` 是完整源语法的节点。暂不把引用式链接变成新的可修复种类。
- `wikiLinkRanges`：在 AST 普通文本节点对应的原文范围内匹配 Wiki 语法；排除奇数个反斜杠转义的起始括号，保持 `![[...]]` 与 `[[...]]` 区分。不从 code、inlineCode、html、已有标准链接目标中识别 Wiki。
- `blockIds`：从有效正文节点的行尾/独立块 ID 标记提取 ID，用于 C03；不从 code/html/comment/frontmatter 取 ID。不改变 Markdown 本身。
- frontmatter 在解析前以保长空白遮罩，换行、字符 offset 必须不变；采用现有 splitFrontmatter 的同等边界，包括 BOM/CRLF。HTML 注释和原有保护测试必须继续成立。
- 解析器不能可靠确认的语法不修改，返回 0/现有 skipped outcome；不回退全文匹配。
- `original` 精确匹配、alias replacement、embed 删除仍按既有动作 metadata 决定。legacy `linkText` 路径也必须经过合法 Wiki ranges，不能保留旧全局替换漏洞。
- 同一目标多处有效链接仍可按既有行为一起替换；只限制位置，不改变替换为显示文本的规则。

替换阶段核心算法（ranges 先按 start 排序并保证不重叠）：

```ts
let cursor = 0;
let updated = "";
for (const { start, end } of ranges) {
  updated += content.slice(cursor, start) + replacement;
  cursor = end;
}
updated += content.slice(cursor);
if (updated === content) return 0;
```

**精确回归：**

```ts
const original = "[Missing](missing.md)";
const before = `${original}\n\n    ${original}\n\n\\${original}`;
const expected = `Missing\n\n    ${original}\n\n\\${original}`;
```

用现有 `makeApp`/`executeFixAction` 断言 `modify` 写入 expected。再分别覆盖 tab 缩进、列表/引用内代码、奇偶反斜杠、普通 Wiki、Wiki alias、embed、Markdown image、围栏/行内 code、HTML 注释、CRLF、无匹配和多处真实匹配。修复后原文非目标区间逐字节保持一致。

```bash
npm test -- src/tests/markdown-source.test.ts src/tests/fix-executor.test.ts src/tests/fix-runner.test.ts
```

**验收：** AST 只用于查源位置；插件包没有新增 Node runtime import。记录 main.js/cli.js 增量及大笔记解析耗时，不引入每个候选链接重复解析整篇文本的循环。C03/C07 复用本任务的解析输出。

## 6. C03 — 正确检查块引用，补齐 CLI blocks

**Commit:** `fix: validate block references against block metadata`

**Files:** `src/scanner/scanners/broken-links.ts`、`cli/local-vault.ts`、`src/utils/markdown-source.ts`；测试 `broken-links.test.ts`、`local-vault.test.ts`、`cli.test.ts`、`fix-executor.test.ts`。

**方案：**

- `headingPart` 以 `^` 开头时走块 ID 判定，查 `cache.blocks`，不再送入标题 slugifier。
- 沿用 Obsidian 实际块 ID 匹配的大小写行为；不能用标题 slugifier 删除 ID 字符后匹配。
- 已有块不输出 finding，更不能生成 remove-link action；缺失块使用准确的块提示语。非块的标题逻辑独立保留。
- CLI `LocalMetadata` 增加 blocks，并用 C02 的 `blockIds` 构造有效 ID lookup；适配类型不伪造未知源码位置给修复执行器。CLI 没有 mutation 路径。
- 不更改无关 fingerprint 结构；缺失块沿用现有字段类型，语义差异由新的 comparisonVersion 隔离。

```ts
const hasBlock = Object.keys(cache.blocks ?? {}).some(
  (id) => id.toLowerCase() === headingPart.slice(1).toLowerCase(),
);
```

**回归：** `[[Target#^valid-block]]`、alias、embed；缺失块；块 ID 位于代码示例时不算有效；Target 同时有同名标题也不能替代块。CLI 创建 `Target.md` 正文 `Body ^valid-block` 后运行 broken-links，预期不存在有效块误报。纯标题有效/缺失用例继续通过。

```bash
npm test -- src/tests/broken-links.test.ts src/tests/local-vault.test.ts src/tests/cli.test.ts src/tests/fix-executor.test.ts
```

## 7. C04 — 同文件片段链接使用源笔记校验

**Commit:** `fix: validate same-note heading links`

**Files:** `src/scanner/scanners/broken-links.ts`；测试 `broken-links.test.ts`、`cli.test.ts`。

**方案：** 在空目标提前返回前判断是否存在片段；空文件部分加非空片段时，resolvedPath 使用 sourcePath，复用 C03 的块/标题判定。不得通过简单改 `getLinkTarget` 改坏其它调用方。

```ts
const sameNote = rawTarget === "" && linkText.startsWith("#");
if ((!rawTarget && !sameNote) || hasUriScheme(rawTarget)) return [];
```

**回归：** `[[#Missing]]`、`[jump](#Missing)`、`![[#Missing]]` 均应报缺失标题；有效同页标题不报；`[[#^valid-block]]` 复用有效块判定；`#` 空锚点不当作缺失标题；外部 URL 的 `#fragment` 不查库内标题。`ignoreUnresolvedNoteLinks` 开启也不能隐藏缺失标题/块。

```bash
npm test -- src/tests/broken-links.test.ts src/tests/cli.test.ts
```

## 8. C05 — 显式 fail-on 参数优先于配置

**Commit:** `fix: honor explicit CLI fail-on thresholds`

**Files:** `cli/cli.ts`、`src/tests/cli.test.ts`。

**方案：** 给内部 ParsedArgs 增加布尔字段记录是否显式输入 fail-on，默认 false；parseArgs 遇到参数时设 true，loadConfig 依据该字段选值。该内部字段不得进入 JSON 输出或 profile。

```ts
// ParsedArgs 增加 failOnExplicit: boolean，初始化为 false。
options.failOn = value;
options.failOnExplicit = true;
// loadConfig 合并：
failOn: args.failOnExplicit ? args.failOn : config.failOn ?? args.failOn,
```

**回归矩阵：** 配置 none + 显式 any + 真实断链 → exit 1；配置 error + 显式 any + 仅 warning → exit 1；省略参数时遵循配置；无配置默认 any；显式 none 返回 0；旧 baseline 不兼容仍优先 exit 2。原 CLI 稳定字段快照不增加内部 flag。

```bash
npm test -- src/tests/cli.test.ts src/tests/scan-profile.test.ts
```

## 9. C06 — CLI 解码 Markdown 文件目标

**Commit:** `fix: resolve encoded Markdown paths in the CLI`

**Files:** `cli/local-vault.ts`、`src/tests/local-vault.test.ts`、`src/tests/cli.test.ts`。

**方案：** URI decoding 只针对 Markdown destination 的路径和片段组件，原始 Wiki 文件名不统一 decode；先分离字面 `#fragment`，再各解码一次，避免 `%23` 被误当分隔符、`%25` 被重复解码。保持 `original` 原样，不能让修复文本变成解码后的字符串。

```ts
function decodeDestinationPart(value: string): string {
  try { return decodeURIComponent(value); }
  catch { return value; }
}
```

在 adapter 内用源文件 + 原始 destination 保存解析结果，路径 lookup 使用解码后的 path，片段校验使用解码后的 fragment；不要把已解码包含 `#` 的文件名重新拼回字符串再 `split('#')`。如当前 scanner API 需要通过字符串传递，增加内部结构化解析/lookup helper，使 path/subpath 只拆一次，不修改公开 JSON schema。

**回归：** `My%20Note.md`、百分号编码中文路径、`./`/`../`、路径内 `%23`/`%25`、编码标题、angle destination；合法 Wiki `[[My%20Note]]` 应仍能指向字面 `%20` 文件名；坏 `%` 序列不抛异常、不崩溃，按现有未解析链接处理。JSON evidence/original 的兼容性有明确断言。

```bash
npm test -- src/tests/local-vault.test.ts src/tests/cli.test.ts src/tests/broken-links.test.ts
```

## 10. C07 — CLI 使用完整 Markdown 链接节点

**Commit:** `fix: parse balanced Markdown link destinations in the CLI`

**Files:** `cli/local-vault.ts`、`src/utils/markdown-source.ts`；测试 `markdown-source.test.ts`、`local-vault.test.ts`、`cli.test.ts`。

**方案：** 删除 `([^)]+)` 的标准 Markdown 链接提取分支，用 C02 的 `markdownLinks(content)` 遍历完整 link/image 节点，接入 C06 的 destination 归一化。不得重复扫描旧 regex 产生第二条截断记录。保留 Wiki、frontmatter、bare URLs 的独立现有入口；去重由原始目标和链接种类决定。

```ts
for (const parsed of markdownLinks(content)) {
  const entry = {
    link: parsed.destination,
    original: parsed.original,
    sourceRelative: true,
  };
  if (parsed.kind === "image") embeds.push(entry);
  else links.push(entry);
}
```

实际集成时 `entry.link` 经过 C06 约定的结构化 target adapter；不能重复 decode AST 已解析的转义字符。

**回归：** `Note(1).md`、嵌套括号、转义括号、angle target、可选标题、image/embed、空格编码；原始语法完整不截尾；indented/fenced/inline code 与转义链接不进入 metadata；缺失真实目标仍报错。CLI 孤立附件用同样链接 fixture，确保解析改善实际进入引用索引。

```bash
npm test -- src/tests/markdown-source.test.ts src/tests/local-vault.test.ts src/tests/cli.test.ts src/tests/reference-index.test.ts
```

## 11. C08 — 外链尾部括号按平衡关系裁剪

**Commit:** `fix: preserve balanced parentheses in external URLs`

**Files:** `src/scanner/scanners/external-links.ts`、`src/tests/external-links.test.ts`。

**方案：** 保留现有句末标点策略，单独调整括号：尾部 `)` 只有在右括号数量大于左括号时才去除。重复去除时重新检查尾部，保留平衡括号和 `%28/%29`。不要为了此 bug 重写网络请求或扩大抓取范围。

```ts
while (/[),.;:!?]$/.test(trimmed)) {
  if (trimmed.endsWith(")")) {
    const opens = (trimmed.match(/\(/g) ?? []).length;
    const closes = (trimmed.match(/\)/g) ?? []).length;
    if (closes <= opens) break;
  }
  trimmed = trimmed.slice(0, -1);
}
```

**回归：** `https://en.wikipedia.org/wiki/Function_(mathematics)` 保持完整；`(https://example.com/a)` 去掉外部括号；`.../a_(b)).` 只去掉多余括号和句号；嵌套括号保留。提供 metadata 正确链接 + body 相同 URL 时，mock HTTP 只收到完整地址一次。测试禁止访问真实网站。

```bash
npm test -- src/tests/external-links.test.ts src/tests/cli.test.ts
```

## 12. C09 — CLI 使用标准 YAML 解析

**Commit:** `fix: parse CLI frontmatter with YAML semantics`

**Files:** `cli/local-vault.ts`、`package.json`、`package-lock.json`、`src/tests/local-vault.test.ts`、`src/tests/cli.test.ts`；必要类型依赖只放 devDependencies。

**方案：** 使用 `js-yaml` 的 `load` 与 `CORE_SCHEMA` 替换手写逐行标量/数组解析，保留现有 frontmatter 分段逻辑。将当前 lockfile 已有的 4.2.0 声明为直接构建依赖，不能依赖 eslint 的间接依赖恰好存在。仅 CLI import，由 esbuild 打进 cli.js；main.js 不引入 Node YAML 路径。

```ts
import { CORE_SCHEMA, load } from "js-yaml";
const value = load(section.frontmatter, { schema: CORE_SCHEMA });
if (value === undefined || value === null) return {};
if (typeof value !== "object" || Array.isArray(value)) {
  throw new Error("Frontmatter must be a mapping");
}
return value as Record<string, unknown>;
```

- CORE_SCHEMA 保留 timestamp 为字符串、不启用自定义 JS 类型；布尔、数值、null、sequence、mapping 使用标准语义。
- 无 frontmatter 返回 undefined；空 frontmatter 返回空对象。重复 key、非法 YAML、非 mapping 顶层明确失败，CLI 返回 setup error 2，不伪造干净扫描。
- 错误信息仅带 vault-relative 文件名、行列及简短原因，不打印 YAML 原文、属性值或解析器含敏感内容的 snippet。
- 不借本任务重构 frontmatterLinks 的提取，但必须确认 tag/property/large-file exclusions 在新值类型下仍正确。

**必测等价输入：**

```yaml
# A.md frontmatter
flag: true # comment
tags:
- alpha
- beta
```

```yaml
# B.md frontmatter
flag: true
tags: [alpha, beta]
```

以上 frontmatter-types 结果应为 0。再覆盖引号中的 `#`、包含逗号的字符串数组元素、缩进 sequence、嵌套 mapping、null、空文件头、BOM/CRLF、非法/重复 key 和合法多行字符串。确认错误 stdout 为空，stderr 不泄露 fixture 中的哨兵敏感值。

```bash
npm test -- src/tests/local-vault.test.ts src/tests/frontmatter-types.test.ts src/tests/tag-usage.test.ts src/tests/cli.test.ts src/tests/cli-package.test.ts
```

## 13. C10 — 统一摘要与 Review new findings 的口径

**Commit:** `fix: align new finding summaries and review filters`

**Files:** `src/report/render-summary.ts`、`src/report/InspectorView.ts`；测试 `render-summary.test.ts`、`inspector-view-filters.test.ts`；README 对应使用说明。

**决策：** 保留简洁文案 `N new findings`，让 N 表示所有未忽略的新增发现，包括 confirmed/candidate/unverified 和 info；不再把优先级子集冒充全部新增。自动扫描通知继续使用原有 `countNewConfirmedFindings`，避免扩大通知范围。

```ts
const newCount = result.issues.filter(
  (issue) => comparison.statuses.get(issue.fingerprint) === "new",
).length;
```

CTA 改为幂等的“查看全部新增”：设置 status=new，清空 scanner、severity、classification；不再第二次点击反向取消。退出通过已有 Clear filters。这样点击前任何筛选不会悄悄缩小 headline 的结果。控件中仍可自行筛 confirmed，保留原功能。

**回归：** 单个 candidate/info → `1 new finding` 且 CTA 可用；混合 3 类、3 严重度 → headline 等于点击后实际显示数；ignored 不计；0 new 无 CTA；首次扫描/不兼容不伪造生命周期；重复点击 CTA 结果稳定；旧 scanner/severity/classification 全部清除；自动扫描通知测试完全保持原口径。

```bash
npm test -- src/tests/render-summary.test.ts src/tests/inspector-view-filters.test.ts src/tests/report-filters.test.ts src/tests/scan-scheduler.test.ts src/tests/main.test.ts
```

## 14. C11 — 重复文件展示使用结构化路径数组

**Commit:** `fix: preserve comma-containing paths in duplicate reports`

**Files:** `src/report/render-issues.ts`、`src/report/markdown-export.ts`；测试 `render-issue-actions.test.ts`、`markdown-export.test.ts`、`cli.test.ts`。

**方案：** duplicate scanner 已将全部路径放入 `relatedPaths`。两个 renderer 直接使用该数组；不再把展示型 `evidence.paths` 按逗号反解析。保留 evidence.paths 的现有字符串形态，避免 CLI 协议漂移；不增加第三套 path 字段。

```ts
function getEvidencePaths(issue: Issue): string[] {
  return issue.relatedPaths;
}
```

先核对此 helper 的所有调用仅服务 duplicate detail；如已有测试把 relatedPaths 填空、仅传 evidence.paths，改为真实 scanner fixture，不保留不可靠的逗号 fallback。

**回归：** `a,one.png`、`b.png` → 两个列表项；点击第一个触发 primaryPath=`a,one.png`；Markdown Files 仅两个完整路径；中文逗号、空格、三个副本排序不变；JSON `relatedPaths`、fingerprint、fixAction.targetPaths 不变。用实际 scanner→Markdown 的测试覆盖，避免只测人为组装正确数据。

```bash
npm test -- src/tests/render-issue-actions.test.ts src/tests/markdown-export.test.ts src/tests/cli.test.ts src/tests/duplicate-files.test.ts
```

## 15. C12 — 整体验收与用户文档

**Commit:** `docs: document corrected scan and CLI behavior`

**Files:** `README.md`、`docs/cli.md`、本计划；集成测试若有缺口必须归回对应修复提交，不将多扫描器代码混进文档提交。

- [ ] README/CLI reference 准确说明块/同页链接、新增发现 CTA、旧 baseline 需要重新生成、YAML 错误退出 2。
- [ ] 修正文档中 CLI HTTP transport 的失真说明：以 `cli/public-http.ts` 的实际 HEAD、405/501 Range GET fallback 为准；不声称 CLI 使用 runtime fetch。此为审查附带的低优先级文档问题，也在本轮收尾覆盖。
- [ ] 运行完整门禁以及 `npm run test:coverage`，阈值不降低。
- [ ] 将 `npm pack` 生成的包安装到临时目录，以包内命令测试 C05/C06/C07/C09 的 fixture；不只运行 TS 测试。确认 cli.js 不要求额外未打包依赖、Node 18 可启动。
- [ ] 检查 `main.js` 的外部依赖仍在既定 Obsidian/Electron 边界；两种 parser 均不以运行时网络下载方式加载。
- [ ] 记录最终构建大小和性能。至少用一份普通笔记、一份大量链接笔记确认不会对每次命中重复整篇解析；只读扫描 benchmark 对比 baseline，不用单次噪声宣称提升。
- [ ] 使用 `/Users/Roger/my-vault` 下隔离测试目录进行以下验收；仅修改明确创建的 fixture，真实用户笔记不执行修复。必要文件操作遵守宿主权限。

### Obsidian 手工验收表

| 场景 | 必须观察的结果 |
|---|---|
| PDF page embed、note heading/block 引用 | 不报告孤立/无引用，不提供不安全批量删除入口 |
| 单个真断链 + 相同缩进代码/转义文本 | 只改真链接，其它内容逐字保留 |
| 有效/缺失块和同页标题 | valid 不报；missing 正确报，提示具体对象 |
| 混合 classification/severity 新增发现 | 摘要与 CTA 展示数量完全相同 |
| 重复文件名含逗号 | 名称不拆，点击打开正确文件，导出路径正确 |
| Duplicate reviewed fix、批量排除、preflight、最终验证 | 原有所有安全检查依然执行 |
| Light/dark、窄侧栏、Resolved 标签 | 文本可读、不溢出，#166 的对比度修复保持 |
| 升级前 snapshot | 明确 comparison restarted，不产生虚假的 resolved |

### 完成标准

- [ ] B01–B10 全部有持久回归测试；B07a/B07b、B08a/B08b 均单独覆盖。
- [ ] 两个 P1 有执行链验证，而不仅是函数返回值测试。
- [ ] CLI 与 desktop 的 resolver 差异有契约测试，测试替身不再自动剥片段掩盖问题。
- [ ] 修复后 12 个提交各自范围清晰，所有 scanner 修改独立于报告 UI commit。
- [ ] 工作区干净；PR 的确切 head 已验证；CI verify 通过。
- [ ] 未完成的手工验收明确标为未完成，不把单元测试通过当作完整上线验收。

## 16. 提交一览

| 顺序 | Commit message | 主要作用 |
|---|---|---|
| C01 | `fix: preserve fragment references in the reference index` | B01 + comparisonVersion 兼容性 |
| C02 | `fix: restrict link fixes to parsed source ranges` | B02 + 纯 Markdown 源位置解析 |
| C03 | `fix: validate block references against block metadata` | B03 + CLI blocks |
| C04 | `fix: validate same-note heading links` | B04 |
| C05 | `fix: honor explicit CLI fail-on thresholds` | B06 |
| C06 | `fix: resolve encoded Markdown paths in the CLI` | B07a |
| C07 | `fix: parse balanced Markdown link destinations in the CLI` | B07b |
| C08 | `fix: preserve balanced parentheses in external URLs` | B05 |
| C09 | `fix: parse CLI frontmatter with YAML semantics` | B08a + B08b |
| C10 | `fix: align new finding summaries and review filters` | B09 |
| C11 | `fix: preserve comma-containing paths in duplicate reports` | B10 |
| C12 | `docs: document corrected scan and CLI behavior` | 文档、覆盖清单、验收记录 |

默认一个修复分支、12 个可独立审查的实现提交，CI 全绿后开 PR。若需要优先交付安全修复，可在 C04 后先开第一组 PR；剩余工作仍须完成 C05–C12，不得因为首组发布而缩减范围。实际提交/推送/PR/发布按后续明确执行请求处理。

## 17. 解析依赖依据

- [mdast-util-from-markdown 官方文档](https://github.com/syntax-tree/mdast-util-from-markdown)：使用 `fromMarkdown` 获得 AST，支持浏览器，ESM 由现有构建打包；本轮只消费源位置和链接节点，不引入完整渲染框架。
- [js-yaml 官方文档](https://github.com/nodeca/js-yaml)：`load` 与 schema 配置用于标准 YAML 解析。实施时使用锁定依赖并测试实际 schema 行为，不依赖环境里偶然存在的包。

## 18. Execution log

Execution baseline verified against origin/main: `f1fa650`. Work occurs on `fix/audit-correctness` in the existing checkout.

Clarifications before implementation:

- C02 source-range parsing must prove preservation with executable fixtures before replacing the executor's existing protection logic. Unsupported syntax must fail closed, never fall back to global replacement.
- C06 keeps raw link identity and original source intact. Decoding belongs to the CLI adapter; decoded file paths containing `#` must not be reparsed as fragments. Internal destination metadata may be added without changing public report fields.
- C09 invalid YAML is a setup failure with exit 2 and a sanitized filename/position message. This behavior must be explicitly tested and documented.

| Task | State | Verification |
|---|---|---|
| C01 | pending | |
| C02 | pending | |
| C03 | pending | |
| C04 | pending | |
| C05 | pending | |
| C06 | pending | |
| C07 | pending | |
| C08 | pending | |
| C09 | pending | |
| C10 | pending | |
| C11 | pending | |
| C12 | pending | |
