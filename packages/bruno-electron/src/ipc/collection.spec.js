const { ipcMain, app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const jsyaml = require('js-yaml');

jest.mock('electron', () => {
  const handlers = {};
  return {
    ipcMain: {
      handle: jest.fn((channel, handler) => {
        handlers[channel] = handler;
      }),
      on: jest.fn(),
      emit: jest.fn(),
      _getHandler: (channel) => handlers[channel]
    },
    app: {
      getPath: jest.fn(() => require('node:os').tmpdir()),
      getVersion: jest.fn(() => '2.0.0')
    },
    dialog: {
      showOpenDialog: jest.fn()
    }
  };
});

jest.mock('../utils/filesystem', () => ({
  ...jest.requireActual('../utils/filesystem'),
  copyPathTo: jest.fn(),
  removePath: jest.fn(),
  getPaths: jest.fn(async (src) => [src]),
  withDirLock: jest.fn((dir, cb) => cb()),
  getUniqueRenamePath: jest.fn((oldPath, desiredPath) => desiredPath)
}));

jest.mock('../cache/requestUids', () => ({
  moveRequestUid: jest.fn(),
  deleteRequestUid: jest.fn(),
  syncExampleUidsCache: jest.fn()
}));

jest.mock('../utils/constants', () => ({
  REQUEST_TYPES: ['http-request', 'graphql-request', 'grpc-request', 'ws-request']
}));

jest.mock('../app/collection-watcher', () => {
  const path = require('node:path');
  const os = require('node:os');
  return {
    getAllWatcherPaths: jest.fn(() => [
      path.join(os.tmpdir(), 'fake', 'source'),
      path.join(os.tmpdir(), 'fake', 'target')
    ])
  };
});

jest.mock('@usebruno/filestore', () => ({
  CUSTOM_SETTINGS_FILENAME: '.bruno-custom.json',
  LEGACY_CUSTOM_SETTINGS_FILENAME: '.bruno-query-encoding.json',
  migrateLegacyRequestSettings: jest.fn(),
  parseRequest: jest.fn(() => ({})),
  loadRequestCustomSettings: jest.fn((collectionPath, pathname, item) => item),
  saveRequestCustomSettings: jest.fn(),
  copyRequestCustomSettings: jest.fn(),
  moveRequestCustomSettings: jest.fn(),
  deleteRequestCustomSettings: jest.fn(),
  stringifyRequest: jest.fn(() => 'mock-content-stringified'),
  stringifyRequestViaWorker: jest.fn(async () => 'mock-request-stringified'),
  stringifyCollection: jest.fn(async () => 'mock-collection-stringified'),
  stringifyFolder: jest.fn(async () => 'mock-folder-stringified')
}));

jest.mock('../utils/request-custom-settings', () => ({
  ...jest.requireActual('../utils/request-custom-settings'),
  writeRequestWithCustomSettings: async (collectionPath, pathname, item, format, content) => {
    require('@usebruno/filestore').saveRequestCustomSettings(collectionPath, pathname, item, format);
    await require('../utils/filesystem').writeFile(pathname, content);
  }
}));

const fsPromises = require('node:fs').promises;
jest.spyOn(fsPromises, 'writeFile').mockImplementation(async () => {});
jest.spyOn(fsPromises, 'readFile').mockImplementation(async () => 'mock-content');

// Load collection.js to register IPC handlers
const registerCollectionsIpc = require('./collection');

const { copyPathTo, posixifyPath } = require('../utils/filesystem');
const { moveRequestUid } = require('../cache/requestUids');
const { copyRequestCustomSettings, deleteRequestCustomSettings, loadRequestCustomSettings, saveRequestCustomSettings } = require('@usebruno/filestore');

describe('IPC collection handlers', () => {
  let mainWindow;

  beforeEach(() => {
    jest.clearAllMocks();
    mainWindow = { webContents: { send: jest.fn() } };
    registerCollectionsIpc(mainWindow, {});
  });

  it.each(['bru', 'yml'])('persists prefix-only collection and folder edits in the %s sidecar', async (format) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-root-bearer-'));
    const { getAllWatcherPaths } = require('../app/collection-watcher');
    const previous = getAllWatcherPaths.getMockImplementation();
    getAllWatcherPaths.mockReturnValue([directory]);
    try {
      const filename = format === 'bru' ? 'collection.bru' : 'opencollection.yml';
      if (format === 'bru') fs.writeFileSync(path.join(directory, 'bruno.json'), '{}');
      fs.writeFileSync(path.join(directory, filename), 'mock-collection-stringified');
      fs.mkdirSync(path.join(directory, 'API'));
      const root = { request: { auth: { mode: 'bearer', bearer: { token: 'secret', prefix: 'Custom' } } } };
      const save = jest.requireActual('@usebruno/filestore').saveRequestCustomSettings;
      saveRequestCustomSettings.mockImplementationOnce(save).mockImplementationOnce(save);
      await ipcMain._getHandler('renderer:save-collection-root')({}, directory, root, {});
      await ipcMain._getHandler('renderer:save-folder-root')({}, {
        name: 'API', root, folderPathname: path.join(directory, 'API'), collectionPathname: directory
      });
      expect(JSON.parse(fs.readFileSync(path.join(directory, '.bruno-custom.json'), 'utf8')).requests).toEqual({
        '/': { bearerTokenPrefix: 'Custom' },
        'API/': { bearerTokenPrefix: 'Custom' }
      });
      root.request.auth.bearer.prefix = '';
      saveRequestCustomSettings.mockImplementationOnce(save);
      await ipcMain._getHandler('renderer:save-collection-root')({}, directory, root, {});
      expect(JSON.parse(fs.readFileSync(path.join(directory, '.bruno-custom.json'), 'utf8')).requests)
        .toEqual({ 'API/': { bearerTokenPrefix: 'Custom' } });
    } finally {
      getAllWatcherPaths.mockImplementation(previous);
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it.each(['bru', 'yml'])('keeps cloned folder path alternatives in the %s collection sidecar', async (format) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-clone-custom-'));
    const { getAllWatcherPaths } = require('../app/collection-watcher');
    const previous = getAllWatcherPaths.getMockImplementation();
    getAllWatcherPaths.mockReturnValue([directory]);
    try {
      fs.writeFileSync(path.join(directory, format === 'bru' ? 'bruno.json' : 'opencollection.yml'), '');
      const item = {
        type: 'http-request',
        filename: `request.${format}`,
        request: { params: [
          { name: 'id', type: 'path', value: 'other', enabled: false },
          { name: 'id', type: 'path', value: 'selected', enabled: true }
        ] }
      };
      saveRequestCustomSettings.mockImplementationOnce(jest.requireActual('@usebruno/filestore').saveRequestCustomSettings);
      await ipcMain._getHandler('renderer:clone-folder')(
        {}, { items: [item] }, path.join(directory, 'Copy'), directory
      );
      expect(fs.existsSync(path.join(directory, 'Copy', `request.${format}`))).toBe(true);
      const sidecar = JSON.parse(fs.readFileSync(path.join(directory, '.bruno-custom.json'), 'utf8'));
      expect(sidecar.requests['Copy/request'].pathParams).toEqual([
        { name: 'id', value: 'other', enabled: false },
        { name: 'id', value: 'selected', enabled: true }
      ]);
    } finally {
      getAllWatcherPaths.mockImplementation(previous);
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  describe('renderer:move-item', () => {
    beforeEach(() => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    });

    afterEach(() => {
      fs.existsSync.mockRestore();
    });

    it('calls moveRequestUid before copyPathTo to prevent observed uid mismatches', async () => {
      const moveItemHandler = ipcMain._getHandler('renderer:move-item');

      let callOrder = [];
      moveRequestUid.mockImplementation(() => callOrder.push('moveRequestUid'));
      copyPathTo.mockImplementation(async () => callOrder.push('copyPathTo'));
      copyRequestCustomSettings.mockImplementation(() => callOrder.push('copyEncoding'));
      deleteRequestCustomSettings.mockImplementation(() => callOrder.push('deleteEncoding'));

      await moveItemHandler({}, {
        targetDirname: path.join(os.tmpdir(), 'fake', 'target'),
        sourcePathname: path.join(os.tmpdir(), 'fake', 'source', 'request.bru')
      });

      expect(callOrder).toEqual(['moveRequestUid', 'copyEncoding', 'copyPathTo', 'deleteEncoding']);
      expect(copyRequestCustomSettings).toHaveBeenCalledWith(
        path.join(os.tmpdir(), 'fake', 'source'),
        path.join(os.tmpdir(), 'fake', 'source', 'request.bru'),
        path.join(os.tmpdir(), 'fake', 'target'),
        path.join(os.tmpdir(), 'fake', 'target', 'request.bru')
      );
    });

    it('does not move the files or remove source settings when copying settings fails', async () => {
      copyRequestCustomSettings.mockImplementationOnce(() => { throw new Error('sidecar is read-only'); });
      await expect(ipcMain._getHandler('renderer:move-item')({}, {
        targetDirname: path.join(os.tmpdir(), 'fake', 'target'),
        sourcePathname: path.join(os.tmpdir(), 'fake', 'source', 'nested')
      })).rejects.toThrow('sidecar is read-only');
      expect(copyPathTo).not.toHaveBeenCalled();
      expect(deleteRequestCustomSettings).not.toHaveBeenCalled();
    });
  });

  describe('renderer:move-item-cross-format', () => {
    beforeEach(() => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    });

    afterEach(() => {
      fs.existsSync.mockRestore();
    });

    it('calls moveRequestUid before writing the target file', async () => {
      const moveItemCrossFormatHandler = ipcMain._getHandler('renderer:move-item-cross-format');

      let callOrder = [];
      moveRequestUid.mockImplementation(() => callOrder.push('moveRequestUid'));
      fsPromises.writeFile.mockImplementation(async () => callOrder.push('writeFile'));
      loadRequestCustomSettings.mockImplementationOnce((collectionPath, pathname, item) => ({
        ...item,
        request: { params: [{ name: 'q', type: 'query', encodeValue: false }] }
      }));

      await moveItemCrossFormatHandler({}, {
        targetDirname: path.join(os.tmpdir(), 'fake', 'target'),
        sourcePathname: path.join(os.tmpdir(), 'fake', 'source', 'request.bru'),
        sourceFormat: 'bru',
        targetFormat: 'yml'
      });

      expect(callOrder).toEqual(['moveRequestUid', 'writeFile']);
      expect(saveRequestCustomSettings).toHaveBeenCalledWith(
        path.join(os.tmpdir(), 'fake', 'target'),
        path.join(os.tmpdir(), 'fake', 'target', 'request.yml'),
        expect.objectContaining({ request: { params: [{ name: 'q', type: 'query', encodeValue: false }] } }),
        'yml'
      );
    });
  });

  describe('request saves', () => {
    beforeEach(() => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    });

    afterEach(() => {
      fs.existsSync.mockRestore();
    });

    it.each(['renderer:save-request', 'renderer:save-multiple-requests'])('persists sparse settings for %s', async (channel) => {
      const pathname = path.join(os.tmpdir(), 'fake', 'source', 'Search.bru');
      const item = { request: { params: [{ name: 'q', type: 'query', encodeValue: false }] } };
      const handler = ipcMain._getHandler(channel);
      if (channel === 'renderer:save-request') {
        await handler({}, pathname, item, 'bru');
      } else {
        await handler({}, [{ pathname, item, format: 'bru' }]);
      }
      expect(saveRequestCustomSettings).toHaveBeenCalledWith(path.dirname(pathname), pathname, item, 'bru');
    });
  });

  describe('renderer:import-collection', () => {
    let collectionLocation;
    let userDataPath;
    let importCollectionHandler;

    beforeEach(() => {
      collectionLocation = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-import-'));
      userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-user-data-'));
      app.getPath.mockReturnValue(userDataPath);
      importCollectionHandler = ipcMain._getHandler('renderer:import-collection');
    });

    afterEach(() => {
      app.getPath.mockReturnValue(os.tmpdir());
      fs.rmSync(collectionLocation, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      fs.rmSync(userDataPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    });

    const ordersSpec = 'openapi: 3.0.0\ninfo:\n  title: Orders API\n';
    const usersSpec = 'openapi: 3.0.0\ninfo:\n  title: Users API\n';
    const specHashOf = (spec) => crypto.createHash('md5').update(JSON.stringify(jsyaml.load(spec))).digest('hex');

    const openApiCollection = (uid, name) => ({
      uid,
      name,
      items: [],
      environments: [],
      brunoConfig: { name, type: 'collection', openapi: [{ sourceUrl: path.join(collectionLocation, `${uid}.yaml`), groupBy: 'tags' }] }
    });

    const readSyncConfig = (collectionName) => {
      return JSON.parse(fs.readFileSync(path.join(collectionLocation, collectionName, 'bruno.json'), 'utf8')).openapi;
    };

    const readStoredSpecs = () => {
      const specsDir = path.join(userDataPath, 'specs');
      const metadata = JSON.parse(fs.readFileSync(path.join(specsDir, 'metadata.json'), 'utf8'));
      return Object.fromEntries(Object.entries(metadata).map(([collectionPath, entries]) => [
        collectionPath,
        entries.map(({ filename, sourceUrl }) => ({ sourceUrl, content: fs.readFileSync(path.join(specsDir, filename), 'utf8') }))
      ]));
    };

    it('saves each synced collection with its own spec', async () => {
      await importCollectionHandler({}, [
        openApiCollection('orders', 'Orders API'),
        openApiCollection('users', 'Users API'),
        { uid: 'postman', name: 'Postman Collection', items: [], environments: [] }
      ], collectionLocation, {
        format: 'bru',
        rawOpenAPISpecs: { orders: ordersSpec, users: usersSpec, postman: 'openapi: 3.0.0\n' }
      });

      expect(readStoredSpecs()).toEqual({
        [path.join(collectionLocation, 'Orders API')]: [{ sourceUrl: path.join(collectionLocation, 'orders.yaml'), content: ordersSpec }],
        [path.join(collectionLocation, 'Users API')]: [{ sourceUrl: path.join(collectionLocation, 'users.yaml'), content: usersSpec }]
      });
      expect(readSyncConfig('Orders API')).toEqual([
        { sourceUrl: '../orders.yaml', groupBy: 'tags', lastSyncDate: expect.any(String), specHash: specHashOf(ordersSpec) }
      ]);
      expect(readSyncConfig('Users API')).toEqual([
        { sourceUrl: '../users.yaml', groupBy: 'tags', lastSyncDate: expect.any(String), specHash: specHashOf(usersSpec) }
      ]);
      expect(readSyncConfig('Postman Collection')).toBeUndefined();
    });

    it('saves a spec passed as an object as JSON', async () => {
      const specContent = JSON.stringify({ openapi: '3.0.0' }, null, 2);

      await importCollectionHandler({}, openApiCollection('orders', 'Orders API'), collectionLocation, {
        format: 'bru',
        rawOpenAPISpecs: { orders: { openapi: '3.0.0' } }
      });

      expect(readStoredSpecs()).toEqual({
        [path.join(collectionLocation, 'Orders API')]: [{ sourceUrl: path.join(collectionLocation, 'orders.yaml'), content: specContent }]
      });
      expect(readSyncConfig('Orders API')).toEqual([
        { sourceUrl: '../orders.yaml', groupBy: 'tags', lastSyncDate: expect.any(String), specHash: specHashOf(specContent) }
      ]);
    });

    it('opens the collection with the sync config it saved, including specHash and lastSyncDate', async () => {
      await importCollectionHandler({}, openApiCollection('orders', 'Orders API'), collectionLocation, {
        format: 'bru',
        rawOpenAPISpecs: { orders: ordersSpec }
      });

      const [, , , brunoConfig] = mainWindow.webContents.send.mock.calls.find(([channel]) => channel === 'main:collection-opened');
      const sentConfig = brunoConfig.openapi.map((entry) => ({ ...entry, sourceUrl: posixifyPath(entry.sourceUrl) }));
      expect(sentConfig).toEqual(readSyncConfig('Orders API'));
    });

    describe('request files', () => {
      const requestItem = (name, method, filename) => ({
        uid: `${method} ${name}`,
        type: 'http-request',
        name,
        ...(filename && { filename }),
        request: { method, url: `https://api.example.com${name}` }
      });

      const importItems = (items, format) => importCollectionHandler({}, { uid: 'requests', name: 'Requests', items, environments: [] }, collectionLocation, { format });

      const requestFilesIn = (...folders) => fs.readdirSync(path.join(collectionLocation, 'Requests', ...folders))
        .filter((file) => /\.(bru|yml)$/.test(file) && !['opencollection.yml', 'collection.bru'].includes(file))
        .sort();

      it.each(['bru', 'yml'])('writes each request\'s file name in %s, also when its path ends in a slash or holds .bru', async (format) => {
        await importItems([
          requestItem('/', 'GET', 'GET /.bru'),
          requestItem('/users/', 'GET', 'GET /users/.bru'),
          requestItem('/export.bru', 'GET', 'GET /export.bru.bru'),
          requestItem('/pets', 'GET', 'GET /pets.bru')
        ], format);

        expect(requestFilesIn()).toEqual([`GET -.${format}`, `GET -export.bru.${format}`, `GET -pets.${format}`, `GET -users-.${format}`]);
      });

      it.each(['bru', 'yml'])('adds the format extension to a file name that has none, in %s', async (format) => {
        await importItems([requestItem('/users', 'GET', 'get-users')], format);

        expect(requestFilesIn()).toEqual([`get-users.${format}`]);
      });

      it.each(['bru', 'yml'])('writes requests that share a name to the files the converter gave them, in %s', async (format) => {
        await importItems([
          requestItem('List pets', 'GET'),
          requestItem('List pets', 'POST', 'List pets (POST).bru')
        ], format);

        expect(requestFilesIn()).toEqual([`List pets (POST).${format}`, `List pets.${format}`]);
      });

      it('keeps requests that share a name in one folder in their own files', async () => {
        await importItems([{
          uid: 'pet',
          type: 'folder',
          name: 'pet',
          items: [
            requestItem('/pet/{petId}', 'GET'),
            requestItem('/pet/{petId}', 'POST'),
            requestItem('/Pet/{petId}', 'DELETE')
          ]
        }], 'yml');

        expect(requestFilesIn('pet')).toEqual(['Pet-{petId} (2).yml', 'pet-{petId} (1).yml', 'pet-{petId}.yml']);
      });
    });
  });
});
