module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: 2023,
    sourceType: 'module',
  },
  env: {
    node: true,
    es2023: true,
  },
  extends: ['eslint:recommended', 'prettier'],
  rules: {
    'no-console': ['error', { allow: ['warn', 'error', 'log'] }],
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'no-implicit-coercion': ['error', { boolean: true, number: true, string: true }],
    'no-eval': 'error',
    'no-new-func': 'error',
    'no-return-await': 'error',
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['ethers', 'viem'],
            message: 'Import chain libs only through src/adapters/xrpl-evm/ or src/adapters/base/.',
          },
        ],
      },
    ],
  },
  overrides: [
    {
      files: ['tests/**/*.js', 'scripts/**/*.js', 'packages/**/*.js'],
      rules: { 'no-restricted-imports': 'off' },
    },
  ],
  ignorePatterns: ['dist', 'cdk.out', 'node_modules', 'coverage'],
};
