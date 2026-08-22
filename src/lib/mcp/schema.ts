export function stringProp(description: string) {
  return { type: 'string', description }
}

export function numberProp(description: string) {
  return { type: 'number', description }
}

export function boolProp(description: string) {
  return { type: 'boolean', description }
}

export function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required, additionalProperties: false }
}

export function enumProp(description: string, values: string[]) {
  return { type: 'string', description, enum: values }
}
