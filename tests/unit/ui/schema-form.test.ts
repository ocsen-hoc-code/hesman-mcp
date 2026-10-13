import { describe, expect, it } from 'vitest';
import { buildFormModel, coerceValues, initialValues } from '../../../src/ui/public/js/lib/schema-form.js';

const findSymbolSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Symbol name to search for' },
    kind: { type: 'string', enum: ['function', 'class'], description: 'Filter by symbol kind' },
    topK: { type: 'integer', minimum: 1, maximum: 200, description: 'Max results' },
  },
  required: ['name'],
};

describe('buildFormModel', () => {
  it('maps schema types to controls', () => {
    const model = buildFormModel({
      type: 'object',
      properties: {
        s: { type: 'string', maxLength: 5 },
        e: { type: 'string', enum: ['a', 'b'] },
        i: { type: 'integer', minimum: 1, maximum: 3 },
        n: { type: 'number', minimum: 0, maximum: 1 },
        b: { type: 'boolean' },
        o: { type: 'object' },
        l: { type: 'array', items: { type: 'string' } },
      },
    });
    expect(model.fields.map((f: { name: string; control: string }) => [f.name, f.control])).toEqual([
      ['s', 'text'],
      ['e', 'select'],
      ['i', 'integer'],
      ['n', 'number'],
      ['b', 'boolean'],
      ['o', 'json'],
      ['l', 'json'],
    ]);
    expect(model.fields[0].maxLength).toBe(5);
    expect(model.fields[1].options).toEqual(['a', 'b']);
    expect(model.fields[2]).toMatchObject({ min: 1, max: 3 });
  });

  it('puts required fields first and keeps schema order otherwise', () => {
    const model = buildFormModel({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' } },
      required: ['c'],
    });
    expect(model.fields.map((f: { name: string }) => f.name)).toEqual(['c', 'a', 'b']);
    expect(model.fields[0].required).toBe(true);
    expect(model.fields[1].required).toBe(false);
  });

  it('keeps the description', () => {
    expect(buildFormModel(findSymbolSchema).fields[0].description).toBe('Symbol name to search for');
  });

  it('returns no fields for an empty or malformed schema', () => {
    expect(buildFormModel({ type: 'object', properties: {} }).fields).toEqual([]);
    expect(buildFormModel(undefined).fields).toEqual([]);
    expect(buildFormModel('nope').fields).toEqual([]);
    expect(buildFormModel({ properties: { x: null } }).fields[0]).toMatchObject({ name: 'x', control: 'text' });
  });

  it('treats a non-string enum as a select and keeps the value types', () => {
    const model = buildFormModel({ properties: { depth: { type: 'integer', enum: [1, 2, 3] } } });
    expect(model.fields[0].control).toBe('select');
    expect(coerceValues(model, { depth: '2' }).args).toEqual({ depth: 2 });
  });
});

describe('coerceValues', () => {
  const model = buildFormModel(findSymbolSchema);

  it('omits empty optional fields', () => {
    expect(coerceValues(model, { name: 'Cart', kind: '', topK: '' })).toEqual({
      ok: true,
      args: { name: 'Cart' },
      errors: {},
    });
  });

  it('reports a missing required field', () => {
    const out = coerceValues(model, { name: '   ' });
    expect(out.ok).toBe(false);
    expect(out.errors.name).toBe('Required');
  });

  it('converts integers and enforces the range', () => {
    expect(coerceValues(model, { name: 'x', topK: '25' }).args).toEqual({ name: 'x', topK: 25 });
    expect(coerceValues(model, { name: 'x', topK: '0' }).errors.topK).toBe('Must be at least 1');
    expect(coerceValues(model, { name: 'x', topK: '201' }).errors.topK).toBe('Must be at most 200');
    expect(coerceValues(model, { name: 'x', topK: '2.5' }).errors.topK).toBe('Must be a whole number');
    expect(coerceValues(model, { name: 'x', topK: 'abc' }).errors.topK).toBe('Must be a number');
  });

  it('accepts decimals for number fields', () => {
    const m = buildFormModel({ properties: { minScore: { type: 'number', minimum: 0, maximum: 1 } } });
    expect(coerceValues(m, { minScore: '0.35' }).args).toEqual({ minScore: 0.35 });
    expect(coerceValues(m, { minScore: '1.5' }).errors.minScore).toBe('Must be at most 1');
  });

  it('rejects a value outside the enum', () => {
    expect(coerceValues(model, { name: 'x', kind: 'gizmo' }).errors.kind).toBe('Must be one of: function, class');
  });

  it('enforces maxLength', () => {
    const m = buildFormModel({ properties: { p: { type: 'string', maxLength: 3 } } });
    expect(coerceValues(m, { p: 'abcd' }).errors.p).toBe('Must be at most 3 characters');
  });

  it('keeps string values verbatim', () => {
    expect(coerceValues(model, { name: ' a b ' }).args.name).toBe(' a b ');
  });

  it('handles booleans as unset, true or false', () => {
    const m = buildFormModel({ properties: { includeNested: { type: 'boolean' } } });
    expect(coerceValues(m, { includeNested: '' }).args).toEqual({});
    expect(coerceValues(m, { includeNested: 'false' }).args).toEqual({ includeNested: false });
    expect(coerceValues(m, { includeNested: true }).args).toEqual({ includeNested: true });
  });

  it('parses JSON fields and reports invalid JSON', () => {
    const m = buildFormModel({ properties: { filter: { type: 'object' } } });
    expect(coerceValues(m, { filter: '{"a":1}' }).args).toEqual({ filter: { a: 1 } });
    expect(coerceValues(m, { filter: '{oops' }).errors.filter).toBe('Must be valid JSON');
  });
});

describe('initialValues', () => {
  it('turns prefilled arguments into raw control values', () => {
    const model = buildFormModel({
      properties: {
        symbolId: { type: 'string' },
        maxDepth: { type: 'integer' },
        flag: { type: 'boolean' },
        extra: { type: 'object' },
      },
    });
    expect(initialValues(model, { symbolId: 'abc', maxDepth: 2, flag: false, extra: { a: 1 }, unknown: 9 })).toEqual({
      symbolId: 'abc',
      maxDepth: '2',
      flag: 'false',
      extra: '{"a":1}',
    });
  });

  it('starts empty without a prefill', () => {
    expect(initialValues(buildFormModel(findSymbolSchema))).toEqual({ name: '', kind: '', topK: '' });
  });
});
