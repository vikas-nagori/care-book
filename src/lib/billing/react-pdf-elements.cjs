// Keep this require dynamic so Next's React Server Components alias does not
// replace the classic React instance used by @react-pdf/renderer.
const runtimeRequire = eval('require')
const React = runtimeRequire('react')

module.exports = {
  createElement: React.createElement,
}
