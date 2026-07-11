import { describe, it, expect, beforeAll } from 'vitest';
import { initParser, parseFile } from '../../../src/parsers/core';
import { goProfile } from '../../../src/parsers/profiles/go';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '..', '..', 'fixtures', 'go-basic');

describe('Go parser — symbol extraction', () => {
  beforeAll(async () => {
    await initParser(goProfile);
  });

  it('parses a Go file without error', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'main.go'), goProfile);
    expect(result.language).toBe('go');
    expect(result.parseQuality).toBe('full');
    expect(result.symbols.length).toBeGreaterThan(0);
  });

  it('extracts functions from main.go', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'main.go'), goProfile);
    const funcs = result.symbols.filter((s) => s.kind === 'function');
    const names = funcs.map((s) => s.name);
    expect(names).toContain('add');
    expect(names).toContain('main');
  });

  it('extracts constants and variables', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'main.go'), goProfile);
    const constants = result.symbols.filter((s) => s.kind === 'constant');
    expect(constants.map((s) => s.name)).toContain('VERSION');
    const variables = result.symbols.filter((s) => s.kind === 'variable');
    expect(variables.map((s) => s.name)).toContain('count');
  });

  it('extracts type declarations from types.go', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'types.go'), goProfile);
    const types = result.symbols.filter((s) => s.kind === 'type');
    const names = types.map((s) => s.name);
    expect(names).toContain('Shape');
    expect(names).toContain('Circle');
    expect(names).toContain('MyInt');
  });

  it('extracts constants and variables from types.go', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'types.go'), goProfile);
    const constants = result.symbols.filter((s) => s.kind === 'constant');
    expect(constants.map((s) => s.name)).toContain('Pi');
    expect(constants.map((s) => s.name)).toContain('Eps');
    const variables = result.symbols.filter((s) => s.kind === 'variable');
    expect(variables.map((s) => s.name)).toContain('DefaultRadius');
  });

  it('extracts methods with receiver from server.go', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'server.go'), goProfile);
    const methods = result.symbols.filter((s) => s.kind === 'method');
    const names = methods.map((s) => s.name);
    expect(names).toContain('Start');
    expect(names).toContain('Stop');
  });

  it('extracts functions from server.go', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'server.go'), goProfile);
    const funcs = result.symbols.filter((s) => s.kind === 'function');
    const names = funcs.map((s) => s.name);
    expect(names).toContain('NewServer');
  });

  it('extracts type from server.go', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'server.go'), goProfile);
    const types = result.symbols.filter((s) => s.kind === 'type');
    expect(types.map((s) => s.name)).toContain('Server');
  });

  it('extracts correct signatures for functions', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'main.go'), goProfile);
    const addFunc = result.symbols.find((s) => s.name === 'add' && s.kind === 'function');
    expect(addFunc?.signature).toBe('func add(a, b int) int');
  });

  it('extracts correct signature for method', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'server.go'), goProfile);
    const start = result.symbols.find((s) => s.name === 'Start' && s.kind === 'method');
    expect(start?.signature).toBe('func (s *Server) Start() string');
  });

  it('extracts correct signature for type declaration', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'types.go'), goProfile);
    const circle = result.symbols.find((s) => s.name === 'Circle');
    expect(circle?.signature).toBe('Circle struct');
  });

  it('extracts doc comments for types', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'server.go'), goProfile);
    const server = result.symbols.find((s) => s.name === 'Server');
    expect(server?.doc_comment).toBe('Server is an HTTP server with configurable port and name.');

    const newServer = result.symbols.find((s) => s.name === 'NewServer');
    expect(newServer?.doc_comment).toBe('NewServer creates a new Server instance.');
  });

  it('extracts doc comments from types.go', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'types.go'), goProfile);
    const shape = result.symbols.find((s) => s.name === 'Shape');
    expect(shape?.doc_comment).toBe('Shape defines geometry methods.');

    const circle = result.symbols.find((s) => s.name === 'Circle');
    expect(circle?.doc_comment).toBe('Circle represents a circle shape.');
  });

  it('does not extract doc comment when none exists', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'main.go'), goProfile);
    const addFunc = result.symbols.find((s) => s.name === 'add' && s.kind === 'function');
    expect(addFunc?.doc_comment).toBeNull();
  });

  it('generates stable symbol IDs', async () => {
    const result1 = await parseFile(resolve(FIXTURE_DIR, 'main.go'), goProfile);
    const result2 = await parseFile(resolve(FIXTURE_DIR, 'main.go'), goProfile);
    const ids1 = result1.symbols.map((s) => s.id).sort();
    const ids2 = result2.symbols.map((s) => s.id).sort();
    expect(ids1).toEqual(ids2);
  });
});
