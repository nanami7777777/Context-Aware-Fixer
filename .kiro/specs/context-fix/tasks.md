# 实现计划：ContextFix

## 概述

基于管道式架构，按照 数据模型与核心接口 → 输入解析 → 上下文收集 → 根因分析 → 补丁生成 → 输出格式化 → CLI 编排 的顺序逐步实现。每个阶段在前一阶段基础上构建，确保无孤立代码。

## 任务

- [x] 1. 项目初始化与基础设施搭建
  - [x] 1.1 初始化项目结构与构建配置
    - 创建 `package.json`（name: contextfix, bin 配置指向 `dist/cli.js`）
    - 创建 `tsconfig.json`（strict 模式, ES2022 target, NodeNext module）
    - 创建 `tsup.config.ts`（入口 `src/cli.ts`, format: esm）
    - 创建 `vitest.config.ts`（包含 fast-check 支持）
    - 安装依赖：commander, simple-git, chalk, yaml, tree-sitter 等
    - 安装开发依赖：typescript, tsup, vitest, fast-check, @types/node
    - _需求: 6.1_

  - [x] 1.2 定义核心数据模型与类型
    - 创建 `src/types.ts`，定义所有核心接口：`BugReport`, `ContextWindow`, `ContextFile`, `RootCauseReport`, `RootCauseCandidate`, `Evidence`, `Patch`, `PatchSet`, `FileChange`, `DiffHunk`, `Configuration`, `ValidationResult`, `ValidationError`, `ParseResult`, `ParseError`, `StackFrame`, `FileReference`, `ProjectInfo`, `GitCommit`, `ChatMessage`, `LLMOptions`
    - 定义类型别名：`InputSource`, `SupportedLanguage`, `OutputMode`
    - _需求: 1.1, 1.2, 2.1, 3.1, 4.1, 8.4, 9.1_

- [ ] 2. 输入解析模块
  - [x] 2.1 实现输入解析器 (`src/input/parser.ts`)
    - 实现 `InputParser` 类，包含 `parse(raw, source)` 和 `validate(report)` 方法
    - 实现正则匹配提取文件路径（`/path/to/file.ts:42` 模式）
    - 实现错误类型提取（`TypeError`, `ReferenceError` 等）
    - 实现堆栈追踪逐行解析（按 `at` 关键字）
    - 实现自然语言关键词提取（文件名、函数名模式匹配）
    - _需求: 1.1, 1.2, 1.3_

  - [x] 2.2 实现输入验证器 (`src/input/validators.ts`)
    - 实现 `validate(report)` 方法，检查 BugReport 是否包含足够信息
    - 当缺少关键信息时生成具体的补充建议
    - _需求: 1.4_

  - [x] 2.3 编写输入解析器属性测试
    - **属性 P1: 输入解析完整性** — 对于任意包含 `path:line` 模式的字符串，`parse()` 必须提取出所有文件路径引用
    - **验证: 需求 1.1**

  - [x] 2.4 编写堆栈追踪解析属性测试
    - **属性 P7: 堆栈追踪解析顺序保持** — 解析后的 `StackFrame` 数组必须保持原始调用顺序
    - **验证: 需求 1.2**


- [x] 3. 检查点 — 输入解析模块验证
  - 确保所有测试通过，如有疑问请向用户确认。

- [ ] 4. 配置管理模块
  - [x] 4.1 实现配置 Schema 定义 (`src/config/schema.ts`)
    - 定义配置默认值和验证规则
    - 定义合法配置字段及其类型约束
    - _需求: 8.4_

  - [x] 4.2 实现配置序列化器 (`src/config/serializer.ts`)
    - 实现 `ConfigSerializer` 类，包含 `parse(yaml)` 和 `serialize(config)` 方法
    - 使用 `yaml` 库进行 YAML 解析和序列化
    - 解析失败时返回包含错误行号和原因的描述性错误信息
    - _需求: 9.1, 9.2, 9.3_

  - [x] 4.3 编写配置往返一致性属性测试
    - **属性 P2: 配置往返一致性** — 对于任意合法 Configuration 对象，`parse(serialize(config))` 必须产生等价对象
    - **验证: 需求 9.4**

  - [x] 4.4 实现配置管理器 (`src/config/manager.ts`)
    - 实现 `ConfigManager` 类，包含 `load(repoPath)` 和 `validate(config)` 方法
    - 实现配置合并逻辑：项目级 `.contextfix.yml` > 全局 `~/.contextfix.yml` > 默认值
    - 配置文件格式不合法时报告具体错误位置和修正建议
    - _需求: 8.1, 8.2, 8.3, 8.5_

  - [x] 4.5 编写配置合并优先级属性测试
    - **属性 P8: 配置合并优先级** — 项目级配置字段值必须覆盖全局配置同名字段值
    - **验证: 需求 8.3**

- [x] 5. 检查点 — 配置管理模块验证
  - 确保所有测试通过，如有疑问请向用户确认。

- [x] 6. LLM 统一接口模块
  - [x] 6.1 实现 LLM Provider 接口与工厂函数 (`src/llm/provider.ts`)
    - 定义 `LLMProvider` 接口（`chat`, `estimateTokens` 方法）
    - 实现 `createLLMProvider(modelId, apiKey)` 工厂函数
    - modelId 格式解析：`"openai:gpt-4"`, `"anthropic:claude-3-sonnet"`, `"ollama:codellama"`
    - _需求: 6.4_

  - [x] 6.2 实现 OpenAI Provider (`src/llm/openai.ts`)
    - 实现 `OpenAIProvider` 类，支持流式 chat 响应
    - 实现 token 估算方法
    - _需求: 6.4_

  - [x] 6.3 实现 Anthropic Claude Provider (`src/llm/anthropic.ts`)
    - 实现 `AnthropicProvider` 类，支持流式 chat 响应
    - _需求: 6.4_

  - [x] 6.4 实现 Ollama Provider (`src/llm/ollama.ts`)
    - 实现 `OllamaProvider` 类，支持本地模型调用
    - _需求: 6.4_


- [ ] 7. 上下文收集模块
  - [x] 7.1 实现 Git 提供者 (`src/context/git-provider.ts`)
    - 使用 `simple-git` 实现 `GitProvider` 类
    - 实现 `getFileHistory(filePath, limit)` 获取最近 N 次提交历史
    - 实现 `getBlame(filePath, startLine, endLine)` 获取 blame 信息
    - 实现 `isIgnored(filePath)` 检查文件是否被 .gitignore 忽略
    - _需求: 2.3, 2.6_

  - [x] 7.2 实现语言解析器注册表与语言解析器 (`src/context/languages/`)
    - 实现 `LanguageRegistry` 类（`register`, `getParser`, `detectLanguage` 方法）
    - 实现 TypeScript/JavaScript 语言解析器（解析 import/require 语句）
    - 实现 Python 语言解析器（解析 import/from...import 语句）
    - 实现 Java 语言解析器（解析 import 语句）
    - 实现 Go 语言解析器（解析 import 语句）
    - 实现 Rust 语言解析器（解析 use 语句）
    - _需求: 7.1, 7.2, 7.4_

  - [x] 7.3 实现 AST 解析器 (`src/context/ast-parser.ts`)
    - 使用 tree-sitter 实现 `ASTParser` 类
    - 实现 `parse(filePath, content)` 返回 AST 信息
    - 实现 `extractImports(filePath, content)` 提取依赖声明
    - 与语言注册表集成，支持多语言解析
    - _需求: 7.1, 7.3_

  - [x] 7.4 实现依赖关系解析器 (`src/context/dependency-resolver.ts`)
    - 实现文件间依赖关系图构建
    - 支持跨语言依赖关系处理
    - _需求: 2.2, 7.3_

  - [x] 7.5 实现相关性评分算法 (`src/context/relevance-scorer.ts`)
    - 实现 `RelevanceScorer` 类的 `score(file, report)` 方法
    - 实现评分公式：`w1*mentionedInReport + w2*(1/(importDepth+1)) + w3*hasErrorTrace + w4*normalize(recentCommitCount)`
    - 权重：w1=0.4, w2=0.3, w3=0.2, w4=0.1
    - _需求: 2.5_

  - [x] 7.6 编写相关性评分有界性属性测试
    - **属性 P4: 相关性评分有界性** — 对于任意候选文件，评分必须在 [0, 1] 范围内
    - **验证: 需求 2.5**

  - [x] 7.7 编写直接提及文件优先属性测试
    - **属性 P6: 直接提及文件优先** — Bug 报告中直接提及的文件，其相关性分数必须高于未提及的文件（其他条件相同时）
    - **验证: 需求 2.5**

  - [x] 7.8 实现上下文收集器 (`src/context/collector.ts`)
    - 实现 `ContextCollector` 类的 `collect(report, config)` 方法
    - 集成 GitProvider、ASTParser、DependencyResolver、RelevanceScorer
    - 实现 Context Window 智能裁剪：按相关性分数降序排列，逐步加入直到 token 上限
    - 对超限文件裁剪到函数/类级别粒度
    - 过滤 .gitignore 忽略的文件
    - 读取项目配置文件识别项目类型
    - _需求: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 7.9 编写上下文窗口 Token 限制属性测试
    - **属性 P3: 上下文窗口 Token 限制** — 收集的 ContextWindow 总 token 数不得超过配置上限
    - **验证: 需求 2.5**

  - [x] 7.10 编写 .gitignore 过滤一致性属性测试
    - **属性 P9: .gitignore 过滤一致性** — 被 .gitignore 忽略的文件不得出现在 ContextWindow 中
    - **验证: 需求 2.6**

- [x] 8. 检查点 — 上下文收集模块验证
  - 确保所有测试通过，如有疑问请向用户确认。


- [ ] 9. 根因分析模块
  - [x] 9.1 实现根因分析器 (`src/analyzer/root-cause.ts`)
    - 实现 `RootCauseAnalyzer` 类的 `analyze(context, report, options)` 方法
    - 支持 `AsyncIterable<AnalysisChunk>` 流式输出
    - 构建分析提示词，包含上下文和 Bug 报告信息
    - 解析 LLM 响应为结构化的 `RootCauseReport`（候选根因按置信度排序）
    - 每个候选根因包含：问题定位、根因描述、影响范围、支撑证据
    - _需求: 3.1, 3.2, 3.3, 3.4_

- [ ] 10. 补丁生成与应用模块
  - [x] 10.1 实现补丁生成器 (`src/patch/generator.ts`)
    - 实现 `PatchGenerator` 类的 `generate(report, context, options)` 方法
    - 支持 `AsyncIterable<PatchChunk>` 流式输出
    - 构建修复提示词，基于根因分析结果
    - 解析 LLM 响应为结构化的 `PatchSet`
    - 生成标准 unified diff 格式补丁
    - 多候选补丁时标注各自优缺点
    - _需求: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 10.2 编写补丁格式合法性属性测试
    - **属性 P5: 补丁格式合法性** — 对于任意生成的 Patch，其 unified diff 格式必须可被标准 diff 工具解析
    - **验证: 需求 4.2**

  - [x] 10.3 实现补丁应用器 (`src/patch/applier.ts`)
    - 实现 `PatchApplier` 类的 `apply(patch, repoPath)` 和 `preview(patch, repoPath)` 方法
    - 应用补丁到文件系统，返回修改文件列表和变更统计
    - 预览模式（dry-run）显示变更但不修改文件
    - 冲突检测：文件已被修改时报告冲突详情和手动解决建议
    - _需求: 5.2, 5.3, 5.4, 5.5_

- [x] 11. 检查点 — 根因分析与补丁模块验证
  - 确保所有测试通过，如有疑问请向用户确认。

- [ ] 12. 输出格式化模块
  - [x] 12.1 实现输出格式化器 (`src/output/formatter.ts`)
    - 实现 `OutputFormatter` 接口（`formatAnalysis`, `formatPatch`, `formatApplyResult` 方法）
    - 实现 `createFormatter(mode)` 工厂函数
    - 自动检测 `process.stdout.isTTY`，非 TTY 时切换到 plain 模式
    - _需求: 10.1, 10.5_

  - [x] 12.2 实现终端彩色输出 (`src/output/terminal.ts`)
    - 使用 chalk 实现彩色终端输出
    - 实现代码片段语法高亮
    - 实现进度指示器显示当前处理阶段
    - _需求: 10.1, 10.3, 10.4_

  - [x] 12.3 实现 JSON 输出 (`src/output/json.ts`)
    - 实现 JSON 格式输出所有分析结果和补丁
    - _需求: 10.2_

  - [x] 12.4 编写输出模式自动检测属性测试
    - **属性 P10: 输出模式自动检测** — 当 stdout 不是 TTY 时，输出不得包含 ANSI 转义序列
    - **验证: 需求 10.5**

- [ ] 13. CLI 入口与管道编排
  - [x] 13.1 实现管道编排器 (`src/pipeline.ts`)
    - 实现 `Pipeline` 类，串联 InputParser → ContextCollector → RootCauseAnalyzer → PatchGenerator → OutputFormatter
    - 支持 `fix` 模式（完整流程）和 `analyze` 模式（仅根因分析）
    - _需求: 6.2, 6.3_

  - [x] 13.2 实现 CLI 入口 (`src/cli.ts`)
    - 使用 Commander.js 定义命令行接口
    - 注册 `fix <bug-description>` 子命令
    - 注册 `analyze <bug-description>` 子命令
    - 实现参数：`--model`, `--context-limit`, `--verbose`, `--output`, `--apply`, `--dry-run`, `--json`
    - 支持从 stdin、命令行参数、文件路径三种方式接收输入
    - 未配置 API 密钥时显示清晰的配置指引并退出
    - _需求: 1.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 5.1_

- [x] 14. 最终检查点 — 全部模块集成验证
  - 确保所有测试通过，如有疑问请向用户确认。

## 备注

- 标记 `*` 的任务为可选任务，可跳过以加速 MVP 开发
- 每个任务引用了具体的需求编号以确保可追溯性
- 检查点任务确保增量验证
- 属性测试验证通用正确性属性（P1-P10），单元测试验证具体示例和边界情况
