import { parentPort } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { initParser, parseFile } from '../parsers/core.js';
import { extractRelations } from '../parsers/relation-extractor.js';
import { profileFor } from '../parsers/languages.js';

interface WorkerTask {
  filePath: string;
  language: string;
}

interface WorkerResult {
  filePath: string;
  symbols: Array<{
    id: string;
    name: string;
    kind: string;
    file_path: string;
    start_line: number;
    end_line: number;
    start_col: number;
    end_col: number;
    signature: string | null;
    doc_comment: string | null;
    parent_id: string | null;
    language: string;
    is_exported: number;
  }>;
  relations: Array<{
    from_id: string;
    to_id: string;
    kind: string;
    file_path: string;
    line: number;
    col: number;
  }>;
  contentHash: string;
  error?: string;
}

// Initialize parser on worker startup
let initialized = false;

async function ensureInit(language: string): Promise<void> {
  if (initialized) return;
  const profile = profileFor(language);
  if (profile) {
    await initParser(profile);
    initialized = true;
  }
}

if (!parentPort) {
  throw new Error('worker.ts must be run as a worker thread');
}

parentPort.on('message', async (task: WorkerTask) => {
  try {
    await ensureInit(task.language);
    const profile = profileFor(task.language);
    if (!profile) {
      throw new Error(`Unsupported language: ${task.language}`);
    }

    const content = readFileSync(task.filePath, 'utf-8');
    const result = await parseFile(task.filePath, profile);
    const sha256 = createHash('sha256').update(content).digest('hex');

    let relations: WorkerResult['relations'] = [];
    if (profile.relationQueries) {
      const rawRelations = extractRelations(result.symbols, content, task.filePath, profile);
      relations = rawRelations.map(r => ({
        from_id: r.from_id,
        to_id: r.to_id,
        kind: r.kind,
        file_path: r.file_path,
        line: r.line,
        col: r.col,
      }));
    }

    const workerResult: WorkerResult = {
      filePath: task.filePath,
      symbols: result.symbols,
      relations,
      contentHash: sha256,
    };

    parentPort!.postMessage(workerResult);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    parentPort!.postMessage({
      filePath: task.filePath,
      symbols: [],
      relations: [],
      contentHash: '',
      error: message,
    });
  }
});
