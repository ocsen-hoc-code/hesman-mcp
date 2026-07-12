# Hesman MCP Server

[![CI](https://github.com/do-minh/hesman-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/do-minh/hesman-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/hesman-mcp.svg)](https://www.npmjs.com/package/hesman-mcp)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

🌐 **Leer en:** [English](../../README.md) | [Tiếng Việt](./README.vi.md) | [Русский](./README.ru.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | [中文](./README.zh.md) | [日本語](./README.ja.md) | [العربية](./README.ar.md) | **Español** | [Português](./README.pt.md)

**Hesman** es un servidor MCP (Model Context Protocol) de última generación que brinda a los agentes de codificación de IA un conocimiento profundo de tu código fuente — símbolos, grafos de llamadas, dependencias y búsqueda semántica — con un pipeline de compresión de 3 capas que reduce drásticamente el consumo de tokens (hasta un 97% en los mejores escenarios). Todo se ejecuta localmente. Sin APIs externas. Sin servidores LSP.

---

## Tabla de Contenidos

- [Por que Hesman?](#por-que-hesman)
- [Inicio Rapido](#inicio-rapido)
- [Funcionalidades](#funcionalidades)
- [Como Funciona la Reduccion de Tokens](#como-funciona-la-reduccion-de-tokens)
- [Instalacion y Configuracion](#instalacion-y-configuracion)
- [Referencia de Herramientas](#referencia-de-herramientas)
- [Configuracion](#configuracion)
- [Referencia de CLI](#referencia-de-cli)
- [Lenguajes Soportados](#lenguajes-soportados)
- [Arquitectura](#arquitectura)
- [Configuracion de Desarrollo](#configuracion-de-desarrollo)
- [Requisitos](#requisitos)
- [Documentacion](#documentacion)
- [Licencia](#licencia)

---

## Por que Hesman?

Los agentes de codificacion de IA son potentes pero costosos. Cada linea de codigo que leen consume tokens. Enviar un archivo completo cuando el agente solo necesita una funcion desperdicia contexto y dinero.

Hesman resuelve esto al:

- **Entregar solo lo que el agente necesita** — una funcion especifica, sus llamantes, sus llamadas, o los simbolos impactados por un cambio.
- **Comprimir cada respuesta** — un pipeline de 3 capas elimina comentarios, poda codigo irrelevante y resume conjuntos de resultados grandes.
- **Reemplazar volcados brutos con resumenes** — en lugar de 200 referencias en un arreglo JSON, el agente recibe un bloque `_summary` con conteos agrupados por tipo y archivo.
- **Ejecutarse 100% localmente** — sin claves de API, sin llamadas de red, sin latencia de servicios externos. Tu codigo nunca sale de tu maquina.
- **Ahorros medibles** — cada respuesta incluye `_meta.reduction` mostrando exactamente cuantos tokens se ahorraron frente a la salida bruta.

El resultado: los agentes trabajan mas rapido, cuestan menos y razonan con mayor precision porque ven el codigo correcto, no todo el codigo.

---

## Inicio Rapido

```bash
# 1. Instalar globalmente
npm install -g hesman-mcp

# 2. Ejecutar el servidor dentro de tu proyecto
cd my-project
hesman

# 3. Registrar con tu agente de IA (Claude Desktop, Cursor, VS Code)
hesman install --agent claude
```

Eso es todo. Una vez que la indexacion inicial finaliza (unos segundos para la mayoria de los proyectos), tu agente de IA puede consultar tu codigo fuente a traves de las 11 herramientas de Hesman.

---

## Funcionalidades

### Inteligencia de Codigo

| Capacidad | Descripcion |
|---|---|
| **Busqueda de simbolos** | Encuentra funciones, clases y metodos por nombre — coincidencia exacta, difusa o por prefijo (< 1ms) |
| **Recorrido del grafo de llamadas** | Navega llamantes y llamados hasta 3 niveles de profundidad |
| **Seguimiento de referencias** | Encuentra cada uso de un simbolo en todo el codigo fuente |
| **Analisis de impacto** | Ve que se rompe si renombras, eliminas o cambias la firma de un simbolo |
| **Busqueda semantica** | Describe lo que buscas en lenguaje natural y encuentra el codigo coincidente |
| **Busqueda estructural** | Encuentra patrones de codigo como `console.$METHOD($$$ARGS)` con capturas nombradas |
| **Analisis de dependencias** | Ve que importa un archivo y que lo importa a el |
| **Ventanas de contexto** | Obtiene codigo enfocado y compactado alrededor de cualquier ubicacion en un archivo |

### Pipeline de Reduccion de Tokens

El pipeline de compresion de 3 capas de Hesman reduce el uso de tokens en cada respuesta. Los ahorros reales se miden y reportan a traves de `_meta.reduction` en cada respuesta.

| Capa | Tecnica | Ahorro Tipico | Mejor Caso |
|---|---|---|---|
| **Modo compacto** | Elimina comentarios, lineas en blanco, espacios al final; elimina imports no utilizados | 10–30% | ~35% (codigo muy comentado) |
| **Poda de contexto** | Conserva solo las lineas relevantes para el simbolo consultado; reemplaza el codigo omitido con marcadores de conteo | 50–80% (sobre el modo compacto) | ~95% (archivos grandes con area de enfoque pequena) |
| **Resumen inteligente** | Reemplaza arreglos de resultados grandes con bloques `_summary` agregados; comprime cadenas de llamadas en estadisticas agrupadas | 70–90% (en herramientas de listado) | ~90% (500+ referencias → resumen) |

**Mejor caso combinado:** Un archivo de 430 lineas consultado via `get_context` para una sola funcion → podado a ~6 lineas relevantes + modo compacto → **hasta un 97% de reduccion**. Este es el escenario ideal; el uso tipico en todas las herramientas promedia una reduccion del 20–70%.

### Listo para Produccion

- **Pool de workers** — indexacion paralela en multiples nucleos de CPU, con tamano automatico por defecto
- **Vigilancia de archivos** — re-indexacion incremental ante cambios en archivos via chokidar
- **Apagado gradual** — drena el trabajo activo, vacia los almacenes, termina los workers de forma limpia
- **Indexacion por hash de contenido** — los archivos se re-parcean solo cuando su contenido cambia realmente
- **Soporte para monorepos** — detecta automaticamente pnpm, lerna, nx, turbo y npm workspaces
- **Diagnosticos** — `hesman diag` imprime memoria, estadisticas de almacenes, estado del pool y metricas de cache
- **Probado en CI** — se ejecuta en Ubuntu, macOS y Windows con Node 20 y 22

---

## Como Funciona la Reduccion de Tokens

### Capa 1: Modo Compacto

Elimina comentarios, lineas en blanco y espacios al final, preservando comentarios magicos (`// @ts-ignore`, `// eslint-disable-*`). El nivel 2 anade manejo de JSDoc consciente del AST y eliminacion de imports no utilizados.

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

Despues (Nivel 1):
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

Despues (Nivel 2 — consciente del AST, conserva solo JSDoc):
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

### Capa 2: Poda de Contexto

Cuando un agente consulta `get_context` para un simbolo especifico, Hesman devuelve solo el codigo relevante:

```typescript
// ... (45 lines omitted: unrelated imports and helper functions)

/**
 * Processes the incoming webhook payload.
 */
export async function handleWebhook(payload: WebhookPayload): Promise<Result> {
  // ... (function body)
}

// ... (120 lines omitted: unrelated class definitions)
```

La poda conserva: la definicion del simbolo enfocado, su comentario de documentacion, los llamantes y llamados directos dentro del mismo archivo, y las referencias en el archivo — todo lo demas se reemplaza con un marcador de conteo.

### Capa 3: Resumen Inteligente

En lugar de volcar 200 referencias en un arreglo JSON:

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

El agente puede entonces solicitar detalles para archivos o tipos especificos — paginados via `cursor`.

### Medicion de Ahorros

Cada respuesta de Hesman incluye un bloque `_meta` con los ahorros reales de tokens:

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

Esto te permite auditar exactamente cuanto esta ahorrando Hesman en tus cargas de trabajo reales.

---

## Instalacion y Configuracion

### Prerrequisitos

- **Node.js** ≥ 20.0.0
- **npm** (o pnpm / yarn)

### Instalar desde npm

```bash
npm install -g hesman-mcp
```

### Instalar desde el codigo fuente

```bash
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install
npm run download:parsers   # Descargar parsers WASM de Tree-sitter
npm run build              # Compilar TypeScript
npm link                   # Hacer `hesman` disponible globalmente
```

### Registrar con Agentes de IA

```bash
# Claude Desktop (detecta automaticamente la ruta de configuracion por plataforma)
hesman install --agent claude

# Cursor
hesman install --agent cursor

# VS Code (con Copilot o Cline)
hesman install --agent vscode

# Usa --global para escribir en la configuracion de usuario en lugar de la del proyecto
hesman install --agent claude --global
```

Despues de la instalacion, reinicia tu agente de IA y Hesman estara disponible como servidor MCP.

### Configuracion Manual de MCP

Anade esto al archivo de configuracion MCP de tu agente:

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

## Referencia de Herramientas

Hesman expone **11 herramientas** a traves del transporte stdio de MCP. Cada respuesta incluye un bloque `_meta` con ahorros de tokens y, cuando corresponde, un bloque `_summary` que agrega los resultados.

### Navegacion de Codigo

| Herramienta | Que hace | Entradas clave |
|---|---|---|
| `find_symbol` | Encuentra simbolos por nombre con coincidencia exacta, difusa o por prefijo | `name`, `kind`, `matchMode`, `topK` |
| `get_file_structure` | Obtiene un arbol jerarquico de todos los simbolos en un archivo | `filePath`, `includeNested` |
| `get_references` | Encuentra todos los usos de un simbolo en todo el codigo fuente | `symbolId`, `referenceKind`, `topK`, `cursor` |
| `get_context` | Obtiene codigo compactado alrededor de una ubicacion especifica | `filePath`, `startLine`, `contextLines`, `mode` |

### Grafo de Llamadas

| Herramienta | Que hace | Entradas clave |
|---|---|---|
| `get_callers` | Encuentra todas las funciones que llaman a un simbolo dado (hasta 3 niveles de profundidad) | `symbolId`, `maxDepth`, `topK` |
| `get_callees` | Encuentra todas las funciones llamadas por un simbolo dado (hasta 3 niveles de profundidad) | `symbolId`, `maxDepth`, `topK` |

### Analisis

| Herramienta | Que hace | Entradas clave |
|---|---|---|
| `impact_analysis` | Categoriza que se rompe si un simbolo cambia (renombrar/eliminar/cambiar firma) | `symbolId`, `changeType` |
| `list_dependencies` | Muestra que importa un archivo, o que lo importa a el | `filePath`, `direction` |
| `semantic_search` | Busca codigo por descripcion en lenguaje natural | `query`, `topK`, `language`, `kind` |
| `find_pattern` | Busca por patron estructural con capturas nombradas (`$NAME`, `$$$ARGS`) | `pattern`, `language`, `topK` |

### Estado

| Herramienta | Que hace |
|---|---|
| `index_status` | Reporta el estado de la indexacion: conteo de archivos, conteo de simbolos, estado del almacen, archivos pendientes |

Para esquemas completos de entrada/salida con ejemplos, consulta **[docs/TOOLS.md](./docs/TOOLS.md)**.

---

## Configuracion

Crea un archivo `hesman.config.json` en la raiz de tu proyecto (todos los campos son opcionales):

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

### Precedencia de Configuracion

La configuracion se resuelve en este orden (el ultimo anula al anterior):

1. **Valores por defecto** — incorporados en Hesman
2. **`hesman.config.json`** — archivo de configuracion a nivel de proyecto
3. **Variables de entorno** — p. ej., `HESMAN_WORKERS=4`
4. **Opciones de CLI** — p. ej., `--workers 4`

### Variables de Entorno

| Variable | Equivalente | Descripcion |
|---|---|---|
| `HESMAN_PROJECT_ROOT` | `--project-root` | Ruta al proyecto a indexar |
| `HESMAN_WORKERS` | `--workers N` | Cantidad de hilos worker (0 = auto-detectar) |
| `HESMAN_LOG_LEVEL` | `--log-level` | Uno de: trace, debug, info, warn, error |
| `HESMAN_DATA_DIR` | `--data-dir` | Directorio para datos de indice (por defecto: `.hesman`) |
| `HESMAN_WATCH_MODE` | `--watch-mode` | Habilitar/deshabilitar la vigilancia de archivos (true/false) |

### Opciones de CLI

| Opcion | Descripcion |
|---|---|
| `--project-root <path>` | Directorio raiz del proyecto |
| `--workers <N>` | Cantidad de hilos worker (0 = automatico) |
| `--log-level <level>` | Nivel de registro |
| `--data-dir <path>` | Ruta del directorio de datos |
| `--watch-mode` | Habilitar vigilancia de archivos |
| `--no-watch` | Deshabilitar vigilancia de archivos |
| `--no-semantic` | Deshabilitar busqueda semantica |
| `--batch-size <N>` | Archivos por lote de indexacion |

---

## Referencia de CLI

```
hesman                         Ejecutar el servidor MCP sobre stdio (por defecto)
hesman index [path]            Indexar un proyecto sin iniciar el servidor
hesman status [path]           Mostrar progreso y estadisticas de indexacion
hesman clean [path]            Eliminar el directorio de datos .hesman/
hesman clean --force           Omitir la confirmacion
hesman clean --dry-run         Vista previa de lo que se eliminaria sin borrar
hesman diag [path]             Imprimir diagnosticos: memoria, estadisticas de almacenes, pool, cache
hesman diag --json             Emitir diagnosticos como JSON
hesman install --agent <name>  Escribir configuracion MCP para Claude Desktop, Cursor o VS Code
hesman install --global        Escribir en la configuracion de usuario en lugar de la del proyecto
hesman --version, -v           Mostrar numero de version
hesman --help, -h              Mostrar texto de ayuda
```

---

## Lenguajes Soportados

| Lenguaje | Extensiones | Estado |
|---|---|---|
| TypeScript / JavaScript | `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts`, `.cts` | Soporte completo |
| Python | `.py`, `.pyw`, `.pyi` | Soporte completo |
| Go | `.go` | Soporte completo |

La arquitectura soporta hasta **158 lenguajes** via Tree-sitter. Anadir un nuevo lenguaje requiere implementar un `LanguageProfile` — consulta la [Guia de Contribucion](./docs/CONTRIBUTING.md) para instrucciones paso a paso.

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
                         │   │  │    Aggregate & compress     │  │  │
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

**Pipeline de datos central:** Cambios en archivos (chokidar) → Parseo con Tree-sitter (AST + simbolos) → Indice SQLite + embeddings ZVec → Respuestas MCP comprimidas

**Decisiones clave de diseno:**
- **Sin dependencia de LSP** — Tree-sitter proporciona parseo agnostico del lenguaje sin ejecutar servidores de lenguaje
- **Indexacion incremental por hash de contenido** — los archivos se re-parcean solo cuando el SHA-256 cambia
- **Compresion a nivel de respuesta** — los datos originales permanecen intactos; la compresion se aplica en el limite de la respuesta
- **Una unica base de datos SQLite por proyecto** — incluso en monorepos, todos los paquetes comparten un almacen con aislamiento por `file_path`

Para el documento completo de arquitectura incluyendo dependencias de modulos, esquemas de almacenes y diseno del pool de workers, consulta **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)**.

---

## Configuracion de Desarrollo

### Prerrequisitos

- **Node.js** ≥ 20.0.0
- **npm** ≥ 10

### Primeros Pasos

```bash
# Clonar e instalar
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install

# Descargar parsers WASM de Tree-sitter
npm run download:parsers

# Ejecutar en modo de desarrollo (recarga en caliente)
npm run dev

# Compilar para produccion
npm run build
```

### Calidad de Codigo

```bash
npm run typecheck    # Verificacion de tipos TypeScript
npm run lint         # ESLint
npm run format       # Formateo con Prettier
```

### Ejecucion de Pruebas

```bash
npm test                  # Ejecutar todas las pruebas (unitarias + integracion)
npm run test:watch        # Modo de vigilancia para desarrollo
npm run test:e2e          # Pruebas de extremo a extremo (inicia el servidor completo)
npm run test:perf         # Benchmarks de rendimiento
```

### Objetivos de Rendimiento

| Benchmark | Objetivo |
|---|---|
| Rendimiento de indexacion | ≥ 500 archivos/s |
| `find_symbol` (exacta) | < 1ms |
| `find_symbol` (difusa) | < 5ms |
| `semantic_search` | < 10ms |
| `get_references` | < 5ms |
| Memoria (despues de indexar) | < 350MB |

Para la guia de contribucion completa incluyendo como anadir nuevos lenguajes, consulta **[docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md)**.

---

## Requisitos

| Recurso | Minimo |
|---|---|
| **Node.js** | ≥ 20.0.0 |
| **Memoria (en reposo)** | ~100 MB |
| **Memoria (bajo carga)** | ~350 MB |
| **Disco** | ~80 MB (descarga unica del modelo de embeddings) |
| **Red** | Solo para el `npm install` inicial; cero llamadas de red en tiempo de ejecucion |

El modelo de embeddings (`all-MiniLM-L6-v2`) se descarga en el primer uso y se almacena en cache indefinidamente en el directorio de cache de Transformers.js.

---

## Documentacion

| Documento | Contenido |
|---|---|
| [README.md](../../README.md) | Vision general del proyecto, configuracion y ajustes (este archivo) |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Arquitectura completa: flujo de datos, mapa de modulos, esquemas de almacenes, diseno del pool de workers |
| [docs/TOOLS.md](./docs/TOOLS.md) | Esquemas completos de entrada/salida para las 11 herramientas con ejemplos |
| [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) | Configuracion de desarrollo, guia de pruebas, creacion de perfiles de lenguaje, lista de verificacion para PRs |
| [CHANGELOG.md](./CHANGELOG.md) | Historial de versiones y cambios |

---

## Licencia

[MIT](./LICENSE) — Copyright (c) 2026 Minh Do
