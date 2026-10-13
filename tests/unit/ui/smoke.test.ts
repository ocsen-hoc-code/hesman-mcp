import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { registerAllTools } from '../../../src/server/tools/index.js';
import { TOOLS } from '../../../src/ui/public/js/mock/tools.js';
import { VIEWS } from '../../../src/ui/public/js/lib/router.js';
import { buildFormModel, coerceValues } from '../../../src/ui/public/js/lib/schema-form.js';

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src/ui/public');

interface RealTool {
  name: string;
  description: string;
  inputSchema: { properties: Record<string, { type?: string; enum?: unknown[] }>; required?: string[] };
}

/** The tools the real server registers, captured without starting a server or opening a store. */
function realTools(): RealTool[] {
  const tools: RealTool[] = [];
  const server = { registerTool: (name: string, description: string, inputSchema: RealTool['inputSchema']) => tools.push({ name, description, inputSchema }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerAllTools(server as any, {} as any, {} as any, { projectRoot: '.' } as any);
  return tools;
}

describe('dashboard smoke checks', () => {
  it('every view of the navigation is a module that exports mount()', async () => {
    const html = readFileSync(resolve(PUBLIC_DIR, 'index.html'), 'utf8');
    const linked = [...html.matchAll(/data-view="([a-z]+)"/g)].map((m) => m[1]);
    expect(linked).toEqual(VIEWS);
    for (const view of VIEWS) {
      const module = await import(`../../../src/ui/public/js/views/${view}.js`);
      expect(typeof module.mount, view).toBe('function');
    }
  });

  it('the mock tools take the same arguments as the tools the real server registers', () => {
    // Descriptions are shortened in the mock on purpose; everything a form depends on must match.
    const shape = (tool: RealTool) => ({
      required: [...(tool.inputSchema.required ?? [])].sort(),
      properties: Object.fromEntries(
        Object.entries(tool.inputSchema.properties).map(([name, prop]) => {
          const { description: _description, ...rest } = prop as Record<string, unknown>;
          return [name, rest];
        }),
      ),
    });
    const real = realTools();
    expect(TOOLS.map((t: RealTool) => t.name).sort()).toEqual(real.map((t) => t.name).sort());
    for (const tool of real) {
      expect(shape(TOOLS.find((t: RealTool) => t.name === tool.name)), tool.name).toEqual(shape(tool));
    }
  });

  it('the playground builds a typed form for every argument of every real tool', () => {
    for (const tool of realTools()) {
      const model = buildFormModel(tool.inputSchema);
      expect(model.fields.map((f: { name: string }) => f.name).sort(), tool.name).toEqual(Object.keys(tool.inputSchema.properties).sort());
      // No argument falls back to the raw JSON text field.
      expect(model.fields.filter((f: { control: string }) => f.control === 'json'), tool.name).toEqual([]);
      const missing = coerceValues(model, {});
      expect(Object.keys(missing.errors).sort(), tool.name).toEqual([...(tool.inputSchema.required ?? [])].sort());
    }
  });
});
