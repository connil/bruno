const path = require('node:path');
const fs = require('node:fs');
const { loadRequestCustomSettings, saveRequestCustomSettings, migrateLegacyRequestSettings, LEGACY_CUSTOM_SETTINGS_FILENAME } = require('@usebruno/filestore');
const { withFileLock, writeFile, writeFileUnique } = require('./filesystem');

const getCustomSettingsCollectionPath = (collectionPath, requestPath) => {
  const relativePath = collectionPath ? path.relative(collectionPath, requestPath) : null;
  // Transient requests live beside metadata.json, outside their original collection.
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    return path.dirname(requestPath);
  }
  return collectionPath;
};

const writeRequestWithCustomSettings = (collectionPath, pathname, item, format, content) => {
  return withFileLock(pathname, async () => {
    const previous = fs.existsSync(pathname) ? await fs.promises.readFile(pathname) : null;
    try {
      await writeFile(pathname, content);
      saveRequestCustomSettings(collectionPath, pathname, item, format);
    } catch (error) {
      try {
        if (previous !== null) {
          await writeFile(pathname, previous, true);
        } else if (fs.existsSync(pathname)) {
          await fs.promises.unlink(pathname);
        }
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `Could not restore request after failed save: ${pathname}`);
      }
      throw error;
    }
  });
};

const loadRequestCustomSettingsWithMigration = (collectionPath, pathname, item, format) => {
  const hasLegacyEncoding = item.request?.params?.some((param) =>
    param.type === 'query' && (param.encodeName === false || param.encodeValue === false || param.encodeValueAsBase64 === true)
  );
  const pathParams = (item.request?.params || []).filter((param) => param.type === 'path');
  const hasLegacyPaths = pathParams.some((param, index) =>
    param.enabled === false || pathParams.findIndex((entry) => entry.name === param.name) !== index
  );
  const prefix = item.request?.auth?.bearer?.prefix;
  const hasLegacyPrefix = prefix && prefix !== 'Bearer';
  const loaded = loadRequestCustomSettings(collectionPath, pathname, item);
  if (hasLegacyEncoding || hasLegacyPaths || hasLegacyPrefix || fs.existsSync(path.join(collectionPath, LEGACY_CUSTOM_SETTINGS_FILENAME))) {
    try {
      migrateLegacyRequestSettings(collectionPath, pathname, loaded, format);
    } catch (error) {
      // Read-only collections must still open with their inline settings intact.
      console.error(`Could not migrate custom request settings for ${pathname}:`, error);
    }
  }
  return loaded;
};

const createRequestWithCustomSettings = async (collectionPath, directory, basename, format, item, content) => {
  const created = await writeFileUnique(directory, basename, format, content);
  try {
    // The final collision-resolved filename is only known after the exclusive create.
    // The sidecar watcher refreshes requests even when their add event arrived first.
    saveRequestCustomSettings(getCustomSettingsCollectionPath(collectionPath, created.pathname), created.pathname, item, format);
    return created;
  } catch (error) {
    fs.unlinkSync(created.pathname);
    throw error;
  }
};

module.exports = {
  getCustomSettingsCollectionPath,
  loadRequestCustomSettingsWithMigration,
  writeRequestWithCustomSettings,
  createRequestWithCustomSettings
};
