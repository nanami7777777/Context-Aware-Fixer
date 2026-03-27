# ContextFix

上下文感知的 AI 修 Bug 助手。自动分析代码仓库上下文 — 文件依赖、Git 历史、堆栈追踪 — 智能定位根因并生成修复补丁。

TypeScript 原生实现，LLM 调用零外部 SDK 依赖，Node.js 环境即可运行。

## 为什么选择 ContextFix

大多数 AI 编程工具只是把错误信息丢给模型碰运气。ContextFix 不一样：

1. **解析** 错误信息、堆栈追踪或自然语言 Bug 描述
2. **收集** 相关代码上下文 — import 依赖图、Git blame、最近提交
3. **评分** 按加权算法对文件相关性排序（提及 × 依赖深度 × 堆栈 × 活跃度）
4. **分析** 通过 LLM 结合完整上下文窗口进行根因分析
5. **生成** 标准 unified diff 格式补丁，可审查后直接应用

```
输入 → 解析 → 收集上下文 → 根因分析 → 生成补丁 → 输出
```

## 快速开始

```bash
# 直接用 npx 运行
npx contextfix fix "TypeError: Cannot read property 'x' of undefined"

# 或全局安装
pnpm add -g contextfix
```

## 使用方法

### 修复 Bug（完整流程）

```bash
# 命令行参数
contextfix fix "TypeError: Cannot read property 'x' of undefined"

# 从文件读取
contextfix fix --file error.log

# 从 stdin 管道输入
cat error.log | contextfix fix

# 直接应用补丁
contextfix fix "UserService 空指针" --apply

# 预览变更（不实际修改文件）
contextfix fix "UserService 空指针" --dry-run
```

### 仅分析（不生成补丁）

```bash
contextfix analyze "数量为零时应用崩溃"
```

### 参数说明

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-m, --model <id>` | LLM 模型（`provider:model` 格式） | `openai:gpt-4` |
| `-c, --context-limit <n>` | 上下文窗口最大 token 数 | `8000` |
| `-v, --verbose` | 详细日志 | `false` |
| `-o, --output <file>` | 输出到文件 | stdout |
| `--apply` | 直接应用补丁 | `false` |
| `--dry-run` | 预览补丁变更 | `false` |
| `--json` | JSON 格式输出 | `false` |
| `-f, --file <path>` | 从文件读取 Bug 描述 | — |

### 支持的 LLM 提供商

```bash
# OpenAI（默认）
contextfix fix "error" --model openai:gpt-4

# Anthropic Claude
contextfix fix "error" --model anthropic:claude-3-sonnet

# Ollama（本地运行，无需 API 密钥）
contextfix fix "error" --model ollama:codellama
```

## 配置

ContextFix 从 YAML 配置文件读取配置，优先级如下：

**项目级** (`.contextfix.yml`) > **全局** (`~/.contextfix.yml`) > **默认值**

```yaml
# .contextfix.yml
model: "openai:gpt-4"
apiKey: "sk-..."
contextLimit: 8000
ignorePatterns:
  - node_modules
  - dist
  - coverage
promptTemplates:
  analyze: "自定义分析提示词"
```

### API 密钥配置

```bash
# 环境变量
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...

# 或写入配置文件
echo 'apiKey: "sk-..."' > ~/.contextfix.yml
```

Ollama 在本地运行，不需要 API 密钥。

## 支持的编程语言

ContextFix 可解析以下语言的 import/依赖关系：

- TypeScript / JavaScript（ES import、CommonJS require、re-export）
- Python（import、from...import）
- Java（import、import static）
- Go（单行和块 import）
- Rust（use 语句）

## 架构

```
contextfix/
├── src/
│   ├── cli.ts                    # CLI 入口（Commander.js）
│   ├── pipeline.ts               # 管道编排器
│   ├── input/                    # 输入解析与验证
│   ├── context/                  # 上下文收集
│   │   ├── collector.ts          # 上下文收集器
│   │   ├── git-provider.ts       # Git 历史（simple-git）
│   │   ├── ast-parser.ts         # AST 解析
│   │   ├── dependency-resolver.ts # 依赖关系图
│   │   ├── relevance-scorer.ts   # 文件相关性评分
│   │   └── languages/            # 各语言 import 解析器
│   ├── analyzer/                 # LLM 根因分析
│   ├── patch/                    # 补丁生成与应用
│   ├── llm/                      # LLM 提供商抽象层
│   ├── config/                   # YAML 配置管理
│   └── output/                   # 终端 / JSON / 纯文本格式化
```

### 管道流程

```
用户输入
  ↓
InputParser          → BugReport（错误类型、文件路径、堆栈追踪、关键词）
  ↓
ContextCollector     → ContextWindow（相关文件、Git 历史、项目信息）
  ├── GitProvider         （文件历史、blame、.gitignore）
  ├── ASTParser           （import 提取）
  ├── DependencyResolver  （文件依赖图）
  └── RelevanceScorer     （加权相关性评分）
  ↓
RootCauseAnalyzer    → RootCauseReport（按置信度排序的候选根因 + 证据）
  ↓
PatchGenerator       → PatchSet（unified diff 补丁 + 优缺点分析）
  ↓
OutputFormatter      → 格式化输出（终端彩色 / JSON / 纯文本）
```

## 开发

```bash
# 安装依赖
pnpm install

# 运行测试
pnpm test

# 类型检查
pnpm lint

# 构建
pnpm build

# 监听模式
pnpm dev
```

### 测试

项目使用 Vitest 进行单元测试，fast-check 进行属性测试。共 417 个测试，覆盖 36 个测试文件，包含 10 个正确性属性：

- P1: 输入解析完整性
- P2: 配置往返一致性
- P3: 上下文窗口 Token 限制
- P4: 相关性评分有界性 [0, 1]
- P5: 补丁 unified diff 格式合法性
- P6: 直接提及文件优先
- P7: 堆栈追踪解析顺序保持
- P8: 配置合并优先级
- P9: .gitignore 过滤一致性
- P10: 输出模式自动检测（管道中无 ANSI 转义）

## 技术栈

- **运行时**: Node.js ≥ 18
- **语言**: TypeScript（strict 模式，ES2022）
- **CLI**: Commander.js
- **LLM**: 原生 fetch（无 SDK 依赖）
- **Git**: simple-git
- **构建**: tsup（基于 esbuild）
- **测试**: Vitest + fast-check
- **包管理**: pnpm

## 许可证

MIT
