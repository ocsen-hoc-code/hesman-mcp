# Hesman MCP Server

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

🌐 **Leia em:** [English](../../README.md) | [Tiếng Việt](./README.vi.md) | [Русский](./README.ru.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | [中文](./README.zh.md) | [日本語](./README.ja.md) | [العربية](./README.ar.md) | [Español](./README.es.md) | **Português**

**Hesman** é um servidor MCP (Model Context Protocol) de nova geração que dá aos agentes de programação com IA uma compreensão profunda da sua base de código — símbolos, grafos de chamadas, dependências e busca semântica — com respostas moldadas para custar poucos tokens: neste repositório, `get_context` retorna de 80% a 96% menos tokens do que o arquivo inteiro, e listas de callers ou referências são de 66% a 72% menores do que o JSON bruto (veja [Medido neste repositório](#medido-neste-repositório)). Tudo roda na sua máquina: sem APIs externas, sem servidores LSP, e o seu código nunca é enviado para lugar nenhum.

---

## Sumário

- [Por que Hesman?](#por-que-hesman)
- [Início rápido](#início-rápido)
- [Funcionalidades](#funcionalidades)
- [Como funciona a redução de tokens](#como-funciona-a-redução-de-tokens)
- [Instalação e configuração](#instalação-e-configuração)
- [Painel](#painel)
- [Desinstalação](#desinstalação)
- [Referência das ferramentas](#referência-das-ferramentas)
- [Configuração](#configuração)
- [Referência da CLI](#referência-da-cli)
- [Linguagens suportadas](#linguagens-suportadas)
- [Arquitetura](#arquitetura)
- [Ambiente de desenvolvimento](#ambiente-de-desenvolvimento)
- [Requisitos](#requisitos)
- [Documentação](#documentação)
- [Licença](#licença)

---

## Por que Hesman?

Agentes de programação com IA são poderosos, mas caros. Cada linha de código que eles leem custa tokens. Enviar um arquivo inteiro quando o agente só precisa de uma função desperdiça contexto e dinheiro.

O Hesman resolve isso:

- **Servindo apenas o que o agente precisa** — uma função específica, seus callers, seus callees ou os símbolos afetados por uma alteração.
- **Compactando e podando o código** — `get_context` remove comentários e linhas em branco e retorna apenas as linhas ao redor do local de interesse, em vez do arquivo inteiro.
- **Listas compactas** — callers, callees, referências, símbolos e estruturas de arquivos voltam como linhas sob colunas nomeadas, agrupadas por arquivo, com caminhos relativos ao projeto; nenhuma linha é descartada. Uma resposta nunca é maior do que o seu payload bruto (veja [Pipeline de redução de tokens](#pipeline-de-redução-de-tokens)).
- **Rodando na sua máquina** — sem chaves de API, sem serviço externo e, portanto, sem a latência de um. Seu código nunca sai da sua máquina. Os únicos downloads são o modelo de embedding no primeiro uso e as gramáticas das linguagens sob demanda; ambos podem ser desativados (`--no-semantic`, `HESMAN_GRAMMARS_OFFLINE=1`).
- **Com economia mensurável** — toda resposta de ferramenta, exceto a de `index_status`, inclui `_meta.reduction`, que mostra exatamente quantos tokens foram economizados em relação à saída bruta.

O resultado: os agentes trabalham mais rápido, custam menos e raciocinam com mais precisão porque veem o código certo, não todo o código.

---

## Início rápido

O `hesman-mcp` ainda não está no registro do npm; por isso, hoje o Hesman é instalado a partir do código-fonte:

```bash
# 1. Obter e compilar o Hesman (Node.js ≥ 20)
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install
npm run download:parsers
npm run build

# 2. Registrá-lo nos seus clientes de IA (detecta Claude Code, Cursor, VS Code, Codex, …)
node dist/index.js setup
```

Reinicie o cliente e abra um projeto. O `setup` grava o comando de inicialização adequado à forma como o Hesman está instalado (aqui: caminhos absolutos para `node` e `dist/index.js`, de modo que nada precisa estar no PATH); veja [Comando de inicialização](#comando-de-inicialização).

Depois que o pacote for publicado, todo o início rápido passa a ser uma linha:

```bash
npx -y hesman-mcp setup   # somente quando o hesman-mcp estiver publicado no npm
```

O servidor responde ao seu agente imediatamente e indexa em segundo plano (alguns segundos na maioria dos projetos): as 11 ferramentas funcionam de imediato, marcam os resultados com `_meta.indexing` enquanto o índice ainda está incompleto, e `index_status` informa o progresso.

---

## Funcionalidades

### Inteligência de código

| Capacidade | Descrição |
|---|---|
| **Busca de símbolos** | Encontre funções, classes e métodos pelo nome — correspondência exata, aproximada (fuzzy) ou por prefixo (< 1 ms) |
| **Navegação no grafo de chamadas** | Percorra callers e callees até 3 níveis de profundidade |
| **Rastreamento de referências** | Encontre cada uso de um símbolo em toda a base de código |
| **Análise de impacto** | Veja o que quebra se você renomear ou excluir um símbolo, ou alterar a assinatura dele |
| **Busca semântica** | Descreva em linguagem natural o que você procura e encontre o código correspondente |
| **Busca estrutural** | Encontre padrões de código como `console.$METHOD($$$ARGS)` com capturas nomeadas |
| **Análise de dependências** | Veja o que um arquivo importa e o que importa dele |
| **Janelas de contexto** | Obtenha código focado e compactado ao redor de qualquer local de um arquivo |

### Pipeline de redução de tokens

O Hesman reduz tokens de três maneiras. Cada resposta informa sua economia real em `_meta.reduction`, e uma resposta nunca é maior do que o seu payload bruto.

| Camada | Técnica | Economia medida | Aplica-se a |
|---|---|---|---|
| **Modo compacto** | Remove comentários, linhas em branco e espaços no fim das linhas | 0–16% de um trecho de código, conforme a quantidade de comentários e linhas em branco (`mode: "full"` vs. `"compact"`) | `get_context` |
| **Poda de contexto** | Retorna um intervalo de linhas ao redor do local de interesse, em vez do arquivo | 96,0% com as ±5 linhas padrão, 79,7% com ±40 linhas (arquivo de 514 linhas); 0% quando o arquivo inteiro é solicitado | `get_context` |
| **Listas compactas** | Linhas sob colunas nomeadas, agrupadas por arquivo, com caminhos relativos ao projeto | 66–72% para callers, callees e referências; 35–41% para listas de símbolos, estruturas de arquivos, dependências e análise de impacto | `find_symbol`, `get_references`, `get_callers`, `get_callees`, `get_file_structure`, `list_dependencies`, `impact_analysis` |

`find_pattern` e `semantic_search` retornam o payload bruto (`_meta.reduction: "0.0%"`). Os números são deste repositório; veja [Medido neste repositório](#medido-neste-repositório) para a tabela completa e como reproduzi-la. O campo `_meta.reduction` de cada resposta informa a economia exata para a sua carga de trabalho.

### Pronto para produção

- **Pool de workers** — indexação paralela entre os núcleos da CPU, dimensionado automaticamente por padrão
- **Monitoramento de arquivos** — reindexação incremental a cada alteração de arquivo, via chokidar
- **Encerramento gracioso** — conclui o trabalho ativo, descarrega os armazenamentos em disco e finaliza os workers de forma limpa
- **Indexação por hash de conteúdo** — os arquivos só são reanalisados quando o conteúdo realmente muda
- **Suporte a monorepos** — detecta automaticamente workspaces pnpm, lerna, nx, turbo e npm
- **Diagnósticos** — `hesman diag` exibe memória, estatísticas dos armazenamentos, estado do pool e métricas de cache
- **Testado localmente** — a suíte de testes completa, incluindo os testes de ponta a ponta pelo servidor real, roda no macOS; Linux e Windows ainda não foram verificados

---

## Como funciona a redução de tokens

### Camada 1: modo compacto

Remove comentários, linhas em branco e espaços no fim das linhas, preservando os comentários mágicos (`// @ts-ignore`, `// eslint-disable-*`).

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

Depois:
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

### Camada 2: poda de contexto

`get_context` não retorna o arquivo inteiro. Ele retorna o intervalo de linhas solicitado mais `contextLines` linhas acima e abaixo (padrão 5, máximo 200) e então aplica o modo compacto a esse trecho. `_meta.reduction` compara o resultado com o arquivo inteiro, e `_meta.layers` lista o que foi aplicado (`compact`, `prune`).

A poda é apenas por intervalo de linhas: ela não segue callers nem callees. Para ler o que uma função chama ou o que a chama, peça os locais a `get_callees` / `get_callers` e depois `get_context` para cada um.

### Camada 3: listas compactas

Uma resposta de lista repete as mesmas coisas em cada linha: um caminho de arquivo longo, os nomes dos campos, valores que nunca mudam. A forma compacta escreve cada um deles uma única vez: os nomes dos campos em `columns`, o caminho uma vez por arquivo, relativo ao projeto. Esta é uma resposta real de `get_callers`:

```json
{
  "format": "compact",
  "columns": ["symbolId", "name", "kind", "line", "depth", "callLine", "callFile"],
  "files": [
    { "file": "src/indexing/file-watcher.ts", "rows": [["a182668c09c39b47", "scan", "method", 78, 1, 79, null]] }
  ],
  "_meta": { "originalTokens": 101, "compressedTokens": 54, "reduction": "46.5%", "compressed": true, "layers": ["group", "columns", "paths"] }
}
```

Nenhuma linha é descartada e nada é resumido; `symbolId`, o `file` relativo e `line` podem ser passados diretamente às outras ferramentas. `get_file_structure` e `list_dependencies` usam uma única lista plana `rows`. Quando a forma compacta não seria menor (uma lista vazia, uma única linha), o payload bruto é retornado. Passe `format: "full"` a qualquer uma dessas ferramentas para obter os objetos brutos com caminhos absolutos. Listas longas são obtidas em páginas com `topK` e, em `get_references`, com `cursor`.

### Medindo a economia

Toda resposta de ferramenta, exceto a de `index_status`, inclui um bloco `_meta` com a economia real de tokens:

```json
{
  "_meta": {
    "originalTokens": 4782,
    "compressedTokens": 190,
    "reduction": "96.0%",
    "compressed": false,
    "layers": ["prune"]
  }
}
```

Este exemplo é uma chamada real a `get_context` (±5 linhas padrão, modo compacto) em um arquivo de 514 linhas: o trecho já vem compactado pela ferramenta, então apenas a camada `prune` é listada, e `compressed: false` significa que o compressor de respostas não tinha mais nada a remover. O campo `_meta.reduction` é medido em relação à contagem de tokens do arquivo completo original, o que dá a economia real de ponta a ponta. Respostas que não encolheriam são retornadas como estão, com `reduction: "0.0%"`; o valor nunca é negativo. Audite exatamente quanto o Hesman economiza nas suas cargas de trabalho reais conferindo `_meta.reduction` em qualquer resposta de ferramenta.

---

## Instalação e configuração

### Pré-requisitos

- **Node.js** ≥ 20.0.0
- **npm** (ou pnpm / yarn)

### Instalar a partir do código-fonte

Este é o caminho que funciona hoje.

```bash
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install
npm run download:parsers   # Baixar os parsers WASM do Tree-sitter
npm run build              # Compilar o TypeScript
npm link                   # Opcional: deixar `hesman` disponível no PATH
```

Sem `npm link`, use `node /path/to/hesman-mcp/dist/index.js` onde quer que este README diga `hesman`.

### Instalar via npm (depois que o pacote for publicado)

O `hesman-mcp` ainda não está no registro do npm. Quando estiver:

```bash
npx -y hesman-mcp setup     # sem instalar: os clientes iniciam o Hesman pelo npx
npm install -g hesman-mcp   # ou uma instalação global que coloca `hesman` no PATH
```

### Registrar nos agentes de IA

```bash
hesman setup                         # lista de seleção dos clientes encontrados nesta máquina
hesman setup --yes                   # sem perguntas: configura todos os clientes detectados
hesman setup --client cursor vscode  # configura clientes específicos
hesman setup --dry-run --all         # mostra a alteração exata por cliente, não grava nada
hesman remove                        # desfazer: retira o Hesman de todos os clientes novamente
```

| Cliente | `--client` | O que `hesman setup` altera (escopo de usuário) | `--scope project` |
|---|---|---|---|
| Claude Code | `claude-code` | executa `claude mcp add --scope user hesman -- <launch command>`; sem a CLI, edita `~/.claude.json` | `.mcp.json` |
| Claude Desktop | `claude-desktop` | `claude_desktop_config.json` | — |
| OpenAI Codex CLI | `codex` | executa `codex mcp add hesman -- <launch command>`; sem a CLI, edita `~/.codex/config.toml` | `.codex/config.toml` |
| Cursor | `cursor` | `~/.cursor/mcp.json` | `.cursor/mcp.json` |
| Google Antigravity | `antigravity` | `~/.gemini/config/mcp_config.json` | `.agents/mcp_config.json` |
| VS Code (Copilot) | `vscode` | `mcp.json` no diretório de usuário do VS Code | `.vscode/mcp.json` |
| Gemini CLI | `gemini-cli` | `~/.gemini/settings.json` | `.gemini/settings.json` |
| Windsurf | `windsurf` | `~/.config/devin/mcp_config.json` | — |

- Apenas a entrada `hesman` é tocada. Um arquivo alterado é primeiro copiado para `<file>.hesman.bak`, e `hesman remove` o restaura byte a byte quando nada mais mudou nesse intervalo.
- A entrada não contém nenhum caminho de projeto: o Hesman encontra o projeto sozinho (veja abaixo). Duas exceções: o **Claude Desktop** não tem workspace, então sua entrada fixa um projeto (o diretório atual, ou `--project-root <path>`), e o **Cursor** recebe `--project-root ${workspaceFolder}` apenas no escopo de projeto (no `~/.cursor/mcp.json` global essa variável pode ser o seu diretório home, então a entrada global não nomeia nenhum projeto).
- Para o **Antigravity** e o **Windsurf**, a forma como o projeto é passado ao servidor não está documentada; `hesman setup` exibe uma nota pedindo que você verifique após a primeira inicialização.
- Arquivos de configuração com comentários (JSONC) não são editados: `hesman setup` os informa e os deixa intactos.
- `hesman install --agent <name>` continua funcionando como alias obsoleto de `hesman setup --client <name> --yes`.

Após a configuração, reinicie o cliente e o Hesman estará disponível como servidor MCP.

### Regras de uso para agentes (opt-in)

Um servidor MCP instalado não é automaticamente um servidor usado: os agentes muitas vezes continuam recorrendo ao grep e à leitura de arquivos inteiros. `hesman setup --rules` grava também um bloco curto (14 linhas) no arquivo de instruções que cada cliente selecionado lê no **projeto atual**, dizendo qual ferramenta do Hesman responde a qual pergunta. Ainda não foi medido se isso muda a frequência com que um agente chama as ferramentas.

```bash
hesman setup --client claude-code codex --rules   # executar dentro do projeto
hesman setup --all --rules --dry-run              # mostra o bloco e os arquivos, não grava nada
hesman remove                                     # também apaga o bloco novamente
```

| Cliente | Arquivo de instruções (relativo ao projeto) |
|---|---|
| Claude Code | `CLAUDE.md` |
| OpenAI Codex CLI, Windsurf | `AGENTS.md` |
| Gemini CLI, Google Antigravity | `GEMINI.md` |
| Cursor | `.cursor/rules/hesman.mdc` (seu próprio arquivo de regras, `alwaysApply: true`) |
| VS Code (Copilot) | `.github/copilot-instructions.md` |
| Claude Desktop | nenhum: ele não lê nenhum arquivo de projeto, então é ignorado com uma nota |

- **Opt-in.** Nada é gravado sem `--rules`. Em um terminal, sem `--yes`, o setup pergunta uma vez e a resposta padrão é Não.
- O bloco fica entre `<!-- hesman:rules:start -->` e `<!-- hesman:rules:end -->`. Executar o setup de novo o substitui no mesmo lugar; o texto fora dos marcadores nunca é alterado, e um arquivo compartilhado por dois clientes recebe o bloco uma única vez.
- `hesman remove` apaga exatamente o bloco e devolve o arquivo byte a byte; um arquivo que o Hesman criou e que não contém mais nada é apagado. Execute-o no mesmo projeto (ou passe `--project-root <path>`, que `setup --rules` também aceita).
- Esses arquivos normalmente são versionados no git e compartilhados com uma equipe. O setup lista os arquivos que alterou para que você possa revisá-los (`git diff`) e decidir se faz o commit.

### Comando de inicialização

`hesman setup --command auto|npx|global|absolute` decide o que os clientes executam. O setup nunca usa a rede.

| `--command` | Entrada gravada | Requer |
|---|---|---|
| `npx` | `npx -y hesman-mcp@<major>` | o pacote no npm (ainda não publicado) e `npx` no PATH do cliente; sobrevive a atualizações do Node |
| `global` | `hesman` | uma instalação global (ou `npm link`) no PATH do cliente |
| `absolute` | `/path/to/node /path/to/hesman-mcp/dist/index.js` | nada no PATH; execute `hesman setup` de novo depois de trocar de versão do Node ou de mover o Hesman |

`auto` (o padrão) observa como o Hesman em execução foi iniciado:

1. iniciado pelo `npx` (ele roda a partir de um diretório de cache `_npx`) → `npx`;
2. o `hesman` no PATH é esta mesma instalação (links simbólicos resolvidos) → `global`;
3. qualquer outro caso (checkout do código-fonte, `node_modules` local, fora do PATH) → `absolute`.

Aplicativos desktop (Claude Desktop, Cursor, Antigravity, VS Code, Windsurf) abertos pelo Dock ou por um launcher não recebem o PATH do seu shell. No macOS e no Linux, quando `auto` escolhe `npx` ou `hesman` e esse comando ou o `node` não está em um diretório padrão do sistema (`/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`, `/usr/local/bin`, além de `/opt/homebrew/bin` no macOS e `/snap/bin` no Linux) — o caso comum com nvm, fnm, volta ou asdf — esses clientes recebem a entrada `absolute` no lugar, com uma nota para executar `hesman setup` de novo depois de trocar de versão do Node. Clientes de terminal (Claude Code, Codex CLI, Gemini CLI) herdam o shell e mantêm o comando escolhido. Um `--command npx|global` explícito é gravado como pedido para todos os clientes, com um aviso onde um aplicativo desktop pode não encontrá-lo.

### Configuração manual do MCP

Adicione isto ao arquivo de configuração MCP do seu agente (o VS Code usa `"servers"` em vez de `"mcpServers"` e precisa de `"type": "stdio"` na entrada; o Codex usa uma tabela TOML `[mcp_servers.hesman]`):

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

`--project-root` é opcional; veja abaixo. `"command": "hesman"` exige que `hesman` esteja no PATH que o cliente enxerga; caso contrário, use `"command": "/path/to/node"` com `"/path/to/hesman-mcp/dist/index.js"` como primeiro argumento (veja [Comando de inicialização](#comando-de-inicialização)).

### Como o Hesman escolhe o projeto

Um processo do servidor indexa um único projeto. Ele é escolhido nesta ordem:

1. **Raiz explícita** — `--project-root <path>`, `HESMAN_PROJECT_ROOT` ou `projectRoot` em `hesman.config.json`. Sempre prevalece.
2. **Pastas de workspace do cliente MCP** — quando o cliente oferece a capacidade `roots` do MCP, o Hesman pede a ele suas pastas após o handshake e indexa a primeira (as outras pastas são registradas em log, não indexadas). Quando o cliente informa uma pasta diferente mais tarde, o Hesman muda para ela.
3. **Diretório de trabalho** — o diretório mais próximo, no diretório de trabalho do servidor ou acima dele, que contenha um diretório de controle de versão (`.git`, `.hg`, `.svn`, `.jj`) ou um manifesto de projeto (`package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`, …).
4. **Nenhum projeto** — o servidor ainda inicia e lista suas ferramentas, mas toda ferramenta retorna um erro `NO_PROJECT` que explica como definir uma raiz.

O diretório home e seus diretórios pais nunca são escolhidos automaticamente (etapas 2 e 3), de modo que uma entrada MCP global iniciada a partir de `~` não varre o seu disco. O índice fica armazenado em `.hesman/` dentro do projeto escolhido.

---

## Painel

`hesman ui` abre uma página web local para um projeto: o que os agentes pediram ao Hesman, a rapidez com que respondeu, quantos tokens economizou, o que o servidor registrou e o que há no índice.

```bash
cd /path/to/project
hesman ui                 # uma porta livre; abre o navegador
hesman ui --no-open       # mostra apenas a URL
hesman ui --port 4100     # uma porta fixa
```

O projeto precisa ter um índice (inicie o servidor MCP uma vez, ou execute `hesman index`). O comando mostra uma URL no formato `http://127.0.0.1:<port>/?token=<random>`; pare-o com Ctrl+C.

![Métricas: chamadas, falhas, latência e tokens antes e depois da redução](../images/dashboard-metrics.png)

| Tela | O que mostra |
|---|---|
| **Overview** | Estado do índice, arquivos, símbolos e relações, cada linguagem com seu nível de suporte e o que está indisponível no painel |
| **Metrics** | Chamadas de ferramentas registradas pelo servidor MCP: quantidade, falhas, latência mediana e do percentil 95, tokens antes e depois da redução, ao longo do tempo e por ferramenta, com as chamadas recentes |
| **Logs** | O log do servidor, do mais recente para o mais antigo, filtrado por nível e texto, atualizado ao vivo |
| **Graph** | Encontre um símbolo e veja seus callers e callees como um grafo, ou veja como os arquivos se importam; selecione um nó para carregar seus vizinhos |
| **Playground** | Escolha uma ferramenta, preencha seus argumentos em um formulário, execute-a e veja a resposta exata que um agente recebe, com os números de tokens |

![Grafo: um símbolo com seus callers e callees](../images/dashboard-graph.png)

Coisas a saber:

- **Metrics e Logs mostram o que o servidor MCP registrou.** Ficam vazios até que um agente tenha chamado o Hesman naquele projeto; `hesman index` sozinho não registra chamadas.
- **Ele roda ao lado do servidor MCP.** O painel é um processo separado que abre o índice somente leitura, então os dois podem rodar ao mesmo tempo.
- **Somente local.** Ele escuta em `127.0.0.1`, e cada requisição precisa do token da URL, que muda a cada início. Nada é enviado para lugar nenhum.
- **Dois limites.** `semantic_search` não pode ser executada pelo Playground (o armazenamento vetorial permite um só processo, e o servidor MCP o mantém), e o painel mostra o índice como foi guardado, não uma execução em andamento.

Todas as opções e a API HTTP estão em [docs/CLI.md](../CLI.md#hesman-ui); as regras de acesso estão em [docs/SECURITY.md](../SECURITY.md).

---

## Desinstalação

O Hesman guarda dados em quatro lugares. Remova-os nesta ordem, porque os dois primeiros passos precisam do comando `hesman`.

**1. Retire o Hesman dos seus clientes de IA**

```bash
hesman remove --dry-run        # mostra o que seria removido, sem gravar nada
hesman remove                  # remove a entrada hesman de cada cliente que a tiver (escopo de usuário)
hesman remove --scope project  # execute dentro de um projeto configurado com --scope project
```

`hesman remove` remove apenas a entrada `hesman` e, se você usou `hesman setup --rules`, o bloco entre `<!-- hesman:rules:start -->` e `<!-- hesman:rules:end -->` nos arquivos de instruções do projeto; todo o resto desses arquivos permanece como estava. Reinicie os clientes depois. Um arquivo `<config>.hesman.bak` ao lado da configuração de um cliente é o backup que o Hesman fez antes da última edição; apague-o quando não precisar mais dele.

**2. Apague o índice de cada projeto**

```bash
cd /path/to/project
hesman clean --dry-run   # mostra o diretório e o seu tamanho
hesman clean --force     # apaga .hesman/ (índice, vetores, logs, log de chamadas de ferramentas)
```

Repita em cada projeto em que o Hesman foi usado, ou apague o diretório `.hesman/` do projeto manualmente. Se você definiu `HESMAN_DATA_DIR` ou `--data-dir`, os dados estão nesse diretório.

**3. Apague o cache de gramáticas**

Gramáticas baixadas sob demanda ficam guardadas por usuário, fora de qualquer projeto. Apague o diretório `hesman` no primeiro local que se aplicar:

| Configuração / plataforma | Diretório a apagar |
|---|---|
| `HESMAN_CACHE_DIR` está definida | `$HESMAN_CACHE_DIR/hesman` |
| `XDG_CACHE_HOME` está definida | `$XDG_CACHE_HOME/hesman` |
| macOS | `~/Library/Caches/hesman` |
| Windows | `%LOCALAPPDATA%\hesman` |
| Linux e outros | `~/.cache/hesman` |

`hesman grammars list` mostra o diretório exato do cache. Se nenhuma gramática sob demanda foi baixada, o diretório não existe.

**4. Remova o programa**

```bash
# instalado a partir do código-fonte
npm unlink -g hesman-mcp   # somente se você executou `npm link`
rm -r /path/to/hesman-mcp  # o repositório clonado

# instalado via npm (depois que o pacote for publicado)
npm uninstall -g hesman-mcp
```

O modelo de embedding fica guardado dentro do `node_modules` do próprio pacote, então desaparece junto com o programa. Nada mais é gravado fora dos lugares acima: nenhum serviço em segundo plano, nenhuma configuração de todo o sistema.

---

## Referência das ferramentas

O Hesman expõe **11 ferramentas** via transporte MCP stdio. Toda resposta de ferramenta, exceto a de `index_status`, inclui um bloco `_meta` com sua economia de tokens (`impact_analysis` também retorna seu próprio `_summary` dos arquivos afetados).

### Navegação de código

| Ferramenta | O que faz | Principais entradas |
|---|---|---|
| `find_symbol` | Encontra símbolos pelo nome com correspondência exata, aproximada (fuzzy) ou por prefixo | `name`, `kind`, `matchMode`, `topK` |
| `get_file_structure` | Retorna a árvore hierárquica de todos os símbolos de um arquivo | `filePath`, `includeNested` |
| `get_references` | Encontra todos os usos de um símbolo na base de código | `symbolId`, `referenceKind`, `topK`, `cursor` |
| `get_context` | Retorna código compactado ao redor de um local específico | `filePath`, `startLine`, `contextLines`, `mode` |

### Grafo de chamadas

| Ferramenta | O que faz | Principais entradas |
|---|---|---|
| `get_callers` | Encontra todas as funções que chamam um determinado símbolo (até 3 níveis de profundidade) | `symbolId`, `maxDepth`, `topK` |
| `get_callees` | Encontra todas as funções chamadas por um determinado símbolo (até 3 níveis de profundidade) | `symbolId`, `maxDepth`, `topK` |

### Análise

| Ferramenta | O que faz | Principais entradas |
|---|---|---|
| `impact_analysis` | Classifica o que quebra se um símbolo mudar (renomeação/exclusão/alteração de assinatura) | `symbolId`, `changeType` |
| `list_dependencies` | Mostra o que um arquivo importa, ou o que importa dele | `filePath`, `direction` |
| `semantic_search` | Busca código a partir de uma descrição em linguagem natural | `query`, `topK`, `language`, `kind` |
| `find_pattern` | Busca por padrão estrutural com capturas nomeadas (`$NAME`, `$$$ARGS`) | `pattern`, `language`, `topK` |

### Status

| Ferramenta | O que faz |
|---|---|
| `index_status` | Informa a saúde da indexação: número de arquivos, número de símbolos, status dos armazenamentos, arquivos pendentes, progresso da indexação inicial em segundo plano |

Para os esquemas completos de entrada e saída com exemplos, veja **[docs/TOOLS.md](../TOOLS.md)**.

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
  "dataDir": ".hesman",
  "grammars": { "offline": false }
}
```

> **Links simbólicos são ignorados durante a indexação.** O scanner do projeto e o monitor de arquivos nunca seguem links simbólicos (para arquivos ou diretórios). Isso evita loops infinitos (por exemplo, `loop -> .`), mantém fora do índice o código externo ao projeto e evita símbolos duplicados. Para indexar código vinculado, aponte `projectRoot` para o diretório real.

### Precedência de configuração

As configurações são resolvidas nesta ordem (a posterior prevalece sobre a anterior):

1. **Padrões** — embutidos no Hesman
2. **`hesman.config.json`** — arquivo de configuração no nível do projeto
3. **Variáveis de ambiente** — por exemplo, `HESMAN_WORKERS=4`
4. **Flags da CLI** — por exemplo, `--workers 4`

### Variáveis de ambiente

| Variável | Equivalente | Descrição |
|---|---|---|
| `HESMAN_PROJECT_ROOT` | `--project-root` | Caminho do projeto a ser indexado |
| `HESMAN_WORKERS` | `--workers N` | Número de threads worker (0 = detecção automática) |
| `HESMAN_LOG_LEVEL` | `--log-level` | Um de: trace, debug, info, warn, error |
| `HESMAN_DATA_DIR` | `--data-dir` | Diretório dos dados do índice (padrão: `.hesman`) |
| `HESMAN_WATCH_MODE` | `--watch-mode` | Ativar/desativar o monitoramento de arquivos (true/false) |
| `HESMAN_GRAMMARS_OFFLINE` | — | `1` ou `true`: nunca baixar uma gramática (chave de configuração `grammars.offline`) |
| `HESMAN_CACHE_DIR` | — | Diretório que contém o cache de gramáticas por usuário (`<dir>/hesman/grammars/`) |

### Flags da CLI

| Flag | Descrição |
|---|---|
| `--project-root <path>` | Projeto a ser indexado (padrão: detectado, veja [Como o Hesman escolhe o projeto](#como-o-hesman-escolhe-o-projeto)) |
| `--workers <N>` | Número de threads worker (0 = automático) |
| `--log-level <level>` | Nível de log |
| `--data-dir <path>` | Caminho do diretório de dados |
| `--watch-mode` | Ativar o monitoramento de arquivos |
| `--no-watch` | Desativar o monitoramento de arquivos |
| `--no-semantic` | Desativar a busca semântica |
| `--batch-size <N>` | Arquivos por lote de indexação |

---

## Referência da CLI

```
hesman                         Run the MCP server over stdio (default)
hesman index [path]            Index a project without starting the server
hesman status [path]           Show indexing progress and statistics
hesman clean [path]            Delete the .hesman/ data directory
hesman clean --force           Skip confirmation prompt
hesman clean --dry-run         Preview what would be deleted without removing
hesman diag [path]             Print diagnostics: memory, store stats, pool, cache
hesman diag --json             Output diagnostics as JSON
hesman setup                   Add Hesman to your AI clients (--client, --all, --yes, --dry-run, --scope, --project-root, --command, --rules)
hesman remove                  Remove Hesman from the clients again (--client, --all, --scope, --dry-run)
hesman doctor                  Check the installation and each client's entry (--client, --json, --timeout)
hesman ui [path]               Open the local dashboard: logs, metrics, index graph, playground (--port, --no-open)
hesman grammars list           Bundled, cached and on-demand grammars with sizes (--json)
hesman grammars install <lang…> Download grammars into the cache (--all, or --from <directory> without network)
hesman install --agent <name>  Deprecated alias of: hesman setup --client <name> --yes
hesman --version, -v           Print version number
hesman --help, -h              Show help text
```

---

## Linguagens suportadas

| Linguagem | Extensões | Nível | Gramática | O que funciona |
|---|---|---|---|---|
| TypeScript | `.ts`, `.mts`, `.cts` | deep | embutida | Símbolos, grafo de chamadas, análise de impacto |
| TSX | `.tsx` | deep | embutida | Símbolos, grafo de chamadas, análise de impacto |
| JavaScript (e JSX) | `.js`, `.jsx`, `.mjs`, `.cjs` | deep | embutida | Símbolos, grafo de chamadas, análise de impacto |
| Python | `.py`, `.pyw`, `.pyi` | deep | embutida | Símbolos, grafo de chamadas, análise de impacto |
| Go | `.go` | deep | embutida | Símbolos, grafo de chamadas, análise de impacto |
| Java | `.java` | deep | embutida | Símbolos, grafo de chamadas, análise de impacto |
| C | `.c`, `.h` | deep | embutida | Símbolos, grafo de chamadas, análise de impacto |
| C++ | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx`, `.ipp`, `.tpp` | deep | embutida | Símbolos, grafo de chamadas, análise de impacto |
| C# | `.cs`, `.csx` | deep | embutida | Símbolos, grafo de chamadas, análise de impacto |
| Rust | `.rs` | deep | embutida | Símbolos, grafo de chamadas, análise de impacto |
| PHP | `.php`, `.phtml` | deep | embutida | Símbolos, grafo de chamadas, análise de impacto |
| Ruby | `.rb`, `.rake`, `.gemspec`, `.ru`, `.podspec` | deep | embutida | Símbolos, grafo de chamadas, análise de impacto |
| Kotlin | `.kt`, `.kts` | deep | embutida | Símbolos, grafo de chamadas, análise de impacto |
| Swift | `.swift` | deep | embutida | Símbolos, grafo de chamadas, análise de impacto |
| Bash | `.sh`, `.bash` | deep | embutida | Símbolos, grafo de chamadas, análise de impacto |
| Lua | `.lua` | deep | embutida | Símbolos, grafo de chamadas, análise de impacto |
| Scala | `.scala`, `.sc`, `.sbt` | structural | sob demanda | Apenas símbolos (sem grafo de chamadas) |
| OCaml | `.ml` | structural | sob demanda | Apenas símbolos (sem grafo de chamadas) |
| F# | `.fs`, `.fsx` | structural | sob demanda | Apenas símbolos (sem grafo de chamadas) |
| R | `.r` | structural | sob demanda | Apenas símbolos (sem grafo de chamadas) |
| CodeQL | `.ql`, `.qll` | structural | sob demanda | Apenas símbolos (sem grafo de chamadas) |
| Arduino | `.ino` | structural | sob demanda | Apenas símbolos (sem grafo de chamadas) |
| Elixir | `.ex`, `.exs` | structural | sob demanda | Apenas símbolos (sem grafo de chamadas) |
| Todo o resto | qualquer arquivo de texto | text | nenhuma | Trechos de texto para `semantic_search`, `find_pattern` e `get_context` (sem símbolos) |

A tabela acima é gerada a partir do registro de linguagens (`npx tsx scripts/generate-language-matrix.ts`; um teste falha quando ela está desatualizada). As gramáticas marcadas como *embutida* vêm dentro do pacote e, portanto, funcionam offline.

**Gramáticas sob demanda.** As gramáticas marcadas como *sob demanda* não estão no pacote. Na primeira vez que um projeto contém arquivos de uma dessas linguagens, esses arquivos são indexados imediatamente como texto e o servidor baixa a gramática em segundo plano (0,3–11,4 MB por gramática, da página de releases do repositório da própria gramática no GitHub); quando ela chega, os arquivos são reindexados com símbolos. Cada gramática é fixada por URL, tamanho e sha256 no `grammars.json` distribuído; um download que não confere é descartado e os arquivos continuam como texto. As gramáticas ficam em cache por usuário, fora do projeto: `HESMAN_CACHE_DIR`, senão `XDG_CACHE_HOME`, senão `~/Library/Caches` (macOS), `%LOCALAPPDATA%` (Windows) ou `~/.cache`, em `hesman/grammars/`.

- **Desativar os downloads:** defina `HESMAN_GRAMMARS_OFFLINE=1`, ou `"grammars": { "offline": true }` em `hesman.config.json`. O Hesman então não faz nenhuma requisição de rede para gramáticas; os arquivos de linguagens sob demanda permanecem no nível text, a menos que a gramática já esteja em cache.
- **Preencher o cache antecipadamente:** `hesman grammars install scala r` ou `hesman grammars install --all` (46,9 MB); em uma máquina sem acesso à rede, copie os arquivos `.wasm` para lá e execute `hesman grammars install --from <directory>`. `hesman grammars list` mostra o que está embutido, em cache e disponível. Veja [docs/CLI.md](../CLI.md#hesman-grammars).
- **Ver o que está faltando:** `index_status` lista, por linguagem, seu nível (`deep`, `structural` ou `text`), o número de arquivos e se sua gramática está embutida, em cache ou ausente, e por quê.

O `grammars.json` também fixa 17 gramáticas que ainda não têm consulta de símbolos (Haskell, Zig, Julia, Perl, Objective-C, Odin, Luau, Starlark, HTML, CSS, JSON, YAML, TOML, XML, Markdown, HCL, Make). Elas podem ser instaladas com `hesman grammars install`, mas o Hesman ainda não as usa: os arquivos dessas linguagens são indexados como texto e a gramática delas nunca é baixada automaticamente.

O que os níveis significam hoje:

- **deep** — definições (funções, classes, métodos, constantes, ...) mais relações `calls`, de modo que `get_callers`, `get_callees`, `get_references` e `impact_analysis` têm um grafo de chamadas. As chamadas são lidas da árvore sintática de cada linguagem (suas expressões de chamada, `new X(...)`, chamadas de Ruby e Bash sem parênteses) e são vinculadas por nome: primeiro o próprio arquivo do caller, depois os arquivos que ele importa, seu diretório e o projeto; um nome que continua ambíguo fica sem vínculo, em vez de ser vinculado a todos os candidatos. Uma chamada é vinculada a uma definição, e não a uma declaração sem corpo (um protótipo C/C++, um método de interface ou abstrato), e `new X(...)` à classe `X`, e não a um de seus construtores. Os tipos não são resolvidos; por isso um método chamado em uma interface com várias implementações fica sem vínculo, e um método Ruby chamado sem argumentos nem parênteses não é visto como chamada. Existem relações de importação para TypeScript/JavaScript, Python, Go, C/C++ (`#include "..."`) e Ruby (`require`, `require_relative`); relações `extends` / `implements` apenas onde uma linguagem escreve `class X extends Y` ou `class X implements Y`.
- **structural** — apenas definições. Nenhuma linguagem embutida está mais neste nível. As linguagens sob demanda são structural porque apenas a consulta de símbolos upstream delas é usada: não há regra de visibilidade para elas (toda definição conta como exportada) nem extração de chamadas.
- **text** — sem símbolos; veja "Text tier" em [docs/TOOLS.md](../TOOLS.md).

Um agente não precisa conhecer esta tabela: quando `get_callers`, `get_callees`, `get_references` ou `impact_analysis` é consultado sobre um símbolo de uma linguagem sem grafo de chamadas, a resposta traz uma `note` como `call graph not available for r (symbols only)` ao lado da lista vazia, para que uma resposta vazia não seja confundida com "nada usa isto".

Os tipos de símbolo seguem a consulta de tags própria de cada gramática, então alguns são mais grosseiros do que a linguagem: métodos de PHP e Kotlin são `function`, enums de Rust e Swift e interfaces de Kotlin são `class`, aliases de tipo de Rust são `class`. Adicionar uma linguagem requer uma gramática, uma consulta de tags, um pequeno perfil e uma entrada no registro de linguagens (`src/parsers/languages.ts`) — veja o [Guia de Contribuição](../CONTRIBUTING.md) para instruções passo a passo.

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
                         │   │      Token Reduction Pipeline    │  │
                         │   │  ┌────────────────────────────┐  │  │
                         │   │  │ 1. Compact Mode            │  │  │
                         │   │  │    Strip comments/blanks    │  │  │
                         │   │  │ 2. Context Pruning         │  │  │
                         │   │  │    A line range, not a file │  │  │
                         │   │  │ 3. Compact Lists           │  │  │
                         │   │  │    Columns, grouped by file │  │  │
                         │   │  └────────────────────────────┘  │  │
                         │   └───────────────────────────────────┘  │
                         │                                          │
                         │   ┌──────────┐ ┌──────────┐ ┌─────────┐ │
                         │   │  SQLite  │ │   ZVec   │ │ Worker  │ │
                         │   │  Store   │ │  Vector  │ │  Pool   │ │
                         │   │ (symbols)│ │ (search) │ │ (index) │ │
                         │   └────┬─────┘ └────┬─────┘ └────┬────┘ │
                         │        │            │            │       │
                         │   ┌────┴────────────┴────────────┴────┐  │
                         │   │     File Watcher (chokidar)       │  │
                         │   └───────────────────────────────────┘  │
                         └──────────────────────────────────────────┘
```

**Pipeline de dados principal:** alterações em arquivos (chokidar) → parsing com Tree-sitter (AST + símbolos) → índice SQLite + embeddings ZVec → respostas MCP compactas

**Principais decisões de design:**
- **Sem dependência de LSP** — o Tree-sitter fornece parsing independente de linguagem sem executar servidores de linguagem
- **Indexação incremental por hash de conteúdo** — os arquivos só são reanalisados quando o SHA-256 muda
- **Compressão no nível da resposta** — os dados originais permanecem intactos; a compressão é aplicada na fronteira da resposta
- **Um único banco de dados SQLite por projeto** — mesmo em monorepos, todos os pacotes compartilham um armazenamento, com isolamento por `file_path`

Para o documento completo de arquitetura, incluindo dependências entre módulos, esquemas dos armazenamentos e design do pool de workers, veja **[docs/ARCHITECTURE.md](../ARCHITECTURE.md)**.

---

## Ambiente de desenvolvimento

### Pré-requisitos

- **Node.js** ≥ 20.0.0
- **npm** ≥ 10

### Primeiros passos

```bash
# Clonar e instalar
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install

# Baixar os parsers WASM do Tree-sitter
npm run download:parsers

# Executar em modo de desenvolvimento (hot reload)
npm run dev

# Compilar para produção
npm run build
```

### Qualidade de código

```bash
npm run typecheck    # Verificação de tipos do TypeScript
npm run lint         # ESLint
npm run format       # Formatação com Prettier
```

### Executando os testes

```bash
npm test                  # Executar todos os testes (unitários + integração)
npm run test:watch        # Modo watch para desenvolvimento
npm run test:e2e          # Testes de ponta a ponta (inicia o servidor completo)
npm run test:perf         # Benchmarks de desempenho
```

### Limites de desempenho

`npm run test:perf` falha quando um benchmark está pior do que o seu limite (`tests/perf/thresholds.ts`). São limites verificados na máquina macOS do mantenedor, com os fixtures do repositório, e não garantias para todos os projetos; `semantic_search` é medido sem o embedding da consulta.

| Benchmark | Limite |
|---|---|
| `find_symbol` (exata) | < 1 ms |
| `find_symbol` (aproximada) | < 5 ms |
| `semantic_search` | < 10 ms |
| `get_references` | < 5 ms |

### Medido neste repositório

`node scripts/measure.mjs` inicia o servidor compilado via stdio, deixa que ele indexe uma exportação limpa deste repositório (502 arquivos: 350 com símbolos, 152 como texto; 7.700 símbolos, 27.372 relações) e chama cada ferramenta 100 vezes via MCP. Medido em 2026-10-13 em um Apple M3 Pro (11 núcleos, 18 GB), macOS, Node 24. Seus números dependem da máquina e do projeto; execute o script para obtê-los.

| Inicialização, indexação e memória | Busca semântica ativada | `--no-semantic` |
|---|---:|---:|
| Handshake MCP respondido após | 0,4 s | 0,2 s |
| Índice pronto após | 70,2 s | 2,4 s |
| Índice em disco | 46,2 MB | 22,1 MB |
| Memória no handshake | 286 MB | 195 MB |
| Memória logo após a indexação | 673 MB | 426 MB |
| Memória em repouso (35 s após a última chamada) | 545 MB | 303 MB |

O servidor responde às ferramentas enquanto indexa; com a busca semântica ativada, quase todos os 70 segundos são gastos calculando 5.760 embeddings na CPU. A memória é a pegada física do processo, o número que o Monitor de Atividade mostra. Threads de análise sintática só são iniciadas durante a indexação (no máximo quatro por padrão) e liberadas após 30 segundos ociosas.

| Ferramenta | Chamada | Mediana | Tokens brutos | Tokens retornados | Redução |
|---|---|---:|---:|---:|---:|
| `get_context` | uma função, ±5 linhas | 0,39 ms | 4.782 | 190 | 96,0% |
| `get_context` | uma função, ±40 linhas | 0,46 ms | 4.782 | 970 | 79,7% |
| `get_references` | referências a `indexProject` | 0,29 ms | 3.026 | 854 | 71,8% |
| `get_callers` | callers de `indexProject` | 0,24 ms | 1.244 | 373 | 70,0% |
| `get_callees` | callees de `indexProject` | 0,15 ms | 387 | 132 | 65,9% |
| `find_symbol` | prefixo `index`, 20 resultados | 0,38 ms | 2.326 | 1.369 | 41,1% |
| `impact_analysis` | exclusão de `indexProject` | 0,39 ms | 3.498 | 2.116 | 39,5% |
| `get_file_structure` | um arquivo-fonte | 0,34 ms | 3.474 | 2.270 | 34,7% |
| `list_dependencies` | importações de um arquivo | 0,11 ms | 572 | 374 | 34,6% |
| `find_symbol` | nome exato, 1 resultado | 0,14 ms | 214 | 197 | 7,9% |
| `find_pattern` | `console.$M($$$A)` em TypeScript | 38,4 ms | 2.112 | 2.112 | 0,0% |
| `semantic_search` | uma consulta em linguagem natural | 2,75 ms | 3.880 | 3.880 | 0,0% |

"Tokens brutos" é o payload como objetos JSON simples com caminhos absolutos (para `get_context`, o arquivo inteiro); os tokens são estimados em quatro caracteres cada. A latência é o que o cliente percebe em uma chamada, incluindo o enquadramento MCP. `semantic_search` inclui o embedding da consulta.

Para o guia completo de contribuição, incluindo como adicionar novas linguagens, veja **[docs/CONTRIBUTING.md](../CONTRIBUTING.md)**.

---

## Requisitos

| Recurso | Mínimo |
|---|---|
| **Node.js** | ≥ 20.0.0 |
| **Memória** | Cerca de 300 MB em repouso e 430 MB durante a indexação sem busca semântica; cerca de 550 MB em repouso e 670 MB durante a indexação com ela (medido em um projeto de 502 arquivos, veja [Medido neste repositório](#medido-neste-repositório)) |
| **Disco** | ~30 MB para o pacote (gramáticas embutidas), ~80 MB para o modelo de embedding (download único), até 47 MB para as gramáticas sob demanda se todas forem instaladas, mais o índice em `.hesman/` |
| **Rede** | Para a instalação, para o modelo de embedding no primeiro uso e para a gramática de uma linguagem sob demanda na primeira vez que um projeto a contém. Fora isso, nenhuma; nenhum código ou consulta jamais é enviado a lugar algum |

O modelo de embedding (`all-MiniLM-L6-v2`) é baixado no primeiro uso e mantido em cache indefinidamente no diretório de cache do Transformers.js.

---

## Documentação

| Documento | Conteúdo |
|---|---|
| [README.md](../../README.md) | Visão geral do projeto, instalação e configuração (este arquivo) |
| [docs/ARCHITECTURE.md](../ARCHITECTURE.md) | Arquitetura completa: fluxo de dados, mapa de módulos, esquemas dos armazenamentos, design do pool de workers |
| [docs/CLI.md](../CLI.md) | Todos os subcomandos: `setup`, `remove`, `doctor`, `ui`, `grammars`, com opções e saída |
| [docs/TOOLS.md](../TOOLS.md) | Esquemas completos de entrada e saída de todas as 11 ferramentas, com exemplos |
| [docs/CONTRIBUTING.md](../CONTRIBUTING.md) | Ambiente de desenvolvimento, guia de testes, criação de perfis de linguagem, checklist de PR |
| [docs/SECURITY.md](../SECURITY.md) | Modelo de ameaças, proteções sobre a entrada das ferramentas, como relatar uma vulnerabilidade |
| [CHANGELOG.md](../../CHANGELOG.md) | Histórico de versões e alterações |

---

## Licença

[MIT](../../LICENSE) — Copyright (c) 2026 Minh Do

A licença MIT cobre o código escrito para o Hesman. Software de terceiros mantém sua própria licença:

- **Dentro do pacote:** as gramáticas Tree-sitter e os arquivos de consulta, todos MIT, exceto a consulta de Elixir (Apache-2.0, a licença da sua gramática); cada um está listado com seu repositório, revisão e copyright em [NOTICE](../../NOTICE).
- **Instalados pelo npm como dependências:** todos sob licenças permissivas (MIT, ISC, BSD, Apache-2.0); a lista completa está em [THIRD-PARTY-LICENSES.md](../../THIRD-PARTY-LICENSES.md). A biblioteca de embedding `@xenova/transformers` e o armazenamento vetorial `@zvec/zvec` são Apache-2.0.
- **Baixados em tempo de execução:** o modelo de embedding `Xenova/all-MiniLM-L6-v2` (Apache-2.0) e as gramáticas sob demanda (MIT, exceto Elixir e HCL: Apache-2.0); veja [NOTICE](../../NOTICE). A dependência `sharp` da biblioteca de embedding instala uma libvips pré-compilada (LGPL-3.0-or-later) como uma biblioteca compartilhada separada.
