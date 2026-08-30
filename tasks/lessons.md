# Lessons Learned

可复用的经验与规则，防止同类错误重复发生。每条记录：现象 → 根因 → 规则。

---

## 禁止 `eslint-disable` obsidianmd 规则（2026-06-23）

**现象**：0.4.12 发布到 Obsidian community 时 review validation 失败。

**根因**：在 `settings-tab.ts` 为绕过 `obsidianmd/ui/sentence-case` 规则加了：
```ts
// eslint-disable-next-line obsidianmd/ui/sentence-case
.setPlaceholder("E.g. excalidraw-plugin")
```
Obsidian review bot 有两条强制规则：
1. directive 注释必须带描述
2. **禁止禁用 `obsidianmd/*` 规则**

这两条直接导致 validation 失败（error 级别，非 warning）。

**规则**：
- ❌ 永远不要 `eslint-disable` 任何 `obsidianmd/*` 规则
- 遇到 obsidianmd 规则冲突，**改代码绕过**（换措辞、改实现），不要用 disable
- 本地 `npm run lint:obsidian-warnings` 不会报这类违规（它只跑指定的 3 条规则），**必须假设 review bot 比本地严格**
- 发布前对照 `eslint-plugin-obsidianmd` 的 recommended 全集自检，而非只看项目脚本

---

## 区分 Obsidian review 的 error 与 warning（2026-06-23）

**现象**：诊断 0.4.12 失败原因时，一度误判为 CLI 移目录（#85）或 annotated tag 导致。

**根因**：review bot 输出里混有两类问题：
- **error（阻断发布）**：本次是 directive 注释违规 + 禁用规则违规
- **warning（不阻断）**：CLI 的 Node API 警告（`node:fs`、`fetch`、`setTimeout`）

#85 移目录后，CLI 警告虽仍存在（`cli/` 目录下），但属于 warning，不影响发布。

**规则**：
- 排查 review 失败时，**只关注 error 级别**，warning 是噪音
- 不能因 warning 存在就推翻已验证的方案（#85 移目录是有效的，已用 `git clone --branch <tag>` 实测确认）

---

## 发布 tag 用 lightweight，与历史一致（2026-06-23）

**现象**：0.4.12 用 `git tag -a`（annotated）创建，发布失败；0.4.13 改用 lightweight 后成功。

**根因**：虽然实测证明 annotated tag 不影响 `git clone --branch` checkout（真正的失败原因是上面的 eslint-disable），但历史 9 个版本都用 lightweight tag 且都成功。annotated tag 引入了不必要的变量，排查时浪费了时间。

**规则**：
- 发布 tag 一律用 `git tag <version>`（lightweight），不用 `git tag -a`
- 不要在发布流程里引入与历史不一致的变量，除非有明确理由

---

## 诊断时先用最小可复现验证假设（2026-06-23）

**现象**：0.4.12 失败后，先后假设了 4 个根因（缓存、annotated tag、移目录、eslint-disable），前 3 个都错了。

**根因**：先猜后验证，且猜测基于不完整信息。

**规则**：
- 排查时**先做能证伪假设的实验**，而不是顺着猜测链推理
- 本次的转折点是用 `git clone --depth 1 --branch 0.4.12` 实测，一秒证伪了「annotated tag / 移目录导致 checkout 错」
- 仔细读错误原文（截图里的 rule name 和 file path）比推理更可靠

---

## #85 移目录方案未达预期（2026-06-24）

**现象**：把 CLI 从 `src/cli/` 移到根目录 `cli/`，目标是让 Obsidian review bot 扫不到 Node API 警告。发布 0.4.13 后检查 scorecard，7 个 Node API warning 仍在（现在报 `cli/cli.ts` 而非 `src/cli/cli.ts`）。

**根因**：方案基于错误假设——以为 review bot 只扫 `src/**`。**实际 bot 扫全仓库 `**/*.ts`**。本地验证时只跑了 `npx eslint "src/**/*.ts"`，得到 0 warning，于是误判方案有效。这个验证范围与 bot 实际行为不一致。

**真实结论**：
- #85 移目录**没有消除任何 review warning**，只是把路径前缀从 `src/cli/` 换成 `cli/`
- 唯一实际收益是源码组织上 CLI 不再混在 `src/` 插件树里，以及 `eslint.config.mjs`/`lint:obsidian-warnings` 配置更简洁（不再需要 `--ignore-pattern src/cli/**`）
- 7 个 Node API warning 是**结构性死结**：CLI 是独立 Node 程序，必须用 `node:fs`/`fetch`/`setTimeout`，无法用 Obsidian 运行时的 `requestUrl`/`window.setTimeout` 替代（CLI 进程里没有这些全局对象）
- 唯一能到 10/10 的方案是 monorepo 把 CLI 拆出独立包，代价远大于收益，当前 6/10 + Satisfactory + Health: Excellent 是合理结果，不追求

**规则**：
- 验证「review bot 是否扫到某目录」时，**必须用 bot 等价的全仓库扫描**（`npx eslint "**/*.ts" --rule ...`），不能只扫 `src/**` 就下结论
- 方案上线后，要用真实 scorecard 结果验证效果，不要只靠本地推理
- 接受已验证的结构性限制，不为不可达的目标投入资源


## 提交信息只描述改动（2026-08-29）

**现象**：PR #122（docs）review 时反馈：提交信息只需体现做了哪些改动。

**规则**：
- commit message 用最短的话说清改了什么，不附加背景叙述、目标铺垫或修饰
- 示例：`docs: add scanner precision foundation design and implementation plan` 已符合；避免在此基础上再写长正文

## 推送前核对子代理报告的提交（2026-08-30）

**现象**：reference-index PR 中，子代理报告已把 Pick<> 重构 amend 进提交，实际 `ScanRunner.ts` 的改动留在工作树未提交；推送时的 uncommitted warning 暴露了差异。其门禁"全绿"是在带着未提交改动的树上跑的，已推送的提交本身未被验证。

**根因**：amend 时漏 `git add` 一个文件；报告与仓库实际状态不一致。

**规则**：
- 子代理声称提交完成后，控制器推送前必须 `git status --short` 核对工作树干净、`git show --stat HEAD` 核对文件清单与报告一致
- 验证门禁只在确切提交内容上算数；工作树有未提交改动时跑的验证不算
