import { readFileSync } from 'node:fs';
import type { ExtractedSymbol } from './core.js';
import type { LanguageProfile } from './language-profile.js';

export interface RelationRow {
  from_id: string;
  to_id: string;
  kind: 'calls' | 'extends' | 'implements' | 'imports' | 'contains' | 'references';
  file_path: string;
  line: number;
  col: number;
}

function findSymbolByName(
  symbols: ExtractedSymbol[],
  name: string,
  kind?: string,
): ExtractedSymbol | undefined {
  return symbols.find(s => {
    if (s.name !== name) return false;
    if (kind && s.kind !== kind) return false;
    return true;
  });
}

export function extractRelations(
  symbols: ExtractedSymbol[],
  source: string,
  filePath: string,
  profile: LanguageProfile,
): RelationRow[] {
  if (!profile.relationQueries) return [];

  const results: RelationRow[] = [];

  // If no source provided, read it from disk
  const sourceCode = source || readFileSync(filePath, 'utf-8');

  // Build a symbol map: name -> ExtractedSymbol[]
  const nameMap = new Map<string, ExtractedSymbol[]>();
  for (const sym of symbols) {
    const existing = nameMap.get(sym.name) || [];
    existing.push(sym);
    nameMap.set(sym.name, existing);
  }

  // CALLS: match function calls like `funcName(...)`
  const callRegex = /\b([a-zA-Z_$][\w$]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = callRegex.exec(sourceCode)) !== null) {
    const calleeName = match[1];
    // Skip keywords
    if (['if', 'for', 'while', 'switch', 'catch', 'return', 'throw', 'new', 'typeof', 'instanceof'].includes(calleeName)) continue;

    const line = sourceCode.substring(0, match.index).split('\n').length; // 1-based
    const col = match.index - sourceCode.lastIndexOf('\n', match.index - 1) - 1;

    // Find caller symbol (the function containing this line)
    const caller = symbols.find(s => s.start_line <= line && s.end_line >= line);
    // Find callee symbol
    const calleeSymbols = nameMap.get(calleeName);
    if (caller && calleeSymbols) {
      for (const callee of calleeSymbols) {
        results.push({
          from_id: caller.id,
          to_id: callee.id,
          kind: 'calls',
          file_path: filePath,
          line,
          col,
        });
      }
    }
  }

  // IMPORTS: match `import { ... } from '...'`
  const importRegex = /import\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = importRegex.exec(sourceCode)) !== null) {
    const modulePath = match[1];
    const line = sourceCode.substring(0, match.index).split('\n').length; // 1-based
    const col = match[0].indexOf('from');

    // Determine if local file or package
    const toId = `unresolved:${modulePath}`;

    // Find the symbol containing this line (the importer).
    // For file-level imports (no containing symbol), fall back to the
    // first top-level symbol in the file so the relation is still recorded.
    let importer = symbols.find(s => s.start_line <= line && s.end_line >= line);
    if (!importer && symbols.length > 0) {
      importer = symbols[0];
    }
    if (importer) {
      results.push({
        from_id: importer.id,
        to_id: toId,
        kind: 'imports',
        file_path: filePath,
        line,
        col,
      });
    }
  }

  // EXTENDS: match `class X extends Y`
  const extendsRegex = /class\s+(\w+)\s+extends\s+(\w+)/g;
  while ((match = extendsRegex.exec(sourceCode)) !== null) {
    const className = match[1];
    const parentName = match[2];
    const line = sourceCode.substring(0, match.index).split('\n').length; // 1-based
    const classSymbol = findSymbolByName(symbols, className, 'class');
    const parentSymbol = findSymbolByName(symbols, parentName, 'class') || nameMap.get(parentName)?.[0];
    if (classSymbol && parentSymbol) {
      results.push({
        from_id: classSymbol.id,
        to_id: parentSymbol.id,
        kind: 'extends',
        file_path: filePath,
        line,
        col: 0,
      });
    }
  }

  // IMPLEMENTS: match `class X implements Y`
  const implementsRegex = /class\s+(\w+)\s+implements\s+(\w+)/g;
  while ((match = implementsRegex.exec(sourceCode)) !== null) {
    const className = match[1];
    const ifaceName = match[2];
    const line = sourceCode.substring(0, match.index).split('\n').length; // 1-based
    const classSymbol = findSymbolByName(symbols, className, 'class');
    const ifaceSymbol = findSymbolByName(symbols, ifaceName, 'interface') || nameMap.get(ifaceName)?.[0];
    if (classSymbol && ifaceSymbol) {
      results.push({
        from_id: classSymbol.id,
        to_id: ifaceSymbol.id,
        kind: 'implements',
        file_path: filePath,
        line,
        col: 0,
      });
    }
  }

  return results;
}
