# Hesman MCP Server

[![CI](https://github.com/ocsen-hoc-code/hesman-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ocsen-hoc-code/hesman-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/hesman-mcp.svg)](https://www.npmjs.com/package/hesman-mcp)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

🌐 **Lesen in:** [English](../../README.md) | [Tiếng Việt](./README.vi.md) | [Русский](./README.ru.md) | **Deutsch** | [Français](./README.fr.md) | [中文](./README.zh.md) | [日本語](./README.ja.md) | [العربية](./README.ar.md) | [Español](./README.es.md) | [Português](./README.pt.md)

**Hesman** ist ein MCP-Server (Model Context Protocol) der nächsten Generation, der KI-Codierungsagenten ein tiefes Verständnis Ihrer Codebasis ermoglicht -- Symbole, Aufrufdiagramme, Abhangigkeiten und semantische Suche -- mit einer 3-stufigen Komprimierungspipeline, die den Tokenverbrauch drastisch reduziert (bis zu 90 % in Best-Case-Szenarien). Alles lauft lokal. Keine externen APIs. Keine LSP-Server.

---

## Inhaltsverzeichnis

- [Warum Hesman?](#warum-hesman)
- [Schnellstart](#schnellstart)
- [Funktionen](#funktionen)
- [Wie die Tokenreduktion funktioniert](#wie-die-tokenreduktion-funktioniert)
- [Installation und Einrichtung](#installation-und-einrichtung)
- [Tool-Referenz](#tool-referenz)
- [Konfiguration](#konfiguration)
- [CLI-Referenz](#cli-referenz)
- [Unterstutzte Sprachen](#unterstutzte-sprachen)
- [Architektur](#architektur)
- [Entwicklungseinrichtung](#entwicklungseinrichtung)
- [Anforderungen](#anforderungen)
- [Dokumentation](#dokumentation)
- [Lizenz](#lizenz)

---

## Warum Hesman?

KI-Codierungsagenten sind leistungsstark, aber teuer. Jede Codezeile, die sie lesen, kostet Token. Eine ganze Datei zu senden, wenn der Agent nur eine einzige Funktion benotigt, verschwendet Kontext und Geld.

Hesman lost dieses Problem durch:

- **Nur das bereitstellen, was der Agent braucht** -- eine gezielte Funktion, ihre Aufrufer, ihre Aufgerufenen oder die von einer Anderung betroffenen Symbole.
- **Jede Antwort komprimieren** -- eine 3-stufige Pipeline entfernt Kommentare, schneidet irrelevanten Code weg und fasst groSSE Ergebnismengen zusammen.
- **100 % lokal laufen** -- keine API-Schlussel, keine Netzwerkaufrufe, keine Latenz durch externe Dienste. Ihr Code verlasst niemals Ihren Rechner.
- **Messbare Einsparungen** -- jede Antwort enthalt `_meta.reduction`, das exakt angibt, wie viele Token im Vergleich zur Rohausgabe gespart wurden.

Das Ergebnis: Agenten arbeiten schneller, kosten weniger und argumentieren praziser, weil sie den richtigen Code sehen, nicht den gesamten Code.

---

## Schnellstart

```bash
# 1. Global installieren
npm install -g hesman-mcp

# 2. Server innerhalb Ihres Projekts ausfuhren
cd my-project
hesman

# 3. Bei Ihrem KI-Agenten registrieren (Claude Desktop, Cursor, VS Code)
hesman install --agent claude
```

Das war's. Sobald die anfangliche Indizierung abgeschlossen ist (einige Sekunden fur die meisten Projekte), kann Ihr KI-Agent Ihre Codebasis uber die 11 Tools von Hesman abfragen.

---

## Funktionen

### Code-Intelligenz

| Fahigkeit | Beschreibung |
|---|---|
| **Symbolsuche** | Funktionen, Klassen, Methoden nach Namen finden -- exakt, unscharf oder mit Prafixubereinstimmung (< 1 ms) |
| **Aufrufdiagramm-Durchlauf** | Aufrufer und Aufgerufene bis zu 3 Ebenen tief verfolgen |
| **Referenzverfolgung** | Jede Verwendung eines Symbols in der gesamten Codebasis finden |
| **Auswirkungsanalyse** | Sehen, was kaputt geht, wenn Sie ein Symbol umbenennen, loschen oder seine Signatur andern |
| **Semantische Suche** | Beschreiben Sie in naturlicher Sprache, wonach Sie suchen, und finden Sie passenden Code |
| **Strukturelle Suche** | Codermuster wie `console.$METHOD($$$ARGS)` mit benannten Erfassungen finden |
| **Abhangigkeitsanalyse** | Sehen, was eine Datei importiert und was aus ihr importiert |
| **Kontextfenster** | Fokussierten, komprimierten Code um eine beliebige Stelle in einer Datei erhalten |

### Tokenreduktions-Pipeline

Die 3-stufige Komprimierungspipeline von Hesman reduziert den Tokenverbrauch bei jeder Antwort. Die tatsachlichen Einsparungen werden gemessen und uber `_meta.reduction` in jeder Antwort gemeldet.

| Stufe | Technik | Typische Einsparung | Best-Case |
|---|---|---|---|
| **Compact Mode** | Entfernt Kommentare, Leerzeilen, abschlieSSende Leerraume; entfernt ungenutzte Importe | 10-30 % | ~35 % (stark kommentierter Code) |
| **Context Pruning** | Behalt nur Zeilen, die fur das abgefragte Symbol relevant sind; ersetzt ausgelassenen Code durch Zahlmarkierungen | 30-90 % (zusatzlich zu Compact) | ~95 % (groSSE Dateien mit kleinem Fokusbereich) |
| **Smart Summarization** | Ersetzt groSSE Ergebnisarrays durch aggregierte `_summary`-Blocke; komprimiert Aufrufketten in gruppierte Statistiken | 0 % (bei List-Tools) | 0 % |

### Produktionsreif

- **Worker-Pool** -- parallele Indizierung uber CPU-Kerne, standardmaSSig automatisch groSSEnangepasst
- **Dateiuberwachung** -- inkrementelle Neuindizierung bei Dateianderungen uber chokidar
- **Graceful Shutdown** -- Aktive Arbeit wird abgeschlossen, Speicher geleert, Worker sauber beendet
- **Content-Hash-Indizierung** -- Dateien werden nur neu geparst, wenn sich ihr Inhalt tatsachlich andert
- **Monorepo-Unterstutzung** -- erkennt automatisch pnpm, lerna, nx, turbo und npm-Workspaces
- **Diagnose** -- `hesman diag` zeigt Speicher, Store-Statistiken, Pool-Zustand und Cache-Metriken
- **CI-getestet** -- lauft auf Ubuntu, macOS und Windows mit Node 20 und 22

---

## Wie die Tokenreduktion funktioniert

### Stufe 1: Compact Mode

Entfernt Kommentare, Leerzeilen und abschlieSSende Leerraume, wahrend magische Kommentare (`// @ts-ignore`, `// eslint-disable-*`) erhalten bleiben. Stufe 2 fugt AST-bewusste JSDoc-Behandlung und Entfernung ungenutzter Importe hinzu.

Vorher:
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

Nachher (Stufe 1):
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

Nachher (Stufe 2 -- AST-bewusst, behalt nur JSDoc):
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

### Stufe 2: Context Pruning

Wenn ein Agent `get_context` fur ein bestimmtes Symbol abfragt, gibt Hesman nur den relevanten Code zuruck:

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

Das Pruning behalt: die Definition des Fokussymbols, seinen Dokumentationskommentar, direkte Aufrufer und Aufgerufene innerhalb derselben Datei sowie In-Datei-Referenzen -- alles andere wird durch eine Zahlmarkierung ersetzt.

### Stufe 3: Smart Summarization

Statt 200 Referenzen in ein JSON-Array zu dumpen:

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

Der Agent kann dann Details fur bestimmte Dateien oder Arten anfordern -- paginiert uber `cursor`.

### Einsparungen messen

Jede Hesman-Antwort enthalt einen `_meta`-Block mit den tatsachlichen Tokeneinsparungen:

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

Dies ermoglicht es Ihnen, genau zu prufen, wie viel Hesman in Ihren realen Arbeitslasten einspart.

---

## Installation und Einrichtung

### Voraussetzungen

- **Node.js** >= 20.0.0
- **npm** (oder pnpm / yarn)

### Installation von npm

```bash
npm install -g hesman-mcp
```

### Installation aus dem Quellcode

```bash
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install
npm run download:parsers   # Tree-sitter WASM-Parser herunterladen
npm run build              # TypeScript kompilieren
npm link                   # `hesman` global verfugbar machen
```

### Bei KI-Agenten registrieren

```bash
# Claude Desktop (erkennt Konfigurationspfad plattformabhangig automatisch)
hesman install --agent claude

# Cursor
hesman install --agent cursor

# VS Code (mit Copilot oder Cline)
hesman install --agent vscode

# Mit --global wird die benutzerweite statt der projektebenen Konfiguration geschrieben
hesman install --agent claude --global
```

Nach der Installation starten Sie Ihren KI-Agenten neu. Hesman steht dann als MCP-Server zur Verfugung.

### Manuelle MCP-Konfiguration

Fugen Sie dies zur MCP-Konfigurationsdatei Ihres Agenten hinzu:

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

## Tool-Referenz

Hesman stellt **11 Tools** uber den MCP-Stdio-Transport bereit. Jede Antwort enthalt einen `_meta`-Block mit Tokeneinsparungen und, wo anwendbar, einen `_summary`-Block mit aggregierten Ergebnissen.

### Codenavigation

| Tool | Funktion | Wichtige Eingaben |
|---|---|---|
| `find_symbol` | Symbole nach Namen mit exakter, unscharfer oder Prafixubereinstimmung finden | `name`, `kind`, `matchMode`, `topK` |
| `get_file_structure` | Hierarchischen Baum aller Symbole in einer Datei abrufen | `filePath`, `includeNested` |
| `get_references` | Alle Verwendungen eines Symbols in der gesamten Codebasis finden | `symbolId`, `referenceKind`, `topK`, `cursor` |
| `get_context` | Komprimierten Code um eine bestimmte Stelle abrufen | `filePath`, `startLine`, `contextLines`, `mode` |

### Aufrufdiagramm

| Tool | Funktion | Wichtige Eingaben |
|---|---|---|
| `get_callers` | Alle Funktionen finden, die ein gegebenes Symbol aufrufen (bis zu 3 Ebenen tief) | `symbolId`, `maxDepth`, `topK` |
| `get_callees` | Alle Funktionen finden, die von einem gegebenen Symbol aufgerufen werden (bis zu 3 Ebenen tief) | `symbolId`, `maxDepth`, `topK` |

### Analyse

| Tool | Funktion | Wichtige Eingaben |
|---|---|---|
| `impact_analysis` | Kategorisieren, was kaputt geht, wenn ein Symbol geandert wird (Umbenennung/Loschung/Signaturanderung) | `symbolId`, `changeType` |
| `list_dependencies` | Anzeigen, was eine Datei importiert oder was aus ihr importiert | `filePath`, `direction` |
| `semantic_search` | Code anhand einer naturlichsprachlichen Beschreibung durchsuchen | `query`, `topK`, `language`, `kind` |
| `find_pattern` | Suche nach strukturellem Muster mit benannten Erfassungen (`$NAME`, `$$$ARGS`) | `pattern`, `language`, `topK` |

### Status

| Tool | Funktion |
|---|---|
| `index_status` | Indizierungszustand melden: Dateianzahl, Symbolanzahl, Store-Status, ausstehende Dateien |

Vollstandige Ein-/Ausgabeschemata mit Beispielen finden Sie unter **[docs/TOOLS.md](./docs/TOOLS.md)**.

---

## Konfiguration

Erstellen Sie eine `hesman.config.json` im Stammverzeichnis Ihres Projekts (alle Felder optional):

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

### Konfigurationsrangfolge

Die Einstellungen werden in dieser Reihenfolge aufgelost (spatere uberschreiben fruhere):

1. **Standardeinstellungen** -- in Hesman eingebaut
2. **`hesman.config.json`** -- Projektkonfigurationsdatei
3. **Umgebungsvariablen** -- z. B. `HESMAN_WORKERS=4`
4. **CLI-Flags** -- z. B. `--workers 4`

### Umgebungsvariablen

| Variable | Entspricht | Beschreibung |
|---|---|---|
| `HESMAN_PROJECT_ROOT` | `--project-root` | Pfad zum zu indizierenden Projekt |
| `HESMAN_WORKERS` | `--workers N` | Anzahl der Worker-Threads (0 = automatische Erkennung) |
| `HESMAN_LOG_LEVEL` | `--log-level` | Einer von: trace, debug, info, warn, error |
| `HESMAN_DATA_DIR` | `--data-dir` | Verzeichnis fur Indexdaten (Standard: `.hesman`) |
| `HESMAN_WATCH_MODE` | `--watch-mode` | Dateiuberwachung aktivieren/deaktivieren (true/false) |

### CLI-Flags

| Flag | Beschreibung |
|---|---|
| `--project-root <path>` | Stammverzeichnis des Projekts |
| `--workers <N>` | Anzahl der Worker-Threads (0 = automatisch) |
| `--log-level <level>` | Protokollierungsstufe |
| `--data-dir <path>` | Pfad zum Datenverzeichnis |
| `--watch-mode` | Dateiuberwachung aktivieren |
| `--no-watch` | Dateiuberwachung deaktivieren |
| `--no-semantic` | Semantische Suche deaktivieren |
| `--batch-size <N>` | Dateien pro Indizierungsbatch |

---

## CLI-Referenz

```
hesman                         MCP-Server uber stdio ausfuhren (Standard)
hesman index [path]            Projekt indizieren, ohne den Server zu starten
hesman status [path]           Indizierungsfortschritt und Statistiken anzeigen
hesman clean [path]            Das Datenverzeichnis .hesman/ loschen
hesman clean --force           Bestatigungsaufforderung uberspringen
hesman clean --dry-run         Vorschau, was geloscht wurde, ohne tatsachlich zu loschen
hesman diag [path]             Diagnose ausgeben: Speicher, Store-Statistiken, Pool, Cache
hesman diag --json             Diagnose als JSON ausgeben
hesman install --agent <name>  MCP-Konfiguration fur Claude Desktop, Cursor oder VS Code schreiben
hesman install --global        In benutzerweite statt projektebene Konfiguration schreiben
hesman --version, -v           Versionsnummer anzeigen
hesman --help, -h              Hilfetext anzeigen
```

---

## Unterstutzte Sprachen

| Sprache | Erweiterungen | Status |
|---|---|---|
| TypeScript / JavaScript | `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts`, `.cts` | Vollstandig unterstutzt |
| Python | `.py`, `.pyw`, `.pyi` | Vollstandig unterstutzt |
| Go | `.go` | Vollstandig unterstutzt |

Die Architektur unterstutzt dank Tree-sitter bis zu **158 Sprachen**. Das Hinzufugen einer neuen Sprache erfordert die Implementierung eines `LanguageProfile` -- siehe den [Contribution Guide](./docs/CONTRIBUTING.md) mit Schritt-fur-Schritt-Anleitung.

---

## Architektur

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

**Kern-Datenpipeline:** Dateianderungen (chokidar) -> Tree-sitter-Parse (AST + Symbole) -> SQLite-Index + ZVec-Embeddings -> Komprimierte MCP-Antworten

**Wichtige Architekturentscheidungen:**
- **Keine LSP-Abhangigkeit** -- Tree-sitter bietet sprachunabhangiges Parsen ohne das Ausfuhren von Sprachservern
- **Content-Hash-inkrementelle Indizierung** -- Dateien werden nur neu geparst, wenn sich der SHA-256 andert
- **Komprimierung auf Antwortebene** -- Die ursprunglichen Daten bleiben intakt; die Komprimierung erfolgt an der Antwortgrenze
- **Eine einzelne SQLite-Datenbank pro Projekt** -- selbst in Monorepos teilen sich alle Pakete einen Store mit `file_path`-Isolation

Das vollstandige Architekturdokument einschlieSSlich Modulabhangigkeiten, Store-Schemas und Worker-Pool-Design finden Sie unter **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)**.

---

## Entwicklungseinrichtung

### Voraussetzungen

- **Node.js** >= 20.0.0
- **npm** >= 10

### Erste Schritte

```bash
# Klonen und installieren
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install

# Tree-sitter WASM-Parser herunterladen
npm run download:parsers

# Im Entwicklungsmodus ausfuhren (Hot Reload)
npm run dev

# Fur Produktion bauen
npm run build
```

### Code-Qualitat

```bash
npm run typecheck    # TypeScript-Typuberprufung
npm run lint         # ESLint
npm run format       # Prettier-Formatierung
```

### Tests ausfuhren

```bash
npm test                  # Alle Tests ausfuhren (Unit + Integration)
npm run test:watch       # Watch-Modus fur die Entwicklung
npm run test:e2e          # End-to-End-Tests (startet vollstandigen Server)
npm run test:perf         # Leistungsbenchmarks
```

### Leistungsziele

| Benchmark | Ziel |
|---|---|
| Index-Durchsatz | >= 500 Dateien/s |
| `find_symbol` (exakt) | < 1 ms |
| `find_symbol` (unscharf) | < 5 ms |
| `semantic_search` | < 10 ms |
| `get_references` | < 5 ms |
| Speicher (nach Indizierung) | < 350 MB |

Die vollstandige Anleitung zum Beitragen, einschlieSSlich der Vorgehensweise zum Hinzufugen neuer Sprachen, finden Sie unter **[docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md)**.

---

## Anforderungen

| Ressource | Minimum |
|---|---|
| **Node.js** | >= 20.0.0 |
| **Arbeitsspeicher (Leerlauf)** | ~100 MB |
| **Arbeitsspeicher (unter Last)** | ~350 MB |
| **Festplatte** | ~80 MB (einmaliger Download des Embedding-Modells) |
| **Netzwerk** | Nur fur anfangliches `npm install`; null Netzwerkaufrufe zur Laufzeit |

Das Embedding-Modell (`all-MiniLM-L6-v2`) wird bei der ersten Verwendung heruntergeladen und im Transformers.js-Cache-Verzeichnis auf unbestimmte Zeit zwischengespeichert.

---

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [README.md](../../README.md) | Projektubersicht, Einrichtung und Konfiguration (diese Datei) |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Vollstandige Architektur: Datenfluss, Modulkarte, Store-Schemas, Worker-Pool-Design |
| [docs/TOOLS.md](./docs/TOOLS.md) | Vollstandige Ein-/Ausgabeschemata aller 11 Tools mit Beispielen |
| [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) | Entwicklungseinrichtung, Testanleitung, Erstellung von Sprachprofilen, PR-Checkliste |
| [CHANGELOG.md](./CHANGELOG.md) | Versionshistorie und Anderungen |

---

## Lizenz

[MIT](./LICENSE) -- Copyright (c) 2026 Minh Do
