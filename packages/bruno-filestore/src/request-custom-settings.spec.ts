import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseRequest, stringifyRequest, parseFolder, stringifyFolder, parseCollection, stringifyCollection } from './index';
import {
  copyRequestCustomSettings,
  deleteRequestCustomSettings,
  loadRequestCustomSettings,
  moveRequestCustomSettings,
  migrateLegacyRequestSettings,
  saveRequestCustomSettings
} from './request-custom-settings';

describe('collection custom request settings', () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-query-encoding-'));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it.each(['bru', 'yml'] as const)('preserves bearer prefixes at every scope after standard Bruno rewrites %s files', (format) => {
    fs.mkdirSync(path.join(directory, 'API'));
    const source = parseRequest('meta {\n  name: Auth\n  type: http\n}\nget {\n  url: https://example.com\n  auth: bearer\n}\nauth:bearer {\n  token: original\n}\n', { format: 'bru' });
    const roots = [
      { filename: format === 'bru' ? 'collection.bru' : 'opencollection.yml', scope: 'collection', key: '/' },
      { filename: path.join('API', `folder.${format}`), scope: 'folder', key: 'API/' },
      { filename: path.join('API', `request.${format}`), scope: 'request', key: 'API/request' }
    ];
    for (const { filename, scope, key } of roots) {
      const item = scope === 'request'
        ? source
        : { meta: { name: 'Auth' }, request: { auth: { mode: 'bearer', bearer: { token: 'original' } } } };
      item.request.auth.bearer.prefix = `Custom-${scope}`;
      const pathname = path.join(directory, filename);
      const serialize = (data: typeof item) => scope === 'request'
        ? stringifyRequest(data, { format })
        : scope === 'folder'
          ? stringifyFolder(data, { format })
          : stringifyCollection(data, { name: 'Auth' }, { format });
      const parse = (content: string) => {
        if (scope === 'request') return parseRequest(content, { format });
        if (scope === 'folder') return parseFolder(content, { format });
        const parsed = parseCollection(content, { format });
        return format === 'yml' ? parsed.collectionRoot : parsed;
      };
      const content = serialize(item);
      expect(content).not.toContain('prefix:');
      fs.writeFileSync(pathname, content);
      saveRequestCustomSettings(directory, pathname, item, format);
      const sidecar = JSON.parse(fs.readFileSync(path.join(directory, '.bruno-custom.json'), 'utf8'));
      expect(sidecar.requests[key]).toEqual({ bearerTokenPrefix: `Custom-${scope}` });
      expect(JSON.stringify(sidecar)).not.toContain('original');

      const standard = parse(fs.readFileSync(pathname, 'utf8'));
      expect(standard.request.auth.bearer).not.toHaveProperty('prefix');
      standard.request.auth.bearer.token = 'edited in regular Bruno';
      fs.writeFileSync(pathname, serialize(standard));
      const reopened = loadRequestCustomSettings(directory, pathname, parse(fs.readFileSync(pathname, 'utf8')));
      expect(reopened.request.auth.bearer).toEqual({ token: 'edited in regular Bruno', prefix: `Custom-${scope}` });

      reopened.request.auth.bearer.prefix = '';
      saveRequestCustomSettings(directory, pathname, reopened, format);
      const reset = JSON.parse(fs.readFileSync(path.join(directory, '.bruno-custom.json'), 'utf8'));
      expect(reset.requests[key]).toBeUndefined();
    }
  });

  it.each(['', 'Bearer'])('creates no sidecar for default bearer prefix %j', (prefix) => {
    saveRequestCustomSettings(directory, path.join(directory, 'request.bru'), {
      request: { auth: { mode: 'bearer', bearer: { token: 'secret', prefix } } }
    }, 'bru');
    expect(fs.existsSync(path.join(directory, '.bruno-custom.json'))).toBe(false);
  });

  it('keeps bearer prefixes on folder copy, move, and format changes', () => {
    const item = { request: { auth: { mode: 'bearer' as const, bearer: { token: 'secret', prefix: 'Custom' } } } };
    saveRequestCustomSettings(directory, path.join(directory, 'source', 'folder.bru'), item, 'bru');
    saveRequestCustomSettings(directory, path.join(directory, 'source', 'request.bru'), item, 'bru');
    copyRequestCustomSettings(directory, path.join(directory, 'source'), directory, path.join(directory, 'copied'));
    moveRequestCustomSettings(directory, path.join(directory, 'copied'), directory, path.join(directory, 'moved'));
    const blank = () => ({ request: { auth: { mode: 'bearer' as const, bearer: { token: 'secret' } } } });
    expect(loadRequestCustomSettings(directory, path.join(directory, 'moved', 'folder.yml'), blank()).request.auth.bearer)
      .toMatchObject({ prefix: 'Custom' });
    expect(loadRequestCustomSettings(directory, path.join(directory, 'moved', 'request.yml'), blank()).request.auth.bearer)
      .toMatchObject({ prefix: 'Custom' });
    deleteRequestCustomSettings(directory, path.join(directory, 'moved'));
    expect(loadRequestCustomSettings(directory, path.join(directory, 'moved', 'folder.yml'), blank()).request.auth.bearer)
      .not.toHaveProperty('prefix');
  });

  it('rejects invalid bearer prefix values in the sidecar', () => {
    fs.writeFileSync(path.join(directory, '.bruno-custom.json'), JSON.stringify({
      version: 1, requests: { request: { bearerTokenPrefix: 42 } }
    }));
    expect(() => loadRequestCustomSettings(directory, path.join(directory, 'request.bru'), { request: {} }))
      .toThrow('Invalid custom settings file');
  });

  it.each(['bru', 'yml'] as const)('preserves options outside %s request files', (format) => {
    const source = format === 'bru'
      ? 'meta {\n  name: example\n  type: http\n  seq: 1\n}\n\nget {\n  url: https://example.com\n  body: none\n}\n\nparams:query {\n  repeated: one\n  repeated: two\n}\n'
      : 'info:\n  name: example\n  type: http\nhttp:\n  method: GET\n  url: https://example.com\n  params:\n    - name: repeated\n      value: one\n      type: query\n    - name: repeated\n      value: two\n      type: query\n';
    const pathname = path.join(directory, `request.${format}`);
    const item = parseRequest(source, { format });
    item.request.params[1].encodeName = false;
    item.request.params[1].encodeValueAsBase64 = true;
    const content = stringifyRequest(item, { format });
    expect(content).not.toMatch(/encodeName|encodeValueAsBase64|queryParamEncoding/);
    fs.writeFileSync(pathname, content);
    saveRequestCustomSettings(directory, pathname, item, format);

    const reopened = parseRequest(fs.readFileSync(pathname, 'utf8'), { format });
    loadRequestCustomSettings(directory, pathname, reopened);
    expect(reopened.request.params[0].encodeName).toBeUndefined();
    expect(reopened.request.params[1]).toMatchObject({ encodeName: false, encodeValueAsBase64: true });

    reopened.request.params[1].value = 'edited by another Bruno';
    fs.writeFileSync(pathname, stringifyRequest(reopened, { format }));
    const edited = parseRequest(fs.readFileSync(pathname, 'utf8'), { format });
    loadRequestCustomSettings(directory, pathname, edited);
    expect(edited.request.params[1]).toMatchObject({ value: 'edited by another Bruno', encodeName: false });
  });

  it.each(['bru', 'yml'] as const)('keeps path alternatives outside %s files and picks up standard Bruno edits', (format) => {
    const pathname = path.join(directory, `request.${format}`);
    const item = parseRequest('meta {\n  name: example\n  type: http\n}\nget {\n  url: https://example.com/:id/:org\n  body: none\n}\n', { format: 'bru' });
    item.request.params = [
      {
        name: 'id',
        value: 'alternative\nwith quotes: \'test\'',
        type: 'path',
        enabled: false,
        description: 'another choice',
        annotations: [{ name: 'custom', value: 'metadata' }]
      },
      { name: 'org', value: 'company', type: 'path', enabled: true },
      { name: 'id', value: 'selected', type: 'path', enabled: true, description: 'current choice' },
      { name: 'q', value: 'query', type: 'query', enabled: true, encodeValue: false }
    ];
    const content = stringifyRequest(item, { format });
    fs.writeFileSync(pathname, content);
    saveRequestCustomSettings(directory, pathname, item, format);
    expect(content).not.toContain('alternative');
    const standard = parseRequest(fs.readFileSync(pathname, 'utf8'), { format });
    const writtenPaths = standard.request.params.filter((param: { type: string }) => param.type === 'path');
    expect(writtenPaths).toHaveLength(2);
    expect(writtenPaths.find((param: { name: string }) => param.name === 'id')).toMatchObject({ value: 'selected', enabled: true });
    expect(writtenPaths.find((param: { name: string }) => param.name === 'org')).toMatchObject({ value: 'company' });
    standard.request.params.find((param: { name: string }) => param.name === 'id').value = 'edited in standard Bruno';
    fs.writeFileSync(pathname, stringifyRequest(standard, { format }));
    const reopened = loadRequestCustomSettings(directory, pathname, parseRequest(fs.readFileSync(pathname, 'utf8'), { format }));
    const alternatives = reopened.request.params.filter((param: { name: string }) => param.name === 'id');
    expect(alternatives).toMatchObject([
      {
        value: 'alternative\nwith quotes: \'test\'',
        enabled: false,
        description: 'another choice',
        annotations: [{ name: 'custom', value: 'metadata' }]
      },
      { value: 'edited in standard Bruno', enabled: true }
    ]);
    expect(new Set(alternatives.map((param: { uid: string }) => param.uid)).size).toBe(2);
    expect(reopened.request.params.find((param: { name: string }) => param.name === 'q').encodeValue).toBe(false);
    alternatives[0].enabled = true;
    alternatives[1].enabled = false;
    saveRequestCustomSettings(directory, pathname, reopened, format);
    const switched = stringifyRequest(reopened, { format });
    const final = loadRequestCustomSettings(directory, pathname, parseRequest(switched, { format }));
    expect(final.request.params.filter((param: { name: string }) => param.name === 'id')).toMatchObject([
      { value: 'alternative\nwith quotes: \'test\'', enabled: true, annotations: expect.arrayContaining([{ name: 'custom', value: 'metadata' }]) },
      { value: 'edited in standard Bruno', enabled: false }
    ]);
    const removed = parseRequest(switched, { format });
    removed.request.params = removed.request.params.filter((param: { name: string }) => param.name !== 'id');
    loadRequestCustomSettings(directory, pathname, removed);
    expect(removed.request.params.some((param: { name: string }) => param.name === 'id')).toBe(false);
  });

  it.each(['bru', 'yml'] as const)('preserves a disabled path parameter without writing disabled path syntax in %s', (format) => {
    const pathname = path.join(directory, `request.${format}`);
    const item = parseRequest('meta {\n  name: example\n  type: http\n}\nget {\n  url: https://example.com/:id\n  body: none\n}\n', { format: 'bru' });
    item.request.params = [{ name: 'id', value: 'unused', type: 'path', enabled: false }];
    saveRequestCustomSettings(directory, pathname, item, format);
    const content = stringifyRequest(item, { format });
    expect(content).not.toMatch(/~id|disabled:|unused/);
    const reopened = loadRequestCustomSettings(directory, pathname, parseRequest(content, { format }));
    expect(reopened.request.params).toMatchObject([{ name: 'id', value: 'unused', enabled: false }]);
  });

  it('reads the old filename without writing and migrates all requests on save', () => {
    const legacy = path.join(directory, '.bruno-query-encoding.json');
    fs.writeFileSync(legacy, JSON.stringify({
      version: 1,
      requests: {
        first: [{ name: 'q', occurrence: 0, encodeValue: false }],
        second: [{ name: 'q', occurrence: 0, encodeName: false }]
      }
    }));
    const first = path.join(directory, 'first.bru');
    const item = { request: { params: [{ uid: 'one', name: 'q', type: 'query' as const }] } };
    expect(loadRequestCustomSettings(directory, first, item).request.params[0]).toMatchObject({ encodeValue: false });
    expect(fs.existsSync(path.join(directory, '.bruno-custom.json'))).toBe(false);
    migrateLegacyRequestSettings(directory, first, item, 'bru');
    expect(fs.existsSync(legacy)).toBe(false);
    const stored = JSON.parse(fs.readFileSync(path.join(directory, '.bruno-custom.json'), 'utf8'));
    expect(stored.requests.second.queryParamEncoding).toEqual([{ name: 'q', occurrence: 0, encodeName: false }]);
    saveRequestCustomSettings(directory, first, { request: { params: [] } }, 'bru');
    expect(JSON.parse(fs.readFileSync(path.join(directory, '.bruno-custom.json'), 'utf8')).requests.first).toBeUndefined();
  });

  it('creates no file for defaults and handles folder moves, copies and deletion', () => {
    const item = { request: { params: [{ uid: 'one', type: 'query' as const, name: 'q', enabled: true }] } };
    const source = path.join(directory, 'folder', 'request.bru');
    const target = path.join(directory, 'moved', 'request.bru');
    const copy = path.join(directory, 'copy', 'request.bru');
    const sidecar = path.join(directory, '.bruno-custom.json');
    saveRequestCustomSettings(directory, source, {
      request: { params: [...item.request.params, { uid: 'path', type: 'path', name: 'id', value: 'selected', enabled: true }] }
    }, 'bru');
    expect(fs.existsSync(sidecar)).toBe(false);
    const configured = { request: { params: [
      { ...item.request.params[0], encodeValue: false },
      { uid: 'path-one', type: 'path' as const, name: 'id', value: 'first', enabled: true },
      { uid: 'path-two', type: 'path' as const, name: 'id', value: 'second', enabled: false }
    ] } };
    saveRequestCustomSettings(directory, source, configured, 'bru');
    moveRequestCustomSettings(directory, path.dirname(source), directory, path.dirname(target));
    copyRequestCustomSettings(directory, target, directory, copy);
    const moved = { request: { params: [{ ...item.request.params[0] }] } };
    loadRequestCustomSettings(directory, target, moved);
    expect(moved.request.params[0]).toMatchObject({ encodeValue: false });
    deleteRequestCustomSettings(directory, path.dirname(target));
    const copied = { request: { params: [
      { ...item.request.params[0] },
      { uid: 'path-one', type: 'path' as const, name: 'id', value: 'first', enabled: true }
    ] } };
    loadRequestCustomSettings(directory, copy, copied);
    expect(copied.request.params[0]).toMatchObject({ encodeValue: false });
    expect(copied.request.params.filter((param) => param.type === 'path')).toMatchObject([
      { value: 'first', enabled: true }, { value: 'second', enabled: false }
    ]);
    const original = { request: { params: [{ ...item.request.params[0] }] } };
    loadRequestCustomSettings(directory, source, original);
    expect(original.request.params[0]).not.toHaveProperty('encodeValue');
  });

  it('keeps duplicate names aligned when Bru groups enabled parameters first', () => {
    const pathname = path.join(directory, 'request.bru');
    const item = parseRequest('meta {\n  name: example\n  type: http\n}\n\nget {\n  url: https://example.com\n  body: none\n}\n', { format: 'bru' });
    item.request.params = [
      { name: 'q', value: 'disabled', type: 'query', enabled: false, encodeName: false },
      { name: 'q', value: 'enabled', type: 'query', enabled: true, encodeValue: false }
    ];
    const content = stringifyRequest(item, { format: 'bru' });
    saveRequestCustomSettings(directory, pathname, item, 'bru');
    const reopened = loadRequestCustomSettings(directory, pathname, parseRequest(content, { format: 'bru' }));
    expect(reopened.request.params[0]).toMatchObject({ value: 'enabled', encodeValue: false });
    expect(reopened.request.params[1]).toMatchObject({ value: 'disabled', encodeName: false });
  });

  it('distinguishes folders whose names end with a request extension', () => {
    const item = { request: { params: [{ uid: 'one', type: 'query' as const, name: 'q', enabled: true, encodeName: false }] } };
    const source = path.join(directory, 'folder.bru', 'request.bru');
    const target = path.join(directory, 'folder', 'request.bru');
    saveRequestCustomSettings(directory, source, item, 'bru');
    moveRequestCustomSettings(directory, path.dirname(source), directory, path.dirname(target));
    const loaded = { request: { params: [{ uid: 'one', type: 'query' as const, name: 'q', enabled: true }] } };
    loadRequestCustomSettings(directory, target, loaded);
    expect(loaded.request.params[0]).toMatchObject({ encodeName: false });
  });

  it('moves settings between collections without disturbing other requests', () => {
    const sourceCollection = path.join(directory, 'source');
    const targetCollection = path.join(directory, 'target');
    fs.mkdirSync(sourceCollection);
    fs.mkdirSync(targetCollection);
    const source = path.join(sourceCollection, 'request.bru');
    const target = path.join(targetCollection, 'request.yml');
    const item = { request: { params: [{ uid: 'one', type: 'query' as const, name: 'q', enabled: true, encodeName: false }] } };
    saveRequestCustomSettings(sourceCollection, source, item, 'bru');
    saveRequestCustomSettings(targetCollection, path.join(targetCollection, 'other.yml'), item, 'yml');
    moveRequestCustomSettings(sourceCollection, source, targetCollection, target);
    const blank = () => ({ request: { params: [{ uid: 'one', type: 'query' as const, name: 'q', enabled: true }] } });
    expect(loadRequestCustomSettings(targetCollection, target, blank()).request.params[0]).toMatchObject({ encodeName: false });
    expect(loadRequestCustomSettings(targetCollection, path.join(targetCollection, 'other.yml'), blank()).request.params[0])
      .toMatchObject({ encodeName: false });
    expect(loadRequestCustomSettings(sourceCollection, source, blank()).request.params[0]).not.toHaveProperty('encodeName');
  });

  it('removes settings when a parameter returns to defaults without affecting another request', () => {
    const first = path.join(directory, 'first.yml');
    const second = path.join(directory, 'second.yml');
    const param = { uid: 'one', type: 'query' as const, name: 'q', enabled: true };
    const configured = { request: { params: [{ ...param, encodeValue: false }] } };
    saveRequestCustomSettings(directory, first, configured, 'yml');
    saveRequestCustomSettings(directory, second, configured, 'yml');
    saveRequestCustomSettings(directory, first, { request: { params: [param] } }, 'yml');
    const fresh = () => ({ request: { params: [{ ...param }] } });
    expect(loadRequestCustomSettings(directory, first, fresh()).request.params[0]).not.toHaveProperty('encodeValue');
    expect(loadRequestCustomSettings(directory, second, fresh()).request.params[0]).toMatchObject({ encodeValue: false });
  });

  it('clears stale destination settings when copying a request with defaults', () => {
    const source = path.join(directory, 'source.bru');
    const destination = path.join(directory, 'destination.bru');
    const param = { uid: 'one', type: 'query' as const, name: 'q', enabled: true };
    saveRequestCustomSettings(directory, destination, { request: { params: [{ ...param, encodeName: false }] } }, 'bru');
    copyRequestCustomSettings(directory, source, directory, destination);
    const loaded = loadRequestCustomSettings(directory, destination, { request: { params: [{ ...param }] } });
    expect(loaded.request.params[0]).not.toHaveProperty('encodeName');
  });

  it('handles differently cased collection paths on Windows', () => {
    if (process.platform !== 'win32') return;
    const source = path.join(directory, 'source.bru');
    const target = path.join(directory.toUpperCase(), 'target.bru');
    const item = { request: { params: [{ uid: 'one', type: 'query' as const, name: 'q', enabled: true, encodeName: false }] } };
    saveRequestCustomSettings(directory, source, item, 'bru');
    moveRequestCustomSettings(directory, source, directory.toUpperCase(), target);
    const loaded = loadRequestCustomSettings(directory, path.join(directory, 'target.bru'), {
      request: { params: [{ uid: 'one', type: 'query' as const, name: 'q', enabled: true }] }
    });
    expect(loaded.request.params[0]).toMatchObject({ encodeName: false });
  });

  it('migrates legacy request annotations into the sidecar on save', () => {
    const pathname = path.join(directory, 'request.bru');
    const source = 'meta {\n  name: example\n  type: http\n}\n\nget {\n  url: https://example.com\n  body: none\n}\n\nparams:query {\n  @encodeValue(\'false\')\n  q: test\n}\n';
    const item = parseRequest(source, { format: 'bru' });
    expect(item.request.params[0].encodeValue).toBe(false);
    saveRequestCustomSettings(directory, pathname, item, 'bru');
    const written = stringifyRequest(item, { format: 'bru' });
    expect(written).not.toContain('@encodeValue');
    const reopened = loadRequestCustomSettings(directory, pathname, parseRequest(written, { format: 'bru' }));
    expect(reopened.request.params[0].encodeValue).toBe(false);
  });

  it('rejects invalid sidecars rather than silently discarding settings', () => {
    fs.writeFileSync(path.join(directory, '.bruno-custom.json'), '{invalid');
    expect(() => loadRequestCustomSettings(directory, path.join(directory, 'request.bru'), {})).toThrow();
  });
});
