# ContextFix：一个真正会读代码的 AI 修 Bug 工具

大多数 AI 编程工具的工作方式是：你把错误信息贴给它，它猜一个答案。ContextFix 不一样 — 它会先读你的代码仓库。

**GitHub**: https://github.com/nanami7777777/Context-Aware-Fixer

## 它做了什么

ContextFix 是一个 CLI 工具，完整流程：

1. **解析**你的错误信息、堆栈追踪或自然语言 Bug 描述
2. **遍历** import 依赖图，找到相关文件
3. **查看** Git blame 和最近提交记录
4. **评分** — 对每个文件按相关性加权打分（直接提及 × 依赖深度 × 堆栈追踪 × 提交活跃度）
5. **分析** — 把最相关的上下文发给 LLM 做根因分析
6. **生成** unified diff 格式的修复补丁

```bash
npx contextfix fix "TypeError: Cannot read property 'x' of undefined"
```

## 为什么做这个

每次遇到 Bug，我都要手动把错误信息复制到 ChatGPT，然后再贴 5 个相关文件，再解释项目结构。LLM 需要上下文才能给出好答案 — 那为什么不自动化这个过程？

核心洞察：**你发给 LLM 的文件比你用哪个 LLM 更重要。** 一个经过相关性评分的上下文窗口，包含依赖图和 Git 历史，效果远好于一条裸的错误信息。

## 技术亮点

- **TypeScript 原生实现** — 不是又一个 Python 包装器。Node.js 开发者零配置 `npx` 直接用。
- **零 LLM SDK 依赖** — 用原生 `fetch` 调用 OpenAI、Anthropic Claude、Ollama。整个 bundle 只有 97KB。
- **相关性评分算法** — 文件按四个维度打分：直接提及（权重 0.4）、import 深度（0.3）、堆栈追踪出现（0.2）、最近提交活跃度（0.1）。按分数贪心填充上下文窗口直到 token 上限。
- **多语言 import 解析** — 支持 TypeScript、JavaScript、Python、Java、Go、Rust 六种语言的依赖关系解析，构建文件依赖图找到错误信息没提到的相关文件。
- **属性测试** — 417 个测试，包含 10 个用 fast-check 验证的形式化正确性属性（比如"上下文窗口永远不超过 token 限制"、"被提及的文件评分一定更高"、"配置往返一致性"）。
- **自定义 endpoint** — 支持任何 OpenAI 兼容 API（阿里云 DashScope、Azure、本地代理）。

## 架构

```
输入 → 输入解析器 → 上下文收集器 → 根因分析器 → 补丁生成器 → 输出
                        ├── Git 提供者（blame、历史）
                        ├── AST 解析器（import 提取）
                        ├── 依赖解析器（文件依赖图）
                        └── 相关性评分器（加权评分）
```

每个阶段是独立模块，通过接口串联，完全可通过依赖注入测试。

## 实际效果

用阿里云 DashScope 的 kimi-k2.5 模型测试，给一个 `TypeError: Cannot read properties of undefined` 的错误：

- 自动找到了 `src/pipeline.ts` 和相关依赖文件
- 分析出 3 个候选根因，按置信度排序（95%、75%、45%）
- 生成了一个防御性空值检查的补丁，附带优缺点分析

整个过程全自动，不需要手动贴代码。

## 下一步

- VS Code 插件
- GitHub Actions 集成（CI 失败自动分析）
- 更多语言支持（C/C++、Ruby、PHP）
- 更智能的上下文：类型定义、测试文件、相关 PR

欢迎试用，欢迎提 issue 和 PR。
