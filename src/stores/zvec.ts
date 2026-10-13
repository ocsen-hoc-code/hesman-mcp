import {
  ZVecCreateAndOpen,
  ZVecOpen,
  ZVecDataType,
  ZVecIndexType,
  ZVecMetricType,
  ZVecCollectionSchema,
  type ZVecCollection,
  type ZVecDoc,
} from '@zvec/zvec';
import { join } from 'node:path';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { createLogger } from '../utils/logger.js';
import { isLanguageId } from '../parsers/languages.js';
import { isSymbolKind } from '../parsers/symbol-kinds.js';
import { splitIdentifier } from '../parsers/chunker.js';
import { TEXT_CHUNK_KIND } from '../parsers/text-chunker.js';
import { isTextLanguageLabel } from '../parsers/text-languages.js';

const log = createLogger('zvec');

export interface SearchDoc {
  symbolId: string;
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature: string | null;
  code: string;
  docComment: string | null;
  language: string;
}

export interface SearchResult {
  symbolId: string;
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature: string | null;
  snippet: string;
  score: number;
  matchType: 'semantic' | 'keyword' | 'both';
  /** Language label; set only on text-tier chunks. */
  language?: string;
  /**
   * `text` on a chunk of a file without a grammar: a line range, not a symbol
   * (`symbolId` is then a chunk id that no symbol tool accepts). Absent on
   * symbol results.
   */
  precision?: 'text';
}

export interface SearchParams {
  queryVector: Float32Array;
  /** Raw query text. When set, a lexical match on the symbol name is blended into the score. */
  queryText?: string;
  topK: number;
  filePattern?: string;
  language?: string;
  kind?: string;
}

function createSchema(): ZVecCollectionSchema {
  return new ZVecCollectionSchema({
    name: 'code_search',
    vectors: [{
      name: 'embedding',
      dataType: ZVecDataType.VECTOR_FP32,
      dimension: 384,
      indexParams: {
        indexType: ZVecIndexType.HNSW,
        metricType: ZVecMetricType.COSINE,
      },
    }],
    fields: [
      { name: 'symbolId', dataType: ZVecDataType.STRING },
      { name: 'name', dataType: ZVecDataType.STRING },
      { name: 'kind', dataType: ZVecDataType.STRING },
      { name: 'filePath', dataType: ZVecDataType.STRING },
      { name: 'startLine', dataType: ZVecDataType.INT32 },
      { name: 'endLine', dataType: ZVecDataType.INT32 },
      { name: 'signature', dataType: ZVecDataType.STRING },
      { name: 'language', dataType: ZVecDataType.STRING },
      {
        name: 'code',
        dataType: ZVecDataType.STRING,
        indexParams: { indexType: ZVecIndexType.FTS },
      },
      {
        name: 'docComment',
        dataType: ZVecDataType.STRING,
        indexParams: { indexType: ZVecIndexType.FTS },
      },
    ],
  });
}

/**
 * Quote a string value for a ZVec filter expression.
 *
 * ZVec 0.5.0 parses filters with an ANTLR SQL grammar (native binding). Verified
 * empirically against `@zvec/zvec@0.5.0` (see tasks/M0-05-zvec-filter.md):
 * - Inside a single-quoted literal, `\'` is the only way to write `'`
 *   (SQL-style `''` is a syntax error).
 * - The lexer treats `\` + any character as one unit, but the unescape step only
 *   turns `\'` / `\"` into the quote; every other backslash is kept verbatim.
 *   So `\\` is two backslashes, a trailing `\` cannot be written, and a
 *   backslash before a quote is ambiguous.
 * - A raw line break inside a literal is a lexer error.
 *
 * Therefore values containing a backslash or a control character cannot be
 * expressed safely and are rejected; `'` is escaped as `\'`.
 */
export function quoteFilterValue(value: string): string {
  if (!canQuoteFilterValue(value)) {
    throw new Error('Value cannot be safely quoted in a ZVec filter (contains a backslash or control character)');
  }
  return `'${value.replace(/'/g, "\\'")}'`;
}

/** True if `quoteFilterValue(value)` would succeed. */
export function canQuoteFilterValue(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return !/[\\\u0000-\u001f\u007f]/.test(value);
}

/**
 * ZVec's COSINE metric reports a *distance* (1 - cosine similarity, range [0, 2];
 * lower is closer), not a similarity. Convert it to a similarity clamped to
 * [0, 1] so that higher means more relevant.
 */
function cosineDistanceToScore(distance: number): number {
  return Math.min(1, Math.max(0, 1 - distance));
}

/** Weight of the lexical name match in the hybrid score (the vector similarity gets the rest). */
const LEXICAL_WEIGHT = 0.3;
/** Vector candidates fetched before re-ranking / filtering, as a multiple of topK (and a floor). */
const CANDIDATE_MULTIPLIER = 5;
const MIN_CANDIDATES = 50;

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'by', 'do', 'does', 'for', 'from', 'get', 'how',
  'i', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'some', 'that', 'the', 'their', 'this',
  'to', 'what', 'when', 'where', 'whether', 'which', 'with',
]);

/** Very light suffix stripping so that `greeting`/`greet` and `items`/`item` match. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  if (word.length >= 4 && word.endsWith('e')) return word.slice(0, -1);
  return word;
}

function contentWords(text: string): Set<string> {
  return new Set(splitIdentifier(text).filter(w => !STOP_WORDS.has(w)).map(stem));
}

/**
 * Share of the query's content words (stop words removed, lightly stemmed) that
 * appear among the words of the symbol name split from camelCase/snake_case.
 * Returns a value in [0, 1].
 */
export function lexicalScore(queryText: string, name: string): number {
  const queryWords = contentWords(queryText);
  if (queryWords.size === 0) return 0;
  const nameWords = contentWords(name);
  let matched = 0;
  for (const word of queryWords) {
    if (nameWords.has(word)) matched++;
  }
  return matched / queryWords.size;
}

function matchesGlob(filePath: string, pattern: string): boolean {
  // Simple glob matching — picomatch can be used in production
  if (pattern.includes('*')) {
    const regex = new RegExp(
      '^' + pattern.replace(/\./g, '\\.').replace(/\*\*/g, '<<<GLOBSTAR>>>').replace(/\*/g, '[^/]*').replace(/<<<GLOBSTAR>>>/g, '.*') + '$'
    );
    return regex.test(filePath);
  }
  return filePath.includes(pattern);
}

export class ZVecStore {
  private collection: ZVecCollection | null = null;
  private dataDir: string;
  private collectionPath: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.collectionPath = join(dataDir, 'zvec', 'code_search');
  }

  open(): void {
    mkdirSync(join(this.dataDir, 'zvec'), { recursive: true });

    if (existsSync(this.collectionPath)) {
      this.collection = ZVecOpen(this.collectionPath);
      log.info({ path: this.collectionPath }, 'ZVec collection opened');
    } else {
      const schema = createSchema();
      this.collection = ZVecCreateAndOpen(this.collectionPath, schema);
      log.info({ path: this.collectionPath }, 'ZVec collection created');
    }
  }

  close(): void {
    if (this.collection) {
      this.collection.closeSync();
      this.collection = null;
      log.info('ZVec collection closed');
    }
  }

  clear(): void {
    if (this.collection) {
      this.collection.closeSync();
    }
    if (existsSync(this.collectionPath)) {
      rmSync(this.collectionPath, { recursive: true });
    }
    this.open();
    log.info('ZVec collection cleared and recreated');
  }

  upsertDocs(docs: SearchDoc[], embeddings: Float32Array[]): void {
    if (!this.collection) throw new Error('ZVec collection not open');
    if (docs.length === 0) return;

    const zvecDocs = docs.map((doc, i) => ({
      id: doc.symbolId,
      vectors: { embedding: embeddings[i] },
      fields: {
        symbolId: doc.symbolId,
        name: doc.name,
        kind: doc.kind,
        filePath: doc.filePath,
        startLine: doc.startLine,
        endLine: doc.endLine,
        signature: doc.signature ?? '',
        language: doc.language,
        code: doc.code,
        docComment: doc.docComment ?? '',
      },
    }));

    const results = this.collection.upsertSync(zvecDocs);
    const resultList = (Array.isArray(results) ? results : [results]) as Array<{ ok: boolean; code: string; message: string }>;
    const failures = resultList.filter(r => !r.ok);

    if (failures.length > 0) {
      log.warn({ failures: failures.length }, 'Some ZVec upserts failed');
    }
  }

  /**
   * Remove every document of `filePath`.
   *
   * `symbolIds` (the file's ids as currently stored in SQLite) are deleted by id,
   * which works for any path. When the path can be quoted safely, a filter delete
   * also removes documents SQLite no longer knows about. Paths that cannot be
   * quoted (e.g. Windows paths with backslashes) rely on the id list alone.
   */
  deleteByFile(filePath: string, symbolIds: readonly string[] = []): void {
    if (!this.collection) throw new Error('ZVec collection not open');
    if (symbolIds.length > 0) {
      this.collection.deleteSync([...symbolIds]);
    }
    if (canQuoteFilterValue(filePath)) {
      this.collection.deleteByFilterSync(`filePath = ${quoteFilterValue(filePath)}`);
    } else {
      log.debug({ file: filePath }, 'Path cannot be quoted in a ZVec filter; deleted by id only');
    }
  }

  search(params: SearchParams): SearchResult[] {
    if (!this.collection) throw new Error('ZVec collection not open');

    // Defense in depth: the tool layer validates these too.
    if (params.language !== undefined && !isLanguageId(params.language) && !isTextLanguageLabel(params.language)) {
      throw new Error(`Unknown language filter: ${JSON.stringify(params.language)}`);
    }
    if (params.kind !== undefined && !isSymbolKind(params.kind) && params.kind !== TEXT_CHUNK_KIND) {
      throw new Error(`Unknown kind filter: ${JSON.stringify(params.kind)}`);
    }

    const conditions: string[] = [];
    if (params.language) conditions.push(`language = ${quoteFilterValue(params.language)}`);
    if (params.kind) conditions.push(`kind = ${quoteFilterValue(params.kind)}`);
    const filter = conditions.length > 0 ? conditions.join(' AND ') : undefined;

    // Fetch a wider candidate pool so re-ranking and the file filter work on more than topK docs.
    const reranks = params.queryText !== undefined || params.filePattern !== undefined;
    const candidateK = reranks
      ? Math.max(params.topK * CANDIDATE_MULTIPLIER, MIN_CANDIDATES)
      : params.topK;

    const queryParams: Record<string, unknown> = {
      fieldName: 'embedding',
      vector: params.queryVector,
      topk: candidateK,
      includeVector: false,
    };
    if (filter !== undefined) {
      queryParams.filter = filter;
    }

    const results: ZVecDoc[] = this.collection.querySync(queryParams);

    const queryText = params.queryText?.trim();

    let mapped: SearchResult[] = results.map(r => {
      const name = r.fields.name as string;
      const kind = r.fields.kind as string;
      const isText = kind === TEXT_CHUNK_KIND;
      const semantic = cosineDistanceToScore(r.score);
      // A text chunk is named after its file, which says nothing about the
      // chunk's content: it gets no lexical bonus, so on equal similarity a
      // symbol whose name matches the query ranks above it.
      const lexical = queryText && !isText ? lexicalScore(queryText, name) : 0;
      return {
        symbolId: r.fields.symbolId as string,
        name,
        kind,
        filePath: r.fields.filePath as string,
        startLine: r.fields.startLine as number,
        endLine: r.fields.endLine as number,
        signature: (r.fields.signature as string) || null,
        snippet: r.fields.code as string,
        score: queryText ? (1 - LEXICAL_WEIGHT) * semantic + LEXICAL_WEIGHT * lexical : semantic,
        matchType: lexical > 0 ? 'both' as const : 'semantic' as const,
        ...(isText ? { language: r.fields.language as string, precision: 'text' as const } : {}),
      };
    }).sort((a, b) => b.score - a.score);

    if (params.filePattern) {
      mapped = mapped.filter(r => matchesGlob(r.filePath, params.filePattern!));
    }

    return mapped.slice(0, params.topK);
  }

  stats(): { docCount: number; collectionPath: string } {
    return {
      docCount: this.collection?.stats?.docCount ?? 0,
      collectionPath: this.collectionPath,
    };
  }
}
