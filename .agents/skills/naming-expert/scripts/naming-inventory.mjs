#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, relative, resolve } from 'node:path';

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.kts',
  '.swift',
  '.md',
  '.json',
  '.yaml',
  '.yml',
]);
const CODE_EXTENSIONS = new Set([...SOURCE_EXTENSIONS].filter((extension) => !['.md', '.json', '.yaml', '.yml'].includes(extension)));
const SKIP_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vite',
  'coverage',
  'dist',
  'docs/evidence',
  'node_modules',
  'playwright-report',
  'test-results',
]);
const MAX_FILE_BYTES = 2_000_000;
const SIMILARITY_STOP_WORDS = new Set([
  'app',
  'core',
  'index',
  'main',
  'package',
  'packages',
  'src',
  'test',
  'tests',
  'type',
  'types',
]);

function usage() {
  return `Usage:
  node naming-inventory.mjs [options] [scope...]

Options:
  --query <term>           Add a current or candidate term; repeat as needed
  --json                   Emit JSON instead of the reader report
  --limit <n>              Limit displayed samples per section (default: 20)
  --min-similarity <0..1>  Similar-file threshold (default: 0.55)
  --help                   Show this help

Examples:
  node naming-inventory.mjs --query sessionKey src/agents/session
  node naming-inventory.mjs --query channel-installation --query plugin src/channels src/config
  node naming-inventory.mjs --json src/runners`;
}

function parseArgs(argv) {
  const options = { json: false, limit: 20, minSimilarity: 0.55, queries: [], scopes: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--query') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--query requires a value');
      options.queries.push(value);
      index += 1;
      continue;
    }
    if (arg === '--limit') {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 1 || value > 500) throw new Error('--limit must be an integer from 1 to 500');
      options.limit = value;
      index += 1;
      continue;
    }
    if (arg === '--min-similarity') {
      const value = Number(argv[index + 1]);
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('--min-similarity must be between 0 and 1');
      options.minSimilarity = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`unknown option: ${arg}`);
    options.scopes.push(arg);
  }
  if (options.scopes.length === 0) options.scopes.push('src');
  return options;
}

function splitWords(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((word) => word.toLowerCase())
    .filter(Boolean);
}

function compactName(value) {
  return splitWords(value).join('');
}

function normalizedFamily(value) {
  return splitWords(value).join('-');
}

function pathWithin(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
}

function displayPath(root, path) {
  const rel = relative(root, path).split('\\').join('/');
  return rel || '.';
}

function shouldSkip(path, root) {
  const rel = displayPath(root, path);
  const parts = rel.split('/');
  return parts.some((part, index) => SKIP_DIRECTORIES.has(part) || SKIP_DIRECTORIES.has(parts.slice(0, index + 1).join('/')));
}

function collectFiles(root, scopes) {
  const files = new Set();
  const visit = (path) => {
    if (shouldSkip(path, root)) return;
    let stat;
    try {
      stat = statSync(path);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        visit(resolve(path, entry.name));
      }
      return;
    }
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES || !SOURCE_EXTENSIONS.has(extname(path))) return;
    files.add(path);
  };

  for (const scope of scopes) {
    const path = resolve(root, scope);
    if (!pathWithin(root, path)) throw new Error(`scope must stay under the working directory: ${scope}`);
    visit(path);
  }
  return [...files].sort();
}

function lineNumberAt(source, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) if (source.charCodeAt(index) === 10) line += 1;
  return line;
}

function declarationPatterns(extension) {
  const patterns = [];
  if (['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].includes(extension)) {
    patterns.push({
      regex: /\b(export\s+)?(?:declare\s+)?(?:default\s+)?(?:async\s+)?(class|interface|type|enum|function|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
      map: (match) => ({ exported: Boolean(match[1]), kind: match[2], name: match[3] }),
    });
  }
  if (extension === '.py') {
    patterns.push({
      regex: /^\s*(class|def)\s+([A-Za-z_][A-Za-z0-9_]*)/gm,
      map: (match) => ({ exported: !match[2].startsWith('_'), kind: match[1] === 'def' ? 'function' : 'class', name: match[2] }),
    });
  }
  if (extension === '.go') {
    patterns.push({
      regex: /^\s*(?:type\s+([A-Za-z_][A-Za-z0-9_]*)\s+(struct|interface)|func\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*))/gm,
      map: (match) => ({
        exported: /^[A-Z]/.test(match[1] || match[3]),
        kind: match[2] || 'function',
        name: match[1] || match[3],
      }),
    });
  }
  if (extension === '.rs') {
    patterns.push({
      regex: /^\s*(pub(?:\([^)]*\))?\s+)?(?:async\s+)?(struct|enum|trait|type|fn|const|static)\s+([A-Za-z_][A-Za-z0-9_]*)/gm,
      map: (match) => ({ exported: Boolean(match[1]), kind: match[2] === 'fn' ? 'function' : match[2], name: match[3] }),
    });
  }
  if (['.java', '.kt', '.kts', '.swift'].includes(extension)) {
    patterns.push({
      regex: /\b(class|interface|enum|object|protocol|struct|typealias|fun|func)\s+([A-Za-z_][A-Za-z0-9_]*)/g,
      map: (match) => ({
        exported: /\b(public|open)\b/.test(match.input.slice(Math.max(0, match.index - 40), match.index)),
        kind: ['fun', 'func'].includes(match[1]) ? 'function' : match[1],
        name: match[2],
      }),
    });
  }
  return patterns;
}

function extractDeclarations(source, extension, file) {
  const declarations = [];
  const seen = new Set();
  for (const pattern of declarationPatterns(extension)) {
    pattern.regex.lastIndex = 0;
    for (const match of source.matchAll(pattern.regex)) {
      const declaration = pattern.map(match);
      const key = `${declaration.kind}:${declaration.name}:${match.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      declarations.push({ ...declaration, file, line: lineNumberAt(source, match.index) });
    }
  }
  return declarations;
}

function extractImports(source, extension) {
  const values = [];
  const add = (value) => {
    const owner = value.split('/').filter(Boolean).pop();
    if (owner) values.push(owner.replace(/\.[^.]+$/, ''));
  };
  if (['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].includes(extension)) {
    for (const match of source.matchAll(/(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)) add(match[1]);
  } else if (extension === '.py') {
    for (const match of source.matchAll(/^\s*(?:from|import)\s+([A-Za-z0-9_.]+)/gm)) add(match[1]);
  } else if (extension === '.go') {
    for (const match of source.matchAll(/['"]([^'"]+)['"]/g)) add(match[1]);
  }
  return values;
}

function fileStem(path) {
  return basename(path)
    .replace(/\.(d\.)?(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|go|rs|java|kt|kts|swift|md|json|ya?ml)$/i, '')
    .replace(/\.(test|spec)$/i, '');
}

function analyzeFile(root, path) {
  const source = readFileSync(path, 'utf8');
  const rel = displayPath(root, path);
  const extension = extname(path);
  const declarations = CODE_EXTENSIONS.has(extension) ? extractDeclarations(source, extension, rel) : [];
  const imports = CODE_EXTENSIONS.has(extension) ? extractImports(source, extension) : [];
  const signature = new Set([
    ...splitWords(fileStem(path)),
    ...declarations.flatMap((declaration) => splitWords(declaration.name)),
    ...imports.flatMap(splitWords),
  ].filter((word) => word.length > 2 && !SIMILARITY_STOP_WORDS.has(word)));
  return { declarations, extension, imports, path: rel, signature, source, stem: fileStem(path) };
}

function counted(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function sortedCounts(counts) {
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function buildRoleInventory(declarations) {
  const roles = new Map();
  for (const declaration of declarations) {
    const role = declaration.kind;
    const entry = roles.get(role) ?? { names: [], suffixes: [] };
    entry.names.push(declaration.name);
    const words = splitWords(declaration.name);
    if (words.length > 1) entry.suffixes.push(words.at(-1));
    roles.set(role, entry);
  }
  return [...roles]
    .map(([role, entry]) => ({
      role,
      declarations: entry.names.length,
      uniqueNames: new Set(entry.names).size,
      commonSuffixes: sortedCounts(counted(entry.suffixes)).filter((item) => item.count >= 2).slice(0, 12),
    }))
    .sort((a, b) => b.declarations - a.declarations || a.role.localeCompare(b.role));
}

function buildNameFamilies(files, declarations) {
  const families = new Map();
  const add = (value, location, role) => {
    const family = normalizedFamily(value);
    if (!family || splitWords(value).length === 0) return;
    const entry = families.get(family) ?? { occurrences: [], variants: new Set() };
    entry.variants.add(value);
    entry.occurrences.push({ location, role, value });
    families.set(family, entry);
  };
  for (const file of files) add(file.stem, file.path, 'file');
  for (const declaration of declarations) add(declaration.name, `${declaration.file}:${declaration.line}`, declaration.kind);
  return [...families]
    .filter(([, entry]) => entry.variants.size > 1 && entry.occurrences.length > 2)
    .map(([family, entry]) => ({
      family,
      occurrences: entry.occurrences.length,
      variants: [...entry.variants].sort(),
      roles: [...new Set(entry.occurrences.map((occurrence) => occurrence.role))].sort(),
      samples: entry.occurrences.slice(0, 8),
    }))
    .sort((a, b) => b.occurrences - a.occurrences || a.family.localeCompare(b.family));
}

function buildPrefixClusters(files) {
  const clusters = new Map();
  for (const file of files) {
    const words = splitWords(file.stem);
    if (words.length < 2) continue;
    const directory = dirname(file.path).split('\\').join('/');
    for (const width of [2, 1]) {
      const prefix = words.slice(0, width).join('-');
      if (['index', 'test', 'tests'].includes(prefix)) continue;
      const key = `${directory}\u0000${prefix}`;
      const entry = clusters.get(key) ?? { directory, files: new Set(), prefix, width };
      entry.files.add(file.path);
      clusters.set(key, entry);
    }
  }
  const candidates = [...clusters.values()].filter((entry) => entry.files.size >= 3);
  return candidates
    .filter((entry) => {
      if (entry.width === 2) return true;
      return !candidates.some(
        (other) =>
          other.width === 2 &&
          other.directory === entry.directory &&
          other.prefix.startsWith(`${entry.prefix}-`) &&
          other.files.size === entry.files.size,
      );
    })
    .map((entry) => ({ directory: entry.directory, prefix: entry.prefix, files: [...entry.files].sort() }))
    .sort((a, b) => b.files.length - a.files.length || a.directory.localeCompare(b.directory) || a.prefix.localeCompare(b.prefix));
}

function jaccard(left, right) {
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function buildSimilarFiles(files, minSimilarity) {
  const tokenFiles = new Map();
  files.forEach((file, index) => {
    for (const token of file.signature) {
      const indexes = tokenFiles.get(token) ?? [];
      indexes.push(index);
      tokenFiles.set(token, indexes);
    }
  });

  const sharedCounts = new Map();
  for (const indexes of tokenFiles.values()) {
    if (indexes.length < 2 || indexes.length > 40) continue;
    for (let left = 0; left < indexes.length; left += 1) {
      for (let right = left + 1; right < indexes.length; right += 1) {
        const key = `${indexes[left]}:${indexes[right]}`;
        sharedCounts.set(key, (sharedCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const pairs = [];
  for (const [key, sharedTokens] of sharedCounts) {
    if (sharedTokens < 3) continue;
    const [leftIndex, rightIndex] = key.split(':').map(Number);
    const left = files[leftIndex];
    const right = files[rightIndex];
    if (left.signature.size < 4 || right.signature.size < 4) continue;
    const score = jaccard(left.signature, right.signature);
    if (score < minSimilarity) continue;
    pairs.push({
      left: left.path,
      right: right.path,
      score: Number(score.toFixed(3)),
      sharedTokens,
      common: [...left.signature].filter((token) => right.signature.has(token)).sort().slice(0, 16),
    });
  }
  return pairs.sort((a, b) => b.score - a.score || b.sharedTokens - a.sharedTokens || a.left.localeCompare(b.left));
}

function buildQueryEvidence(query, files, declarations) {
  const queryWords = splitWords(query);
  const queryCompact = compactName(query);
  const exactNames = [];
  const familyNames = [];
  const matchedFiles = new Set();

  const consider = (value, role, location) => {
    const valueCompact = compactName(value);
    const valueWords = splitWords(value);
    if (valueCompact === queryCompact) {
      exactNames.push({ value, role, location });
      matchedFiles.add(location.split(':')[0]);
    } else if (queryWords.length > 0 && queryWords.every((word) => valueWords.includes(word))) {
      familyNames.push({ value, role, location });
      matchedFiles.add(location.split(':')[0]);
    }
  };

  for (const file of files) consider(file.stem, 'file', file.path);
  for (const declaration of declarations) consider(declaration.name, declaration.kind, `${declaration.file}:${declaration.line}`);

  const occurrences = [];
  const queryLower = query.toLowerCase();
  for (const file of files) {
    const lines = file.source.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].toLowerCase().includes(queryLower)) continue;
      occurrences.push({ file: file.path, line: index + 1, text: lines[index].trim().slice(0, 240) });
      matchedFiles.add(file.path);
    }
  }

  const related = [];
  for (const declaration of declarations) {
    if (!matchedFiles.has(declaration.file)) continue;
    if (compactName(declaration.name) === queryCompact) continue;
    related.push({ name: declaration.name, role: declaration.kind, location: `${declaration.file}:${declaration.line}` });
  }

  const siblingRoles = new Set(exactNames.filter((entry) => entry.role !== 'file').map((entry) => entry.role));
  const siblingDirectories = new Set(
    exactNames
      .filter((entry) => entry.role !== 'file')
      .map((entry) => dirname(entry.location.split(':')[0]).split('\\').join('/')),
  );
  const siblings = declarations
    .filter(
      (declaration) =>
        siblingRoles.has(declaration.kind) && siblingDirectories.has(dirname(declaration.file).split('\\').join('/')) &&
        compactName(declaration.name) !== queryCompact,
    )
    .map((declaration) => ({ name: declaration.name, role: declaration.kind, location: `${declaration.file}:${declaration.line}` }));

  return {
    query,
    totals: {
      exactNames: exactNames.length,
      familyNames: familyNames.length,
      occurrences: occurrences.length,
      relatedNames: related.length,
      sameRoleSiblings: siblings.length,
    },
    exactNames,
    familyNames,
    occurrences,
    relatedNames: related,
    sameRoleSiblings: siblings,
  };
}

function limitedSection(values, limit) {
  return { displayed: Math.min(values.length, limit), total: values.length, items: values.slice(0, limit) };
}

function buildReport(root, options) {
  const paths = collectFiles(root, options.scopes);
  const files = paths.map((path) => analyzeFile(root, path));
  const declarations = files.flatMap((file) => file.declarations);
  const roleInventory = buildRoleInventory(declarations);
  const nameFamilies = buildNameFamilies(files, declarations);
  const prefixClusters = buildPrefixClusters(files);
  const similarFiles = buildSimilarFiles(files, options.minSimilarity);
  const queryEvidence = options.queries.map((query) => buildQueryEvidence(query, files, declarations));

  return {
    schemaVersion: 1,
    root,
    scopes: options.scopes,
    summary: {
      scannedFiles: files.length,
      codeFiles: files.filter((file) => CODE_EXTENSIONS.has(file.extension)).length,
      declarations: declarations.length,
      uniqueDeclarationNames: new Set(declarations.map((declaration) => declaration.name)).size,
      queries: options.queries.length,
      completePrefixClusters: prefixClusters.length,
      completeNameFamilies: nameFamilies.length,
      completeSimilarFilePairs: similarFiles.length,
    },
    roleInventory,
    queryEvidence: queryEvidence.map((entry) => ({
      query: entry.query,
      totals: entry.totals,
      exactNames: limitedSection(entry.exactNames, options.limit),
      familyNames: limitedSection(entry.familyNames, options.limit),
      occurrences: limitedSection(entry.occurrences, options.limit),
      relatedNames: limitedSection(entry.relatedNames, options.limit),
      sameRoleSiblings: limitedSection(entry.sameRoleSiblings, options.limit),
    })),
    nameFamilies: limitedSection(nameFamilies, options.limit),
    prefixClusters: limitedSection(prefixClusters, options.limit),
    similarFiles: limitedSection(similarFiles, options.limit),
  };
}

function printItems(section, render) {
  if (section.total === 0) {
    process.stdout.write('  none\n');
    return;
  }
  for (const item of section.items) process.stdout.write(`  ${render(item)}\n`);
  if (section.displayed < section.total) process.stdout.write(`  ... ${section.total - section.displayed} more (complete total: ${section.total})\n`);
}

function printReport(report) {
  const { summary } = report;
  process.stdout.write('Naming inventory\n');
  process.stdout.write(`  scopes: ${report.scopes.join(', ')}\n`);
  process.stdout.write(`  files: ${summary.scannedFiles} (${summary.codeFiles} code)\n`);
  process.stdout.write(`  declarations: ${summary.declarations} (${summary.uniqueDeclarationNames} unique names)\n`);
  process.stdout.write(
    `  complete findings: ${summary.completePrefixClusters} prefix clusters, ${summary.completeNameFamilies} cross-artifact name families, ${summary.completeSimilarFilePairs} similar-file pairs\n`,
  );

  for (const query of report.queryEvidence) {
    process.stdout.write(`\nQuery: ${query.query}\n`);
    process.stdout.write(`  totals: ${JSON.stringify(query.totals)}\n`);
    process.stdout.write('  exact names:\n');
    printItems(query.exactNames, (item) => `${item.value} [${item.role}] ${item.location}`);
    process.stdout.write('  family names:\n');
    printItems(query.familyNames, (item) => `${item.value} [${item.role}] ${item.location}`);
    process.stdout.write('  same-role siblings:\n');
    printItems(query.sameRoleSiblings, (item) => `${item.name} [${item.role}] ${item.location}`);
    process.stdout.write('  nearby declarations:\n');
    printItems(query.relatedNames, (item) => `${item.name} [${item.role}] ${item.location}`);
    process.stdout.write('  text occurrences:\n');
    printItems(query.occurrences, (item) => `${item.file}:${item.line} ${item.text}`);
  }

  process.stdout.write('\nDeclaration roles and suffix families\n');
  for (const role of report.roleInventory) {
    const suffixes = role.commonSuffixes.map((suffix) => `${suffix.name}:${suffix.count}`).join(', ') || 'none';
    process.stdout.write(`  ${role.role}: ${role.declarations} declarations, ${role.uniqueNames} unique; suffixes ${suffixes}\n`);
  }

  process.stdout.write('\nRepeated filename prefixes in one directory (inspect for pseudo-grouping)\n');
  printItems(report.prefixClusters, (item) => `${item.directory} :: ${item.prefix}-* (${item.files.length}) :: ${item.files.join(', ')}`);

  process.stdout.write('\nCross-artifact name families (expected case transforms or possible drift)\n');
  printItems(report.nameFamilies, (item) => `${item.family} (${item.occurrences}) :: ${item.variants.join(', ')} :: roles ${item.roles.join(', ')}`);

  process.stdout.write('\nSimilar file signatures (read source before inferring shared semantics)\n');
  printItems(
    report.similarFiles,
    (item) => `${item.score.toFixed(3)} ${item.left} <-> ${item.right} :: ${item.common.join(', ')}`,
  );
}

try {
  const options = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const report = buildReport(root, options);
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else printReport(report);
} catch (error) {
  process.stderr.write(`naming-inventory: ${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`);
  process.exit(1);
}
