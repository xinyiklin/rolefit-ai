export function parseSuite(args) {
  if (args.length === 0) return 'all';
  if (args.length === 1 && /^--suite=(all|core|extended)$/.test(args[0])) return args[0].slice(8);
  throw new Error('Usage: npm run test:editor:browser -- [--suite=all|core|extended]');
}

export const includesSuite = (suite, owner) => suite === 'all' || suite === owner;

export function wrappingCases(suite) {
  return [80, 512, 4096].flatMap(length => [false, true].map(spaced => ({ length, spaced })))
    .filter(({ length, spaced }) => includesSuite(suite, length === 512 && spaced ? 'core' : 'extended'));
}
