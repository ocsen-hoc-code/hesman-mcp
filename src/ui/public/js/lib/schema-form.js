// Turns a tool's JSON-Schema `inputSchema` into a form model, and form values into tool arguments.
// Covers what Hesman's tools use: strings, enums, integers and numbers with bounds, booleans.
// Anything else (objects, arrays) becomes a JSON text field. No DOM access.

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function controlFor(prop) {
  if (Array.isArray(prop.enum) && prop.enum.length > 0) return 'select';
  switch (prop.type) {
    case 'integer':
      return 'integer';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
    case 'array':
      return 'json';
    default:
      return 'text';
  }
}

/** `{ fields: [{ name, control, required, description, min, max, maxLength, options }] }`, required fields first. */
export function buildFormModel(inputSchema) {
  if (!isObject(inputSchema) || !isObject(inputSchema.properties)) return { fields: [] };
  const required = new Set(Array.isArray(inputSchema.required) ? inputSchema.required : []);
  const fields = Object.entries(inputSchema.properties).map(([name, raw]) => {
    const prop = isObject(raw) ? raw : {};
    const control = controlFor(prop);
    return {
      name,
      control,
      required: required.has(name),
      description: typeof prop.description === 'string' ? prop.description : '',
      min: typeof prop.minimum === 'number' ? prop.minimum : undefined,
      max: typeof prop.maximum === 'number' ? prop.maximum : undefined,
      maxLength: typeof prop.maxLength === 'number' ? prop.maxLength : undefined,
      options: control === 'select' ? [...prop.enum] : undefined,
    };
  });
  return { fields: [...fields.filter((f) => f.required), ...fields.filter((f) => !f.required)] };
}

function coerceNumber(field, text) {
  const value = Number(text);
  if (text.trim() === '' || !Number.isFinite(value)) return { error: 'Must be a number' };
  if (field.control === 'integer' && !Number.isInteger(value)) return { error: 'Must be a whole number' };
  if (field.min !== undefined && value < field.min) return { error: `Must be at least ${field.min}` };
  if (field.max !== undefined && value > field.max) return { error: `Must be at most ${field.max}` };
  return { value };
}

function coerceField(field, raw) {
  switch (field.control) {
    case 'boolean':
      return { value: raw === true || raw === 'true' };
    case 'integer':
    case 'number':
      return coerceNumber(field, String(raw));
    case 'select': {
      const match = field.options.find((option) => String(option) === String(raw));
      return match === undefined ? { error: `Must be one of: ${field.options.join(', ')}` } : { value: match };
    }
    case 'json':
      try {
        return { value: JSON.parse(String(raw)) };
      } catch {
        return { error: 'Must be valid JSON' };
      }
    default: {
      const text = String(raw);
      if (field.maxLength !== undefined && text.length > field.maxLength) {
        return { error: `Must be at most ${field.maxLength} characters` };
      }
      return { value: text };
    }
  }
}

const isBlank = (raw) => raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');

/** Validate raw control values and build the tool arguments. Empty optional fields are left out. */
export function coerceValues(model, rawValues) {
  const args = {};
  const errors = {};
  for (const field of model.fields) {
    const raw = rawValues ? rawValues[field.name] : undefined;
    if (isBlank(raw)) {
      if (field.required) errors[field.name] = 'Required';
      continue;
    }
    const result = coerceField(field, raw);
    if (result.error) errors[field.name] = result.error;
    else args[field.name] = result.value;
  }
  return { ok: Object.keys(errors).length === 0, args, errors };
}

/** Raw control values for a form, optionally prefilled from tool arguments. */
export function initialValues(model, prefill = {}) {
  const values = {};
  for (const field of model.fields) {
    const given = isObject(prefill) ? prefill[field.name] : undefined;
    if (given === undefined || given === null) values[field.name] = '';
    else if (field.control === 'json') values[field.name] = typeof given === 'string' ? given : JSON.stringify(given);
    else values[field.name] = String(given);
  }
  return values;
}
