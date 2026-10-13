# Hesman MCP Server

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

🌐 **Leer en:** [English](../../README.md) | [Tiếng Việt](./README.vi.md) | [Русский](./README.ru.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | [中文](./README.zh.md) | [日本語](./README.ja.md) | [العربية](./README.ar.md) | **Español** | [Português](./README.pt.md)

**Hesman** es un servidor MCP (Model Context Protocol) de última generación que da a los agentes de programación con IA un conocimiento profundo de tu base de código — símbolos, grafos de llamadas, dependencias y búsqueda semántica — con lecturas de código acotadas que reducen el consumo de tokens (`get_context` devuelve alrededor de un 90 % menos de tokens que el archivo completo cuando pides el entorno de una sola función). Todo se ejecuta en local. Sin APIs externas. Sin servidores LSP.

---

## Tabla de contenidos

- [¿Por qué Hesman?](#por-qué-hesman)
- [Inicio rápido](#inicio-rápido)
- [Funcionalidades](#funcionalidades)
- [Cómo funciona la reducción de tokens](#cómo-funciona-la-reducción-de-tokens)
- [Instalación y configuración](#instalación-y-configuración)
- [Referencia de herramientas](#referencia-de-herramientas)
- [Configuración](#configuración)
- [Referencia de la CLI](#referencia-de-la-cli)
- [Lenguajes soportados](#lenguajes-soportados)
- [Arquitectura](#arquitectura)
- [Entorno de desarrollo](#entorno-de-desarrollo)
- [Requisitos](#requisitos)
- [Documentación](#documentación)
- [Licencia](#licencia)

---

## ¿Por qué Hesman?

Los agentes de programación con IA son potentes pero caros. Cada línea de código que leen cuesta tokens. Enviar un archivo completo cuando el agente solo necesita una función desperdicia contexto y dinero.

Hesman lo resuelve así:

- **Entrega solo lo que el agente necesita** — una función concreta, sus llamantes, sus llamados o los símbolos afectados por un cambio.
- **Compacta y poda el código** — `get_context` elimina comentarios y líneas en blanco y devuelve solo las líneas alrededor de la ubicación de interés en lugar del archivo completo.
- **Nunca infla las respuestas** — una respuesta nunca es más grande que su payload sin procesar. Los resúmenes para listas de resultados largas están planificados pero todavía no se aplican (consulta [Pipeline de reducción de tokens](#pipeline-de-reducción-de-tokens)).
- **Se ejecuta en tu máquina** — sin claves de API, sin ningún servicio externo y, por tanto, sin la latencia de uno. Tu código nunca sale de tu máquina. Las únicas descargas son el modelo de embeddings en el primer uso y las gramáticas de los lenguajes bajo demanda; ambas se pueden desactivar (`--no-semantic`, `HESMAN_GRAMMARS_OFFLINE=1`).
- **Ahorro medible** — todas las respuestas de las herramientas, salvo la de `index_status`, incluyen `_meta.reduction`, que muestra exactamente cuántos tokens se ahorraron frente a la salida sin procesar.

El resultado: los agentes trabajan más rápido, cuestan menos y razonan con más precisión porque ven el código correcto, no todo el código.

---

## Inicio rápido

`hesman-mcp` todavía no está en el registro de npm, así que hoy Hesman se instala desde el código fuente:

```bash
# 1. Obtener y compilar Hesman (Node.js ≥ 20)
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install
npm run download:parsers
npm run build

# 2. Registrarlo en tus clientes de IA (detecta Claude Code, Cursor, VS Code, Codex, …)
node dist/index.js setup
```

Reinicia el cliente y abre un proyecto. `setup` escribe el comando de arranque que corresponde a la forma en que Hesman está instalado (aquí: rutas absolutas a `node` y a `dist/index.js`, de modo que nada tiene que estar en el PATH); consulta [Comando de arranque](#comando-de-arranque).

Cuando el paquete esté publicado, todo el inicio rápido se reducirá a una línea:

```bash
npx -y hesman-mcp setup   # solo cuando hesman-mcp esté publicado en npm
```

El servidor responde a tu agente de inmediato e indexa en segundo plano (unos segundos en la mayoría de los proyectos): las 11 herramientas funcionan desde el primer momento, marcan sus resultados con `_meta.indexing` mientras el índice está incompleto, e `index_status` informa del progreso.

---

## Funcionalidades

### Inteligencia de código

| Capacidad | Descripción |
|---|---|
| **Búsqueda de símbolos** | Encuentra funciones, clases y métodos por nombre — coincidencia exacta, aproximada o por prefijo (< 1 ms) |
| **Recorrido del grafo de llamadas** | Recorre llamantes y llamados hasta 3 niveles de profundidad |
| **Seguimiento de referencias** | Encuentra cada uso de un símbolo en toda la base de código |
| **Análisis de impacto** | Averigua qué se rompe si renombras o eliminas un símbolo, o si cambias su firma |
| **Búsqueda semántica** | Describe lo que buscas en lenguaje natural y encuentra el código que coincide |
| **Búsqueda estructural** | Encuentra patrones de código como `console.$METHOD($$$ARGS)` con capturas con nombre |
| **Análisis de dependencias** | Averigua qué importa un archivo y qué lo importa a él |
| **Ventanas de contexto** | Obtén código acotado y compactado alrededor de cualquier ubicación de un archivo |

### Pipeline de reducción de tokens

Hesman diseña su pipeline de compresión en 3 capas; hoy el ahorro proviene del modo compacto y de la poda de contexto en `get_context`. Cada respuesta informa de su ahorro real en `_meta.reduction`, y una respuesta nunca es más grande que su payload sin procesar.

| Capa | Técnica | Ahorro medido | Estado |
|---|---|---|---|
| **Modo compacto** | Elimina comentarios, líneas en blanco y espacios al final de línea | ~14–16 % de un fragmento de código (`get_context`, `mode: "full"` frente a `"compact"`) | Aplicado en `get_context` |
| **Poda de contexto** | Extracción de un rango de líneas alrededor de la ubicación de interés + modo compacto | 89,9 % con las ±5 líneas por defecto, 29,9 % con ±40 líneas (archivo de 195 líneas); 0 % cuando se pide el archivo completo | Aplicado en `get_context` |
| **Resumen inteligente** | Bloques `_summary` agregados para listas de resultados largas | 0 % — un `_summary` solo añadía contenido a la respuesta, así que se descarta | Todavía no aplicado ([backlog](../../tasks/STATUS.md)) |

Las herramientas de listado y de grafo de llamadas (`get_references`, `get_callers`, `get_callees`, `list_dependencies`, `get_file_structure`) devuelven actualmente su payload sin procesar con `_meta.reduction: "0.0%"` y `_meta.compressed: false`. Medido sobre el directorio `src/` de este repositorio y sobre `tests/fixtures/polyglot-basic`. El campo `_meta.reduction` de cada respuesta informa del ahorro exacto para tu carga de trabajo.

### Listo para producción

- **Pool de workers** — indexación en paralelo entre los núcleos de la CPU, dimensionado automáticamente por defecto
- **Vigilancia de archivos** — reindexación incremental ante cambios en los archivos, mediante chokidar
- **Apagado ordenado** — termina el trabajo activo, vuelca los almacenes a disco y finaliza los workers limpiamente
- **Indexación por hash de contenido** — los archivos solo se vuelven a analizar cuando su contenido cambia de verdad
- **Soporte para monorepos** — detecta automáticamente workspaces de pnpm, lerna, nx, turbo y npm
- **Diagnósticos** — `hesman diag` muestra la memoria, las estadísticas de los almacenes, el estado del pool y las métricas de caché
- **Probado en local** — la suite de pruebas completa, incluidas las pruebas de extremo a extremo a través del servidor real, se ejecuta en macOS; Linux y Windows aún no están verificados

---

## Cómo funciona la reducción de tokens

### Capa 1: modo compacto

Elimina comentarios, líneas en blanco y espacios al final de línea, conservando los comentarios mágicos (`// @ts-ignore`, `// eslint-disable-*`).

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

Después:
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

### Capa 2: poda de contexto

`get_context` no devuelve el archivo completo. Devuelve el rango de líneas solicitado más `contextLines` líneas por encima y por debajo (5 por defecto, 200 como máximo), y después aplica el modo compacto a ese fragmento. `_meta.reduction` compara el resultado con el archivo completo, y `_meta.layers` enumera lo que se aplicó (`compact`, `prune`).

La poda es solo por rango de líneas: no sigue a los llamantes ni a los llamados. Para leer a qué llama una función o qué la llama, pide las ubicaciones a `get_callees` / `get_callers` y después `get_context` para cada una.

### Capa 3: resumen inteligente (todavía no aplicado)

El plan es sustituir las listas de resultados largas por un `_summary` agregado (recuentos por tipo y por archivo) más las primeras entradas. La implementación actual solo *añadía* un `_summary` junto a la lista completa, lo que hacía las respuestas más grandes, así que Hesman lo descarta y devuelve el payload sin procesar: las herramientas de listado y de grafo de llamadas informan hoy de `_meta.reduction: "0.0%"`. Conseguir que los resúmenes ahorren tokens de verdad está registrado en el backlog ([`tasks/STATUS.md`](../../tasks/STATUS.md)). Las listas largas ya se pueden obtener por páginas mediante `topK` y `cursor` (`get_references`).

### Medir el ahorro

Cada respuesta de Hesman incluye un bloque `_meta` con el ahorro real de tokens:

```json
{
  "_meta": {
    "originalTokens": 1764,
    "compressedTokens": 178,
    "reduction": "89.9%",
    "compressed": false,
    "layers": ["prune"]
  }
}
```

Este ejemplo es una llamada real a `get_context` (±5 líneas por defecto, modo compacto) sobre un archivo de 195 líneas: el fragmento ya viene compactado por la herramienta, por lo que solo aparece la capa `prune`, y `compressed: false` significa que el compresor de respuestas no tenía nada más que quitar. El campo `_meta.reduction` se mide respecto al número de tokens del archivo completo original, lo que te da el ahorro real de extremo a extremo. Las respuestas que no se reducirían se devuelven tal cual con `reduction: "0.0%"`; el valor nunca es negativo. Comprueba exactamente cuánto ahorra Hesman en tus cargas de trabajo reales consultando `_meta.reduction` en cualquier respuesta de una herramienta.

---

## Instalación y configuración

### Requisitos previos

- **Node.js** ≥ 20.0.0
- **npm** (o pnpm / yarn)

### Instalar desde el código fuente

Esta es la vía que funciona hoy.

```bash
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install
npm run download:parsers   # Descargar los parsers WASM de Tree-sitter
npm run build              # Compilar TypeScript
npm link                   # Opcional: dejar `hesman` disponible en el PATH
```

Sin `npm link`, usa `node /path/to/hesman-mcp/dist/index.js` allí donde este README dice `hesman`.

### Instalar desde npm (cuando el paquete esté publicado)

`hesman-mcp` todavía no está en el registro de npm. Cuando lo esté:

```bash
npx -y hesman-mcp setup     # sin instalar: los clientes arrancan Hesman a través de npx
npm install -g hesman-mcp   # o una instalación global que deja `hesman` en el PATH
```

### Registrar en los agentes de IA

```bash
hesman setup                         # lista de selección de los clientes encontrados en esta máquina
hesman setup --yes                   # sin preguntas: configura todos los clientes detectados
hesman setup --client cursor vscode  # configura clientes concretos
hesman setup --dry-run --all         # muestra el cambio exacto por cliente, no escribe nada
hesman remove                        # deshacer: vuelve a quitar Hesman de todos los clientes
```

| Cliente | `--client` | Qué cambia `hesman setup` (ámbito de usuario) | `--scope project` |
|---|---|---|---|
| Claude Code | `claude-code` | ejecuta `claude mcp add --scope user hesman -- <launch command>`; sin la CLI, edita `~/.claude.json` | `.mcp.json` |
| Claude Desktop | `claude-desktop` | `claude_desktop_config.json` | — |
| OpenAI Codex CLI | `codex` | ejecuta `codex mcp add hesman -- <launch command>`; sin la CLI, edita `~/.codex/config.toml` | `.codex/config.toml` |
| Cursor | `cursor` | `~/.cursor/mcp.json` | `.cursor/mcp.json` |
| Google Antigravity | `antigravity` | `~/.gemini/config/mcp_config.json` | `.agents/mcp_config.json` |
| VS Code (Copilot) | `vscode` | `mcp.json` en el directorio de usuario de VS Code | `.vscode/mcp.json` |
| Gemini CLI | `gemini-cli` | `~/.gemini/settings.json` | `.gemini/settings.json` |
| Windsurf | `windsurf` | `~/.config/devin/mcp_config.json` | — |

- Solo se toca la entrada `hesman`. Un archivo modificado se copia primero a `<file>.hesman.bak`, y `hesman remove` lo restaura byte a byte si nada más cambió entretanto.
- La entrada no contiene ninguna ruta de proyecto: Hesman encuentra el proyecto por sí mismo (ver más abajo). Dos excepciones: **Claude Desktop** no tiene workspace, así que su entrada fija un proyecto (el directorio actual, o `--project-root <path>`), y **Cursor** recibe `--project-root ${workspaceFolder}` solo en el ámbito de proyecto (en el `~/.cursor/mcp.json` global esa variable puede ser tu directorio personal, así que la entrada global no nombra ningún proyecto).
- Para **Antigravity** y **Windsurf** no está documentado cómo se le pasa el proyecto al servidor; `hesman setup` muestra una nota pidiéndote que lo compruebes tras el primer arranque.
- Los archivos de configuración con comentarios (JSONC) no se editan: `hesman setup` informa de ellos y los deja intactos.
- `hesman install --agent <name>` sigue funcionando como alias obsoleto de `hesman setup --client <name> --yes`.

Tras la configuración, reinicia el cliente y Hesman estará disponible como servidor MCP.

### Reglas de uso para agentes (opt-in)

Un servidor MCP instalado no es automáticamente un servidor utilizado: los agentes a menudo siguen recurriendo a grep y a la lectura de archivos completos. `hesman setup --rules` escribe además un bloque breve (14 líneas) en el archivo de instrucciones que cada cliente seleccionado lee en el **proyecto actual**, indicando qué herramienta de Hesman responde a qué pregunta. Todavía no se ha medido si cambia la frecuencia con la que un agente llama a las herramientas.

```bash
hesman setup --client claude-code codex --rules   # ejecutar dentro del proyecto
hesman setup --all --rules --dry-run              # muestra el bloque y los archivos, no escribe nada
hesman remove                                     # también vuelve a eliminar el bloque
```

| Cliente | Archivo de instrucciones (relativo al proyecto) |
|---|---|
| Claude Code | `CLAUDE.md` |
| OpenAI Codex CLI, Windsurf | `AGENTS.md` |
| Gemini CLI, Google Antigravity | `GEMINI.md` |
| Cursor | `.cursor/rules/hesman.mdc` (su propio archivo de reglas, `alwaysApply: true`) |
| VS Code (Copilot) | `.github/copilot-instructions.md` |
| Claude Desktop | ninguno: no lee ningún archivo de proyecto, así que se omite con una nota |

- **Opt-in.** No se escribe nada sin `--rules`. En una terminal, sin `--yes`, setup pregunta una vez y la respuesta por defecto es No.
- El bloque se sitúa entre `<!-- hesman:rules:start -->` y `<!-- hesman:rules:end -->`. Volver a ejecutar setup lo reemplaza en su sitio; el texto fuera de los marcadores nunca se modifica, y un archivo compartido por dos clientes recibe el bloque una sola vez.
- `hesman remove` elimina exactamente el bloque y devuelve el archivo byte a byte; un archivo que creó Hesman y que no contiene nada más se elimina. Ejecútalo en el mismo proyecto (o pasa `--project-root <path>`, que `setup --rules` también acepta).
- Estos archivos suelen estar versionados en git y compartirse con un equipo. Setup enumera los archivos que ha modificado para que puedas revisarlos (`git diff`) y decidir si los confirmas.

### Comando de arranque

`hesman setup --command auto|npx|global|absolute` decide qué ejecutan los clientes. Setup nunca usa la red.

| `--command` | Entrada escrita | Requiere |
|---|---|---|
| `npx` | `npx -y hesman-mcp@<major>` | el paquete en npm (todavía no publicado) y `npx` en el PATH del cliente; sobrevive a las actualizaciones de Node |
| `global` | `hesman` | una instalación global (o `npm link`) en el PATH del cliente |
| `absolute` | `/path/to/node /path/to/hesman-mcp/dist/index.js` | nada en el PATH; vuelve a ejecutar `hesman setup` después de cambiar de versión de Node o de mover Hesman |

`auto` (el valor por defecto) se fija en cómo se arrancó el Hesman en ejecución:

1. arrancado a través de `npx` (se ejecuta desde un directorio de caché `_npx`) → `npx`;
2. el `hesman` del PATH es esta misma instalación (con los enlaces simbólicos resueltos) → `global`;
3. cualquier otro caso (checkout del código fuente, `node_modules` local, fuera del PATH) → `absolute`.

Las aplicaciones de escritorio (Claude Desktop, Cursor, Antigravity, VS Code, Windsurf) abiertas desde el Dock o desde un lanzador no reciben el PATH de tu shell. En macOS y Linux, cuando `auto` elige `npx` o `hesman` y ese comando o `node` no está en un directorio estándar del sistema (`/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`, `/usr/local/bin`, además de `/opt/homebrew/bin` en macOS y `/snap/bin` en Linux) — lo habitual con nvm, fnm, volta o asdf — esos clientes reciben en su lugar la entrada `absolute`, con una nota para volver a ejecutar `hesman setup` después de cambiar de versión de Node. Los clientes de terminal (Claude Code, Codex CLI, Gemini CLI) heredan el shell y conservan el comando elegido. Un `--command npx|global` explícito se escribe tal como se pidió para todos los clientes, con una advertencia allí donde una aplicación de escritorio podría no encontrarlo.

### Configuración manual de MCP

Añade esto al archivo de configuración MCP de tu agente (VS Code usa `"servers"` en lugar de `"mcpServers"` y necesita `"type": "stdio"` en la entrada; Codex usa una tabla TOML `[mcp_servers.hesman]`):

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

`--project-root` es opcional; ver más abajo. `"command": "hesman"` necesita que `hesman` esté en el PATH que ve el cliente; si no, usa `"command": "/path/to/node"` con `"/path/to/hesman-mcp/dist/index.js"` como primer argumento (consulta [Comando de arranque](#comando-de-arranque)).

### Cómo elige Hesman el proyecto

Un proceso del servidor indexa un solo proyecto. Se elige en este orden:

1. **Raíz explícita** — `--project-root <path>`, `HESMAN_PROJECT_ROOT` o `projectRoot` en `hesman.config.json`. Siempre gana.
2. **Carpetas del workspace del cliente MCP** — cuando el cliente admite la capacidad `roots` de MCP, Hesman le pide sus carpetas tras el handshake e indexa la primera (las demás carpetas se registran en el log, no se indexan). Si más adelante el cliente informa de una carpeta distinta, Hesman cambia a ella.
3. **Directorio de trabajo** — el directorio más cercano, en el directorio de trabajo del servidor o por encima de él, que contenga un directorio de control de versiones (`.git`, `.hg`, `.svn`, `.jj`) o un manifiesto de proyecto (`package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`, …).
4. **Sin proyecto** — el servidor arranca igualmente y lista sus herramientas, pero cada herramienta devuelve un error `NO_PROJECT` que explica cómo establecer una raíz.

El directorio personal y sus directorios superiores nunca se eligen automáticamente (pasos 2 y 3), de modo que una entrada MCP global arrancada desde `~` no recorre tu disco. El índice se guarda en `.hesman/` dentro del proyecto elegido.

---

## Referencia de herramientas

Hesman expone **11 herramientas** a través del transporte stdio de MCP. Todas las respuestas de las herramientas, salvo la de `index_status`, incluyen un bloque `_meta` con su ahorro de tokens (`impact_analysis` devuelve además su propio `_summary` de los archivos afectados).

### Navegación por el código

| Herramienta | Qué hace | Entradas clave |
|---|---|---|
| `find_symbol` | Busca símbolos por nombre con coincidencia exacta, aproximada o por prefijo | `name`, `kind`, `matchMode`, `topK` |
| `get_file_structure` | Devuelve el árbol jerárquico de todos los símbolos de un archivo | `filePath`, `includeNested` |
| `get_references` | Encuentra todos los usos de un símbolo en la base de código | `symbolId`, `referenceKind`, `topK`, `cursor` |
| `get_context` | Devuelve código compactado alrededor de una ubicación concreta | `filePath`, `startLine`, `contextLines`, `mode` |

### Grafo de llamadas

| Herramienta | Qué hace | Entradas clave |
|---|---|---|
| `get_callers` | Encuentra todas las funciones que llaman a un símbolo dado (hasta 3 niveles de profundidad) | `symbolId`, `maxDepth`, `topK` |
| `get_callees` | Encuentra todas las funciones a las que llama un símbolo dado (hasta 3 niveles de profundidad) | `symbolId`, `maxDepth`, `topK` |

### Análisis

| Herramienta | Qué hace | Entradas clave |
|---|---|---|
| `impact_analysis` | Clasifica qué se rompe si un símbolo cambia (renombrado/eliminación/cambio de firma) | `symbolId`, `changeType` |
| `list_dependencies` | Muestra qué importa un archivo, o qué lo importa a él | `filePath`, `direction` |
| `semantic_search` | Busca código a partir de una descripción en lenguaje natural | `query`, `topK`, `language`, `kind` |
| `find_pattern` | Busca por patrón estructural con capturas con nombre (`$NAME`, `$$$ARGS`) | `pattern`, `language`, `topK` |

### Estado

| Herramienta | Qué hace |
|---|---|
| `index_status` | Informa de la salud de la indexación: número de archivos, número de símbolos, estado de los almacenes, archivos pendientes, progreso de la indexación inicial en segundo plano |

Para los esquemas completos de entrada y salida con ejemplos, consulta **[docs/TOOLS.md](../TOOLS.md)**.

---

## Configuración

Crea un `hesman.config.json` en la raíz de tu proyecto (todos los campos son opcionales):

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

> **Los enlaces simbólicos se omiten durante la indexación.** El escáner del proyecto y el vigilante de archivos nunca siguen enlaces simbólicos (a archivos o a directorios). Esto evita bucles infinitos (p. ej. `loop -> .`), mantiene fuera del índice el código ajeno al proyecto y evita símbolos duplicados. Para indexar código enlazado, apunta `projectRoot` al directorio real.

### Precedencia de la configuración

Los ajustes se resuelven en este orden (el posterior prevalece sobre el anterior):

1. **Valores por defecto** — integrados en Hesman
2. **`hesman.config.json`** — archivo de configuración a nivel de proyecto
3. **Variables de entorno** — p. ej., `HESMAN_WORKERS=4`
4. **Opciones de la CLI** — p. ej., `--workers 4`

### Variables de entorno

| Variable | Equivalente | Descripción |
|---|---|---|
| `HESMAN_PROJECT_ROOT` | `--project-root` | Ruta del proyecto que se va a indexar |
| `HESMAN_WORKERS` | `--workers N` | Número de hilos worker (0 = detección automática) |
| `HESMAN_LOG_LEVEL` | `--log-level` | Uno de: trace, debug, info, warn, error |
| `HESMAN_DATA_DIR` | `--data-dir` | Directorio de los datos del índice (por defecto: `.hesman`) |
| `HESMAN_WATCH_MODE` | `--watch-mode` | Activar/desactivar la vigilancia de archivos (true/false) |
| `HESMAN_GRAMMARS_OFFLINE` | — | `1` o `true`: no descargar nunca una gramática (clave de configuración `grammars.offline`) |
| `HESMAN_CACHE_DIR` | — | Directorio que contiene la caché de gramáticas por usuario (`<dir>/hesman/grammars/`) |

### Opciones de la CLI

| Opción | Descripción |
|---|---|
| `--project-root <path>` | Proyecto que se va a indexar (por defecto: detectado, consulta [Cómo elige Hesman el proyecto](#cómo-elige-hesman-el-proyecto)) |
| `--workers <N>` | Número de hilos worker (0 = automático) |
| `--log-level <level>` | Nivel de log |
| `--data-dir <path>` | Ruta del directorio de datos |
| `--watch-mode` | Activar la vigilancia de archivos |
| `--no-watch` | Desactivar la vigilancia de archivos |
| `--no-semantic` | Desactivar la búsqueda semántica |
| `--batch-size <N>` | Archivos por lote de indexación |

---

## Referencia de la CLI

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

## Lenguajes soportados

| Lenguaje | Extensiones | Nivel | Gramática | Qué funciona |
|---|---|---|---|---|
| TypeScript | `.ts`, `.mts`, `.cts` | deep | incluida | Símbolos, grafo de llamadas, análisis de impacto |
| TSX | `.tsx` | deep | incluida | Símbolos, grafo de llamadas, análisis de impacto |
| JavaScript (y JSX) | `.js`, `.jsx`, `.mjs`, `.cjs` | deep | incluida | Símbolos, grafo de llamadas, análisis de impacto |
| Python | `.py`, `.pyw`, `.pyi` | deep | incluida | Símbolos, grafo de llamadas, análisis de impacto |
| Go | `.go` | deep | incluida | Símbolos, grafo de llamadas, análisis de impacto |
| Java | `.java` | deep | incluida | Símbolos, grafo de llamadas, análisis de impacto |
| C | `.c`, `.h` | deep | incluida | Símbolos, grafo de llamadas, análisis de impacto |
| C++ | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx`, `.ipp`, `.tpp` | deep | incluida | Símbolos, grafo de llamadas, análisis de impacto |
| C# | `.cs`, `.csx` | deep | incluida | Símbolos, grafo de llamadas, análisis de impacto |
| Rust | `.rs` | deep | incluida | Símbolos, grafo de llamadas, análisis de impacto |
| PHP | `.php`, `.phtml` | deep | incluida | Símbolos, grafo de llamadas, análisis de impacto |
| Ruby | `.rb`, `.rake`, `.gemspec`, `.ru`, `.podspec` | deep | incluida | Símbolos, grafo de llamadas, análisis de impacto |
| Kotlin | `.kt`, `.kts` | deep | incluida | Símbolos, grafo de llamadas, análisis de impacto |
| Swift | `.swift` | deep | incluida | Símbolos, grafo de llamadas, análisis de impacto |
| Bash | `.sh`, `.bash` | deep | incluida | Símbolos, grafo de llamadas, análisis de impacto |
| Lua | `.lua` | deep | incluida | Símbolos, grafo de llamadas, análisis de impacto |
| Scala | `.scala`, `.sc`, `.sbt` | structural | bajo demanda | Solo símbolos (sin grafo de llamadas) |
| OCaml | `.ml` | structural | bajo demanda | Solo símbolos (sin grafo de llamadas) |
| F# | `.fs`, `.fsx` | structural | bajo demanda | Solo símbolos (sin grafo de llamadas) |
| R | `.r` | structural | bajo demanda | Solo símbolos (sin grafo de llamadas) |
| CodeQL | `.ql`, `.qll` | structural | bajo demanda | Solo símbolos (sin grafo de llamadas) |
| Arduino | `.ino` | structural | bajo demanda | Solo símbolos (sin grafo de llamadas) |
| Elixir | `.ex`, `.exs` | structural | bajo demanda | Solo símbolos (sin grafo de llamadas) |
| Todo lo demás | cualquier archivo de texto | text | ninguna | Fragmentos de texto para `semantic_search`, `find_pattern` y `get_context` (sin símbolos) |

La tabla anterior se genera a partir del registro de lenguajes (`npx tsx scripts/generate-language-matrix.ts`; un test falla cuando está desactualizada). Las gramáticas marcadas como *incluida* se distribuyen dentro del paquete, por lo que funcionan sin conexión.

**Gramáticas bajo demanda.** Las gramáticas marcadas como *bajo demanda* no están en el paquete. La primera vez que un proyecto contiene archivos de uno de esos lenguajes, esos archivos se indexan de inmediato como texto y el servidor descarga la gramática en segundo plano (0,3–11,4 MB por gramática, desde la página de releases del repositorio de la propia gramática en GitHub); cuando ha llegado, los archivos se vuelven a indexar con símbolos. Cada gramática está fijada por URL, tamaño y sha256 en el `grammars.json` distribuido; una descarga que no coincide se descarta y los archivos se quedan como texto. Las gramáticas se guardan en caché por usuario, fuera del proyecto: `HESMAN_CACHE_DIR`, si no `XDG_CACHE_HOME`, si no `~/Library/Caches` (macOS), `%LOCALAPPDATA%` (Windows) o `~/.cache`, bajo `hesman/grammars/`.

- **Desactivar las descargas:** define `HESMAN_GRAMMARS_OFFLINE=1`, o `"grammars": { "offline": true }` en `hesman.config.json`. Hesman no hace entonces ninguna petición de red para las gramáticas; los archivos de los lenguajes bajo demanda se quedan en el nivel text salvo que la gramática ya esté en caché.
- **Rellenar la caché de antemano:** `hesman grammars install scala r` o `hesman grammars install --all` (46,9 MB); en una máquina sin acceso a la red, copia allí los archivos `.wasm` y ejecuta `hesman grammars install --from <directory>`. `hesman grammars list` muestra qué está incluido, en caché y disponible. Consulta [docs/CLI.md](../CLI.md#hesman-grammars).
- **Ver qué falta:** `index_status` enumera, por lenguaje, su nivel (`deep`, `structural` o `text`), el número de archivos y si su gramática está incluida, en caché o ausente, y por qué.

`grammars.json` también fija 17 gramáticas que todavía no tienen consulta de símbolos (Haskell, Zig, Julia, Perl, Objective-C, Odin, Luau, Starlark, HTML, CSS, JSON, YAML, TOML, XML, Markdown, HCL, Make). Se pueden instalar con `hesman grammars install`, pero Hesman aún no las usa: los archivos de esos lenguajes se indexan como texto y su gramática nunca se descarga automáticamente.

Qué significan hoy los niveles:

- **deep** — definiciones (funciones, clases, métodos, constantes, ...) más relaciones `calls`, de modo que `get_callers`, `get_callees`, `get_references` e `impact_analysis` disponen de un grafo de llamadas. Las llamadas se leen del árbol sintáctico de cada lenguaje (sus expresiones de llamada, `new X(...)`, las llamadas de Ruby y Bash sin paréntesis) y se enlazan por nombre: primero el propio archivo del llamante, luego los archivos que importa, su directorio y el proyecto; un nombre que sigue siendo ambiguo se deja sin enlazar en lugar de enlazarlo con todos los candidatos. Una llamada se enlaza con una definición antes que con una declaración sin cuerpo (un prototipo de C/C++, un método de interfaz o abstracto), y `new X(...)` con la clase `X` antes que con uno de sus constructores. Los tipos no se resuelven, así que un método llamado sobre una interfaz con varias implementaciones queda sin enlazar, y un método de Ruby llamado sin argumentos ni paréntesis no se ve como una llamada. Existen relaciones de importación para TypeScript/JavaScript, Python, Go, C/C++ (`#include "..."`) y Ruby (`require`, `require_relative`); relaciones `extends` / `implements` solo donde un lenguaje escribe `class X extends Y` o `class X implements Y`.
- **structural** — solo definiciones. Ya no hay ningún lenguaje incluido en este nivel. Los lenguajes bajo demanda son structural porque solo se usa su consulta de símbolos upstream: para ellos no hay regla de visibilidad (toda definición cuenta como exportada) ni extracción de llamadas.
- **text** — sin símbolos; consulta «Text tier» en [docs/TOOLS.md](../TOOLS.md).

Un agente no tiene por qué conocer esta tabla: cuando se pregunta a `get_callers`, `get_callees`, `get_references` o `impact_analysis` por un símbolo de un lenguaje sin grafo de llamadas, la respuesta lleva una `note` como `call graph not available for r (symbols only)` junto a la lista vacía, para que una respuesta vacía no se confunda con «nada usa esto».

Los tipos de símbolo siguen la consulta de tags propia de cada gramática, por lo que algunos son más gruesos que el lenguaje: los métodos de PHP y Kotlin son `function`, los enums de Rust y Swift y las interfaces de Kotlin son `class`, los alias de tipo de Rust son `class`. Añadir un lenguaje requiere una gramática, una consulta de tags, un perfil pequeño y una entrada en el registro de lenguajes (`src/parsers/languages.ts`) — consulta la [guía de contribución](../CONTRIBUTING.md) para ver las instrucciones paso a paso.

---

## Arquitectura

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
                         │   │     3-Layer Compression Pipeline │  │
                         │   │  ┌────────────────────────────┐  │  │
                         │   │  │ 1. Compact Mode            │  │  │
                         │   │  │    Strip comments/blanks    │  │  │
                         │   │  │ 2. Context Pruning         │  │  │
                         │   │  │    Keep only relevant lines │  │  │
                         │   │  │ 3. Smart Summarization     │  │  │
                         │   │  │    planned, not applied     │  │  │
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

**Pipeline de datos principal:** cambios en archivos (chokidar) → análisis con Tree-sitter (AST + símbolos) → índice SQLite + embeddings ZVec → respuestas MCP comprimidas

**Decisiones de diseño clave:**
- **Sin dependencia de LSP** — Tree-sitter proporciona un análisis independiente del lenguaje sin ejecutar servidores de lenguaje
- **Indexación incremental por hash de contenido** — los archivos solo se vuelven a analizar cuando cambia su SHA-256
- **Compresión a nivel de respuesta** — los datos originales permanecen intactos; la compresión se aplica en la frontera de la respuesta
- **Una única base de datos SQLite por proyecto** — incluso en monorepos, todos los paquetes comparten un almacén con aislamiento por `file_path`

Para el documento de arquitectura completo, con las dependencias entre módulos, los esquemas de los almacenes y el diseño del pool de workers, consulta **[docs/ARCHITECTURE.md](../ARCHITECTURE.md)**.

---

## Entorno de desarrollo

### Requisitos previos

- **Node.js** ≥ 20.0.0
- **npm** ≥ 10

### Primeros pasos

```bash
# Clonar e instalar
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install

# Descargar los parsers WASM de Tree-sitter
npm run download:parsers

# Ejecutar en modo desarrollo (recarga en caliente)
npm run dev

# Compilar para producción
npm run build
```

### Calidad del código

```bash
npm run typecheck    # Comprobación de tipos de TypeScript
npm run lint         # ESLint
npm run format       # Formateo con Prettier
```

### Ejecutar las pruebas

```bash
npm test                  # Ejecutar todas las pruebas (unitarias + integración)
npm run test:watch        # Modo watch para desarrollo
npm run test:e2e          # Pruebas de extremo a extremo (arranca el servidor completo)
npm run test:perf         # Benchmarks de rendimiento
```

### Objetivos de rendimiento

| Benchmark | Objetivo |
|---|---|
| Rendimiento de indexación | ≥ 500 archivos/s |
| `find_symbol` (exacta) | < 1 ms |
| `find_symbol` (aproximada) | < 5 ms |
| `semantic_search` | < 10 ms |
| `get_references` | < 5 ms |
| Memoria (tras indexar) | < 350 MB |

Para la guía de contribución completa, que incluye cómo añadir nuevos lenguajes, consulta **[docs/CONTRIBUTING.md](../CONTRIBUTING.md)**.

---

## Requisitos

| Recurso | Mínimo |
|---|---|
| **Node.js** | ≥ 20.0.0 |
| **Memoria (en reposo)** | ~100 MB |
| **Memoria (bajo carga)** | ~350 MB |
| **Disco** | ~30 MB para el paquete (gramáticas incluidas), ~80 MB para el modelo de embeddings (descarga única), hasta 47 MB para las gramáticas bajo demanda si se instalan todas, más el índice en `.hesman/` |
| **Red** | Para la instalación, para el modelo de embeddings en el primer uso y para la gramática de un lenguaje bajo demanda la primera vez que un proyecto lo contiene. Para nada más; nunca se envía código ni ninguna consulta a ningún sitio |

El modelo de embeddings (`all-MiniLM-L6-v2`) se descarga en el primer uso y se guarda en caché indefinidamente en el directorio de caché de Transformers.js.

---

## Documentación

| Documento | Contenido |
|---|---|
| [README.md](../../README.md) | Visión general del proyecto, instalación y configuración (este archivo) |
| [docs/ARCHITECTURE.md](../ARCHITECTURE.md) | Arquitectura completa: flujo de datos, mapa de módulos, esquemas de los almacenes, diseño del pool de workers |
| [docs/CLI.md](../CLI.md) | Todos los subcomandos: `setup`, `remove`, `doctor`, `ui`, `grammars`, con sus opciones y su salida |
| [docs/TOOLS.md](../TOOLS.md) | Esquemas completos de entrada y salida de las 11 herramientas, con ejemplos |
| [docs/CONTRIBUTING.md](../CONTRIBUTING.md) | Entorno de desarrollo, guía de pruebas, creación de perfiles de lenguaje, checklist de PR |
| [docs/SECURITY.md](../SECURITY.md) | Modelo de amenazas, protecciones sobre la entrada de las herramientas, cómo informar de una vulnerabilidad |
| [CHANGELOG.md](../../CHANGELOG.md) | Historial de versiones y cambios |

---

## Licencia

[MIT](../../LICENSE) — Copyright (c) 2026 Minh Do

La licencia MIT cubre el código escrito para Hesman. El software de terceros conserva su propia licencia:

- **Dentro del paquete:** las gramáticas de Tree-sitter y los archivos de consultas, todos MIT salvo la consulta de Elixir (Apache-2.0, la licencia de su gramática); cada uno aparece con su repositorio, revisión y copyright en [NOTICE](../../NOTICE).
- **Instalado por npm como dependencias:** todo bajo licencias permisivas (MIT, ISC, BSD, Apache-2.0); la lista completa está en [THIRD-PARTY-LICENSES.md](../../THIRD-PARTY-LICENSES.md). La biblioteca de embeddings `@xenova/transformers` y el almacén vectorial `@zvec/zvec` son Apache-2.0.
- **Descargado en tiempo de ejecución:** el modelo de embeddings `Xenova/all-MiniLM-L6-v2` (Apache-2.0) y las gramáticas bajo demanda (MIT, salvo Elixir y HCL: Apache-2.0); consulta [NOTICE](../../NOTICE). La dependencia `sharp` de la biblioteca de embeddings instala una libvips precompilada (LGPL-3.0-or-later) como biblioteca compartida independiente.
