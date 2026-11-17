const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { describe, it, expect } = require('@jest/globals');
const constants = require('../../src/constants');
const { createCollectionJsonFromPathname, getCollectionFormat, FORMAT_CONFIG } = require('../../src/utils/collection');
const { parseEnvironment, stringifyRequest, stringifyFolder, stringifyCollection } = require('@usebruno/filestore');
const { encodeUrlWithQueryParamSettings } = require('@usebruno/common').utils;
const prepareRequest = require('../../src/runner/prepare-request');
const interpolateVars = require('../../src/runner/interpolate-vars');

describe('create collection json from pathname', () => {
  it.each(['bru', 'yml'])('loads bearer prefixes from the sidecar at every scope in a %s collection', async (format) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-cli-bearer-'));
    try {
      const root = { meta: { name: 'Auth' }, request: { auth: { mode: 'bearer', bearer: { token: 'root-token' } } } };
      const rootFile = format === 'bru' ? 'collection.bru' : 'opencollection.yml';
      fs.writeFileSync(path.join(directory, rootFile), stringifyCollection(root, { name: 'Auth' }, { format }));
      if (format === 'bru') fs.writeFileSync(path.join(directory, 'bruno.json'), JSON.stringify({ version: '1', name: 'Auth' }));
      fs.mkdirSync(path.join(directory, 'API'));
      fs.writeFileSync(path.join(directory, 'API', `folder.${format}`), stringifyFolder({
        ...root, request: { auth: { mode: 'bearer', bearer: { token: 'folder-token' } } }
      }, { format }));
      const request = (name, auth) => ({
        type: 'http-request', name, request: {
          method: 'GET', url: 'https://example.com', headers: [], params: [], body: { mode: 'none' }, auth
        }
      });
      fs.writeFileSync(path.join(directory, `root-request.${format}`), stringifyRequest(request('root-request', { mode: 'inherit' }), { format }));
      fs.writeFileSync(path.join(directory, 'API', `inherited.${format}`), stringifyRequest(request('inherited', { mode: 'inherit' }), { format }));
      fs.writeFileSync(path.join(directory, 'API', `own.${format}`), stringifyRequest(request('own', {
        mode: 'bearer', bearer: { token: 'request-token' }
      }), { format }));
      fs.writeFileSync(path.join(directory, '.bruno-custom.json'), JSON.stringify({
        version: 1, requests: {
          '/': { bearerTokenPrefix: 'Collection' },
          'API/': { bearerTokenPrefix: 'Folder' },
          'API/own': { bearerTokenPrefix: 'Request' }
        }
      }));
      const collection = createCollectionJsonFromPathname(directory);
      const folder = collection.items.find((item) => item.type === 'folder');
      const rootRequest = collection.items.find((item) => item.name === 'root-request');
      expect((await prepareRequest(rootRequest, collection)).headers.Authorization).toBe('Collection root-token');
      expect((await prepareRequest(folder.items.find((item) => item.name === 'inherited'), collection)).headers.Authorization).toBe('Folder folder-token');
      expect((await prepareRequest(folder.items.find((item) => item.name === 'own'), collection)).headers.Authorization).toBe('Request request-token');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  it('should throw an error when the pathname is not a valid bruno collection root', () => {
    const invalidCollectionPathname = path.join(__dirname, './fixtures/collection-invalid');
    jest.spyOn(console, 'error').mockImplementation(() => { });
    let mockProcessExit = jest.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(code); });
    try { createCollectionJsonFromPathname(invalidCollectionPathname); } catch { }
    expect(mockProcessExit).toHaveBeenCalledWith(constants.EXIT_STATUS.ERROR_NOT_IN_COLLECTION);
    jest.restoreAllMocks();
  });

  it('creates a bruno collection json from the collection bru files', () => {
    const collectionPathname = path.join(__dirname, './fixtures/collection-json-from-pathname/collection');
    const outputCollectionJson = createCollectionJsonFromPathname(collectionPathname);

    let c = outputCollectionJson;
    expect(c).toBeDefined();

    /* collection bruno.json */
    expect(c).toHaveProperty('brunoConfig.version', '1');
    expect(c).toHaveProperty('brunoConfig.name', 'collection');
    expect(c).toHaveProperty('brunoConfig.type', 'collection');
    expect(c).toHaveProperty('brunoConfig.ignore', ['node_modules', '.git']);
    expect(c).toHaveProperty('brunoConfig.proxy.enabled', false);
    expect(c).toHaveProperty('brunoConfig.proxy.protocol', 'http');
    expect(c).toHaveProperty('brunoConfig.proxy.hostname', '<proxy-hostname>');
    expect(c).toHaveProperty('brunoConfig.proxy.port', 3000);
    expect(c).toHaveProperty('brunoConfig.proxy.auth.enabled', false);
    expect(c).toHaveProperty('brunoConfig.proxy.auth.username', '<user-name>');
    expect(c).toHaveProperty('brunoConfig.proxy.auth.password', '<password>');
    expect(c).toHaveProperty('brunoConfig.proxy.bypassProxy', '');
    expect(c).toHaveProperty('brunoConfig.scripts.moduleWhitelist', ['crypto', 'buffer']);
    expect(c).toHaveProperty('brunoConfig.clientCertificates.enabled', true);
    expect(c).toHaveProperty('brunoConfig.clientCertificates.certs', []);

    /* collection pathname */
    expect(c).toHaveProperty('pathname', collectionPathname);

    /* collection root */
    // headers
    expect(c).toHaveProperty('root.request.headers[0].name', 'collection_header');
    expect(c).toHaveProperty('root.request.headers[0].value', 'collection_header_value');
    expect(c).toHaveProperty('root.request.headers[0].enabled', true);
    // auth
    expect(c).toHaveProperty('root.request.auth.mode', 'basic');
    expect(c).toHaveProperty('root.request.auth.basic.username', 'username');
    expect(c).toHaveProperty('root.request.auth.basic.password', 'password');
    // pre-request scripts
    expect(c).toHaveProperty('root.request.script.req', 'const collectionPreRequestScript = true;');
    // collection root - post-response scripts
    expect(c).toHaveProperty('root.request.script.res', 'const collectionPostResponseScript = true;');
    // pre-request vars
    expect(c).toHaveProperty('root.request.vars.req[0].name', 'collection_pre_var');
    expect(c).toHaveProperty('root.request.vars.req[0].value', 'collection_pre_var_value');
    expect(c).toHaveProperty('root.request.vars.req[0].enabled', true);
    // post-response vars
    expect(c).toHaveProperty('root.request.vars.res[0].name', 'collection_post_var');
    expect(c).toHaveProperty('root.request.vars.res[0].value', 'collection_post_var_value');
    expect(c).toHaveProperty('root.request.vars.res[0].enabled', true);
    // tests
    expect(c).toHaveProperty('root.request.tests', 'test(\"collection level script\", function() {\n  expect(\"test\").to.equal(\"test\");\n});');

    /* collection items names and sequences */
    // <collection-root>/folder_2
    expect(c).toHaveProperty('items[0].type', 'folder');
    expect(c).toHaveProperty('items[0].name', 'folder_2');
    expect(c).toHaveProperty('items[0].seq', 1);

    // <collection-root>/folder_2/request_1
    expect(c).toHaveProperty('items[0].items[0].name', 'request_1');
    expect(c).toHaveProperty('items[0].items[0].seq', 1);

    // <collection-root>/folder_2/request_3
    expect(c).toHaveProperty('items[0].items[1].name', 'request_3');
    expect(c).toHaveProperty('items[0].items[1].seq', 2);

    // <collection-root>/folder_2/request_2
    expect(c).toHaveProperty('items[0].items[2].name', 'request_2');
    expect(c).toHaveProperty('items[0].items[2].seq', 3);

    // <collection-root>/folder_1
    expect(c).toHaveProperty('items[1].type', 'folder');
    expect(c).toHaveProperty('items[1].name', 'folder_1');
    expect(c).toHaveProperty('items[1].seq', 5);

    // <collection-root>/folder_1/folder_2
    expect(c).toHaveProperty('items[1].items[0].name', 'folder_2');
    expect(c).toHaveProperty('items[1].items[0].seq', 1);

    // <collection-root>/folder_1/folder_2/request_3
    expect(c).toHaveProperty('items[1].items[0].items[0].name', 'request_3');
    expect(c).toHaveProperty('items[1].items[0].items[0].seq', 1);

    // <collection-root>/folder_1/folder_2/request_1
    expect(c).toHaveProperty('items[1].items[0].items[1].name', 'request_1');
    expect(c).toHaveProperty('items[1].items[0].items[1].seq', 2);

    // <collection-root>/folder_1/folder_2/request_2
    expect(c).toHaveProperty('items[1].items[0].items[2].name', 'request_2');
    expect(c).toHaveProperty('items[1].items[0].items[2].seq', 3);

    // <collection-root>/folder_1/folder_1
    expect(c).toHaveProperty('items[1].items[1].name', 'folder_1');
    expect(c).toHaveProperty('items[1].items[1].seq', 2);

    // <collection-root>/folder_1/folder_1/request_3
    expect(c).toHaveProperty('items[1].items[1].items[0].name', 'request_3');
    expect(c).toHaveProperty('items[1].items[1].items[0].seq', 1);

    // <collection-root>/folder_1/folder_1/request_2
    expect(c).toHaveProperty('items[1].items[1].items[1].name', 'request_2');
    expect(c).toHaveProperty('items[1].items[1].items[1].seq', 2);

    // <collection-root>/folder_1/folder_1/request_1
    expect(c).toHaveProperty('items[1].items[1].items[2].name', 'request_1');
    expect(c).toHaveProperty('items[1].items[1].items[2].seq', 3);

    // <collection-root>/folder_1/request_1
    expect(c).toHaveProperty('items[1].items[2].name', 'request_1');
    expect(c).toHaveProperty('items[1].items[2].seq', 3);

    // <collection-root>/folder_1/request_3
    expect(c).toHaveProperty('items[1].items[3].name', 'request_3');
    expect(c).toHaveProperty('items[1].items[3].seq', 4);

    // <collection-root>/folder_1/request_2
    expect(c).toHaveProperty('items[1].items[4].name', 'request_2');
    expect(c).toHaveProperty('items[1].items[4].seq', 5);

    // <collection-root>/request_2
    expect(c).toHaveProperty('items[2].name', 'request_3');
    expect(c).toHaveProperty('items[2].seq', 2);

    // <collection-root>/request_3
    expect(c).toHaveProperty('items[3].name', 'request_1');
    expect(c).toHaveProperty('items[3].seq', 3);

    // <collection-root>/request_4
    expect(c).toHaveProperty('items[4].name', 'request_2');
    expect(c).toHaveProperty('items[4].seq', 4);

    /* collection request item - <collection-root>/request_4 */
    // <collection-root>/request_4
    // headers
    expect(c).toHaveProperty('items[4].request.headers[0].name', 'request_header');
    expect(c).toHaveProperty('items[4].request.headers[0].value', 'request_header_value');
    expect(c).toHaveProperty('items[4].request.headers[0].enabled', true);
    // auth
    expect(c).toHaveProperty('items[4].request.auth.mode', 'basic');
    expect(c).toHaveProperty('items[4].request.auth.basic.username', 'username');
    expect(c).toHaveProperty('items[4].request.auth.basic.password', 'password');
    // pre-request scripts
    expect(c).toHaveProperty('items[4].request.script.req', 'const requestPreRequestScript = true;');
    // request items[4] - post-response scripts
    expect(c).toHaveProperty('items[4].request.script.res', 'const requestPostResponseScript = true;');
    // pre-request vars
    expect(c).toHaveProperty('items[4].request.vars.req[0].name', 'request_pre_var');
    expect(c).toHaveProperty('items[4].request.vars.req[0].value', 'request_pre_var_value');
    expect(c).toHaveProperty('items[4].request.vars.req[0].enabled', true);
    // post-response vars
    expect(c).toHaveProperty('items[4].request.vars.res[0].name', 'request_post_var');
    expect(c).toHaveProperty('items[4].request.vars.res[0].value', 'request_post_var_value');
    expect(c).toHaveProperty('items[4].request.vars.res[0].enabled', true);
    // tests
    expect(c).toHaveProperty('items[4].request.tests', 'test(\"request level script\", function() {\n  expect(\"test\").to.equal(\"test\");\n});');
  });

  it('creates a collection json from OpenCollection yml files', () => {
    const collectionPathname = path.join(__dirname, './fixtures/opencollection/collection');
    const c = createCollectionJsonFromPathname(collectionPathname);

    expect(c).toBeDefined();
    expect(c).toHaveProperty('format', 'yml');
    expect(c).toHaveProperty('brunoConfig.opencollection', '1.0.0');
    expect(c).toHaveProperty('brunoConfig.name', 'Test OpenCollection');
    expect(c).toHaveProperty('brunoConfig.type', 'collection');
    expect(c).toHaveProperty('brunoConfig.ignore', ['node_modules', '.git']);
    expect(c).toHaveProperty('pathname', collectionPathname);

    // collection root headers
    expect(c).toHaveProperty('root.request.headers[0].name', 'X-Collection-Header');
    expect(c).toHaveProperty('root.request.headers[0].value', 'collection-header-value');
    expect(c).toHaveProperty('root.request.headers[0].enabled', true);

    // folder
    expect(c.items.some((i) => i.type === 'folder' && i.name === 'users')).toBe(true);
    const usersFolder = c.items.find((i) => i.name === 'users');
    expect(usersFolder).toHaveProperty('root.meta.name', 'Users');
    expect(usersFolder).toHaveProperty('root.meta.seq', 1);
    expect(usersFolder.pathname).toContain('users');

    // request in folder - name comes from info.name, pathname is correct
    const createUserReq = usersFolder.items.find((i) => i.name === 'Create User');
    expect(createUserReq).toBeDefined();
    expect(createUserReq).toHaveProperty('type', 'http-request');
    expect(createUserReq).toHaveProperty('request.method', 'POST');
    expect(createUserReq).toHaveProperty('request.url', 'https://api.example.com/users');
    expect(createUserReq.pathname).toContain('create-user.yml');

    // root level request - name comes from info.name, pathname is correct
    const getUsersReq = c.items.find((i) => i.name === 'Get Users');
    expect(getUsersReq).toBeDefined();
    expect(getUsersReq).toHaveProperty('type', 'http-request');
    expect(getUsersReq).toHaveProperty('request.method', 'GET');
    expect(getUsersReq).toHaveProperty('request.url', 'https://api.example.com/users');
    expect(getUsersReq.pathname).toContain('get-users.yml');
  });

  it.each(['bru', 'yml'])('loads custom query and path parameter settings for %s requests from the sidecar', async (format) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-cli-encoding-'));
    try {
      if (format === 'bru') {
        fs.writeFileSync(path.join(directory, 'bruno.json'), JSON.stringify({ version: '1', name: 'test', type: 'collection' }));
        fs.writeFileSync(path.join(directory, 'request.bru'), 'meta {\n  name: request\n  type: http\n  seq: 1\n}\nget {\n  url: https://example.com/:id\n  body: none\n}\nparams:query {\n  q: test\n}\nparams:path {\n  id: chosen\n}\n');
      } else {
        fs.writeFileSync(path.join(directory, 'opencollection.yml'), 'opencollection: 1.0.0\ninfo:\n  name: test\n');
        fs.writeFileSync(path.join(directory, 'request.yml'), 'info:\n  name: request\n  type: http\nhttp:\n  method: GET\n  url: https://example.com/:id\n  params:\n    - name: q\n      value: test\n      type: query\n    - name: id\n      value: chosen\n      type: path\n');
      }
      fs.writeFileSync(path.join(directory, '.bruno-custom.json'), JSON.stringify({
        version: 1,
        requests: { request: {
          queryParamEncoding: [{ name: 'q', occurrence: 0, encodeValueAsBase64: true }],
          pathParams: [
            { name: 'id', value: 'unused', enabled: false },
            { name: 'id', value: 'previous', enabled: true }
          ]
        } }
      }));
      const collection = createCollectionJsonFromPathname(directory);
      expect(collection.items[0].request.params[0]).toMatchObject({ name: 'q', encodeValueAsBase64: true });
      expect(collection.items[0].request.params.filter((param) => param.type === 'path')).toMatchObject([
        { value: 'unused', enabled: false }, { value: 'chosen', enabled: true }
      ]);
      const prepared = await prepareRequest(collection.items[0], collection);
      interpolateVars(prepared);
      expect(encodeUrlWithQueryParamSettings(prepared.url, prepared.queryParams)).toBe('https://example.com/chosen?q=dGVzdA%3D%3D');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });
});

describe('getCollectionFormat', () => {
  it('returns yml for OpenCollection', () => {
    const collectionPath = path.join(__dirname, './fixtures/opencollection/collection');
    expect(getCollectionFormat(collectionPath)).toBe('yml');
  });

  it('returns bru for Bruno collection', () => {
    const collectionPath = path.join(__dirname, './fixtures/collection-json-from-pathname/collection');
    expect(getCollectionFormat(collectionPath)).toBe('bru');
  });

  it('returns null for invalid path', () => {
    const collectionPath = path.join(__dirname, './fixtures/collection-invalid');
    expect(getCollectionFormat(collectionPath)).toBe(null);
  });
});

describe('FORMAT_CONFIG', () => {
  it('has correct config for yml format', () => {
    expect(FORMAT_CONFIG.yml).toEqual({
      ext: '.yml',
      collectionFile: 'opencollection.yml',
      folderFile: 'folder.yml'
    });
  });

  it('has correct config for bru format', () => {
    expect(FORMAT_CONFIG.bru).toEqual({
      ext: '.bru',
      collectionFile: 'collection.bru',
      folderFile: 'folder.bru'
    });
  });
});

describe('OpenCollection environment parsing', () => {
  it('parses YML environment files correctly', () => {
    const envPath = path.join(__dirname, './fixtures/opencollection/collection/environments/dev.yml');
    const envContent = fs.readFileSync(envPath, 'utf8');
    const env = parseEnvironment(envContent, { format: 'yml' });

    expect(env).toBeDefined();
    expect(env).toHaveProperty('name', 'Development');
    expect(env.variables).toHaveLength(2);
    expect(env.variables[0]).toHaveProperty('name', 'baseUrl');
    expect(env.variables[0]).toHaveProperty('value', 'https://api.dev.example.com');
    expect(env.variables[1]).toHaveProperty('name', 'apiKey');
    expect(env.variables[1]).toHaveProperty('value', 'dev-api-key-123');
  });
});
