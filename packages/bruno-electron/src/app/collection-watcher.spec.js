const path = require('path');
const fs = require('fs');

const watcherHandlers = {};
const mockWatcher = {
  on: jest.fn((event, handler) => {
    watcherHandlers[event] = handler;
    return mockWatcher;
  }),
  getWatched: jest.fn(),
  close: jest.fn()
};

jest.mock('chokidar', () => ({
  watch: jest.fn((watchPath, options) => {
    return mockWatcher;
  })
}));

jest.mock('../utils/filesystem', () => ({
  hasRequestExtension: jest.fn(),
  isWSLPath: jest.fn(() => false),
  normalizeAndResolvePath: jest.fn((pathname) => pathname),
  sizeInMB: jest.fn(),
  getCollectionFormat: jest.fn(() => 'bru')
}));

jest.mock('@usebruno/filestore', () => ({
  CUSTOM_SETTINGS_FILENAME: '.bruno-custom.json',
  LEGACY_CUSTOM_SETTINGS_FILENAME: '.bruno-query-encoding.json',
  migrateLegacyRequestSettings: jest.fn(),
  parseEnvironment: jest.fn(),
  parseRequest: jest.fn(),
  parseRequestViaWorker: jest.fn(),
  loadRequestCustomSettings: jest.fn((collectionPath, pathname, item) => item),
  saveRequestCustomSettings: jest.fn(),
  parseCollection: jest.fn(),
  parseFolder: jest.fn()
}), { virtual: true });

jest.mock('@usebruno/common/utils', () => ({
  parseValueByDataType: jest.fn()
}), { virtual: true });

jest.mock('../utils/common', () => ({
  uuid: jest.fn(() => 'uuid')
}));

jest.mock('../cache/requestUids', () => ({
  getRequestUid: jest.fn()
}));

jest.mock('../utils/encryption', () => ({
  decryptStringSafe: jest.fn()
}));

jest.mock('../store/env-secrets', () => jest.fn().mockImplementation(() => ({})));

jest.mock('../services/snapshot', () => ({
  getCollection: jest.fn()
}));

jest.mock('../utils/collection', () => ({
  parseFileMeta: jest.fn(),
  hydrateRequestWithUuid: jest.fn()
}));

jest.mock('../utils/parse', () => ({
  parseLargeRequestWithRedaction: jest.fn()
}));

jest.mock('../utils/request-custom-settings', () => ({
  ...jest.requireActual('../utils/request-custom-settings'),
  loadRequestCustomSettingsWithMigration: (collectionPath, pathname, item) =>
    require('@usebruno/filestore').loadRequestCustomSettings(collectionPath, pathname, item)
}));

jest.mock('../utils/transformBrunoConfig', () => ({
  transformBrunoConfigAfterRead: jest.fn()
}));

jest.mock('./dotenv-watcher', () => ({
  addCollectionWatcher: jest.fn(),
  removeCollectionWatcher: jest.fn()
}));

const { getBrunoConfig } = require('../store/bruno-config');
const collectionWatcher = require('./collection-watcher');
const { parseRequest, parseRequestViaWorker, parseCollection, parseFolder, loadRequestCustomSettings } = require('@usebruno/filestore');
const { hasRequestExtension } = require('../utils/filesystem');

describe('CollectionWatcher', () => {
  afterEach(() => {
    collectionWatcher.removeWatcher(path.resolve('sidecar-watcher-fixture'));
    collectionWatcher.closeAllWatchers();
    Object.keys(watcherHandlers).forEach((event) => delete watcherHandlers[event]);
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('honors configured ignore paths during the initial scan', () => {
    const watchPath = path.join('tmp', 'collection');
    const collectionUid = 'collection-uid';
    const brunoConfig = { ignore: ['ignored'] };
    const win = { webContents: { send: jest.fn() } };

    collectionWatcher.addWatcher(win, watchPath, collectionUid, brunoConfig);

    expect(getBrunoConfig(collectionUid)).toEqual(brunoConfig);

    const ignored = require('chokidar').watch.mock.calls[0][1].ignored;
    const ignoredDir = path.join(watchPath, 'ignored', 'somefile.yml');
    const visibleDir = path.join(watchPath, 'visible', 'somefile.yml');
    const gitDir = path.join(watchPath, '.git', 'config');
    const nodeModulesDir = path.join(watchPath, 'node_modules', 'package', 'index.js');

    expect(ignored(ignoredDir)).toBe(true);
    expect(ignored(visibleDir)).toBe(false);
    expect(ignored(gitDir)).toBe(true);
    expect(ignored(nodeModulesDir)).toBe(true);
  });

  it.each(['add', 'change', 'unlink'])('refreshes request data when an external sidecar emits %s', async (event) => {
    const watchPath = path.resolve('sidecar-watcher-fixture');
    const pathname = path.join(watchPath, 'Search.bru');
    const sidecar = path.join(watchPath, '.bruno-custom.json');
    const win = { webContents: { send: jest.fn() } };
    const fileIndex = { stageParsed: jest.fn() };
    let encodeValue = false;
    const stagedEncodings = [];
    fileIndex.stageParsed.mockImplementation((collectionPath, requestPath, data) => {
      stagedEncodings.push(data.request.params[0].encodeValue);
    });
    parseRequest.mockImplementation(() => ({ request: { params: [{ name: 'q', type: 'query' }] } }));
    loadRequestCustomSettings.mockImplementation((collectionPath, requestPath, item) => {
      if (encodeValue !== undefined) item.request.params[0].encodeValue = encodeValue;
      return item;
    });
    hasRequestExtension.mockImplementation((filename) => filename.endsWith('.bru'));
    mockWatcher.getWatched.mockReturnValue({ [watchPath]: ['Search.bru', '.bruno-custom.json'] });
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    const readFileSync = fs.readFileSync.bind(fs);
    jest.spyOn(fs, 'readFileSync').mockImplementation((filename, ...args) => {
      if (filename === pathname) return 'request content';
      if (filename === sidecar) return '{"version":1,"requests":{}}';
      return readFileSync(filename, ...args);
    });
    jest.spyOn(fs, 'statSync').mockReturnValue({ size: 10 });
    collectionWatcher.addWatcher(win, watchPath, 'sidecar-collection', {}, false, false, { ignoreInitial: true, fileIndex });

    await watcherHandlers[event](sidecar);
    expect(win.webContents.send).toHaveBeenLastCalledWith('main:collection-tree-updated', 'change', expect.objectContaining({
      data: expect.objectContaining({ request: { params: [{ name: 'q', type: 'query', encodeValue: false }] } })
    }));
    expect(parseRequest).toHaveBeenCalledTimes(1);
    expect(stagedEncodings).toEqual([undefined]);

    encodeValue = undefined;
    await watcherHandlers.unlink(sidecar);
    expect(win.webContents.send.mock.calls.at(-1)[2].data.request.params[0].encodeValue).toBeUndefined();
  });

  it.each(['collection.bru', path.join('API', 'folder.bru')])('refreshes bearer prefixes from the sidecar for %s', async (relativePath) => {
    const watchPath = path.resolve('sidecar-watcher-fixture');
    const pathname = path.join(watchPath, relativePath);
    const sidecar = path.join(watchPath, '.bruno-custom.json');
    const win = { webContents: { send: jest.fn() } };
    const stagedPrefixes = [];
    const fileIndex = {
      stageParsed: jest.fn((collectionPath, requestPath, data) => stagedPrefixes.push(data.request.auth.bearer.prefix))
    };
    const root = () => ({ request: { auth: { mode: 'bearer', bearer: { token: 'secret' } } } });
    parseCollection.mockImplementation(root);
    parseFolder.mockImplementation(root);
    let prefix = 'Custom';
    loadRequestCustomSettings.mockImplementation((collectionPath, requestPath, item) => {
      if (prefix) item.request.auth.bearer.prefix = prefix;
      return item;
    });
    mockWatcher.getWatched.mockReturnValue({ [path.dirname(pathname)]: [path.basename(pathname)] });
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    const readFileSync = fs.readFileSync.bind(fs);
    jest.spyOn(fs, 'readFileSync').mockImplementation((filename, ...args) =>
      filename === pathname ? 'root content' : readFileSync(filename, ...args)
    );
    collectionWatcher.addWatcher(win, watchPath, 'prefix-collection', {}, false, false, { ignoreInitial: true, fileIndex });
    await watcherHandlers.change(sidecar);
    expect(win.webContents.send.mock.calls.at(-1)[2].data.request.auth.bearer.prefix).toBe('Custom');
    prefix = '';
    await watcherHandlers.unlink(sidecar);
    expect(win.webContents.send.mock.calls.at(-1)[2].data.request.auth.bearer).not.toHaveProperty('prefix');
    expect(stagedPrefixes).toEqual([undefined, undefined]);
  });

  it.each([false, true])('hydrates sidecar settings after request parsing (worker: %s)', async (useWorkerThread) => {
    const watchPath = path.resolve('sidecar-watcher-fixture');
    const pathname = path.join(watchPath, 'Search.bru');
    const win = { webContents: { send: jest.fn() } };
    const parsed = { request: { params: [{ name: 'q', type: 'query' }] } };
    parseRequest.mockResolvedValue(parsed);
    parseRequestViaWorker.mockResolvedValue(parsed);
    require('../utils/collection').parseFileMeta.mockReturnValue({ name: 'Search' });
    loadRequestCustomSettings.mockImplementation((collectionPath, requestPath, item) => {
      item.request.params[0].encodeName = false;
      return item;
    });
    hasRequestExtension.mockReturnValue(true);
    const readFileSync = fs.readFileSync.bind(fs);
    jest.spyOn(fs, 'readFileSync').mockImplementation((filename, ...args) =>
      filename === pathname ? 'request content' : readFileSync(filename, ...args)
    );
    jest.spyOn(fs, 'statSync').mockReturnValue({ size: 10 });
    collectionWatcher.addWatcher(win, watchPath, 'sidecar-collection', {}, false, useWorkerThread);
    await watcherHandlers.add(pathname);
    expect(win.webContents.send.mock.calls.at(-1)[2].data.request.params[0].encodeName).toBe(false);
  });
});
