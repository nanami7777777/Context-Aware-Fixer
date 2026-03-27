# 需求文档

## 简介

ContextFix 是一个上下文感知的 AI 修 Bug 助手，作为开源工具发布。它能够自动分析代码仓库的上下文信息（如 Git 历史、项目结构、依赖关系、相关文件），结合 Bug 报告或错误信息，智能定位 Bug 根因并生成高质量的修复补丁。目标是成为开发者日常调试工作流中不可或缺的工具，在 GitHub 上获得广泛认可。

## 术语表

- **ContextFix**: 本项目的核心系统，上下文感知的 AI 修 Bug 助手
- **Bug_Report**: 用户提交的 Bug 描述，包含错误信息、复现步骤、期望行为等
- **Context_Collector**: 上下文收集器，负责从代码仓库中提取与 Bug 相关的上下文信息
- **Root_Cause_Analyzer**: 根因分析器，负责分析 Bug 的根本原因
- **Patch_Generator**: 补丁生成器，负责生成修复 Bug 的代码补丁
- **Patch**: 修复补丁，包含对源代码的具体修改内容
- **Context_Window**: 上下文窗口，传递给 AI 模型的相关代码和元数据的集合
- **Repository**: 用户的代码仓库，ContextFix 分析的目标项目
- **Error_Trace**: 错误堆栈追踪信息，包含错误发生的调用链
- **Diff**: 代码差异，表示修复前后的代码变更

## 需求

### 需求 1：Bug 报告输入与解析

**用户故事：** 作为开发者，我希望能通过多种方式提交 Bug 信息，以便 ContextFix 理解我要修复的问题。

#### 验收标准

1. WHEN 用户提供错误信息文本, THE Context_Collector SHALL 解析错误信息并提取关键字段（错误类型、文件路径、行号）
2. WHEN 用户提供 Error_Trace, THE Context_Collector SHALL 解析堆栈追踪并识别调用链中的所有相关文件和行号
3. WHEN 用户提供自然语言的 Bug 描述, THE Context_Collector SHALL 从描述中提取关键实体（文件名、函数名、变量名、错误现象）
4. IF 用户提供的 Bug_Report 缺少关键信息（如错误类型或相关文件）, THEN THE ContextFix SHALL 提示用户补充缺失的信息并给出具体建议
5. THE Context_Collector SHALL 支持从标准输入（stdin）、命令行参数和文件路径三种方式接收 Bug_Report

### 需求 2：代码仓库上下文收集

**用户故事：** 作为开发者，我希望 ContextFix 能自动收集与 Bug 相关的代码上下文，以便 AI 能准确理解问题所在。

#### 验收标准

1. WHEN Bug_Report 中包含文件路径, THE Context_Collector SHALL 读取对应文件的完整内容并纳入 Context_Window
2. WHEN Bug_Report 中包含文件路径, THE Context_Collector SHALL 分析该文件的 import/依赖关系并收集直接依赖文件的相关代码片段
3. WHEN Repository 使用 Git 进行版本控制, THE Context_Collector SHALL 收集相关文件最近 10 次提交的 Git 历史记录
4. THE Context_Collector SHALL 读取 Repository 的项目配置文件（如 package.json、pyproject.toml、Cargo.toml）以识别项目类型和依赖
5. WHILE Context_Window 的总 token 数超过模型限制, THE Context_Collector SHALL 按相关性优先级裁剪上下文，保留与 Bug 最相关的内容
6. THE Context_Collector SHALL 在收集上下文时忽略 .gitignore 中列出的文件和目录

### 需求 3：根因分析

**用户故事：** 作为开发者，我希望 ContextFix 能分析 Bug 的根本原因，以便我理解问题的本质而不仅仅是表面现象。

#### 验收标准

1. WHEN Context_Window 构建完成, THE Root_Cause_Analyzer SHALL 分析上下文并生成根因分析报告
2. THE Root_Cause_Analyzer SHALL 在根因分析报告中包含以下内容：问题定位（具体文件和行号）、根本原因描述、影响范围评估
3. WHEN Root_Cause_Analyzer 识别出多个可能的根因, THE Root_Cause_Analyzer SHALL 按置信度从高到低排列所有候选根因
4. THE Root_Cause_Analyzer SHALL 为每个候选根因提供支撑证据（引用具体的代码片段或 Git 历史）

### 需求 4：修复补丁生成

**用户故事：** 作为开发者，我希望 ContextFix 能自动生成修复补丁，以便我可以快速应用修复而不需要从零编写代码。

#### 验收标准

1. WHEN 根因分析完成, THE Patch_Generator SHALL 生成至少一个修复 Patch
2. THE Patch_Generator SHALL 以标准 unified diff 格式输出 Patch
3. THE Patch_Generator SHALL 确保生成的 Patch 仅修改与 Bug 修复直接相关的代码行
4. WHEN Patch_Generator 生成 Patch, THE Patch_Generator SHALL 为每个 Patch 附带修改说明，解释每处变更的目的
5. IF Patch_Generator 识别出多种可行的修复方案, THEN THE Patch_Generator SHALL 生成多个候选 Patch 并标注各自的优缺点
6. THE Patch_Generator SHALL 生成语法正确的代码，确保 Patch 应用后不引入新的语法错误

### 需求 5：补丁输出与应用

**用户故事：** 作为开发者，我希望能方便地查看和应用修复补丁，以便快速完成 Bug 修复流程。

#### 验收标准

1. THE ContextFix SHALL 将 Patch 输出到标准输出（stdout），支持管道操作
2. WHEN 用户指定 --apply 参数, THE ContextFix SHALL 直接将 Patch 应用到 Repository 的对应文件
3. WHEN 用户指定 --dry-run 参数, THE ContextFix SHALL 显示 Patch 将要修改的内容但不实际修改文件
4. IF Patch 应用失败（如文件已被修改导致冲突）, THEN THE ContextFix SHALL 报告冲突详情并建议手动解决方案
5. WHEN Patch 成功应用, THE ContextFix SHALL 输出修改的文件列表和变更统计（增加行数、删除行数）

### 需求 6：命令行界面

**用户故事：** 作为开发者，我希望通过简洁的命令行界面使用 ContextFix，以便将其集成到我的日常开发工作流中。

#### 验收标准

1. THE ContextFix SHALL 提供 `contextfix` 命令作为主入口
2. THE ContextFix SHALL 支持 `contextfix fix <bug-description>` 子命令执行完整的分析和修复流程
3. THE ContextFix SHALL 支持 `contextfix analyze <bug-description>` 子命令仅执行根因分析而不生成补丁
4. THE ContextFix SHALL 支持 --model 参数允许用户指定使用的 AI 模型（默认使用 OpenAI GPT-4）
5. THE ContextFix SHALL 支持 --context-limit 参数允许用户设置 Context_Window 的最大 token 数
6. THE ContextFix SHALL 支持 --verbose 参数输出详细的分析过程日志
7. THE ContextFix SHALL 支持 --output 参数将 Patch 写入指定文件而非标准输出
8. IF 用户未配置 AI 模型的 API 密钥, THEN THE ContextFix SHALL 显示清晰的配置指引并退出

### 需求 7：多语言支持

**用户故事：** 作为开发者，我希望 ContextFix 能支持多种编程语言的代码分析，以便在不同技术栈的项目中使用。

#### 验收标准

1. THE Context_Collector SHALL 支持解析 Python、JavaScript、TypeScript、Java、Go、Rust 六种编程语言的代码文件
2. THE Context_Collector SHALL 根据文件扩展名和项目配置自动识别 Repository 的主要编程语言
3. WHEN 分析多语言项目, THE Context_Collector SHALL 正确处理不同语言之间的跨语言依赖关系
4. THE Context_Collector SHALL 为每种支持的语言提供语言特定的 import/依赖解析逻辑

### 需求 8：配置管理

**用户故事：** 作为开发者，我希望能通过配置文件自定义 ContextFix 的行为，以便适配不同项目的需求。

#### 验收标准

1. THE ContextFix SHALL 支持在 Repository 根目录下的 `.contextfix.yml` 文件中读取项目级配置
2. THE ContextFix SHALL 支持在用户主目录下的 `~/.contextfix.yml` 文件中读取全局配置
3. WHEN 项目级配置和全局配置同时存在, THE ContextFix SHALL 以项目级配置优先，全局配置作为回退
4. THE ContextFix SHALL 在配置文件中支持以下配置项：AI 模型选择、API 密钥、上下文 token 限制、忽略文件模式、自定义提示词模板
5. IF 配置文件格式不合法, THEN THE ContextFix SHALL 报告具体的格式错误位置和修正建议

### 需求 9：配置文件解析与序列化

**用户故事：** 作为开发者，我希望配置文件的解析和序列化是可靠的，以便配置不会在读写过程中丢失或损坏。

#### 验收标准

1. WHEN 合法的 `.contextfix.yml` 配置文件被提供, THE ContextFix SHALL 将其解析为 Configuration 对象
2. WHEN 不合法的 `.contextfix.yml` 配置文件被提供, THE ContextFix SHALL 返回描述性的错误信息，包含错误行号和原因
3. THE ContextFix SHALL 能将 Configuration 对象序列化回合法的 YAML 格式配置文件
4. 对于所有合法的 Configuration 对象，解析后序列化再解析 SHALL 产生等价的对象（往返一致性）

### 需求 10：输出格式化与报告

**用户故事：** 作为开发者，我希望 ContextFix 的输出清晰易读，以便我能快速理解分析结果和修复建议。

#### 验收标准

1. THE ContextFix SHALL 默认以人类可读的彩色终端格式输出分析结果
2. WHEN 用户指定 --json 参数, THE ContextFix SHALL 以 JSON 格式输出所有分析结果和补丁
3. THE ContextFix SHALL 在输出中使用语法高亮显示代码片段
4. THE ContextFix SHALL 在分析过程中显示进度指示器，告知用户当前处理阶段
5. WHEN 输出被重定向到非终端（如管道或文件）, THE ContextFix SHALL 自动禁用彩色输出和进度指示器
