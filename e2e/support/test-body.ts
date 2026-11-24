// Finds the source of one Playwright test by its title, for mutation-manifest.test.ts.
//
// Uses the TypeScript parser, so the body is the test callback's real extent: a `test.setTimeout()`,
// `test.fail()`, `test.skip()`, `test.step()` or a nested `test.describe` inside a test no longer
// cuts it short, and braces inside strings, templates, regexes and comments cannot confuse it.

import ts from 'typescript'

/** `test(...)` and the modifiers that also declare a test when given a title and a callback. */
const DECLARING_MODIFIERS = new Set(['only', 'skip', 'fixme', 'fail'])

function isTestDeclaration(call: ts.CallExpression): boolean {
  const callee = call.expression
  if (ts.isIdentifier(callee)) return callee.text === 'test'
  return ts.isPropertyAccessExpression(callee)
    && ts.isIdentifier(callee.expression)
    && callee.expression.text === 'test'
    && DECLARING_MODIFIERS.has(callee.name.text)
}

function staticTitle(node: ts.Expression | undefined): string | null {
  if (!node) return null
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return null
}

/**
 * The source text of the callback of the test titled `title` (from `async (...) => {` to its
 * closing brace), or null when the file declares no such test. A title must be a plain string or
 * a template literal without substitutions; `test.describe` titles never match.
 */
export function testBody(source: string, title: string): string | null {
  const file = ts.createSourceFile('spec.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let found: string | null = null
  const visit = (node: ts.Node): void => {
    if (found !== null) return
    if (ts.isCallExpression(node) && isTestDeclaration(node) && staticTitle(node.arguments[0]) === title) {
      const callback = [...node.arguments].reverse()
        .find((argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))
      if (callback) {
        found = callback.getText(file)
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}
