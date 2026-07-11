import { describe, it, expect, beforeAll } from 'vitest';
import { initParser, parseFile } from '../../../src/parsers/core';
import { pythonProfile } from '../../../src/parsers/profiles/python';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '..', '..', 'fixtures', 'py-basic');

describe('Python parser — symbol extraction', () => {
  beforeAll(async () => {
    await initParser(pythonProfile);
  });

  it('parses a Python file without error', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'main.py'), pythonProfile);
    expect(result.language).toBe('python');
    expect(result.parseQuality).toBe('full');
    expect(result.symbols.length).toBeGreaterThan(0);
  });

  it('extracts functions from main.py', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'main.py'), pythonProfile);
    const funcs = result.symbols.filter((s) => s.kind === 'function');
    const names = funcs.map((s) => s.name);
    expect(names).toContain('add');
    expect(names).toContain('subtract');
  });

  it('extracts class declaration', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'main.py'), pythonProfile);
    const classes = result.symbols.filter((s) => s.kind === 'class');
    expect(classes.map((s) => s.name)).toContain('Calculator');
  });

  it('extracts class methods with parent_id', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'main.py'), pythonProfile);
    const methods = result.symbols.filter((s) => s.kind === 'function');
    const classMethods = methods.filter((s) => s.parent_id !== null);
    expect(classMethods.length).toBe(3);
    const names = classMethods.map((s) => s.name);
    expect(names).toContain('__init__');
    expect(names).toContain('add');
    expect(names).toContain('get_value');
  });

  it('extracts doc comments for functions', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'main.py'), pythonProfile);
    const addFunc = result.symbols.find((s) => s.name === 'add' && s.kind === 'function');
    expect(addFunc?.doc_comment).toBe('Add two integers and return the sum.');

    const subFunc = result.symbols.find((s) => s.name === 'subtract');
    expect(subFunc?.doc_comment).toBeNull();
  });

  it('extracts doc comments for classes', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'main.py'), pythonProfile);
    const calc = result.symbols.find((s) => s.name === 'Calculator');
    expect(calc?.doc_comment).toBe('A simple calculator class.');
  });

  it('extracts correct signatures', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'main.py'), pythonProfile);
    const addFunc = result.symbols.find((s) => s.name === 'add' && s.kind === 'function');
    expect(addFunc?.signature).toBe('def add(a: int, b: int) -> int');

    const calc = result.symbols.find((s) => s.name === 'Calculator');
    expect(calc?.signature).toBe('class Calculator');
  });

  it('extracts symbols from utils.py', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'utils.py'), pythonProfile);
    const funcs = result.symbols.filter((s) => s.kind === 'function');
    expect(funcs.map((s) => s.name)).toContain('filter_positive');
    expect(funcs.map((s) => s.name)).toContain('find_max');
  });

  it('extracts doc comment from utils.py', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'utils.py'), pythonProfile);
    const fp = result.symbols.find((s) => s.name === 'filter_positive');
    expect(fp?.doc_comment).toBe('Return only positive numbers from the list.');
  });

  it('extracts symbols from models.py (dataclass)', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'models.py'), pythonProfile);
    const classes = result.symbols.filter((s) => s.kind === 'class');
    expect(classes.map((s) => s.name)).toContain('User');
    expect(classes.map((s) => s.name)).toContain('AdminUser');
  });

  it('extracts nested methods from models.py', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'models.py'), pythonProfile);
    const methods = result.symbols.filter((s) => s.kind === 'function' && s.parent_id !== null);
    const names = methods.map((s) => s.name);
    expect(names).toContain('is_adult');
    expect(names).toContain('__init__');
  });

  it('extracts doc comment for AdminUser', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'models.py'), pythonProfile);
    const admin = result.symbols.find((s) => s.name === 'AdminUser');
    expect(admin?.doc_comment).toBe('Admin user with extra permissions.');
  });

  it('extracts correct signatures for class with inheritance', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'models.py'), pythonProfile);
    const admin = result.symbols.find((s) => s.name === 'AdminUser');
    expect(admin?.signature).toBe('class AdminUser(User)');
  });

  it('generates stable symbol IDs', async () => {
    const result1 = await parseFile(resolve(FIXTURE_DIR, 'main.py'), pythonProfile);
    const result2 = await parseFile(resolve(FIXTURE_DIR, 'main.py'), pythonProfile);
    const ids1 = result1.symbols.map((s) => s.id).sort();
    const ids2 = result2.symbols.map((s) => s.id).sort();
    expect(ids1).toEqual(ids2);
  });
});
