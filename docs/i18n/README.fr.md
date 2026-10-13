# Hesman MCP Server

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

🌐 **Lire ce document en :** [English](../../README.md) | [Tiếng Việt](./README.vi.md) | [Русский](./README.ru.md) | [Deutsch](./README.de.md) | **Français** | [中文](./README.zh.md) | [日本語](./README.ja.md) | [العربية](./README.ar.md) | [Español](./README.es.md) | [Português](./README.pt.md)

**Hesman** est un serveur MCP (Model Context Protocol) de nouvelle génération qui donne aux agents de codage IA une compréhension approfondie de votre base de code — symboles, graphes d'appels, dépendances et recherche sémantique — avec des lectures de code ciblées qui réduisent la consommation de tokens (`get_context` renvoie environ 90 % de tokens en moins que le fichier entier lorsque vous demandez le voisinage d'une seule fonction). Tout s'exécute en local. Aucune API externe. Aucun serveur LSP.

---

## Table des matières

- [Pourquoi Hesman ?](#pourquoi-hesman-)
- [Démarrage rapide](#démarrage-rapide)
- [Fonctionnalités](#fonctionnalités)
- [Comment fonctionne la réduction de tokens](#comment-fonctionne-la-réduction-de-tokens)
- [Installation et configuration](#installation-et-configuration)
- [Référence des outils](#référence-des-outils)
- [Configuration](#configuration)
- [Référence CLI](#référence-cli)
- [Langages pris en charge](#langages-pris-en-charge)
- [Architecture](#architecture)
- [Environnement de développement](#environnement-de-développement)
- [Configuration requise](#configuration-requise)
- [Documentation](#documentation)
- [Licence](#licence)

---

## Pourquoi Hesman ?

Les agents de codage IA sont puissants mais coûteux. Chaque ligne de code qu'ils lisent coûte des tokens. Envoyer un fichier entier alors que l'agent n'a besoin que d'une seule fonction gaspille du contexte et de l'argent.

Hesman résout ce problème :

- **En ne servant que ce dont l'agent a besoin** — une fonction ciblée, ses appelants, ses appelés, ou les symboles touchés par une modification.
- **En compactant et en élaguant le code** — `get_context` supprime les commentaires et les lignes vides et ne renvoie que les lignes autour de l'emplacement ciblé au lieu du fichier entier.
- **En ne gonflant jamais les réponses** — une réponse n'est jamais plus volumineuse que sa charge utile brute. Les résumés pour les longues listes de résultats sont prévus mais pas encore appliqués (voir [Pipeline de réduction de tokens](#pipeline-de-réduction-de-tokens)).
- **En s'exécutant sur votre machine** — pas de clés d'API, pas de service externe, donc aucune latence de ce côté. Votre code ne quitte jamais votre machine. Les seuls téléchargements sont le modèle d'embedding à la première utilisation et les grammaires des langages à la demande ; les deux peuvent être désactivés (`--no-semantic`, `HESMAN_GRAMMARS_OFFLINE=1`).
- **Avec des économies mesurables** — chaque réponse d'outil, sauf celle de `index_status`, inclut `_meta.reduction`, qui indique exactement combien de tokens ont été économisés par rapport à la sortie brute.

Résultat : les agents travaillent plus vite, coûtent moins cher et raisonnent plus justement, parce qu'ils voient le bon code et non tout le code.

---

## Démarrage rapide

`hesman-mcp` n'est pas encore dans le registre npm ; aujourd'hui, Hesman s'installe donc depuis les sources :

```bash
# 1. Récupérer et compiler Hesman (Node.js ≥ 20)
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install
npm run download:parsers
npm run build

# 2. L'enregistrer auprès de vos clients IA (détecte Claude Code, Cursor, VS Code, Codex, …)
node dist/index.js setup
```

Redémarrez le client et ouvrez un projet. `setup` écrit la commande de lancement adaptée à la façon dont Hesman est installé (ici : des chemins absolus vers `node` et `dist/index.js`, donc rien n'a besoin d'être dans le PATH) ; voir [Commande de lancement](#commande-de-lancement).

Une fois le paquet publié, tout le démarrage rapide tiendra en une ligne :

```bash
npx -y hesman-mcp setup   # uniquement une fois hesman-mcp publié sur npm
```

Le serveur répond immédiatement à votre agent et indexe en arrière-plan (quelques secondes pour la plupart des projets) : les 11 outils fonctionnent tout de suite, signalent leurs résultats avec `_meta.indexing` tant que l'index est incomplet, et `index_status` indique la progression.

---

## Fonctionnalités

### Intelligence du code

| Capacité | Description |
|---|---|
| **Recherche de symboles** | Trouver des fonctions, classes et méthodes par nom — correspondance exacte, approximative ou par préfixe (< 1 ms) |
| **Parcours du graphe d'appels** | Remonter les appelants et descendre les appelés jusqu'à 3 niveaux de profondeur |
| **Suivi des références** | Trouver chaque utilisation d'un symbole dans toute la base de code |
| **Analyse d'impact** | Voir ce qui casse si vous renommez ou supprimez un symbole, ou si vous modifiez sa signature |
| **Recherche sémantique** | Décrire ce que vous cherchez en langage naturel et trouver le code correspondant |
| **Recherche structurelle** | Trouver des motifs de code comme `console.$METHOD($$$ARGS)` avec des captures nommées |
| **Analyse des dépendances** | Voir ce qu'un fichier importe et ce qui l'importe |
| **Fenêtres de contexte** | Obtenir un code ciblé et compacté autour de n'importe quel emplacement d'un fichier |

### Pipeline de réduction de tokens

Hesman conçoit son pipeline de compression en 3 couches ; aujourd'hui, les économies viennent du mode compact et de l'élagage de contexte dans `get_context`. Chaque réponse indique ses économies réelles dans `_meta.reduction`, et une réponse n'est jamais plus volumineuse que sa charge utile brute.

| Couche | Technique | Économies mesurées | État |
|---|---|---|---|
| **Mode compact** | Supprime les commentaires, les lignes vides et les espaces en fin de ligne | ~14–16 % d'un extrait de code (`get_context`, `mode: "full"` comparé à `"compact"`) | Appliqué dans `get_context` |
| **Élagage de contexte** | Extraction d'une plage de lignes autour de l'emplacement ciblé + mode compact | 89,9 % avec les ±5 lignes par défaut, 29,9 % avec ±40 lignes (fichier de 195 lignes) ; 0 % lorsque le fichier entier est demandé | Appliqué dans `get_context` |
| **Résumé intelligent** | Blocs `_summary` agrégés pour les longues listes de résultats | 0 % — un `_summary` ne faisait qu'alourdir la réponse, il est donc supprimé | Pas encore appliqué ([backlog](../../tasks/STATUS.md)) |

Les outils de liste et de graphe d'appels (`get_references`, `get_callers`, `get_callees`, `list_dependencies`, `get_file_structure`) renvoient actuellement leur charge utile brute avec `_meta.reduction: "0.0%"` et `_meta.compressed: false`. Mesures effectuées sur le répertoire `src/` de ce dépôt et sur `tests/fixtures/polyglot-basic`. Le champ `_meta.reduction` de chaque réponse indique les économies exactes pour votre charge de travail.

### Prêt pour la production

- **Pool de workers** — indexation parallèle sur les cœurs du processeur, dimensionné automatiquement par défaut
- **Surveillance des fichiers** — réindexation incrémentale lors des modifications de fichiers, via chokidar
- **Arrêt propre** — termine le travail en cours, vide les stores sur disque et arrête proprement les workers
- **Indexation par hash de contenu** — les fichiers ne sont réanalysés que lorsque leur contenu change réellement
- **Prise en charge des monorepos** — détecte automatiquement les workspaces pnpm, lerna, nx, turbo et npm
- **Diagnostics** — `hesman diag` affiche la mémoire, les statistiques des stores, l'état du pool et les métriques du cache
- **Testé en local** — la suite de tests complète, y compris les tests de bout en bout à travers le vrai serveur, tourne sous macOS ; Linux et Windows ne sont pas encore vérifiés

---

## Comment fonctionne la réduction de tokens

### Couche 1 : mode compact

Supprime les commentaires, les lignes vides et les espaces en fin de ligne tout en préservant les commentaires magiques (`// @ts-ignore`, `// eslint-disable-*`).

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

Après :
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

### Couche 2 : élagage de contexte

`get_context` ne renvoie pas le fichier entier. Il renvoie la plage de lignes demandée plus `contextLines` lignes au-dessus et en dessous (5 par défaut, 200 au maximum), puis applique le mode compact à cet extrait. `_meta.reduction` compare le résultat au fichier entier, et `_meta.layers` liste ce qui a été appliqué (`compact`, `prune`).

L'élagage se fait uniquement par plage de lignes : il ne suit ni les appelants ni les appelés. Pour lire ce qu'une fonction appelle ou ce qui l'appelle, demandez les emplacements à `get_callees` / `get_callers`, puis `get_context` pour chacun.

### Couche 3 : résumé intelligent (pas encore appliqué)

L'objectif est de remplacer les longues listes de résultats par un `_summary` agrégé (décomptes par type et par fichier) accompagné des premières entrées. L'implémentation actuelle se contentait d'*ajouter* un `_summary` à côté de la liste complète, ce qui alourdissait les réponses ; Hesman le supprime donc et renvoie la charge utile brute : les outils de liste et de graphe d'appels indiquent aujourd'hui `_meta.reduction: "0.0%"`. Faire en sorte que les résumés économisent réellement des tokens est suivi dans le backlog ([`tasks/STATUS.md`](../../tasks/STATUS.md)). Les longues listes peuvent déjà être récupérées page par page via `topK` et `cursor` (`get_references`).

### Mesurer les économies

Chaque réponse de Hesman inclut un bloc `_meta` avec les économies réelles de tokens :

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

Cet exemple est un véritable appel à `get_context` (±5 lignes par défaut, mode compact) sur un fichier de 195 lignes : l'extrait est déjà compacté par l'outil, donc seule la couche `prune` est listée, et `compressed: false` signifie que le compresseur de réponses n'avait plus rien à retirer. Le champ `_meta.reduction` se mesure par rapport au nombre de tokens du fichier complet d'origine, ce qui vous donne les économies réelles de bout en bout. Les réponses qui ne rétréciraient pas sont renvoyées telles quelles avec `reduction: "0.0%"` ; la valeur n'est jamais négative. Vérifiez exactement combien Hesman économise sur vos charges de travail réelles en consultant `_meta.reduction` dans n'importe quelle réponse d'outil.

---

## Installation et configuration

### Prérequis

- **Node.js** ≥ 20.0.0
- **npm** (ou pnpm / yarn)

### Installation depuis les sources

C'est la méthode qui fonctionne aujourd'hui.

```bash
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install
npm run download:parsers   # Télécharger les parsers WASM Tree-sitter
npm run build              # Compiler le TypeScript
npm link                   # Facultatif : rendre `hesman` disponible dans le PATH
```

Sans `npm link`, utilisez `node /path/to/hesman-mcp/dist/index.js` partout où ce README écrit `hesman`.

### Installation depuis npm (une fois le paquet publié)

`hesman-mcp` n'est pas encore dans le registre npm. Quand il y sera :

```bash
npx -y hesman-mcp setup     # sans installation : les clients lancent Hesman via npx
npm install -g hesman-mcp   # ou une installation globale qui place `hesman` dans le PATH
```

### Enregistrement auprès des agents IA

```bash
hesman setup                         # liste à cocher des clients trouvés sur cette machine
hesman setup --yes                   # sans question : configure chaque client détecté
hesman setup --client cursor vscode  # configure des clients précis
hesman setup --dry-run --all         # affiche le changement exact par client, n'écrit rien
hesman remove                        # annuler : retire Hesman de tous les clients
```

| Client | `--client` | Ce que `hesman setup` modifie (portée utilisateur) | `--scope project` |
|---|---|---|---|
| Claude Code | `claude-code` | exécute `claude mcp add --scope user hesman -- <launch command>` ; sans la CLI, modifie `~/.claude.json` | `.mcp.json` |
| Claude Desktop | `claude-desktop` | `claude_desktop_config.json` | — |
| OpenAI Codex CLI | `codex` | exécute `codex mcp add hesman -- <launch command>` ; sans la CLI, modifie `~/.codex/config.toml` | `.codex/config.toml` |
| Cursor | `cursor` | `~/.cursor/mcp.json` | `.cursor/mcp.json` |
| Google Antigravity | `antigravity` | `~/.gemini/config/mcp_config.json` | `.agents/mcp_config.json` |
| VS Code (Copilot) | `vscode` | `mcp.json` dans le répertoire utilisateur de VS Code | `.vscode/mcp.json` |
| Gemini CLI | `gemini-cli` | `~/.gemini/settings.json` | `.gemini/settings.json` |
| Windsurf | `windsurf` | `~/.config/devin/mcp_config.json` | — |

- Seule l'entrée `hesman` est touchée. Un fichier modifié est d'abord copié vers `<file>.hesman.bak`, et `hesman remove` le restaure octet pour octet si rien d'autre n'a changé entre-temps.
- L'entrée ne contient aucun chemin de projet : Hesman trouve le projet lui-même (voir plus bas). Deux exceptions : **Claude Desktop** n'a pas de workspace, son entrée épingle donc un projet (le répertoire courant, ou `--project-root <path>`), et **Cursor** reçoit `--project-root ${workspaceFolder}` dans la portée projet uniquement (dans le fichier global `~/.cursor/mcp.json`, cette variable peut désigner votre répertoire personnel, si bien que l'entrée globale ne nomme aucun projet).
- Pour **Antigravity** et **Windsurf**, la façon dont le projet est transmis au serveur n'est pas documentée ; `hesman setup` affiche une note vous demandant de vérifier après le premier démarrage.
- Les fichiers de configuration contenant des commentaires (JSONC) ne sont pas modifiés : `hesman setup` les signale et n'y touche pas.
- `hesman install --agent <name>` fonctionne toujours, comme alias déprécié de `hesman setup --client <name> --yes`.

Après la configuration, redémarrez le client et Hesman sera disponible en tant que serveur MCP.

### Règles d'utilisation pour les agents (opt-in)

Un serveur MCP installé n'est pas automatiquement un serveur utilisé : les agents continuent souvent de recourir à grep et à la lecture de fichiers entiers. `hesman setup --rules` écrit en plus un court bloc (14 lignes) dans le fichier d'instructions que chaque client sélectionné lit dans le **projet courant**, indiquant quel outil Hesman répond à quelle question. Son effet sur la fréquence à laquelle un agent appelle les outils n'a pas encore été mesuré.

```bash
hesman setup --client claude-code codex --rules   # à lancer dans le projet
hesman setup --all --rules --dry-run              # affiche le bloc et les fichiers, n'écrit rien
hesman remove                                     # supprime aussi le bloc
```

| Client | Fichier d'instructions (relatif au projet) |
|---|---|
| Claude Code | `CLAUDE.md` |
| OpenAI Codex CLI, Windsurf | `AGENTS.md` |
| Gemini CLI, Google Antigravity | `GEMINI.md` |
| Cursor | `.cursor/rules/hesman.mdc` (son propre fichier de règles, `alwaysApply: true`) |
| VS Code (Copilot) | `.github/copilot-instructions.md` |
| Claude Desktop | aucun : il ne lit aucun fichier de projet, il est donc ignoré avec une note |

- **Opt-in.** Rien n'est écrit sans `--rules`. Dans un terminal, sans `--yes`, setup pose la question une fois et la réponse par défaut est Non.
- Le bloc se trouve entre `<!-- hesman:rules:start -->` et `<!-- hesman:rules:end -->`. Relancer setup le remplace sur place ; le texte en dehors des marqueurs n'est jamais modifié, et un fichier partagé par deux clients ne reçoit le bloc qu'une fois.
- `hesman remove` supprime exactement le bloc et rend le fichier octet pour octet ; un fichier créé par Hesman et qui ne contient rien d'autre est supprimé. Lancez la commande dans le même projet (ou passez `--project-root <path>`, que `setup --rules` accepte également).
- Ces fichiers sont généralement commités dans git et partagés avec une équipe. Setup liste les fichiers qu'il a modifiés pour que vous puissiez les relire (`git diff`) et décider de les commiter ou non.

### Commande de lancement

`hesman setup --command auto|npx|global|absolute` décide de ce que les clients exécutent. Setup n'utilise jamais le réseau.

| `--command` | Entrée écrite | Nécessite |
|---|---|---|
| `npx` | `npx -y hesman-mcp@<major>` | le paquet sur npm (pas encore publié) et `npx` dans le PATH du client ; survit aux mises à jour de Node |
| `global` | `hesman` | une installation globale (ou `npm link`) dans le PATH du client |
| `absolute` | `/path/to/node /path/to/hesman-mcp/dist/index.js` | rien dans le PATH ; relancez `hesman setup` après avoir changé de version de Node ou déplacé Hesman |

`auto` (la valeur par défaut) regarde comment le Hesman en cours d'exécution a été lancé :

1. lancé via `npx` (il s'exécute depuis un répertoire de cache `_npx`) → `npx` ;
2. le `hesman` du PATH est cette même installation (liens symboliques résolus) → `global` ;
3. tout autre cas (checkout des sources, `node_modules` local, absent du PATH) → `absolute`.

Les applications de bureau (Claude Desktop, Cursor, Antigravity, VS Code, Windsurf) ouvertes depuis le Dock ou un lanceur n'héritent pas du PATH de votre shell. Sous macOS et Linux, lorsque `auto` choisit `npx` ou `hesman` et que cette commande ou `node` ne se trouve pas dans un répertoire système standard (`/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`, `/usr/local/bin`, plus `/opt/homebrew/bin` sous macOS et `/snap/bin` sous Linux) — le cas habituel avec nvm, fnm, volta ou asdf — ces clients reçoivent à la place l'entrée `absolute`, avec une note invitant à relancer `hesman setup` après un changement de version de Node. Les clients en terminal (Claude Code, Codex CLI, Gemini CLI) héritent du shell et gardent la commande choisie. Un `--command npx|global` explicite est écrit tel que demandé pour chaque client, avec un avertissement là où une application de bureau risque de ne pas le trouver.

### Configuration MCP manuelle

Ajoutez ceci au fichier de configuration MCP de votre agent (VS Code utilise `"servers"` au lieu de `"mcpServers"` et exige `"type": "stdio"` dans l'entrée ; Codex utilise une table TOML `[mcp_servers.hesman]`) :

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

`--project-root` est facultatif ; voir ci-dessous. `"command": "hesman"` suppose que `hesman` se trouve dans le PATH que voit le client ; sinon, utilisez `"command": "/path/to/node"` avec `"/path/to/hesman-mcp/dist/index.js"` comme premier argument (voir [Commande de lancement](#commande-de-lancement)).

### Comment Hesman choisit le projet

Un processus serveur indexe un seul projet. Celui-ci est choisi dans cet ordre :

1. **Racine explicite** — `--project-root <path>`, `HESMAN_PROJECT_ROOT`, ou `projectRoot` dans `hesman.config.json`. L'emporte toujours.
2. **Dossiers de workspace du client MCP** — lorsque le client prend en charge la capacité MCP `roots`, Hesman lui demande ses dossiers après le handshake et indexe le premier (les autres dossiers sont journalisés, pas indexés). Si le client signale plus tard un autre dossier, Hesman bascule dessus.
3. **Répertoire de travail** — le répertoire le plus proche, au niveau du répertoire de travail du serveur ou au-dessus, qui contient un répertoire de gestion de versions (`.git`, `.hg`, `.svn`, `.jj`) ou un manifeste de projet (`package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`, …).
4. **Aucun projet** — le serveur démarre quand même et liste ses outils, mais chaque outil renvoie une erreur `NO_PROJECT` qui explique comment définir une racine.

Le répertoire personnel et ses répertoires parents ne sont jamais choisis automatiquement (étapes 2 et 3) ; une entrée MCP globale lancée depuis `~` ne parcourt donc pas votre disque. L'index est stocké dans `.hesman/`, à l'intérieur du projet choisi.

---

## Référence des outils

Hesman expose **11 outils** via le transport MCP stdio. Chaque réponse d'outil, sauf celle de `index_status`, inclut un bloc `_meta` avec ses économies de tokens (`impact_analysis` renvoie en plus son propre `_summary` des fichiers affectés).

### Navigation dans le code

| Outil | Ce qu'il fait | Entrées principales |
|---|---|---|
| `find_symbol` | Trouve des symboles par nom, avec correspondance exacte, approximative ou par préfixe | `name`, `kind`, `matchMode`, `topK` |
| `get_file_structure` | Renvoie l'arbre hiérarchique de tous les symboles d'un fichier | `filePath`, `includeNested` |
| `get_references` | Trouve toutes les utilisations d'un symbole dans la base de code | `symbolId`, `referenceKind`, `topK`, `cursor` |
| `get_context` | Renvoie le code compacté autour d'un emplacement précis | `filePath`, `startLine`, `contextLines`, `mode` |

### Graphe d'appels

| Outil | Ce qu'il fait | Entrées principales |
|---|---|---|
| `get_callers` | Trouve toutes les fonctions qui appellent un symbole donné (jusqu'à 3 niveaux de profondeur) | `symbolId`, `maxDepth`, `topK` |
| `get_callees` | Trouve toutes les fonctions appelées par un symbole donné (jusqu'à 3 niveaux de profondeur) | `symbolId`, `maxDepth`, `topK` |

### Analyse

| Outil | Ce qu'il fait | Entrées principales |
|---|---|---|
| `impact_analysis` | Classe ce qui casse si un symbole change (renommage / suppression / changement de signature) | `symbolId`, `changeType` |
| `list_dependencies` | Montre ce qu'un fichier importe, ou ce qui l'importe | `filePath`, `direction` |
| `semantic_search` | Recherche du code à partir d'une description en langage naturel | `query`, `topK`, `language`, `kind` |
| `find_pattern` | Recherche par motif structurel avec des captures nommées (`$NAME`, `$$$ARGS`) | `pattern`, `language`, `topK` |

### État

| Outil | Ce qu'il fait |
|---|---|
| `index_status` | Indique la santé de l'indexation : nombre de fichiers, nombre de symboles, état des stores, fichiers en attente, progression de l'indexation initiale en arrière-plan |

Pour les schémas complets d'entrée et de sortie, avec des exemples, consultez **[docs/TOOLS.md](../TOOLS.md)**.

---

## Configuration

Créez un fichier `hesman.config.json` à la racine de votre projet (tous les champs sont facultatifs) :

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

> **Les liens symboliques sont ignorés pendant l'indexation.** Le scanner de projet et la surveillance des fichiers ne suivent jamais les liens symboliques (vers des fichiers ou des répertoires). Cela évite les boucles infinies (par exemple `loop -> .`), garde hors de l'index le code extérieur au projet et évite les symboles en double. Pour indexer du code lié, faites pointer `projectRoot` vers le répertoire réel.

### Priorité de configuration

Les paramètres sont résolus dans cet ordre (le suivant l'emporte sur le précédent) :

1. **Valeurs par défaut** — intégrées à Hesman
2. **`hesman.config.json`** — fichier de configuration au niveau du projet
3. **Variables d'environnement** — par exemple `HESMAN_WORKERS=4`
4. **Options CLI** — par exemple `--workers 4`

### Variables d'environnement

| Variable | Équivalent | Description |
|---|---|---|
| `HESMAN_PROJECT_ROOT` | `--project-root` | Chemin du projet à indexer |
| `HESMAN_WORKERS` | `--workers N` | Nombre de threads workers (0 = détection automatique) |
| `HESMAN_LOG_LEVEL` | `--log-level` | L'une des valeurs : trace, debug, info, warn, error |
| `HESMAN_DATA_DIR` | `--data-dir` | Répertoire des données d'index (par défaut : `.hesman`) |
| `HESMAN_WATCH_MODE` | `--watch-mode` | Activer/désactiver la surveillance des fichiers (true/false) |
| `HESMAN_GRAMMARS_OFFLINE` | — | `1` ou `true` : ne jamais télécharger de grammaire (clé de configuration `grammars.offline`) |
| `HESMAN_CACHE_DIR` | — | Répertoire qui contient le cache de grammaires par utilisateur (`<dir>/hesman/grammars/`) |

### Options CLI

| Option | Description |
|---|---|
| `--project-root <path>` | Projet à indexer (par défaut : détecté, voir [Comment Hesman choisit le projet](#comment-hesman-choisit-le-projet)) |
| `--workers <N>` | Nombre de threads workers (0 = automatique) |
| `--log-level <level>` | Niveau de journalisation |
| `--data-dir <path>` | Chemin du répertoire de données |
| `--watch-mode` | Activer la surveillance des fichiers |
| `--no-watch` | Désactiver la surveillance des fichiers |
| `--no-semantic` | Désactiver la recherche sémantique |
| `--batch-size <N>` | Nombre de fichiers par lot d'indexation |

---

## Référence CLI

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

## Langages pris en charge

| Langage | Extensions | Niveau | Grammaire | Ce qui fonctionne |
|---|---|---|---|---|
| TypeScript | `.ts`, `.mts`, `.cts` | deep | intégrée | Symboles, graphe d'appels, analyse d'impact |
| TSX | `.tsx` | deep | intégrée | Symboles, graphe d'appels, analyse d'impact |
| JavaScript (et JSX) | `.js`, `.jsx`, `.mjs`, `.cjs` | deep | intégrée | Symboles, graphe d'appels, analyse d'impact |
| Python | `.py`, `.pyw`, `.pyi` | deep | intégrée | Symboles, graphe d'appels, analyse d'impact |
| Go | `.go` | deep | intégrée | Symboles, graphe d'appels, analyse d'impact |
| Java | `.java` | deep | intégrée | Symboles, graphe d'appels, analyse d'impact |
| C | `.c`, `.h` | deep | intégrée | Symboles, graphe d'appels, analyse d'impact |
| C++ | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx`, `.ipp`, `.tpp` | deep | intégrée | Symboles, graphe d'appels, analyse d'impact |
| C# | `.cs`, `.csx` | deep | intégrée | Symboles, graphe d'appels, analyse d'impact |
| Rust | `.rs` | deep | intégrée | Symboles, graphe d'appels, analyse d'impact |
| PHP | `.php`, `.phtml` | deep | intégrée | Symboles, graphe d'appels, analyse d'impact |
| Ruby | `.rb`, `.rake`, `.gemspec`, `.ru`, `.podspec` | deep | intégrée | Symboles, graphe d'appels, analyse d'impact |
| Kotlin | `.kt`, `.kts` | deep | intégrée | Symboles, graphe d'appels, analyse d'impact |
| Swift | `.swift` | deep | intégrée | Symboles, graphe d'appels, analyse d'impact |
| Bash | `.sh`, `.bash` | deep | intégrée | Symboles, graphe d'appels, analyse d'impact |
| Lua | `.lua` | deep | intégrée | Symboles, graphe d'appels, analyse d'impact |
| Scala | `.scala`, `.sc`, `.sbt` | structural | à la demande | Symboles uniquement (pas de graphe d'appels) |
| OCaml | `.ml` | structural | à la demande | Symboles uniquement (pas de graphe d'appels) |
| F# | `.fs`, `.fsx` | structural | à la demande | Symboles uniquement (pas de graphe d'appels) |
| R | `.r` | structural | à la demande | Symboles uniquement (pas de graphe d'appels) |
| CodeQL | `.ql`, `.qll` | structural | à la demande | Symboles uniquement (pas de graphe d'appels) |
| Arduino | `.ino` | structural | à la demande | Symboles uniquement (pas de graphe d'appels) |
| Elixir | `.ex`, `.exs` | structural | à la demande | Symboles uniquement (pas de graphe d'appels) |
| Tout le reste | tout fichier texte | text | aucune | Fragments de texte pour `semantic_search`, `find_pattern` et `get_context` (pas de symboles) |

Le tableau ci-dessus est généré à partir du registre des langages (`npx tsx scripts/generate-language-matrix.ts` ; un test échoue lorsqu'il n'est plus à jour). Les grammaires marquées *intégrée* sont livrées dans le paquet et fonctionnent donc hors ligne.

**Grammaires à la demande.** Les grammaires marquées *à la demande* ne sont pas dans le paquet. La première fois qu'un projet contient des fichiers d'un tel langage, ces fichiers sont aussitôt indexés comme du texte et le serveur télécharge la grammaire en arrière-plan (0,3–11,4 Mo par grammaire, depuis la page des releases du dépôt GitHub de la grammaire elle-même) ; une fois la grammaire arrivée, les fichiers sont réindexés avec leurs symboles. Chaque grammaire est épinglée par URL, taille et sha256 dans le fichier `grammars.json` livré ; un téléchargement qui ne correspond pas est rejeté et les fichiers restent du texte. Les grammaires sont mises en cache par utilisateur, en dehors du projet : `HESMAN_CACHE_DIR`, sinon `XDG_CACHE_HOME`, sinon `~/Library/Caches` (macOS), `%LOCALAPPDATA%` (Windows) ou `~/.cache`, sous `hesman/grammars/`.

- **Désactiver les téléchargements :** définissez `HESMAN_GRAMMARS_OFFLINE=1`, ou `"grammars": { "offline": true }` dans `hesman.config.json`. Hesman ne fait alors aucune requête réseau pour les grammaires ; les fichiers des langages à la demande restent au niveau text, sauf si la grammaire est déjà en cache.
- **Préremplir le cache :** `hesman grammars install scala r` ou `hesman grammars install --all` (46,9 Mo) ; sur une machine sans accès réseau, copiez-y les fichiers `.wasm` et lancez `hesman grammars install --from <directory>`. `hesman grammars list` montre ce qui est intégré, en cache et disponible. Voir [docs/CLI.md](../CLI.md#hesman-grammars).
- **Voir ce qui manque :** `index_status` liste, pour chaque langage, son niveau (`deep`, `structural` ou `text`), le nombre de fichiers, et si sa grammaire est intégrée, en cache ou manquante, et pourquoi.

`grammars.json` épingle aussi 17 grammaires qui n'ont pas encore de requête de symboles (Haskell, Zig, Julia, Perl, Objective-C, Odin, Luau, Starlark, HTML, CSS, JSON, YAML, TOML, XML, Markdown, HCL, Make). Elles peuvent être installées avec `hesman grammars install`, mais Hesman ne les utilise pas encore : les fichiers de ces langages sont indexés comme du texte et leur grammaire n'est jamais téléchargée automatiquement.

Ce que les niveaux signifient aujourd'hui :

- **deep** — les définitions (fonctions, classes, méthodes, constantes, ...) plus les relations `calls`, de sorte que `get_callers`, `get_callees`, `get_references` et `impact_analysis` disposent d'un graphe d'appels. Les appels sont lus dans l'arbre syntaxique de chaque langage (ses expressions d'appel, `new X(...)`, les appels Ruby et Bash sans parenthèses) et sont liés par nom : d'abord le fichier de l'appelant, puis les fichiers qu'il importe, son répertoire, et le projet ; un nom qui reste ambigu n'est pas lié, plutôt que d'être lié à chaque candidat. Un appel est lié à une définition plutôt qu'à une déclaration sans corps (un prototype C/C++, une méthode d'interface ou abstraite), et `new X(...)` à la classe `X` plutôt qu'à l'un de ses constructeurs. Les types ne sont pas résolus : une méthode appelée sur une interface ayant plusieurs implémentations reste donc non liée, et une méthode Ruby appelée sans arguments ni parenthèses n'est pas vue comme un appel. Les relations d'import existent pour TypeScript/JavaScript, Python, Go, C/C++ (`#include "..."`) et Ruby (`require`, `require_relative`) ; les relations `extends` / `implements` uniquement là où un langage écrit `class X extends Y` ou `class X implements Y`.
- **structural** — les définitions uniquement. Plus aucun langage intégré n'est à ce niveau. Les langages à la demande sont structural parce que seule leur requête de symboles amont est utilisée : il n'existe pour eux aucune règle de visibilité (chaque définition compte comme exportée) et aucune extraction d'appels.
- **text** — pas de symboles ; voir « Text tier » dans [docs/TOOLS.md](../TOOLS.md).

Un agent n'a pas besoin de connaître ce tableau : lorsque `get_callers`, `get_callees`, `get_references` ou `impact_analysis` est interrogé sur un symbole d'un langage sans graphe d'appels, la réponse porte une `note` telle que `call graph not available for r (symbols only)` à côté de la liste vide, afin qu'une réponse vide ne soit pas prise pour « rien n'utilise ceci ».

Les types de symboles suivent la requête de tags propre à chaque grammaire ; certains sont donc plus grossiers que le langage : les méthodes PHP et Kotlin sont des `function`, les enums Rust et Swift et les interfaces Kotlin sont des `class`, les alias de type Rust sont des `class`. Ajouter un langage nécessite une grammaire, une requête de tags, un petit profil et une entrée dans le registre des langages (`src/parsers/languages.ts`) — consultez le [guide de contribution](../CONTRIBUTING.md) pour des instructions pas à pas.

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

**Pipeline de données principal :** modifications de fichiers (chokidar) → analyse Tree-sitter (AST + symboles) → index SQLite + embeddings ZVec → réponses MCP compressées

**Principales décisions de conception :**
- **Aucune dépendance à LSP** — Tree-sitter fournit une analyse indépendante du langage sans faire tourner de serveurs de langage
- **Indexation incrémentale par hash de contenu** — les fichiers ne sont réanalysés que lorsque leur SHA-256 change
- **Compression au niveau de la réponse** — les données d'origine restent intactes ; la compression est appliquée à la frontière de la réponse
- **Une seule base SQLite par projet** — même dans les monorepos, tous les packages partagent un même store, isolés par `file_path`

Pour le document d'architecture complet, y compris les dépendances entre modules, les schémas des stores et la conception du pool de workers, consultez **[docs/ARCHITECTURE.md](../ARCHITECTURE.md)**.

---

## Environnement de développement

### Prérequis

- **Node.js** ≥ 20.0.0
- **npm** ≥ 10

### Pour commencer

```bash
# Cloner et installer
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install

# Télécharger les parsers WASM Tree-sitter
npm run download:parsers

# Lancer en mode développement (rechargement à chaud)
npm run dev

# Compiler pour la production
npm run build
```

### Qualité du code

```bash
npm run typecheck    # Vérification des types TypeScript
npm run lint         # ESLint
npm run format       # Formatage avec Prettier
```

### Lancer les tests

```bash
npm test                  # Lancer tous les tests (unitaires + intégration)
npm run test:watch        # Mode watch pour le développement
npm run test:e2e          # Tests de bout en bout (démarre le serveur complet)
npm run test:perf         # Benchmarks de performance
```

### Objectifs de performance

| Benchmark | Objectif |
|---|---|
| Débit d'indexation | ≥ 500 fichiers/s |
| `find_symbol` (exact) | < 1 ms |
| `find_symbol` (approximatif) | < 5 ms |
| `semantic_search` | < 10 ms |
| `get_references` | < 5 ms |
| Mémoire (après indexation) | < 350 Mo |

Pour le guide de contribution complet, y compris la façon d'ajouter de nouveaux langages, consultez **[docs/CONTRIBUTING.md](../CONTRIBUTING.md)**.

---

## Configuration requise

| Ressource | Minimum |
|---|---|
| **Node.js** | ≥ 20.0.0 |
| **Mémoire (au repos)** | ~100 Mo |
| **Mémoire (en charge)** | ~350 Mo |
| **Disque** | ~30 Mo pour le paquet (grammaires intégrées), ~80 Mo pour le modèle d'embedding (téléchargement unique), jusqu'à 47 Mo pour les grammaires à la demande si toutes sont installées, plus l'index dans `.hesman/` |
| **Réseau** | Pour l'installation, pour le modèle d'embedding à la première utilisation, et pour la grammaire d'un langage à la demande la première fois qu'un projet en contient. Aucun autre accès ; aucun code ni aucune requête n'est jamais envoyé où que ce soit |

Le modèle d'embedding (`all-MiniLM-L6-v2`) est téléchargé à la première utilisation et mis en cache indéfiniment dans le répertoire de cache de Transformers.js.

---

## Documentation

| Document | Contenu |
|---|---|
| [README.md](../../README.md) | Vue d'ensemble du projet, installation et configuration (ce fichier) |
| [docs/ARCHITECTURE.md](../ARCHITECTURE.md) | Architecture complète : flux de données, carte des modules, schémas des stores, conception du pool de workers |
| [docs/CLI.md](../CLI.md) | Toutes les sous-commandes : `setup`, `remove`, `doctor`, `ui`, `grammars`, avec leurs options et leur sortie |
| [docs/TOOLS.md](../TOOLS.md) | Schémas complets d'entrée et de sortie des 11 outils, avec des exemples |
| [docs/CONTRIBUTING.md](../CONTRIBUTING.md) | Environnement de développement, guide des tests, écriture d'un profil de langage, checklist de PR |
| [docs/SECURITY.md](../SECURITY.md) | Modèle de menaces, garde-fous sur les entrées des outils, comment signaler une vulnérabilité |
| [CHANGELOG.md](../../CHANGELOG.md) | Historique des versions et des modifications |

---

## Licence

[MIT](../../LICENSE) — Copyright (c) 2026 Minh Do

La licence MIT couvre le code écrit pour Hesman. Les logiciels tiers conservent leur propre licence :

- **Dans le paquet :** les grammaires Tree-sitter et les fichiers de requêtes, tous sous licence MIT sauf la requête Elixir (Apache-2.0, la licence de sa grammaire) ; chacun est listé avec son dépôt, sa révision et son copyright dans [NOTICE](../../NOTICE).
- **Installés par npm comme dépendances :** tous sous licences permissives (MIT, ISC, BSD, Apache-2.0) ; la liste complète se trouve dans [THIRD-PARTY-LICENSES.md](../../THIRD-PARTY-LICENSES.md). La bibliothèque d'embedding `@xenova/transformers` et le store vectoriel `@zvec/zvec` sont sous Apache-2.0.
- **Téléchargés à l'exécution :** le modèle d'embedding `Xenova/all-MiniLM-L6-v2` (Apache-2.0) et les grammaires à la demande (MIT, sauf Elixir et HCL : Apache-2.0) ; voir [NOTICE](../../NOTICE). La dépendance `sharp` de la bibliothèque d'embedding installe une libvips précompilée (LGPL-3.0-or-later) sous forme de bibliothèque partagée distincte.
