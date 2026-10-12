# Hesman MCP Server

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

🌐 **Lesen in:** [English](../../README.md) | [Tiếng Việt](./README.vi.md) | [Русский](./README.ru.md) | **Deutsch** | [Français](./README.fr.md) | [中文](./README.zh.md) | [日本語](./README.ja.md) | [العربية](./README.ar.md) | [Español](./README.es.md) | [Português](./README.pt.md)

**Hesman** ist ein MCP-Server (Model Context Protocol) der nächsten Generation, der KI-Coding-Agenten ein tiefes Verständnis Ihrer Codebasis gibt – Symbole, Aufrufgraphen, Abhängigkeiten und semantische Suche – mit gezielten Code-Lesezugriffen, die den Tokenverbrauch senken (`get_context` liefert ~90 % weniger Token als die ganze Datei, wenn Sie nach der Umgebung einer einzelnen Funktion fragen). Alles läuft lokal. Keine externen APIs. Keine LSP-Server.

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
- [Unterstützte Sprachen](#unterstützte-sprachen)
- [Architektur](#architektur)
- [Entwicklungsumgebung](#entwicklungsumgebung)
- [Anforderungen](#anforderungen)
- [Dokumentation](#dokumentation)
- [Lizenz](#lizenz)

---

## Warum Hesman?

KI-Coding-Agenten sind leistungsfähig, aber teuer. Jede Codezeile, die sie lesen, kostet Token. Eine ganze Datei zu senden, wenn der Agent nur eine einzige Funktion braucht, verschwendet Kontext und Geld.

Hesman löst das so:

- **Nur liefern, was der Agent braucht** – eine einzelne Funktion, ihre Aufrufer, die von ihr aufgerufenen Funktionen oder die von einer Änderung betroffenen Symbole.
- **Code verdichten und beschneiden** – `get_context` entfernt Kommentare und Leerzeilen und gibt nur die Zeilen rund um die Fokusstelle zurück statt der ganzen Datei.
- **Antworten nie aufblähen** – eine Antwort ist nie größer als ihre unveränderte Nutzlast. Zusammenfassungen für lange Ergebnislisten sind geplant, werden aber noch nicht angewendet (siehe [Token-Reduktions-Pipeline](#token-reduktions-pipeline)).
- **Auf Ihrem Rechner laufen** – keine API-Schlüssel, kein externer Dienst, keine Latenz durch einen solchen. Ihr Code verlässt niemals Ihren Rechner. Die einzigen Downloads sind das Embedding-Modell bei der ersten Verwendung und die Grammatiken von Bei-Bedarf-Sprachen; beides lässt sich abschalten (`--no-semantic`, `HESMAN_GRAMMARS_OFFLINE=1`).
- **Messbare Einsparungen** – jede Tool-Antwort außer `index_status` enthält `_meta.reduction` und zeigt damit genau, wie viele Token gegenüber der Rohausgabe eingespart wurden.

Das Ergebnis: Agenten arbeiten schneller, kosten weniger und schlussfolgern genauer, weil sie den richtigen Code sehen und nicht den gesamten Code.

---

## Schnellstart

`hesman-mcp` ist noch nicht in der npm-Registry, deshalb wird Hesman derzeit aus dem Quellcode installiert:

```bash
# 1. Hesman holen und bauen (Node.js ≥ 20)
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install
npm run download:parsers
npm run build

# 2. Bei Ihren KI-Clients registrieren (erkennt Claude Code, Cursor, VS Code, Codex, …)
node dist/index.js setup
```

Starten Sie den Client neu und öffnen Sie ein Projekt. `setup` schreibt den Startbefehl, der zur Art der Hesman-Installation passt (hier: absolute Pfade zu `node` und `dist/index.js`, sodass nichts im PATH liegen muss); siehe [Startbefehl](#startbefehl).

Sobald das Paket veröffentlicht ist, wird aus dem ganzen Schnellstart eine Zeile:

```bash
npx -y hesman-mcp setup   # erst, wenn hesman-mcp auf npm veröffentlicht ist
```

Der Server antwortet Ihrem Agenten sofort und indiziert im Hintergrund (wenige Sekunden bei den meisten Projekten): Die 11 Tools funktionieren von Anfang an, kennzeichnen Ergebnisse mit `_meta.indexing`, solange der Index noch unvollständig ist, und `index_status` meldet den Fortschritt.

---

## Funktionen

### Code-Verständnis

| Fähigkeit | Beschreibung |
|---|---|
| **Symbolsuche** | Funktionen, Klassen, Methoden nach Namen finden – exakt, unscharf oder per Präfix (< 1 ms) |
| **Durchlaufen des Aufrufgraphen** | Aufrufer und aufgerufene Funktionen bis zu 3 Ebenen tief verfolgen |
| **Referenzverfolgung** | Jede Verwendung eines Symbols in der gesamten Codebasis finden |
| **Auswirkungsanalyse** | Sehen, was kaputtgeht, wenn Sie ein Symbol umbenennen, löschen oder seine Signatur ändern |
| **Semantische Suche** | In natürlicher Sprache beschreiben, wonach Sie suchen, und passenden Code finden |
| **Strukturelle Suche** | Codemuster wie `console.$METHOD($$$ARGS)` mit benannten Captures finden |
| **Abhängigkeitsanalyse** | Sehen, was eine Datei importiert und was aus ihr importiert |
| **Kontextfenster** | Fokussierten, verdichteten Code rund um eine beliebige Stelle in einer Datei abrufen |

### Token-Reduktions-Pipeline

Hesman legt seine Komprimierungspipeline in 3 Schichten an; heute stammen die Einsparungen aus dem Compact-Modus und dem Kontext-Pruning in `get_context`. Jede Antwort meldet ihre tatsächliche Einsparung in `_meta.reduction`, und eine Antwort ist nie größer als ihre unveränderte Nutzlast.

| Schicht | Technik | Gemessene Einsparung | Status |
|---|---|---|---|
| **Compact-Modus** | Entfernt Kommentare, Leerzeilen, Leerraum am Zeilenende | ~14–16 % eines Codeausschnitts (`get_context`, `mode: "full"` gegenüber `"compact"`) | In `get_context` angewendet |
| **Kontext-Pruning** | Extraktion eines Zeilenbereichs rund um die Fokusstelle + Compact-Modus | 89,9 % mit den standardmäßigen ±5 Zeilen, 29,9 % mit ±40 Zeilen (Datei mit 195 Zeilen); 0 %, wenn die ganze Datei angefordert wird | In `get_context` angewendet |
| **Intelligente Zusammenfassung** | Aggregierte `_summary`-Blöcke für lange Ergebnislisten | 0 % – ein `_summary` hat die Antwort nur vergrößert und wird deshalb verworfen | Noch nicht angewendet ([Backlog](../../tasks/STATUS.md)) |

Listen- und Aufrufgraph-Tools (`get_references`, `get_callers`, `get_callees`, `list_dependencies`, `get_file_structure`) geben derzeit ihre unveränderte Nutzlast mit `_meta.reduction: "0.0%"` und `_meta.compressed: false` zurück. Gemessen am Verzeichnis `src/` dieses Repositorys und an `tests/fixtures/polyglot-basic`. Das Feld `_meta.reduction` in jeder Antwort meldet die exakte Einsparung für Ihre Arbeitslast.

### Produktionsreif

- **Worker-Pool** – parallele Indizierung über die CPU-Kerne, standardmäßig automatisch dimensioniert
- **Dateiüberwachung** – inkrementelle Neuindizierung bei Dateiänderungen über chokidar
- **Geordnetes Herunterfahren** – arbeitet laufende Aufgaben ab, schreibt die Stores zurück, beendet die Worker sauber
- **Indizierung per Inhalts-Hash** – Dateien werden nur dann neu geparst, wenn sich ihr Inhalt tatsächlich ändert
- **Monorepo-Unterstützung** – erkennt automatisch pnpm-, lerna-, nx-, turbo- und npm-Workspaces
- **Diagnose** – `hesman diag` gibt Speicher, Store-Statistiken, Pool-Zustand und Cache-Metriken aus
- **Lokal getestet** – die vollständige Testsuite, einschließlich End-to-End-Tests über den echten Server, läuft auf macOS; Linux und Windows sind noch nicht verifiziert

---

## Wie die Tokenreduktion funktioniert

### Schicht 1: Compact-Modus

Entfernt Kommentare, Leerzeilen und Leerraum am Zeilenende und behält dabei magische Kommentare (`// @ts-ignore`, `// eslint-disable-*`).

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

Nachher:
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

### Schicht 2: Kontext-Pruning

`get_context` gibt nicht die ganze Datei zurück. Es liefert den angeforderten Zeilenbereich plus `contextLines` Zeilen darüber und darunter (Standard 5, Maximum 200) und wendet dann den Compact-Modus auf diesen Ausschnitt an. `_meta.reduction` vergleicht das Ergebnis mit der ganzen Datei, und `_meta.layers` führt auf, was angewendet wurde (`compact`, `prune`).

Das Pruning erfolgt ausschließlich nach Zeilenbereich: Es folgt weder Aufrufern noch aufgerufenen Funktionen. Um zu lesen, was eine Funktion aufruft oder wovon sie aufgerufen wird, fragen Sie `get_callees` / `get_callers` nach den Fundstellen und anschließend `get_context` für jede davon.

### Schicht 3: Intelligente Zusammenfassung (noch nicht angewendet)

Geplant ist, lange Ergebnislisten durch ein aggregiertes `_summary` (Anzahlen nach Art und nach Datei) plus die obersten Einträge zu ersetzen. Die aktuelle Implementierung hat ein `_summary` lediglich neben der vollständigen Liste *hinzugefügt*, was die Antworten größer machte; deshalb verwirft Hesman es und gibt die unveränderte Nutzlast zurück: Listen- und Aufrufgraph-Tools melden heute `_meta.reduction: "0.0%"`. Dass Zusammenfassungen tatsächlich Token sparen, wird im Backlog verfolgt ([`tasks/STATUS.md`](../../tasks/STATUS.md)). Lange Listen lassen sich bereits seitenweise über `topK` und `cursor` abrufen (`get_references`).

### Einsparungen messen

Jede Hesman-Antwort enthält einen `_meta`-Block mit den tatsächlichen Token-Einsparungen:

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

Dieses Beispiel ist ein echter `get_context`-Aufruf (Standard ±5 Zeilen, Compact-Modus) auf einer Datei mit 195 Zeilen: Der Ausschnitt ist vom Tool bereits verdichtet, daher wird nur die Schicht `prune` aufgeführt, und `compressed: false` bedeutet, dass der Antwort-Kompressor nichts weiter zu entfernen hatte. Das Feld `_meta.reduction` misst gegen die ursprüngliche Tokenzahl der ganzen Datei und liefert Ihnen damit die echte Ende-zu-Ende-Einsparung. Antworten, die nicht kleiner würden, werden unverändert mit `reduction: "0.0%"` zurückgegeben; der Wert ist nie negativ. Prüfen Sie genau, wie viel Hesman in Ihren realen Arbeitslasten einspart, indem Sie `_meta.reduction` in einer beliebigen Tool-Antwort ansehen.

---

## Installation und Einrichtung

### Voraussetzungen

- **Node.js** ≥ 20.0.0
- **npm** (oder pnpm / yarn)

### Installation aus dem Quellcode

Das ist der Weg, der heute funktioniert.

```bash
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install
npm run download:parsers   # Tree-sitter-WASM-Parser herunterladen
npm run build              # TypeScript kompilieren
npm link                   # Optional: `hesman` im PATH verfügbar machen
```

Ohne `npm link` verwenden Sie `node /path/to/hesman-mcp/dist/index.js` überall dort, wo in diesem README `hesman` steht.

### Installation von npm (nach Veröffentlichung des Pakets)

`hesman-mcp` ist noch nicht in der npm-Registry. Sobald es dort ist:

```bash
npx -y hesman-mcp setup     # ohne Installation: Clients starten Hesman über npx
npm install -g hesman-mcp   # oder eine globale Installation, die `hesman` in den PATH legt
```

### Bei KI-Agenten registrieren

```bash
hesman setup                         # Auswahlliste der auf diesem Rechner gefundenen Clients
hesman setup --yes                   # ohne Rückfragen: jeden erkannten Client konfigurieren
hesman setup --client cursor vscode  # bestimmte Clients konfigurieren
hesman setup --dry-run --all         # die genaue Änderung pro Client ausgeben, nichts schreiben
hesman remove                        # rückgängig: Hesman wieder aus jedem Client entfernen
```

| Client | `--client` | Was `hesman setup` ändert (Scope „user“) | `--scope project` |
|---|---|---|---|
| Claude Code | `claude-code` | führt `claude mcp add --scope user hesman -- <launch command>` aus; ohne die CLI wird `~/.claude.json` bearbeitet | `.mcp.json` |
| Claude Desktop | `claude-desktop` | `claude_desktop_config.json` | — |
| OpenAI Codex CLI | `codex` | führt `codex mcp add hesman -- <launch command>` aus; ohne die CLI wird `~/.codex/config.toml` bearbeitet | `.codex/config.toml` |
| Cursor | `cursor` | `~/.cursor/mcp.json` | `.cursor/mcp.json` |
| Google Antigravity | `antigravity` | `~/.gemini/config/mcp_config.json` | `.agents/mcp_config.json` |
| VS Code (Copilot) | `vscode` | `mcp.json` im VS-Code-Benutzerverzeichnis | `.vscode/mcp.json` |
| Gemini CLI | `gemini-cli` | `~/.gemini/settings.json` | `.gemini/settings.json` |
| Windsurf | `windsurf` | `~/.config/devin/mcp_config.json` | — |

- Nur der Eintrag `hesman` wird angefasst. Eine geänderte Datei wird zuerst nach `<file>.hesman.bak` kopiert, und `hesman remove` stellt sie Byte für Byte wieder her, wenn sich in der Zwischenzeit sonst nichts geändert hat.
- Der Eintrag enthält keinen Projektpfad: Hesman findet das Projekt selbst (siehe unten). Zwei Ausnahmen: **Claude Desktop** hat keinen Workspace, daher legt sein Eintrag ein Projekt fest (das aktuelle Verzeichnis oder `--project-root <path>`), und **Cursor** erhält `--project-root ${workspaceFolder}` nur im Projekt-Scope (in der globalen `~/.cursor/mcp.json` kann diese Variable Ihr Home-Verzeichnis sein, daher nennt der globale Eintrag kein Projekt).
- Für **Antigravity** und **Windsurf** ist nicht dokumentiert, wie das Projekt an den Server übergeben wird; `hesman setup` gibt einen Hinweis aus, der Sie bittet, das nach dem ersten Start zu prüfen.
- Konfigurationsdateien mit Kommentaren (JSONC) werden nicht bearbeitet: `hesman setup` meldet sie und lässt sie unberührt.
- `hesman install --agent <name>` funktioniert weiterhin als veralteter Alias für `hesman setup --client <name> --yes`.

Starten Sie nach der Einrichtung den Client neu; Hesman steht dann als MCP-Server zur Verfügung.

### Nutzungsregeln für Agenten (Opt-in)

Ein installierter MCP-Server ist nicht automatisch ein genutzter: Agenten greifen oft weiterhin zu grep und lesen ganze Dateien. `hesman setup --rules` schreibt zusätzlich einen kurzen Block (14 Zeilen) in die Anweisungsdatei, die jeder ausgewählte Client im **aktuellen Projekt** liest, und sagt darin, welches Hesman-Tool welche Frage beantwortet. Ob das ändert, wie oft ein Agent die Tools aufruft, wurde noch nicht gemessen.

```bash
hesman setup --client claude-code codex --rules   # innerhalb des Projekts ausführen
hesman setup --all --rules --dry-run              # Block und Dateien ausgeben, nichts schreiben
hesman remove                                     # löscht auch den Block wieder
```

| Client | Anweisungsdatei (relativ zum Projekt) |
|---|---|
| Claude Code | `CLAUDE.md` |
| OpenAI Codex CLI, Windsurf | `AGENTS.md` |
| Gemini CLI, Google Antigravity | `GEMINI.md` |
| Cursor | `.cursor/rules/hesman.mdc` (eigene Regeldatei, `alwaysApply: true`) |
| VS Code (Copilot) | `.github/copilot-instructions.md` |
| Claude Desktop | keine: Es liest keine Projektdatei und wird daher mit einem Hinweis übersprungen |

- **Opt-in.** Ohne `--rules` wird nichts geschrieben. In einem Terminal ohne `--yes` fragt setup einmal nach, und die Standardantwort ist Nein.
- Der Block steht zwischen `<!-- hesman:rules:start -->` und `<!-- hesman:rules:end -->`. Ein erneuter Lauf von setup ersetzt ihn an Ort und Stelle; Text außerhalb der Markierungen wird nie verändert, und eine Datei, die sich zwei Clients teilen, erhält den Block nur einmal.
- `hesman remove` löscht genau den Block und gibt die Datei Byte für Byte zurück; eine Datei, die Hesman angelegt hat und die sonst nichts enthält, wird gelöscht. Führen Sie den Befehl im selben Projekt aus (oder übergeben Sie `--project-root <path>`, das auch `setup --rules` akzeptiert).
- Diese Dateien werden üblicherweise in git eingecheckt und mit einem Team geteilt. Setup listet die geänderten Dateien auf, damit Sie sie prüfen (`git diff`) und entscheiden können, ob Sie sie committen.

### Startbefehl

`hesman setup --command auto|npx|global|absolute` legt fest, was die Clients ausführen. Setup nutzt nie das Netzwerk.

| `--command` | Geschriebener Eintrag | Benötigt |
|---|---|---|
| `npx` | `npx -y hesman-mcp@<major>` | das Paket auf npm (noch nicht veröffentlicht) und `npx` im PATH des Clients; übersteht Node-Upgrades |
| `global` | `hesman` | eine globale Installation (oder `npm link`) im PATH des Clients |
| `absolute` | `/path/to/node /path/to/hesman-mcp/dist/index.js` | nichts im PATH; führen Sie `hesman setup` erneut aus, nachdem Sie die Node-Version gewechselt oder Hesman verschoben haben |

`auto` (der Standard) richtet sich danach, wie das laufende Hesman gestartet wurde:

1. über `npx` gestartet (es läuft aus einem `_npx`-Cache-Verzeichnis) → `npx`;
2. das `hesman` im PATH ist genau diese Installation (symbolische Links aufgelöst) → `global`;
3. alles andere (Quellcode-Checkout, lokales `node_modules`, nicht im PATH) → `absolute`.

Desktop-Apps (Claude Desktop, Cursor, Antigravity, VS Code, Windsurf), die aus dem Dock oder einem Launcher geöffnet werden, erhalten nicht den PATH Ihrer Shell. Wenn `auto` unter macOS und Linux `npx` oder `hesman` wählt und dieser Befehl oder `node` nicht in einem Standard-Systemverzeichnis liegt (`/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`, `/usr/local/bin`, dazu `/opt/homebrew/bin` unter macOS und `/snap/bin` unter Linux) – der Normalfall mit nvm, fnm, volta oder asdf –, erhalten diese Clients stattdessen den `absolute`-Eintrag, mit dem Hinweis, `hesman setup` nach einem Wechsel der Node-Version erneut auszuführen. Terminal-Clients (Claude Code, Codex CLI, Gemini CLI) erben die Shell und behalten den gewählten Befehl. Ein ausdrückliches `--command npx|global` wird für jeden Client wie verlangt geschrieben, mit einer Warnung dort, wo eine Desktop-App den Befehl möglicherweise nicht findet.

### Manuelle MCP-Konfiguration

Fügen Sie dies in die MCP-Konfigurationsdatei Ihres Agenten ein (VS Code verwendet `"servers"` statt `"mcpServers"` und braucht `"type": "stdio"` im Eintrag; Codex verwendet eine TOML-Tabelle `[mcp_servers.hesman]`):

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

`--project-root` ist optional; siehe unten. `"command": "hesman"` setzt voraus, dass `hesman` in dem PATH liegt, den der Client sieht; andernfalls verwenden Sie `"command": "/path/to/node"` mit `"/path/to/hesman-mcp/dist/index.js"` als erstem Argument (siehe [Startbefehl](#startbefehl)).

### Wie Hesman das Projekt auswählt

Ein Serverprozess indiziert ein Projekt. Es wird in dieser Reihenfolge bestimmt:

1. **Expliziter Root** – `--project-root <path>`, `HESMAN_PROJECT_ROOT` oder `projectRoot` in `hesman.config.json`. Gewinnt immer.
2. **Workspace-Ordner des MCP-Clients** – wenn der Client die MCP-Capability `roots` unterstützt, fragt Hesman ihn nach dem Handshake nach seinen Ordnern und indiziert den ersten (weitere Ordner werden protokolliert, nicht indiziert). Meldet der Client später einen anderen Ordner, wechselt Hesman dorthin.
3. **Arbeitsverzeichnis** – das nächstgelegene Verzeichnis im oder oberhalb des Arbeitsverzeichnisses des Servers, das ein Versionskontrollverzeichnis (`.git`, `.hg`, `.svn`, `.jj`) oder ein Projektmanifest (`package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`, …) enthält.
4. **Kein Projekt** – der Server startet trotzdem und listet seine Tools auf, aber jedes Tool gibt einen `NO_PROJECT`-Fehler zurück, der erklärt, wie man einen Root festlegt.

Das Home-Verzeichnis und seine übergeordneten Verzeichnisse werden nie automatisch gewählt (Schritte 2 und 3), sodass ein globaler MCP-Eintrag, der aus `~` gestartet wird, nicht Ihre Festplatte durchsucht. Der Index liegt in `.hesman/` innerhalb des gewählten Projekts.

---

## Tool-Referenz

Hesman stellt **11 Tools** über den MCP-stdio-Transport bereit. Jede Tool-Antwort außer `index_status` enthält einen `_meta`-Block mit ihrer Token-Einsparung (`impact_analysis` gibt außerdem ein eigenes `_summary` der betroffenen Dateien zurück).

### Code-Navigation

| Tool | Was es tut | Wichtige Eingaben |
|---|---|---|
| `find_symbol` | Symbole nach Namen finden, mit exaktem, unscharfem oder Präfix-Abgleich | `name`, `kind`, `matchMode`, `topK` |
| `get_file_structure` | Einen hierarchischen Baum aller Symbole einer Datei abrufen | `filePath`, `includeNested` |
| `get_references` | Alle Verwendungen eines Symbols in der gesamten Codebasis finden | `symbolId`, `referenceKind`, `topK`, `cursor` |
| `get_context` | Verdichteten Code rund um eine bestimmte Stelle abrufen | `filePath`, `startLine`, `contextLines`, `mode` |

### Aufrufgraph

| Tool | Was es tut | Wichtige Eingaben |
|---|---|---|
| `get_callers` | Alle Funktionen finden, die ein gegebenes Symbol aufrufen (bis zu 3 Ebenen tief) | `symbolId`, `maxDepth`, `topK` |
| `get_callees` | Alle Funktionen finden, die von einem gegebenen Symbol aufgerufen werden (bis zu 3 Ebenen tief) | `symbolId`, `maxDepth`, `topK` |

### Analyse

| Tool | Was es tut | Wichtige Eingaben |
|---|---|---|
| `impact_analysis` | Kategorisieren, was kaputtgeht, wenn sich ein Symbol ändert (Umbenennen/Löschen/Signaturänderung) | `symbolId`, `changeType` |
| `list_dependencies` | Zeigen, was eine Datei importiert oder was aus ihr importiert | `filePath`, `direction` |
| `semantic_search` | Code anhand einer Beschreibung in natürlicher Sprache suchen | `query`, `topK`, `language`, `kind` |
| `find_pattern` | Nach einem strukturellen Muster mit benannten Captures suchen (`$NAME`, `$$$ARGS`) | `pattern`, `language`, `topK` |

### Status

| Tool | Was es tut |
|---|---|
| `index_status` | Den Zustand der Indizierung melden: Dateianzahl, Symbolanzahl, Store-Status, ausstehende Dateien, Fortschritt der anfänglichen Hintergrundindizierung |

Vollständige Ein-/Ausgabeschemata mit Beispielen finden Sie in **[docs/TOOLS.md](../TOOLS.md)**.

---

## Konfiguration

Legen Sie eine `hesman.config.json` im Stammverzeichnis Ihres Projekts an (alle Felder optional):

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

> **Symlinks werden bei der Indizierung übersprungen.** Der Projekt-Scanner und die Dateiüberwachung folgen niemals symbolischen Links (auf Dateien oder Verzeichnisse). Das verhindert Endlosschleifen (z. B. `loop -> .`), hält Code außerhalb des Projekts aus dem Index heraus und vermeidet doppelte Symbole. Um verlinkten Code zu indizieren, richten Sie `projectRoot` auf das echte Verzeichnis.

### Rangfolge der Konfiguration

Einstellungen werden in dieser Reihenfolge aufgelöst (spätere überschreiben frühere):

1. **Standardwerte** – in Hesman eingebaut
2. **`hesman.config.json`** – Konfigurationsdatei auf Projektebene
3. **Umgebungsvariablen** – z. B. `HESMAN_WORKERS=4`
4. **CLI-Flags** – z. B. `--workers 4`

### Umgebungsvariablen

| Variable | Entspricht | Beschreibung |
|---|---|---|
| `HESMAN_PROJECT_ROOT` | `--project-root` | Pfad zu dem Projekt, das indiziert werden soll |
| `HESMAN_WORKERS` | `--workers N` | Anzahl der Worker-Threads (0 = automatische Erkennung) |
| `HESMAN_LOG_LEVEL` | `--log-level` | Einer von: trace, debug, info, warn, error |
| `HESMAN_DATA_DIR` | `--data-dir` | Verzeichnis für die Indexdaten (Standard: `.hesman`) |
| `HESMAN_WATCH_MODE` | `--watch-mode` | Dateiüberwachung ein-/ausschalten (true/false) |
| `HESMAN_GRAMMARS_OFFLINE` | — | `1` oder `true`: nie eine Grammatik herunterladen (Konfigurationsschlüssel `grammars.offline`) |
| `HESMAN_CACHE_DIR` | — | Verzeichnis, das den benutzerbezogenen Grammatik-Cache enthält (`<dir>/hesman/grammars/`) |

### CLI-Flags

| Flag | Beschreibung |
|---|---|
| `--project-root <path>` | Zu indizierendes Projekt (Standard: automatisch erkannt, siehe [Wie Hesman das Projekt auswählt](#wie-hesman-das-projekt-auswählt)) |
| `--workers <N>` | Anzahl der Worker-Threads (0 = automatisch) |
| `--log-level <level>` | Log-Level |
| `--data-dir <path>` | Pfad des Datenverzeichnisses |
| `--watch-mode` | Dateiüberwachung einschalten |
| `--no-watch` | Dateiüberwachung ausschalten |
| `--no-semantic` | Semantische Suche ausschalten |
| `--batch-size <N>` | Dateien pro Indizierungs-Batch |

---

## CLI-Referenz

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

## Unterstützte Sprachen

| Sprache | Erweiterungen | Stufe | Grammatik | Was funktioniert |
|---|---|---|---|---|
| TypeScript | `.ts`, `.mts`, `.cts` | deep | mitgeliefert | Symbole, Aufrufgraph, Auswirkungsanalyse |
| TSX | `.tsx` | deep | mitgeliefert | Symbole, Aufrufgraph, Auswirkungsanalyse |
| JavaScript (und JSX) | `.js`, `.jsx`, `.mjs`, `.cjs` | deep | mitgeliefert | Symbole, Aufrufgraph, Auswirkungsanalyse |
| Python | `.py`, `.pyw`, `.pyi` | deep | mitgeliefert | Symbole, Aufrufgraph, Auswirkungsanalyse |
| Go | `.go` | deep | mitgeliefert | Symbole, Aufrufgraph, Auswirkungsanalyse |
| Java | `.java` | deep | mitgeliefert | Symbole, Aufrufgraph, Auswirkungsanalyse |
| C | `.c`, `.h` | deep | mitgeliefert | Symbole, Aufrufgraph, Auswirkungsanalyse |
| C++ | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx`, `.ipp`, `.tpp` | deep | mitgeliefert | Symbole, Aufrufgraph, Auswirkungsanalyse |
| C# | `.cs`, `.csx` | deep | mitgeliefert | Symbole, Aufrufgraph, Auswirkungsanalyse |
| Rust | `.rs` | deep | mitgeliefert | Symbole, Aufrufgraph, Auswirkungsanalyse |
| PHP | `.php`, `.phtml` | deep | mitgeliefert | Symbole, Aufrufgraph, Auswirkungsanalyse |
| Ruby | `.rb`, `.rake`, `.gemspec`, `.ru`, `.podspec` | deep | mitgeliefert | Symbole, Aufrufgraph, Auswirkungsanalyse |
| Kotlin | `.kt`, `.kts` | deep | mitgeliefert | Symbole, Aufrufgraph, Auswirkungsanalyse |
| Swift | `.swift` | deep | mitgeliefert | Symbole, Aufrufgraph, Auswirkungsanalyse |
| Bash | `.sh`, `.bash` | deep | mitgeliefert | Symbole, Aufrufgraph, Auswirkungsanalyse |
| Lua | `.lua` | deep | mitgeliefert | Symbole, Aufrufgraph, Auswirkungsanalyse |
| Scala | `.scala`, `.sc`, `.sbt` | structural | bei Bedarf | Nur Symbole (kein Aufrufgraph) |
| OCaml | `.ml` | structural | bei Bedarf | Nur Symbole (kein Aufrufgraph) |
| F# | `.fs`, `.fsx` | structural | bei Bedarf | Nur Symbole (kein Aufrufgraph) |
| R | `.r` | structural | bei Bedarf | Nur Symbole (kein Aufrufgraph) |
| CodeQL | `.ql`, `.qll` | structural | bei Bedarf | Nur Symbole (kein Aufrufgraph) |
| Arduino | `.ino` | structural | bei Bedarf | Nur Symbole (kein Aufrufgraph) |
| Alles andere | jede Textdatei | text | keine | Textabschnitte für `semantic_search`, `find_pattern` und `get_context` (keine Symbole) |

Die obige Tabelle wird aus der Sprach-Registry erzeugt (`npx tsx scripts/generate-language-matrix.ts`; ein Test schlägt fehl, wenn sie veraltet ist). Die als *mitgeliefert* gekennzeichneten Grammatiken sind im Paket enthalten und funktionieren daher offline.

**Grammatiken bei Bedarf.** Die als *bei Bedarf* gekennzeichneten Grammatiken sind nicht im Paket. Wenn ein Projekt zum ersten Mal Dateien einer solchen Sprache enthält, werden diese Dateien sofort als Text indiziert, und der Server lädt die Grammatik im Hintergrund herunter (0,3–11,4 MB pro Grammatik, von der Release-Seite des eigenen Repositorys der Grammatik auf GitHub); sobald sie da ist, werden die Dateien mit Symbolen neu indiziert. Jede Grammatik ist in der mitgelieferten `grammars.json` über URL, Größe und sha256 festgeschrieben; ein Download, der nicht übereinstimmt, wird verworfen, und die Dateien bleiben Text. Grammatiken werden pro Benutzer außerhalb des Projekts zwischengespeichert: `HESMAN_CACHE_DIR`, sonst `XDG_CACHE_HOME`, sonst `~/Library/Caches` (macOS), `%LOCALAPPDATA%` (Windows) oder `~/.cache`, jeweils unter `hesman/grammars/`.

- **Downloads abschalten:** Setzen Sie `HESMAN_GRAMMARS_OFFLINE=1` oder `"grammars": { "offline": true }` in `hesman.config.json`. Hesman stellt dann keine Netzwerkanfrage für Grammatiken; Dateien von Bei-Bedarf-Sprachen bleiben auf der Stufe text, sofern die Grammatik nicht bereits im Cache liegt.
- **Cache vorab füllen:** `hesman grammars install scala r` oder `hesman grammars install --all` (46,9 MB); auf einem Rechner ohne Netzwerkzugang kopieren Sie die `.wasm`-Dateien dorthin und führen `hesman grammars install --from <directory>` aus. `hesman grammars list` zeigt, was mitgeliefert, im Cache und verfügbar ist. Siehe [docs/CLI.md](../CLI.md#hesman-grammars).
- **Sehen, was fehlt:** `index_status` listet pro Sprache ihre Stufe (`deep`, `structural` oder `text`), die Anzahl der Dateien und ob ihre Grammatik mitgeliefert, im Cache oder nicht vorhanden ist, und warum.

`grammars.json` schreibt außerdem 18 Grammatiken fest, für die es noch keine Symbol-Query gibt (Haskell, Elixir, Zig, Julia, Perl, Objective-C, Odin, Luau, Starlark, HTML, CSS, JSON, YAML, TOML, XML, Markdown, HCL, Make). Sie lassen sich mit `hesman grammars install` installieren, aber Hesman verwendet sie noch nicht: Dateien dieser Sprachen werden als Text indiziert, und ihre Grammatik wird nie automatisch heruntergeladen.

Was die Stufen heute bedeuten:

- **deep** – Definitionen (Funktionen, Klassen, Methoden, Konstanten, ...) plus `calls`-Relationen, sodass `get_callers`, `get_callees`, `get_references` und `impact_analysis` einen Aufrufgraphen haben. Aufrufe werden aus dem Syntaxbaum der jeweiligen Sprache gelesen (ihre Aufrufausdrücke, `new X(...)`, Ruby- und Bash-Aufrufe ohne Klammern) und über den Namen verknüpft: zuerst die eigene Datei des Aufrufers, dann die Dateien, die er importiert, sein Verzeichnis und das Projekt; ein Name, der mehrdeutig bleibt, wird nicht verknüpft, statt mit jedem Kandidaten verknüpft zu werden. Ein Aufruf wird mit einer Definition verknüpft und nicht mit einer Deklaration ohne Rumpf (ein C/C++-Prototyp, eine Interface- oder abstrakte Methode), und `new X(...)` mit der Klasse `X` und nicht mit einem ihrer Konstruktoren. Typen werden nicht aufgelöst; daher bleibt eine Methode, die auf einem Interface mit mehreren Implementierungen aufgerufen wird, unverknüpft, und eine Ruby-Methode, die ohne Argumente und ohne Klammern aufgerufen wird, wird nicht als Aufruf erkannt. Import-Relationen gibt es für TypeScript/JavaScript, Python, Go, C/C++ (`#include "..."`) und Ruby (`require`, `require_relative`); `extends`- / `implements`-Relationen nur dort, wo eine Sprache `class X extends Y` oder `class X implements Y` schreibt.
- **structural** – nur Definitionen. Keine mitgelieferte Sprache liegt mehr auf dieser Stufe. Die Bei-Bedarf-Sprachen sind structural, weil nur ihre Upstream-Symbol-Query verwendet wird: Für sie gibt es keine Sichtbarkeitsregel (jede Definition gilt als exportiert) und keine Extraktion von Aufrufen.
- **text** – keine Symbole; siehe „Text tier“ in [docs/TOOLS.md](../TOOLS.md).

Ein Agent muss diese Tabelle nicht kennen: Wenn `get_callers`, `get_callees`, `get_references` oder `impact_analysis` nach einem Symbol einer Sprache ohne Aufrufgraph gefragt wird, trägt die Antwort neben der leeren Liste eine `note` wie `call graph not available for r (symbols only)`, damit eine leere Antwort nicht als „nichts verwendet das“ missverstanden wird.

Die Symbolarten folgen der eigenen Tags-Query der jeweiligen Grammatik, daher sind einige gröber als die Sprache: PHP- und Kotlin-Methoden sind `function`, Rust- und Swift-Enums sowie Kotlin-Interfaces sind `class`, Rust-Typaliase sind `class`. Um eine Sprache hinzuzufügen, braucht es eine Grammatik, eine Tags-Query, ein kleines Profil und einen Eintrag in der Sprach-Registry (`src/parsers/languages.ts`) – eine Schritt-für-Schritt-Anleitung finden Sie im [Leitfaden für Mitwirkende](../CONTRIBUTING.md).

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

**Zentrale Datenpipeline:** Dateiänderungen (chokidar) → Tree-sitter-Parsing (AST + Symbole) → SQLite-Index + ZVec-Embeddings → komprimierte MCP-Antworten

**Zentrale Designentscheidungen:**
- **Keine LSP-Abhängigkeit** – Tree-sitter bietet sprachunabhängiges Parsen, ohne Language Server zu betreiben
- **Inkrementelle Indizierung per Inhalts-Hash** – Dateien werden nur dann neu geparst, wenn sich der SHA-256 ändert
- **Komprimierung auf Antwortebene** – die Originaldaten bleiben unangetastet; komprimiert wird an der Antwortgrenze
- **Eine einzige SQLite-Datenbank pro Projekt** – selbst in Monorepos teilen sich alle Pakete einen Store mit Isolation über `file_path`

Das vollständige Architekturdokument mit Modulabhängigkeiten, Store-Schemata und dem Design des Worker-Pools finden Sie in **[docs/ARCHITECTURE.md](../ARCHITECTURE.md)**.

---

## Entwicklungsumgebung

### Voraussetzungen

- **Node.js** ≥ 20.0.0
- **npm** ≥ 10

### Erste Schritte

```bash
# Klonen und installieren
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install

# Tree-sitter-WASM-Parser herunterladen
npm run download:parsers

# Im Entwicklungsmodus ausführen (Hot Reload)
npm run dev

# Für die Produktion bauen
npm run build
```

### Codequalität

```bash
npm run typecheck    # TypeScript-Typprüfung
npm run lint         # ESLint
npm run format       # Formatierung mit Prettier
```

### Tests ausführen

```bash
npm test                  # Alle Tests ausführen (Unit + Integration)
npm run test:watch        # Watch-Modus für die Entwicklung
npm run test:e2e          # End-to-End-Tests (starten den vollständigen Server)
npm run test:perf         # Performance-Benchmarks
```

### Performance-Ziele

| Benchmark | Ziel |
|---|---|
| Indizierungsdurchsatz | ≥ 500 Dateien/s |
| `find_symbol` (exakt) | < 1 ms |
| `find_symbol` (unscharf) | < 5 ms |
| `semantic_search` | < 10 ms |
| `get_references` | < 5 ms |
| Speicher (nach der Indizierung) | < 350 MB |

Den vollständigen Leitfaden für Mitwirkende, einschließlich des Hinzufügens neuer Sprachen, finden Sie in **[docs/CONTRIBUTING.md](../CONTRIBUTING.md)**.

---

## Anforderungen

| Ressource | Minimum |
|---|---|
| **Node.js** | ≥ 20.0.0 |
| **Arbeitsspeicher (Leerlauf)** | ~100 MB |
| **Arbeitsspeicher (unter Last)** | ~350 MB |
| **Festplatte** | ~30 MB für das Paket (mitgelieferte Grammatiken), ~80 MB für das Embedding-Modell (einmaliger Download), bis zu 47 MB für Bei-Bedarf-Grammatiken, wenn alle installiert sind, dazu der Index in `.hesman/` |
| **Netzwerk** | Für die Installation, für das Embedding-Modell bei der ersten Verwendung und für die Grammatik einer Bei-Bedarf-Sprache, wenn ein Projekt sie zum ersten Mal enthält. Sonst keines; weder Code noch Abfragen werden jemals irgendwohin gesendet |

Das Embedding-Modell (`all-MiniLM-L6-v2`) wird bei der ersten Verwendung heruntergeladen und unbegrenzt im Cache-Verzeichnis von Transformers.js zwischengespeichert.

---

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [README.md](../../README.md) | Projektüberblick, Einrichtung und Konfiguration (diese Datei) |
| [docs/ARCHITECTURE.md](../ARCHITECTURE.md) | Vollständige Architektur: Datenfluss, Modulübersicht, Store-Schemata, Design des Worker-Pools |
| [docs/CLI.md](../CLI.md) | Jeder Unterbefehl: `setup`, `remove`, `doctor`, `ui`, `grammars`, mit Optionen und Ausgabe |
| [docs/TOOLS.md](../TOOLS.md) | Vollständige Ein-/Ausgabeschemata aller 11 Tools mit Beispielen |
| [docs/CONTRIBUTING.md](../CONTRIBUTING.md) | Entwicklungsumgebung, Testanleitung, Erstellen von Sprachprofilen, PR-Checkliste |
| [docs/SECURITY.md](../SECURITY.md) | Bedrohungsmodell, Schutzprüfungen für Tool-Eingaben, wie man eine Schwachstelle meldet |
| [CHANGELOG.md](../../CHANGELOG.md) | Versionsgeschichte und Änderungen |

---

## Lizenz

[MIT](../../LICENSE) – Copyright (c) 2026 Minh Do

Die MIT-Lizenz gilt für den Code, der für Hesman geschrieben wurde. Software von Dritten behält ihre eigene Lizenz:

- **Im Paket enthalten:** die Tree-sitter-Grammatiken und Query-Dateien, alle unter MIT; jede ist mit Repository, Revision und Copyright in [NOTICE](../../NOTICE) aufgeführt.
- **Von npm als Abhängigkeiten installiert:** alle unter permissiven Lizenzen (MIT, ISC, BSD, Apache-2.0); die vollständige Liste steht in [THIRD-PARTY-LICENSES.md](../../THIRD-PARTY-LICENSES.md). Die Embedding-Bibliothek `@xenova/transformers` und der Vektor-Store `@zvec/zvec` stehen unter Apache-2.0.
- **Zur Laufzeit heruntergeladen:** das Embedding-Modell `Xenova/all-MiniLM-L6-v2` (Apache-2.0) und Bei-Bedarf-Grammatiken (MIT, außer Elixir und HCL: Apache-2.0); siehe [NOTICE](../../NOTICE). Die Abhängigkeit `sharp` der Embedding-Bibliothek installiert ein vorgefertigtes libvips (LGPL-3.0-or-later) als separate Shared Library.
