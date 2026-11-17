const fs = require('node:fs');
const path = require('node:path');

jest.mock('electron', () => ({
  app: { getPath: jest.fn(() => process.cwd()) },
  dialog: { showOpenDialog: jest.fn() }
}));

const { parseRequest, stringifyRequest, parseCollection, stringifyCollection, parseFolder, stringifyFolder, saveRequestCustomSettings } = require('@usebruno/filestore');
const {
  getCustomSettingsCollectionPath,
  createRequestWithCustomSettings,
  loadRequestCustomSettingsWithMigration,
  writeRequestWithCustomSettings
} = require('./request-custom-settings');
const { buildTree } = require('../services/mount/tree-builder');

const request = (value, encodeValue) => ({
  type: 'http-request',
  name: 'Search',
  seq: 1,
  request: {
    method: 'GET',
    url: 'https://example.com',
    params: [{ name: 'q', value, type: 'query', enabled: true, encodeValue }],
    headers: [],
    body: { mode: 'none' },
    auth: { mode: 'none' }
  }
});

describe('custom request settings persistence', () => {
  let directory;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(__dirname, '.query-encoding-'));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it.each(['bru', 'yml'])('reloads bearer prefixes on requests, folders and the collection without polluting the %s cache', (format) => {
    const auth = { mode: 'bearer', bearer: { token: 'secret', prefix: 'Custom' } };
    const root = { meta: { name: 'Auth' }, request: { auth } };
    const item = request('query', true);
    item.request.auth = auth;
    const rootFile = format === 'bru' ? 'collection.bru' : 'opencollection.yml';
    const entries = new Map([
      [rootFile, { data: parseCollection(stringifyCollection(root, { name: 'Auth' }, { format }), { format }) }],
      [path.join('API', `folder.${format}`), { data: parseFolder(stringifyFolder(root, { format }), { format }) }],
      [path.join('API', `request.${format}`), { data: parseRequest(stringifyRequest(item, { format }), { format }) }]
    ]);
    for (const filename of entries.keys()) saveRequestCustomSettings(directory, path.join(directory, filename), item, format);
    const tree = buildTree(directory, entries);
    expect(tree.root.request.auth.bearer.prefix).toBe('Custom');
    expect(tree.items[0].root.request.auth.bearer.prefix).toBe('Custom');
    expect(tree.items[0].items[0].request.auth.bearer.prefix).toBe('Custom');
    expect(JSON.stringify([...entries])).not.toContain('"prefix"');
    fs.unlinkSync(path.join(directory, '.bruno-custom.json'));
    const reset = buildTree(directory, entries);
    expect(reset.root.request.auth.bearer).not.toHaveProperty('prefix');
    expect(reset.items[0].root.request.auth.bearer).not.toHaveProperty('prefix');
    expect(reset.items[0].items[0].request.auth.bearer).not.toHaveProperty('prefix');
  });

  it('migrates an inline prefix before a regular request rewrite', () => {
    const item = request('query', true);
    item.request.auth = { mode: 'bearer', bearer: { token: 'secret', prefix: 'Token' } };
    const pathname = path.join(directory, 'Search.bru');
    loadRequestCustomSettingsWithMigration(directory, pathname, item, 'bru');
    const standard = parseRequest(stringifyRequest(item, { format: 'bru' }), { format: 'bru' });
    expect(standard.request.auth.bearer).not.toHaveProperty('prefix');
    expect(loadRequestCustomSettingsWithMigration(directory, pathname, standard, 'bru').request.auth.bearer.prefix).toBe('Token');
  });

  it.each(['bru', 'yml'])('uses the collision-resolved filename when creating a %s request', async (format) => {
    const item = request('a/b', false);
    fs.writeFileSync(path.join(directory, `Search.${format}`), 'existing request');
    const created = await createRequestWithCustomSettings(directory, directory, 'Search', format, item, stringifyRequest(item, { format }));
    const parsed = parseRequest(fs.readFileSync(created.pathname, 'utf8'), { format });
    const tree = buildTree(directory, new Map([[created.filename, { data: parsed }]]));
    expect(created.filename).toBe(`Search 1.${format}`);
    expect(tree.items[0].request.params[0].encodeValue).toBe(false);
    expect(fs.readFileSync(path.join(directory, `Search.${format}`), 'utf8')).toBe('existing request');
    expect(Object.keys(JSON.parse(fs.readFileSync(path.join(directory, '.bruno-custom.json'), 'utf8')).requests)).toEqual(['Search 1']);
  });

  it('reloads sidecar edits and removal over cached request data without polluting the cache', () => {
    const filename = 'Search.bru';
    const pathname = path.join(directory, filename);
    const cachedData = parseRequest(stringifyRequest(request('a/b', true), { format: 'bru' }), { format: 'bru' });
    const entries = new Map([[filename, { data: cachedData }]]);
    saveRequestCustomSettings(directory, pathname, request('a/b', false), 'bru');
    expect(buildTree(directory, entries).items[0].request.params[0].encodeValue).toBe(false);
    expect(cachedData.request.params[0].encodeValue).not.toBe(false);
    fs.unlinkSync(path.join(directory, '.bruno-custom.json'));
    expect(buildTree(directory, entries).items[0].request.params[0].encodeValue).not.toBe(false);
  });

  it.each(['bru', 'yml'])('migrates inline path alternatives before a %s request is rewritten and keeps cached data clean', (format) => {
    const pathname = path.join(directory, `Search.${format}`);
    const item = request('query', false);
    item.request.params.push(
      { name: 'id', value: 'other', type: 'path', enabled: false, description: 'other account' },
      { name: 'id', value: 'selected', type: 'path', enabled: true }
    );
    const loaded = loadRequestCustomSettingsWithMigration(directory, pathname, item, format);
    const content = stringifyRequest(loaded, { format });
    expect(content).not.toContain('other account');
    const cachedData = parseRequest(content, { format });
    const entries = new Map([[`Search.${format}`, { data: cachedData }]]);
    const restored = buildTree(directory, entries).items[0].request.params.filter((param) => param.type === 'path');
    expect(restored).toMatchObject([{ value: 'other', enabled: false }, { value: 'selected', enabled: true }]);
    expect(cachedData.request.params.filter((param) => param.type === 'path')).toHaveLength(1);
    fs.unlinkSync(path.join(directory, '.bruno-custom.json'));
    expect(buildTree(directory, entries).items[0].request.params.filter((param) => param.type === 'path')).toHaveLength(1);
  });

  it('renames the legacy encoding sidecar when opening a collection', () => {
    const legacy = path.join(directory, '.bruno-query-encoding.json');
    fs.writeFileSync(legacy, JSON.stringify({
      version: 1, requests: { Search: [{ name: 'q', occurrence: 0, encodeValue: false }] }
    }));
    const loaded = loadRequestCustomSettingsWithMigration(directory, path.join(directory, 'Search.bru'), request('query', true), 'bru');
    expect(loaded.request.params[0].encodeValue).toBe(false);
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.existsSync(path.join(directory, '.bruno-custom.json'))).toBe(true);
  });

  it('serializes concurrent saves so the sidecar matches the final request bytes', async () => {
    const pathname = path.join(directory, 'Search.bru');
    const first = request('first', false);
    const second = request('second', true);
    await Promise.all([first, second].map((item) =>
      writeRequestWithCustomSettings(directory, pathname, item, 'bru', stringifyRequest(item, { format: 'bru' }))
    ));
    const parsed = parseRequest(fs.readFileSync(pathname, 'utf8'), { format: 'bru' });
    const tree = buildTree(directory, new Map([['Search.bru', { data: parsed }]]));
    expect(tree.items[0].request.params[0].value).toBe('second');
    expect(tree.items[0].request.params[0].encodeValue).not.toBe(false);
  });

  it('does not leave a newly created request behind when sidecar persistence fails', async () => {
    fs.writeFileSync(path.join(directory, '.bruno-custom.json'), 'invalid json');
    const item = request('a/b', false);
    await expect(createRequestWithCustomSettings(directory, directory, 'Search', 'bru', item, stringifyRequest(item, { format: 'bru' }))).rejects.toThrow();
    expect(fs.existsSync(path.join(directory, 'Search.bru'))).toBe(false);
  });

  it('restores request bytes when saving the sidecar fails', async () => {
    const pathname = path.join(directory, 'Search.bru');
    const original = 'original request';
    fs.writeFileSync(pathname, original);
    fs.writeFileSync(path.join(directory, '.bruno-custom.json'), 'invalid json');
    const item = request('changed', false);
    await expect(writeRequestWithCustomSettings(directory, pathname, item, 'bru', stringifyRequest(item, { format: 'bru' })))
      .rejects.toThrow();
    expect(fs.readFileSync(pathname, 'utf8')).toBe(original);
  });

  it('keeps transient encoding beside the transient request rather than outside the original collection', () => {
    const original = path.join(directory, 'original');
    const transient = path.join(directory, 'transient');
    expect(getCustomSettingsCollectionPath(original, path.join(transient, 'Search.bru'))).toBe(transient);
    expect(getCustomSettingsCollectionPath(original, path.join(original, 'nested', 'Search.bru'))).toBe(original);
  });

  it('migrates legacy flags on opening without rewriting existing sidecar entries', () => {
    const sidecarPath = path.join(directory, '.bruno-custom.json');
    const existing = { version: 1, requests: { Search: { queryParamEncoding: [{ name: 'q', occurrence: 0, encodeValue: true }] } } };
    fs.writeFileSync(sidecarPath, JSON.stringify(existing));
    const pathname = path.join(directory, 'Search.bru');
    expect(loadRequestCustomSettingsWithMigration(directory, pathname, request('legacy', false), 'bru').request.params[0].encodeValue).toBe(true);
    expect(JSON.parse(fs.readFileSync(sidecarPath, 'utf8'))).toEqual(existing);

    loadRequestCustomSettingsWithMigration(directory, path.join(directory, 'Other.bru'), request('legacy', false), 'bru');
    const migrated = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
    expect(migrated.requests.Search).toEqual(existing.requests.Search);
    expect(migrated.requests.Other.queryParamEncoding).toEqual([{ name: 'q', occurrence: 0, encodeValue: false }]);
  });
});
