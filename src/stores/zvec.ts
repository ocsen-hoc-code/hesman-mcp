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
import { createLogger } from '../utils/logger';

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
}

export interface SearchParams {
  queryVector: Float32Array;
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

  deleteByFile(filePath: string): void {
    if (!this.collection) throw new Error('ZVec collection not open');
    this.collection.deleteByFilterSync(`filePath = '${filePath}'`);
  }

  search(params: SearchParams): SearchResult[] {
    if (!this.collection) throw new Error('ZVec collection not open');

    const conditions: string[] = [];
    if (params.language) conditions.push(`language = '${params.language}'`);
    if (params.kind) conditions.push(`kind = '${params.kind}'`);
    const filter = conditions.length > 0 ? conditions.join(' AND ') : undefined;

    const queryParams: Record<string, unknown> = {
      fieldName: 'embedding',
      vector: params.queryVector,
      topk: params.topK,
      includeVector: false,
    };
    if (filter !== undefined) {
      queryParams.filter = filter;
    }

    const results: ZVecDoc[] = this.collection.querySync(queryParams);

    let mapped: SearchResult[] = results.map(r => ({
      symbolId: r.fields.symbolId as string,
      name: r.fields.name as string,
      kind: r.fields.kind as string,
      filePath: r.fields.filePath as string,
      startLine: r.fields.startLine as number,
      endLine: r.fields.endLine as number,
      signature: (r.fields.signature as string) || null,
      snippet: r.fields.code as string,
      score: r.score,
      matchType: r.score > 0.5 ? 'semantic' as const : 'keyword' as const,
    })).sort((a, b) => b.score - a.score);

    if (params.filePattern) {
      mapped = mapped.filter(r => matchesGlob(r.filePath, params.filePattern!));
    }

    return mapped;
  }

  stats(): { docCount: number; collectionPath: string } {
    return {
      docCount: this.collection?.stats?.docCount ?? 0,
      collectionPath: this.collectionPath,
    };
  }
}
