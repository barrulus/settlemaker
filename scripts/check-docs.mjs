/** Check public guidance against real files, declarations and compiled examples. */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { SETTLEMAKER_VERSION, SKIN_SLOTS, decodeBurgParam } from '../dist/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const read = path => readFileSync(resolve(root, path), 'utf8');
const pages = ['README.md', 'docs/README.md', 'docs/getting-started.md', 'docs/api.md',
  'docs/geojson.md', 'docs/scene-schema.md', 'docs/url-api.md', 'docs/water-context-v1.md',
  'docs/skins.md', 'docs/current-symbol-library.md', 'docs/artwork-integration.md',
  'docs/fmg-embed-zoom.md', 'docs/development.md', 'docs/test-urls.md', 'docs/gallery.md',
  'docs/schema-v3.md', 'symbols/copperline/README.md', `docs/releases/${pkg.version}.md`];
const withoutCode = text => text.replace(/```[^\n]*\n[\s\S]*?```/g, '');
function anchors(path) {
  const counts = new Map();
  return new Set([...withoutCode(read(path)).matchAll(/^#{1,6}\s+(.+)$/gm)].map(([, heading]) => {
    const slug = heading.toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    return count ? `${slug}-${count}` : slug;
  }));
}
let links = 0;
for (const page of pages) {
  const text = withoutCode(read(page));
  const targets = [...text.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g), ...text.matchAll(/(?:src|href)="([^"]+)"/g)];
  for (const [, target] of targets) {
    let local;
    if (target.startsWith('https://github.com/barrulus/settlemaker/blob/')) {
      const match = target.match(/^https:\/\/github\.com\/barrulus\/settlemaker\/blob\/(v[^/]+)\/(.+)$/);
      assert.ok(match, `Invalid source link in ${page}: ${target}`);
      assert.equal(match[1], `v${pkg.version}`, `Wrong documentation tag in ${page}`);
      local = resolve(root, match[2]);
    } else if (target.startsWith('https://raw.githubusercontent.com/barrulus/settlemaker/')) {
      const match = target.match(/^https:\/\/raw\.githubusercontent\.com\/barrulus\/settlemaker\/(v[^/]+)\/(.+)$/);
      assert.ok(match, `Invalid image link in ${page}: ${target}`);
      assert.equal(match[1], `v${pkg.version}`, `Wrong image tag in ${page}`);
      local = resolve(root, match[2]);
    } else if (/^(?:https?:|mailto:)/.test(target)) continue;
    else local = target.startsWith('#') ? resolve(root, page) + target : resolve(root, dirname(page), target);
    const [path, anchor] = local.split('#');
    assert.ok(existsSync(decodeURIComponent(path)), `Broken link in ${page}: ${target}`);
    if (anchor && path.endsWith('.md')) assert.ok(anchors(path).has(decodeURIComponent(anchor)), `Broken anchor in ${page}: ${target}`);
    links++;
  }
}
assert.equal(SETTLEMAKER_VERSION, pkg.version);
assert.equal(Object.keys(SKIN_SLOTS).length, 693);
const gallery = JSON.parse(read('docs/examples/gallery/fixtures.json'));
assert.equal(gallery.generatorVersion, pkg.version, 'Regenerate the gallery for this release');
for (const fixture of gallery.fixtures) {
  assert.equal(fixture.engine, fixture.burg.population <= 1000 ? 'village' : 'settlement');
  for (const ext of ['svg', 'png']) assert.ok(existsSync(join(root, `docs/examples/gallery/${fixture.id}.${ext}`)));
  if (fixture.previewUrl) {
    assert.ok(!fixture.skin, 'The URL codec does not carry skins');
    assert.deepEqual(await decodeBurgParam(new URL(fixture.previewUrl).searchParams.get('i')), { burg: fixture.burg, seed: fixture.seed });
  }
}

const work = mkdtempSync(join(tmpdir(), 'settlemaker-docs-'));
const entry = pathToFileURL(join(root, 'dist/index.js')).href;
const blocks = (page, language) => [...read(page).matchAll(new RegExp('```' + language + '\\n([\\s\\S]*?)```', 'g'))].map(m => m[1]);
const imports = code => code.replaceAll("from 'settlemaker'", `from '${entry}'`).replaceAll("import('settlemaker')", `import('${entry}')`)
  .replaceAll("import.meta.resolve('settlemaker/docs/examples/copperline.skin.json')", JSON.stringify(pathToFileURL(join(root, 'docs/examples/copperline.skin.json')).href));
function run(name, code) {
  const path = join(work, name + '.mjs');
  writeFileSync(path, imports(code));
  try { execFileSync(process.execPath, [path], { cwd: work, stdio: 'pipe' }); }
  catch (error) { throw new Error(`${name}: ${error.message}\n${error.stderr?.toString().slice(-3000) ?? ''}`); }
}
const quick = blocks('README.md', 'js');
run('readme', quick.join('\n') + '\nif (!result.svg.includes("<svg") || !moonVillage.svg.includes("#68748c")) throw new Error("README output missing");');
for (const [i, code] of blocks('docs/getting-started.md', 'js').entries()) run(`getting-started-${i}`, code);
const html = blocks('docs/getting-started.md', 'html')[0];
const browser = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
  .replace("'./assets/settlemaker.browser.js'", JSON.stringify(pathToFileURL(join(root, 'dist/settlemaker.browser.js')).href));
run('browser-page', 'const element = {}; const document = {querySelector: () => element};\n' + browser + '\nif (!element.innerHTML.includes("<svg")) throw new Error("No browser map");');
const scene = blocks('docs/scene-schema.md', 'js');
run('scene', scene[0]);
const burg = scene[0].match(/const burg = \{[\s\S]*?\n\};/)[0];
run('lower-level', burg + '\n' + scene[1]);
run('tiles', quick[0] + '\n' + blocks('docs/geojson.md', 'js')[0] + '\nif (!rootTileSvg.includes("<svg")) throw new Error("No tile");');
const url = blocks('docs/url-api.md', 'js');
run('url-encode', url[0]);
run('url-renderer', 'const location = {search: "?name=Docs&pop=300&plaza=1&seed=2&roads=20,140,270"};\n' + url[1] + '\nif (result.kind !== "village") throw new Error("Wrong URL engine");');
const typeFiles = [];
for (const page of ['docs/getting-started.md', 'docs/api.md']) {
  for (const [i, code] of blocks(page, 'ts').entries()) {
    const path = join(work, `${page.replaceAll('/', '-')}-${i}.mts`);
    writeFileSync(path, code.replaceAll("from 'settlemaker'", `from '${join(root, 'dist/index.js')}'`));
    typeFiles.push(path);
  }
}
const program = ts.createProgram(typeFiles, { noEmit: true, strict: true, target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, types: [] });
const diagnostics = ts.getPreEmitDiagnostics(program);
assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCanonicalFileName: f => f, getCurrentDirectory: () => work, getNewLine: () => '\n',
}));
console.log(`Passed: ${pages.length} public pages, ${links} local links/anchors, ${gallery.fixtures.length} gallery fixtures, README/Node/browser/URL/scene/tile examples and TypeScript snippets.`);
