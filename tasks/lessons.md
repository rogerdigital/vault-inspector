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
