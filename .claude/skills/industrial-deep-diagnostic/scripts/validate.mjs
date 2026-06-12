import fs from 'node:fs';

function usage() {
  console.error('Usage: node validate.mjs <schema.json> <data.json>');
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function checkType(value, expected) {
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (expected === 'integer') return Number.isInteger(value);
  return typeof value === expected;
}

function validate(schema, data, path = '$') {
  const errors = [];

  if (schema.type && !checkType(data, schema.type)) {
    return [`${path} should be ${schema.type}`];
  }

  if (schema.enum && !schema.enum.includes(data)) {
    errors.push(`${path} should be one of ${schema.enum.join(', ')}`);
  }

  if (typeof data === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) errors.push(`${path} should be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && data > schema.maximum) errors.push(`${path} should be <= ${schema.maximum}`);
  }

  if (schema.type === 'object') {
    for (const key of schema.required || []) {
      if (!(key in data)) errors.push(`${path}.${key} is required`);
    }

    for (const [key, child] of Object.entries(schema.properties || {})) {
      if (key in data) errors.push(...validate(child, data[key], `${path}.${key}`));
    }

    if (schema.additionalProperties) {
      const additionalSchema = schema.additionalProperties;
      for (const [key, value] of Object.entries(data)) {
        if (!schema.properties || !(key in schema.properties)) {
          errors.push(...validate(additionalSchema, value, `${path}.${key}`));
        }
      }
    }
  }

  if (schema.type === 'array') {
    if (schema.minItems !== undefined && data.length < schema.minItems) errors.push(`${path} should have at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && data.length > schema.maxItems) errors.push(`${path} should have at most ${schema.maxItems} items`);
    if (schema.items) {
      data.forEach((item, index) => {
        errors.push(...validate(schema.items, item, `${path}[${index}]`));
      });
    }
  }

  return errors;
}

if (process.argv.length < 4) usage();

const [, , schemaPath, dataPath] = process.argv;
const schema = readJson(schemaPath);
const data = readJson(dataPath);
const errors = validate(schema, data);

if (errors.length > 0) {
  fail(`Schema validation failed for ${dataPath}\n${errors.join('\n')}`);
}

console.log(`Schema validation passed for ${dataPath}`);
