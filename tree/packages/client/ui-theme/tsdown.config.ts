import { clientBundle } from '../tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-client-ui-theme',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  {
    lib: {
      copy: [
        { from: 'src/styles/*', to: 'lib/styles' },
        { from: 'src/styles/skins/*', to: 'lib/styles/skins' },
        { from: 'src/styles/skins/assets/*', to: 'lib/styles/skins/assets' },
        // Generated skin sheets; the manifest beside them is a TypeScript
        // module the bundle imports, not a style asset, so it stays behind.
        { from: 'src/styles/skins/generated/*.css', to: 'lib/styles/skins/generated' },
      ],
    },
  },
)
