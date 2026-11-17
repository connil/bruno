import fs from 'node:fs';
import path from 'node:path';
import type { BrunoCollection, BrunoItem } from '@usebruno/schema-types';
import { sanitizeName, getFilenameWithFormat } from '@usebruno/common/utils';
import {
  stringifyRequest,
  stringifyFolder,
  stringifyCollection,
  stringifyEnvironment,
  saveRequestCustomSettings,
  DEFAULT_COLLECTION_FORMAT,
  type CollectionFormat
} from '@usebruno/filestore';
import type { WriteCollectionOptions } from '../types';

const SUPPORTED_WRITE_ITEM_TYPES = ['http-request', 'graphql-request', 'grpc-request', 'ws-request'];

const HTTP_ITEM_TYPES = ['http-request', 'graphql-request'];

const COLLECTION_FILES: Record<CollectionFormat, string> = {
  bru: 'collection.bru',
  yml: 'opencollection.yml'
};

// Converters emit sparse request objects; fill what the serializers expect without dropping
// anything the item already carries.
const normalizeRequestItem = (item: BrunoItem): BrunoItem => {
  const request: Record<string, any> = item.request || {};

  return {
    ...item,
    seq: typeof item.seq === 'number' ? item.seq : 1,
    tags: item.tags || [],
    settings: item.settings || {},
    examples: item.examples || [],
    request: {
      ...request,
      ...(HTTP_ITEM_TYPES.includes(item.type) && { method: request.method || 'GET' }),
      url: request.url || '',
      headers: request.headers || [],
      params: request.params || [],
      auth: request.auth || {},
      body: request.body || {},
      script: request.script || {},
      vars: request.vars || { req: [], res: [] },
      assertions: request.assertions || [],
      tests: request.tests || '',
      docs: request.docs || ''
    }
  } as BrunoItem;
};

const writeItems = (items: BrunoItem[], dirPath: string, format: CollectionFormat, collectionPath: string): void => {
  for (const item of items) {
    if (item.type === 'folder') {
      const folderPath = path.join(dirPath, sanitizeName(item.filename || item.name));
      fs.mkdirSync(folderPath, { recursive: true });

      if (item.root?.meta?.name) {
        const folderRoot = typeof item.seq === 'number'
          ? { ...item.root, meta: { ...item.root.meta, seq: item.seq } }
          : item.root;
        const folderFilePath = path.join(folderPath, `folder.${format}`);
        fs.writeFileSync(folderFilePath, stringifyFolder(folderRoot, { format }));
        saveRequestCustomSettings(collectionPath, folderFilePath, folderRoot, format);
      }

      writeItems(item.items || [], folderPath, format, collectionPath);
    } else if (SUPPORTED_WRITE_ITEM_TYPES.includes(item.type)) {
      const filename = sanitizeName(getFilenameWithFormat(item, format));
      const requestPath = path.join(dirPath, filename);
      const normalized = normalizeRequestItem(item);
      fs.writeFileSync(requestPath, stringifyRequest(normalized, { format }));
      saveRequestCustomSettings(collectionPath, requestPath, normalized, format);
    } else {
      throw new Error(`Unsupported item type: ${item.type}`);
    }
  }
};

const writeCollectionInFormat = async (
  collection: BrunoCollection,
  outputDir: string,
  format: CollectionFormat
): Promise<string> => {
  const collectionFile = COLLECTION_FILES[format];
  if (!collectionFile) {
    throw new Error(`Unsupported format: ${format}`);
  }

  const brunoConfig: Record<string, unknown> = {
    version: '1',
    name: collection.name,
    type: 'collection',
    ignore: ['node_modules', '.git']
  };
  if (format === 'yml') {
    brunoConfig.opencollection = '1.0.0';
  }

  fs.mkdirSync(outputDir, { recursive: true });
  if (fs.readdirSync(outputDir).length > 0) {
    throw Object.assign(new Error(`Output directory is not empty: ${outputDir}`), { code: 'ENOTEMPTY' });
  }

  if (format === 'bru') {
    fs.writeFileSync(path.join(outputDir, 'bruno.json'), JSON.stringify(brunoConfig, null, 2));
  }
  fs.writeFileSync(
    path.join(outputDir, collectionFile),
    stringifyCollection((collection.root || {}) as BrunoCollection, brunoConfig, { format })
  );
  saveRequestCustomSettings(outputDir, path.join(outputDir, collectionFile), collection.root || {}, format);

  const environments = collection.environments || [];
  if (environments.length) {
    const envDirPath = path.join(outputDir, 'environments');
    fs.mkdirSync(envDirPath, { recursive: true });
    for (const env of environments) {
      fs.writeFileSync(path.join(envDirPath, sanitizeName(`${env.name}.${format}`)), stringifyEnvironment(env, { format }));
    }
  }

  writeItems(collection.items || [], outputDir, format, outputDir);

  return outputDir;
};

/**
 * Writes a collection (as returned by `@usebruno/converters`) to `outputDir` as a Bruno
 * collection directory in the default (`yml`) format. `outputDir` is created if missing and must
 * otherwise be empty.
 */
export const writeCollection = (collection: BrunoCollection, outputDir: string): Promise<string> => {
  return writeCollectionInFormat(collection, outputDir, DEFAULT_COLLECTION_FORMAT);
};

/**
 * Same as `writeCollection`, but lets the caller pick the on-disk format.
 */
export const writeCollectionLegacy = (
  collection: BrunoCollection,
  outputDir: string,
  options: WriteCollectionOptions = {}
): Promise<string> => {
  return writeCollectionInFormat(collection, outputDir, options.format || DEFAULT_COLLECTION_FORMAT);
};
