# Hesman MCP Server

[![CI](https://github.com/do-minh/hesman-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/do-minh/hesman-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/hesman-mcp.svg)](https://www.npmjs.com/package/hesman-mcp)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

🌐 **Lire ce document en :** [English](../../README.md) | [Tiếng Việt](./README.vi.md) | [Русский](./README.ru.md) | [Deutsch](./README.de.md) | **Français** | [中文](./README.zh.md) | [日本語](./README.ja.md) | [العربية](./README.ar.md) | [Español](./README.es.md) | [Português](./README.pt.md)

**Hesman** est un serveur MCP (Model Context Protocol) de nouvelle generation qui offre aux agents IA de codage une comprehension approfondie de votre codebase — symboles, graphes d'appels, dependances et recherche semantique — avec un pipeline de compression en 3 couches qui reduit considerablement la consommation de tokens (jusqu'a 98 % dans les meilleurs cas). Tout s'execute localement. Aucune API externe. Aucun serveur LSP.

---

## Table des matieres

- [Pourquoi Hesman ?](#pourquoi-hesman)
- [Demarrage rapide](#demarrage-rapide)
- [Fonctionnalites](#fonctionnalites)
- [Comment fonctionne la reduction de tokens](#comment-fonctionne-la-reduction-de-tokens)
- [Installation et configuration](#installation-et-configuration)
- [Reference des outils](#reference-des-outils)
- [Configuration](#configuration)
- [Reference CLI](#reference-cli)
- [Langages pris en charge](#langages-pris-en-charge)
- [Architecture](#architecture)
- [Configuration de developpement](#configuration-de-developpement)
- [Prerequis](#prerequis)
- [Documentation](#documentation)
- [Licence](#licence)

---

## Pourquoi Hesman ?

Les agents IA de codage sont puissants mais couteux. Chaque ligne de code qu'ils lisent consomme des tokens. Envoyer un fichier entier alors que l'agent n'a besoin que d'une seule fonction gaspille du contexte et de l'argent.

Hesman resout ce probleme en :

- **Servant uniquement ce dont l'agent a besoin** — une fonction ciblee, ses appelants, ses appelés, ou les symboles impactes par un changement.
- **Comprimant chaque reponse** — un pipeline en 3 couches supprime les commentaires, elague le code non pertinent et resume les grands ensembles de resultats.
- **Remplacant les vidages bruts par des resumes** — au lieu de 200 references dans un tableau JSON, l'agent recoit un bloc `_summary` avec des comptes groupes par type et par fichier.
- **Fonctionnant 100 % en local** — pas de cles API, pas d'appels reseau, pas de latence due a des services externes. Votre code ne quitte jamais votre machine.
- **Des economies mesurables** — chaque reponse inclut `_meta.reduction` indiquant exactement combien de tokens ont ete economies par rapport a la sortie brute.

Le resultat : les agents travaillent plus vite, coutent moins cher et raisonnent plus precisement car ils voient le bon code, pas tout le code.

---

## Demarrage rapide

```bash
# 1. Installation globale
npm install -g hesman-mcp

# 2. Lancer le serveur dans votre projet
cd my-project
hesman

# 3. Enregistrer aupres de votre agent IA (Claude Desktop, Cursor, VS Code)
hesman install --agent claude
```

Voila. Une fois l'indexation initiale terminee (quelques secondes pour la plupart des projets), votre agent IA peut interroger votre codebase via les 11 outils de Hesman.

---

## Fonctionnalites

### Intelligence du code

| Capacite | Description |
|---|---|
| **Recherche de symboles** | Trouver fonctions, classes, methodes par nom — correspondance exacte, floue ou par prefixe (< 1 ms) |
| **Parcours de graphe d'appels** | Parcourir les appelants et appelés jusqu'a 3 niveaux de profondeur |
| **Suivi de references** | Trouver chaque utilisation d'un symbole dans l'ensemble du codebase |
| **Analyse d'impact** | Voir ce qui casse si vous renommez, supprimez ou modifiez la signature d'un symbole |
| **Recherche semantique** | Decrivez ce que vous cherchez en langage naturel et trouvez le code correspondant |
| **Recherche structurelle** | Trouver des motifs de code comme `console.$METHOD($$$ARGS)` avec des captures nommees |
| **Analyse de dependances** | Voir ce qu'un fichier importe et ce qui l'importe |
| **Fenetres de contexte** | Obtenir un code concentre et compacte autour de n'importe quel emplacement dans un fichier |

### Pipeline de reduction de tokens

Le pipeline de compression en 3 couches de Hesman reduit l'utilisation de tokens a chaque reponse. Les economies reelles sont mesurees et rapportees via `_meta.reduction` dans chaque reponse.

| Couche | Technique | Economies typiques | Meilleur cas |
|---|---|---|---|
| **Mode compact** | Supprime commentaires, lignes vides, espaces de fin ; retire les imports inutilises | 20–35 % | ~50 % (code fortement commente) |
| **Elagage de contexte** | Conserve uniquement les lignes pertinentes pour le symbole interroge ; remplace le code omis par des marqueurs de comptage | 50–80 % (en plus du compact) | ~95 % (grands fichiers avec petite zone d'interet) |
| **Resume intelligent** | Remplace les grands tableaux de resultats par des blocs `_summary` agreges ; compresse les chaines d'appels en statistiques groupees | 70–90 % (outils de liste) | ~98 % (200+ references → resume) |

**Meilleur cas combine :** Un fichier de 430 lignes interroge via `get_context` pour une seule fonction → elague a ~6 lignes pertinentes + mode compact → **jusqu'a 98 % de reduction**. C'est le scenario ideal ; l'utilisation typique sur tous les outils offre une reduction moyenne de 40–70 %.

### Pret pour la production

- **Pool de workers** — indexation parallele sur les cœurs CPU, dimensionne automatiquement par defaut
- **Surveillance de fichiers** — reindexation incrementielle lors des modifications de fichiers via chokidar
- **Arret gracieux** — vide le travail actif, vide les stocks, termine les workers proprement
- **Indexation par empreinte de contenu** — les fichiers sont re-analyses uniquement lorsque leur contenu change reellement
- **Support des monorepos** — detection automatique des workspaces pnpm, lerna, nx, turbo et npm
- **Diagnostics** — `hesman diag` affiche la memoire, les statistiques des stocks, l'etat du pool et les metriques du cache
- **Teste en CI** — fonctionne sur Ubuntu, macOS et Windows avec Node 20 et 22

---

## Comment fonctionne la reduction de tokens

### Couche 1 : Mode compact

Supprime les commentaires, les lignes vides et les espaces de fin tout en preservant les commentaires magiques (`// @ts-ignore`, `// eslint-disable-*`). Le niveau 2 ajoute la gestion des JSDoc via AST et la suppression des imports inutilises.

Avant :
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

Apres (Niveau 1) :
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

Apres (Niveau 2 — base sur l'AST, preserve uniquement la JSDoc) :
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

### Couche 2 : Elagage de contexte

Lorsqu'un agent interroge `get_context` pour un symbole specifique, Hesman ne retourne que le code pertinent :

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

L'elagage conserve : la definition du symbole cible, son commentaire de documentation, les appelants et appelés directs dans le meme fichier, et les references internes au fichier — tout le reste est remplace par un marqueur de comptage.

### Couche 3 : Resume intelligent

Au lieu de vider 200 references dans un tableau JSON :

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

L'agent peut ensuite demander les details pour des fichiers ou types specifiques — pagines via `cursor`.

### Mesure des economies

Chaque reponse de Hesman inclut un bloc `_meta` avec les economies reelles de tokens :

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

Cela vous permet d'auditer exactement combien Hesman vous fait economiser dans vos charges de travail reelles.

---

## Installation et configuration

### Prerequis

- **Node.js** >= 20.0.0
- **npm** (ou pnpm / yarn)

### Installation depuis npm

```bash
npm install -g hesman-mcp
```

### Installation depuis les sources

```bash
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install
npm run download:parsers   # Telecharger les analyseurs WASM Tree-sitter
npm run build              # Compiler TypeScript
npm link                   # Rendre `hesman` disponible globalement
```

### Enregistrement aupres des agents IA

```bash
# Claude Desktop (detecte automatiquement le chemin de configuration selon la plateforme)
hesman install --agent claude

# Cursor
hesman install --agent cursor

# VS Code (avec Copilot ou Cline)
hesman install --agent vscode

# Utilisez --global pour ecrire dans la configuration utilisateur au lieu de celle du projet
hesman install --agent claude --global
```

Apres l'installation, redemarrez votre agent IA et Hesman sera disponible en tant que serveur MCP.

### Configuration manuelle de MCP

Ajoutez ceci au fichier de configuration MCP de votre agent :

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

## Reference des outils

Hesman expose **11 outils** via le transport stdio MCP. Chaque reponse inclut un bloc `_meta` avec les economies de tokens et, le cas echeant, un bloc `_summary` aggregant les resultats.

### Navigation dans le code

| Outil | Description | Entrees principales |
|---|---|---|
| `find_symbol` | Trouver des symboles par nom avec correspondance exacte, floue ou par prefixe | `name`, `kind`, `matchMode`, `topK` |
| `get_file_structure` | Obtenir un arbre hierarchique de tous les symboles dans un fichier | `filePath`, `includeNested` |
| `get_references` | Trouver toutes les utilisations d'un symbole dans le codebase | `symbolId`, `referenceKind`, `topK`, `cursor` |
| `get_context` | Obtenir le code compacte autour d'un emplacement specifique | `filePath`, `startLine`, `contextLines`, `mode` |

### Graphe d'appels

| Outil | Description | Entrees principales |
|---|---|---|
| `get_callers` | Trouver toutes les fonctions qui appellent un symbole donne (jusqu'a 3 niveaux de profondeur) | `symbolId`, `maxDepth`, `topK` |
| `get_callees` | Trouver toutes les fonctions appelees par un symbole donne (jusqu'a 3 niveaux de profondeur) | `symbolId`, `maxDepth`, `topK` |

### Analyse

| Outil | Description | Entrees principales |
|---|---|---|
| `impact_analysis` | Categoriser ce qui casse si un symbole change (rename/suppression/changement de signature) | `symbolId`, `changeType` |
| `list_dependencies` | Afficher ce qu'un fichier importe, ou ce qui l'importe | `filePath`, `direction` |
| `semantic_search` | Rechercher du code par description en langage naturel | `query`, `topK`, `language`, `kind` |
| `find_pattern` | Rechercher par motif structurel avec des captures nommees (`$NAME`, `$$$ARGS`) | `pattern`, `language`, `topK` |

### Statut

| Outil | Description |
|---|---|
| `index_status` | Rapporter l'etat de l'indexation : nombre de fichiers, nombre de symboles, etat du stock, fichiers en attente |

Pour les schemas complets d'entree/sortie avec des exemples, consultez **[docs/TOOLS.md](./docs/TOOLS.md)**.

---

## Configuration

Creez un fichier `hesman.config.json` a la racine de votre projet (tous les champs sont facultatifs) :

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

### Priorite de configuration

Les parametres sont resolus dans cet ordre (le dernier remplace le precedent) :

1. **Valeurs par defaut** — integrees dans Hesman
2. **`hesman.config.json`** — fichier de configuration au niveau du projet
3. **Variables d'environnement** — p. ex. `HESMAN_WORKERS=4`
4. **Indicateurs CLI** — p. ex. `--workers 4`

### Variables d'environnement

| Variable | Equivalent | Description |
|---|---|---|
| `HESMAN_PROJECT_ROOT` | `--project-root` | Chemin vers le projet a indexer |
| `HESMAN_WORKERS` | `--workers N` | Nombre de threads workers (0 = detection automatique) |
| `HESMAN_LOG_LEVEL` | `--log-level` | Une valeur parmi : trace, debug, info, warn, error |
| `HESMAN_DATA_DIR` | `--data-dir` | Repertoire pour les donnees d'index (defaut : `.hesman`) |
| `HESMAN_WATCH_MODE` | `--watch-mode` | Activer/desactiver la surveillance des fichiers (true/false) |

### Indicateurs CLI

| Indicateur | Description |
|---|---|
| `--project-root <path>` | Repertoire racine du projet |
| `--workers <N>` | Nombre de threads workers (0 = automatique) |
| `--log-level <level>` | Niveau de journalisation |
| `--data-dir <path>` | Chemin du repertoire de donnees |
| `--watch-mode` | Activer la surveillance des fichiers |
| `--no-watch` | Desactiver la surveillance des fichiers |
| `--no-semantic` | Desactiver la recherche semantique |
| `--batch-size <N>` | Fichiers par lot d'indexation |

---

## Reference CLI

```
hesman                         Lancer le serveur MCP sur stdio (par defaut)
hesman index [path]            Indexer un projet sans demarrer le serveur
hesman status [path]           Afficher la progression et les statistiques d'indexation
hesman clean [path]            Supprimer le repertoire de donnees .hesman/
hesman clean --force           Ignorer la demande de confirmation
hesman clean --dry-run         Previsualiser ce qui serait supprime sans le faire
hesman diag [path]             Afficher les diagnostics : memoire, statistiques des stocks, pool, cache
hesman diag --json             Afficher les diagnostics au format JSON
hesman install --agent <name>  Ecrire la configuration MCP pour Claude Desktop, Cursor ou VS Code
hesman install --global        Ecrire dans la configuration utilisateur au lieu de celle du projet
hesman --version, -v           Afficher le numero de version
hesman --help, -h              Afficher le texte d'aide
```

---

## Langages pris en charge

| Langage | Extensions | Statut |
|---|---|---|
| TypeScript / JavaScript | `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts`, `.cts` | Support complet |
| Python | `.py`, `.pyw`, `.pyi` | Support complet |
| Go | `.go` | Support complet |

L'architecture prend en charge jusqu'a **158 langages** via Tree-sitter. Ajouter un nouveau langage necessite l'implementation d'un `LanguageProfile` — consultez le [Guide de contribution](./docs/CONTRIBUTING.md) pour des instructions etape par etape.

---

## Architecture

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

**Pipeline de donnees principal :** Modifications de fichiers (chokidar) → Analyse Tree-sitter (AST + symboles) → Index SQLite + embeddings ZVec → Reponses MCP compressees

**Decisions de conception cles :**
- **Aucune dependance LSP** — Tree-sitter fournit une analyse independante du langage sans executer de serveurs de langage
- **Indexation incrementielle par empreinte de contenu** — les fichiers sont re-analyses uniquement lorsque le SHA-256 change
- **Compression au niveau des reponses** — les donnees originales restent intactes ; la compression est appliquee a la limite de la reponse
- **Base de donnees SQLite unique par projet** — meme dans les monorepos, tous les packages partagent un stock avec isolation par `file_path`

Pour le document d'architecture complet incluant les dependances des modules, les schemas des stocks et la conception du pool de workers, consultez **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)**.

---

## Configuration de developpement

### Prerequis

- **Node.js** >= 20.0.0
- **npm** >= 10

### Pour commencer

```bash
# Cloner et installer
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install

# Telecharger les analyseurs WASM Tree-sitter
npm run download:parsers

# Lancer en mode developpement (rechargement a chaud)
npm run dev

# Compiler pour la production
npm run build
```

### Qualite du code

```bash
npm run typecheck    # Verification des types TypeScript
npm run lint         # ESLint
npm run format       # Formatage Prettier
```

### Execution des tests

```bash
npm test                  # Lancer tous les tests (unitaire + integration)
npm run test:watch        # Mode surveillance pour le developpement
npm run test:e2e          # Tests de bout en bout (demarre le serveur complet)
npm run test:perf         # Benchmarks de performance
```

### Objectifs de performance

| Benchmark | Objectif |
|---|---|
| Debit d'indexation | >= 500 fichiers/s |
| `find_symbol` (exact) | < 1 ms |
| `find_symbol` (flou) | < 5 ms |
| `semantic_search` | < 10 ms |
| `get_references` | < 5 ms |
| Memoire (apres indexation) | < 350 Mo |

Pour le guide de contribution complet incluant comment ajouter de nouveaux langages, consultez **[docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md)**.

---

## Prerequis

| Ressource | Minimum |
|---|---|
| **Node.js** | >= 20.0.0 |
| **Memoire (au repos)** | ~100 Mo |
| **Memoire (en charge)** | ~350 Mo |
| **Disque** | ~80 Mo (telechargement unique du modele d'embedding) |
| **Reseau** | Uniquement pour le `npm install` initial ; zero appel reseau a l'execution |

Le modele d'embedding (`all-MiniLM-L6-v2`) est telecharge lors de la premiere utilisation et mis en cache indefiniment dans le repertoire de cache de Transformers.js.

---

## Documentation

| Document | Contenu |
|---|---|
| [README.md](../../README.md) | Apercu du projet, installation et configuration (ce fichier) |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Architecture complete : flux de donnees, plan des modules, schemas des stocks, conception du pool de workers |
| [docs/TOOLS.md](./docs/TOOLS.md) | Schemas complets d'entree/sortie pour les 11 outils avec exemples |
| [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) | Configuration de developpement, guide de test, creation de profils de langage, liste de verification PR |
| [CHANGELOG.md](./CHANGELOG.md) | Historique des versions et modifications |

---

## Licence

[MIT](./LICENSE) — Copyright (c) 2026 Minh Do
