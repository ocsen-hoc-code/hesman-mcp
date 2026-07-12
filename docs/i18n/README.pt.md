# Servidor MCP Hesman

[![CI](https://github.com/ocsen-hoc-code/hesman-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ocsen-hoc-code/hesman-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/hesman-mcp.svg)](https://www.npmjs.com/package/hesman-mcp)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

🌐 **Leia em:** [English](../../README.md) | [Tiếng Việt](./README.vi.md) | [Русский](./README.ru.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | [中文](./README.zh.md) | [日本語](./README.ja.md) | [العربية](./README.ar.md) | [Español](./README.es.md) | **Português**

**Hesman** é um servidor MCP (Model Context Protocol) de nova geração que oferece a agentes de IA uma compreensão profunda do seu código-fonte — símbolos, grafos de chamada, dependências e busca semântica — com um pipeline de compressão de 3 camadas que reduz drasticamente o consumo de tokens (até 97% nos melhores cenários). Tudo roda localmente. Sem APIs externas. Sem servidores LSP.

---

## Sumário

- [Por que Hesman?](#por-que-hesman)
- [Início Rápido](#início-rápido)
- [Funcionalidades](#funcionalidades)
- [Como a Redução de Tokens Funciona](#como-a-redução-de-tokens-funciona)
- [Instalação e Configuração](#instalação-e-configuração)
- [Referência de Ferramentas](#referência-de-ferramentas)
- [Configuração](#configuração)
- [Referência da CLI](#referência-da-cli)
- [Linguagens Suportadas](#linguagens-suportadas)
- [Arquitetura](#arquitetura)
- [Configuração de Desenvolvimento](#configuração-de-desenvolvimento)
- [Requisitos](#requisitos)
- [Documentação](#documentação)
- [Licença](#licença)

---

## Por que Hesman?

Agentes de IA para codificação são poderosos, mas caros. Cada linha de código que leem custa tokens. Enviar um arquivo inteiro quando o agente precisa apenas de uma função desperdiça contexto e dinheiro.

O Hesman resolve isso:

- **Servindo apenas o que o agente precisa** — uma função específica, seus caller, seus callee, ou os símbolos impactados por uma alteração.
- **Comprimindo cada resposta** — um pipeline de 3 camadas remove comentários, poda código irrelevante e resume grandes conjuntos de resultados.
- **Substituindo dumps brutos por resumos** — em vez de 200 referências em um array JSON, o agente recebe um bloco `_summary` com contagens agrupadas por tipo e arquivo.
- **Funcionando 100% localmente** — sem chaves de API, sem chamadas de rede, sem latência de serviços externos. Seu código nunca sai da sua máquina.
- **Economia mensurável** — cada resposta inclui `_meta.reduction` mostrando exatamente quantos tokens foram economizados em relação à saída bruta.

O resultado: agentes trabalham mais rápido, custam menos e raciocinam com mais precisão porque veem o código certo, não todo o código.

---

## Início Rápido

```bash
# 1. Instale globalmente
npm install -g hesman-mcp

# 2. Execute o servidor dentro do seu projeto
cd my-project
hesman

# 3. Registre com seu agente de IA (Claude Desktop, Cursor, VS Code)
hesman install --agent claude
```

Pronto. Assim que a indexação inicial terminar (alguns segundos para a maioria dos projetos), seu agente de IA poderá consultar seu código-fonte por meio das 11 ferramentas do Hesman.

---

## Funcionalidades

### Inteligência de Código

| Capacidade | Descrição |
|---|---|
| **Busca de símbolos** | Encontre funções, classes e métodos pelo nome — correspondência exata, aproximada (fuzzy) ou por prefixo (< 1ms) |
| **Grafo de chamada** | Navegue por caller e callee até 3 níveis de profundidade |
| **Rastreamento de referências** | Encontre cada uso de um símbolo em toda a base de código |
| **Análise de impacto** | Veja o que quebra se você renomear, excluir ou alterar a assinatura de um símbolo |
| **Busca semântica** | Descreva em linguagem natural o que você está procurando e encontre o código correspondente |
| **Busca estrutural** | Encontre padrões de código como `console.$METHOD($$$ARGS)` com capturas nomeadas |
| **Análise de dependências** | Veja o que um arquivo importa e o que importa dele |
| **Janelas de contexto** | Obtenha código compactado e focado em torno de qualquer localização em um arquivo |

### Pipeline de Redução de Tokens

O pipeline de compressão de 3 camadas do Hesman reduz o uso de tokens em cada resposta. A economia real é medida e relatada via `_meta.reduction` em cada resposta.

| Camada | Técnica | Economia Típica | Melhor Caso |
|---|---|---|---|
| **Modo compacto** | Remove comentários, linhas em branco, espaços à direita; elimina imports não utilizados | 10–30% | ~35% (código densamente comentado) |
| **Poda de contexto** | Mantém apenas linhas relevantes ao símbolo consultado; substitui código omitido por marcadores de contagem | 50–80% (sobre o modo compacto) | ~95% (arquivos grandes com área focal pequena) |
| **Sumarização inteligente** | Substitui grandes arrays de resultados por blocos `_summary` agregados; comprime cadeias de chamada em estatísticas agrupadas | 70–90% (em ferramentas de listagem) | ~90% (500+ referências → resumo) |

**Melhor caso combinado:** Um arquivo de 430 linhas consultado via `get_context` para uma única função → reduzido para ~6 linhas relevantes + modo compacto → **até 97% de redução**. Este é o cenário ideal; o uso típico em todas as ferramentas tem média de 20–70% de redução.

### Pronto para Produção

- **Pool de workers** — indexação paralela entre núcleos da CPU, dimensionado automaticamente por padrão
- **Monitoramento de arquivos** — reindexação incremental em alterações de arquivos via chokidar
- **Desligamento gracioso** — drena trabalhos ativos, descarrega armazenamentos, finaliza workers de forma limpa
- **Indexação por hash de conteúdo** — arquivos são reanalisados apenas quando seu conteúdo realmente muda
- **Suporte a monorepo** — detecta automaticamente workspaces pnpm, lerna, nx, turbo e npm
- **Diagnósticos** — `hesman diag` exibe memória, estatísticas de armazenamento, estado do pool e métricas de cache
- **Testado em CI** — roda em Ubuntu, macOS e Windows com Node 20 e 22

---

## Como a Redução de Tokens Funciona

### Camada 1: Modo Compacto

Remove comentários, linhas em branco e espaços à direita, preservando comentários mágicos (`// @ts-ignore`, `// eslint-disable-*`). O nível 2 adiciona manipulação de JSDoc com conhecimento de AST e remoção de imports não utilizados.

Antes:
```typescript
// This function calculates the total price
// including tax and shipping
function calculateTotal(
  items: CartItem[],      // shopping cart items
  taxRate: number,        // local tax rate
): number {
  let total = 0;

  // Sum up item prices
  for (const item of items) {
    total += item.price * item.quantity;
  }

  // Apply tax
  total = total * (1 + taxRate);

  return total;
}
```

Depois (Nível 1):
```typescript
function calculateTotal(
  items: CartItem[],
  taxRate: number,
): number {
  let total = 0;
  for (const item of items) {
    total += item.price * item.quantity;
  }
  total = total * (1 + taxRate);
  return total;
}
```

Depois (Nível 2 — com conhecimento de AST, preserva apenas JSDoc):
```typescript
/**
 * Calculates the total price including tax.
 * @param items - Shopping cart items
 * @param taxRate - Local tax rate as decimal (e.g., 0.08)
 */
function calculateTotal(items: CartItem[], taxRate: number): number {
  let total = 0;
  for (const item of items) {
    total += item.price * item.quantity;
  }
  total = total * (1 + taxRate);
  return total;
}
```

### Camada 2: Poda de Contexto

Quando um agente consulta `get_context` para um símbolo específico, o Hesman retorna apenas o código relevante:

```typescript
// ... (45 linhas omitidas: imports e funções auxiliares não relacionados)

/**
 * Processes the incoming webhook payload.
 */
export async function handleWebhook(payload: WebhookPayload): Promise<Result> {
  // ... (corpo da função)
}

// ... (120 linhas omitidas: definições de classe não relacionadas)
```

A poda mantém: a definição do símbolo focal, seu comentário de documentação, caller e callee diretos dentro do mesmo arquivo e referências no arquivo — todo o resto é substituído por um marcador de contagem.

### Camada 3: Sumarização Inteligente

Em vez de despejar 200 referências em um array JSON:

```json
{
  "_summary": {
    "totalCount": 200,
    "byKind": { "calls": 145, "imports": 38, "extends": 12, "type_ref": 5 },
    "byFile": [
      { "filePath": "src/services/payment.ts", "count": 34 },
      { "filePath": "src/controllers/checkout.ts", "count": 28 }
    ]
  }
}
```

O agente pode então solicitar detalhes para arquivos ou tipos específicos — paginados via `cursor`.

### Medindo a Economia

Cada resposta do Hesman inclui um bloco `_meta` com a economia real de tokens:

```json
{
  "_meta": {
    "originalTokens": 2007,
    "compressedTokens": 58,
    "reduction": "97.1%",
    "layers": ["compact", "prune"]
  }
}
```

Isso permite auditar exatamente quanto o Hesman está economizando em suas cargas de trabalho reais.

---

## Instalação e Configuração

### Pré-requisitos

- **Node.js** ≥ 20.0.0
- **npm** (ou pnpm / yarn)

### Instalar via npm

```bash
npm install -g hesman-mcp
```

### Instalar a Partir do Código Fonte

```bash
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install
npm run download:parsers   # Baixar parsers WASM do Tree-sitter
npm run build              # Compilar TypeScript
npm link                   # Tornar `hesman` disponível globalmente
```

### Registrar com Agentes de IA

```bash
# Claude Desktop (detecta automaticamente o caminho do config por plataforma)
hesman install --agent claude

# Cursor
hesman install --agent cursor

# VS Code (com Copilot ou Cline)
hesman install --agent vscode

# Use --global para escrever no config do usuário em vez do config do projeto
hesman install --agent claude --global
```

Após a instalação, reinicie seu agente de IA e o Hesman estará disponível como um servidor MCP.

### Configuração Manual do MCP

Adicione isto ao arquivo de configuração MCP do seu agente:

```json
{
  "mcpServers": {
    "hesman": {
      "command": "hesman",
      "args": ["--project-root", "/path/to/your/project"],
      "env": {}
    }
  }
}
```

---

## Referência de Ferramentas

O Hesman expõe **11 ferramentas** via transporte MCP stdio. Cada resposta inclui um bloco `_meta` com economia de tokens e, quando aplicável, um bloco `_summary` agregando resultados.

### Navegação de Código

| Ferramenta | O que faz | Principais entradas |
|---|---|---|
| `find_symbol` | Encontra símbolos pelo nome com correspondência exata, aproximada (fuzzy) ou por prefixo | `name`, `kind`, `matchMode`, `topK` |
| `get_file_structure` | Obtém uma árvore hierárquica de todos os símbolos em um arquivo | `filePath`, `includeNested` |
| `get_references` | Encontra todos os usos de um símbolo em toda a base de código | `symbolId`, `referenceKind`, `topK`, `cursor` |
| `get_context` | Obtém código compactado em torno de uma localização específica | `filePath`, `startLine`, `contextLines`, `mode` |

### Grafo de Chamada

| Ferramenta | O que faz | Principais entradas |
|---|---|---|
| `get_callers` | Encontra todas as funções que chamam um determinado símbolo (até 3 níveis de profundidade) | `symbolId`, `maxDepth`, `topK` |
| `get_callees` | Encontra todas as funções chamadas por um determinado símbolo (até 3 níveis de profundidade) | `symbolId`, `maxDepth`, `topK` |

### Análise

| Ferramenta | O que faz | Principais entradas |
|---|---|---|
| `impact_analysis` | Categoriza o que quebra se um símbolo mudar (renomear/excluir/alterar assinatura) | `symbolId`, `changeType` |
| `list_dependencies` | Mostra o que um arquivo importa, ou o que importa dele | `filePath`, `direction` |
| `semantic_search` | Busca código por descrição em linguagem natural | `query`, `topK`, `language`, `kind` |
| `find_pattern` | Busca por padrão estrutural com capturas nomeadas (`$NAME`, `$$$ARGS`) | `pattern`, `language`, `topK` |

### Status

| Ferramenta | O que faz |
|---|---|
| `index_status` | Relata a saúde da indexação: contagem de arquivos, contagem de símbolos, status do armazenamento, arquivos pendentes |

Para esquemas completos de entrada/saída com exemplos, veja **[docs/TOOLS.md](./docs/TOOLS.md)**.

---

## Configuração

Crie um `hesman.config.json` na raiz do seu projeto (todos os campos são opcionais):

```json
{
  "projectRoot": ".",
  "workers": 0,
  "watchMode": true,
  "languages": ["*"],
  "ignore": ["node_modules/**", "dist/**", ".git/**", "legacy/**"],
  "semanticSearch": {
    "enabled": true,
    "defaultTopK": 10,
    "maxTopK": 50,
    "embeddingModel": "Xenova/all-MiniLM-L6-v2"
  },
  "logLevel": "info",
  "dataDir": ".hesman"
}
```

### Precedência de Configuração

As configurações são resolvidas nesta ordem (a posterior substitui a anterior):

1. **Padrões** — embutidos no Hesman
2. **`hesman.config.json`** — arquivo de configuração no nível do projeto
3. **Variáveis de ambiente** — ex.: `HESMAN_WORKERS=4`
4. **Flags da CLI** — ex.: `--workers 4`

### Variáveis de Ambiente

| Variável | Equivalente | Descrição |
|---|---|---|
| `HESMAN_PROJECT_ROOT` | `--project-root` | Caminho para o projeto a ser indexado |
| `HESMAN_WORKERS` | `--workers N` | Número de threads worker (0 = detecção automática) |
| `HESMAN_LOG_LEVEL` | `--log-level` | Um de: trace, debug, info, warn, error |
| `HESMAN_DATA_DIR` | `--data-dir` | Diretório para dados de índice (padrão: `.hesman`) |
| `HESMAN_WATCH_MODE` | `--watch-mode` | Ativar/desativar monitoramento de arquivos (true/false) |

### Flags da CLI

| Flag | Descrição |
|---|---|
| `--project-root <caminho>` | Diretório raiz do projeto |
| `--workers <N>` | Número de threads worker (0 = automático) |
| `--log-level <nível>` | Nível de registro |
| `--data-dir <caminho>` | Caminho do diretório de dados |
| `--watch-mode` | Ativar monitoramento de arquivos |
| `--no-watch` | Desativar monitoramento de arquivos |
| `--no-semantic` | Desativar busca semântica |
| `--batch-size <N>` | Arquivos por lote de indexação |

---

## Referência da CLI

```
hesman                         Executa o servidor MCP via stdio (padrão)
hesman index [caminho]         Indexa um projeto sem iniciar o servidor
hesman status [caminho]        Mostra progresso da indexação e estatísticas
hesman clean [caminho]         Exclui o diretório de dados .hesman/
hesman clean --force           Pula o prompt de confirmação
hesman clean --dry-run         Visualiza o que seria excluído sem remover
hesman diag [caminho]          Exibe diagnósticos: memória, estatísticas de armazenamento, pool, cache
hesman diag --json             Exibe diagnósticos como JSON
hesman install --agent <nome>  Escreve configuração MCP para Claude Desktop, Cursor ou VS Code
hesman install --global        Escreve no config do usuário em vez do config do projeto
hesman --version, -v           Exibe o número da versão
hesman --help, -h              Exibe o texto de ajuda
```

---

## Linguagens Suportadas

| Linguagem | Extensões | Status |
|---|---|---|
| TypeScript / JavaScript | `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts`, `.cts` | Suporte completo |
| Python | `.py`, `.pyw`, `.pyi` | Suporte completo |
| Go | `.go` | Suporte completo |

A arquitetura suporta até **158 linguagens** via Tree-sitter. Adicionar uma nova linguagem requer a implementação de um `LanguageProfile` — veja o [Guia de Contribuição](./docs/CONTRIBUTING.md) para instruções passo a passo.

---

## Arquitetura

```
                         ┌──────────────────────────────────────┐
                         │         AI Agent (Claude, etc.)       │
                         │              │  MCP stdio              │
                         └──────────────┼─────────────────────────┘
                                        │
                         ┌──────────────┼─────────────────────────┐
                         │       Hesman MCP Server                │
                         │              │                          │
                         │   ┌──────────┴──────────────────────┐  │
                         │   │  Pipeline de Compressão de 3    │  │
                         │   │  Camadas                        │  │
                         │   │  ┌────────────────────────────┐  │  │
                         │   │  │ 1. Modo Compacto           │  │  │
                         │   │  │    Remove comentários/     │  │  │
                         │   │  │    linhas em branco        │  │  │
                         │   │  │ 2. Poda de Contexto        │  │  │
                         │   │  │    Mantém apenas linhas    │  │  │
                         │   │  │    relevantes              │  │  │
                         │   │  │ 3. Sumarização Inteligente │  │  │
                         │   │  │    Agrega e comprime       │  │  │
                         │   │  └────────────────────────────┘  │  │
                         │   └───────────────────────────────────┘  │
                         │                                          │
                         │   ┌──────────┐ ┌──────────┐ ┌─────────┐ │
                         │   │  SQLite  │ │   ZVec   │ │ Pool de │ │
                         │   │  Store   │ │  Vector  │ │ Workers │ │
                         │   │ (símbolos)│ │ (busca)  │ │(índice) │ │
                         │   └────┬─────┘ └────┬─────┘ └────┬────┘ │
                         │        │            │            │       │
                         │   ┌────┴────────────┴────────────┴────┐  │
                         │   │  Monitor de Arquivos (chokidar)   │  │
                         │   └───────────────────────────────────┘  │
                         └──────────────────────────────────────────┘
```

**Pipeline de dados principal:** Alterações em arquivos (chokidar) → Parsing Tree-sitter (AST + símbolos) → Índice SQLite + embeddings ZVec → Respostas MCP comprimidas

**Principais decisões de design:**
- **Sem dependência de LSP** — Tree-sitter fornece parsing agnóstico a linguagens sem executar servidores de linguagem
- **Indexação incremental por hash de conteúdo** — arquivos são reanalisados apenas quando o SHA-256 muda
- **Compressão no nível da resposta** — os dados originais permanecem intactos; a compressão é aplicada no limite da resposta
- **Banco SQLite único por projeto** — mesmo em monorepos, todos os pacotes compartilham um armazenamento com isolamento por `file_path`

Para o documento completo de arquitetura, incluindo dependências de módulos, esquemas de armazenamento e design do pool de workers, veja **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)**.

---

## Configuração de Desenvolvimento

### Pré-requisitos

- **Node.js** ≥ 20.0.0
- **npm** ≥ 10

### Primeiros Passos

```bash
# Clone e instale
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install

# Baixe os parsers WASM do Tree-sitter
npm run download:parsers

# Execute em modo de desenvolvimento (hot reload)
npm run dev

# Compile para produção
npm run build
```

### Qualidade de Código

```bash
npm run typecheck    # Verificação de tipos TypeScript
npm run lint         # ESLint
npm run format       # Formatação Prettier
```

### Executando Testes

```bash
npm test                  # Executa todos os testes (unitários + integração)
npm run test:watch        # Modo de observação para desenvolvimento
npm run test:e2e          # Testes ponta a ponta (inicia servidor completo)
npm run test:perf         # Benchmarks de desempenho
```

### Metas de Desempenho

| Benchmark | Meta |
|---|---|
| Taxa de indexação | ≥ 500 arquivos/s |
| `find_symbol` (exato) | < 1ms |
| `find_symbol` (aproximado) | < 5ms |
| `semantic_search` | < 10ms |
| `get_references` | < 5ms |
| Memória (após indexação) | < 350MB |

Para o guia completo de contribuição, incluindo como adicionar novas linguagens, veja **[docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md)**.

---

## Requisitos

| Recurso | Mínimo |
|---|---|
| **Node.js** | ≥ 20.0.0 |
| **Memória (ocioso)** | ~100 MB |
| **Memória (sob carga)** | ~350 MB |
| **Disco** | ~80 MB (download único do modelo de embedding) |
| **Rede** | Apenas para o `npm install` inicial; zero chamadas de rede em tempo de execução |

O modelo de embedding (`all-MiniLM-L6-v2`) é baixado no primeiro uso e armazenado em cache indefinidamente no diretório de cache do Transformers.js.

---

## Documentação

| Documento | Conteúdo |
|---|---|
| [README.md](../../README.md) | Visão geral do projeto, configuração e definições (este arquivo) |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Arquitetura completa: fluxo de dados, mapa de módulos, esquemas de armazenamento, design do pool de workers |
| [docs/TOOLS.md](./docs/TOOLS.md) | Esquemas completos de entrada/saída para todas as 11 ferramentas com exemplos |
| [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) | Configuração de desenvolvimento, guia de teste, criação de perfis de linguagem, checklist de PR |
| [CHANGELOG.md](./CHANGELOG.md) | Histórico de versões e alterações |

---

## Licença

[MIT](./LICENSE) — Copyright (c) 2026 Minh Do
