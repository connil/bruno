import * as fs from 'fs';
import * as path from 'path';
import type { HttpRequestParam } from '@usebruno/schema-types/requests/http';
import type { Auth } from '@usebruno/schema-types/common/auth';
import { uuid } from './utils';

export const CUSTOM_SETTINGS_FILENAME = '.bruno-custom.json';
export const LEGACY_CUSTOM_SETTINGS_FILENAME = '.bruno-query-encoding.json';

type Encoding = {
  name: string;
  occurrence: number;
  encodeName?: boolean;
  encodeValue?: boolean;
  encodeValueAsBase64?: boolean;
};

type CustomSettingsItem = {
  request?: { params?: HttpRequestParam[] | null; auth?: Auth | null } | null;
};

type PathParam = {
  name: string;
  value: string;
  enabled: boolean;
  description?: string;
  annotations?: HttpRequestParam['annotations'];
};

type RequestSettings = {
  queryParamEncoding?: Encoding[];
  pathParams?: PathParam[];
  bearerTokenPrefix?: string;
};

type Sidecar = {
  version: 1;
  requests: Record<string, RequestSettings>;
};

const sameCollection = (first: string, second: string): boolean => {
  const firstPath = path.resolve(first);
  const secondPath = path.resolve(second);
  return process.platform === 'win32'
    ? firstPath.toLowerCase() === secondPath.toLowerCase()
    : firstPath === secondPath;
};

const relativeKey = (collectionPath: string, itemPath: string): string => {
  const relative = path.relative(collectionPath, itemPath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Path is not inside the collection: ${itemPath}`);
  }
  return relative.split(path.sep).join('/');
};

const requestKey = (collectionPath: string, itemPath: string): string => {
  const relative = relativeKey(collectionPath, itemPath);
  if (relative === 'collection.bru' || relative === 'opencollection.yml') return '/';
  if (/^folder\.(bru|ya?ml)$/i.test(path.basename(itemPath))) {
    return relative.slice(0, relative.lastIndexOf('/') + 1) || '/';
  }
  return relative.replace(/\.(bru|ya?ml)$/i, '');
};

const operationKey = (collectionPath: string, itemPath: string, sidecar: Sidecar): { key: string; directory: boolean } => {
  const relative = relativeKey(collectionPath, itemPath);
  const directory = (fs.existsSync(itemPath) && fs.statSync(itemPath).isDirectory())
    || Object.keys(sidecar.requests).some((entry) => entry.startsWith(`${relative}/`));
  return { key: directory ? relative : requestKey(collectionPath, itemPath), directory };
};

const readSidecar = (collectionPath: string): Sidecar => {
  let filename = path.join(collectionPath, CUSTOM_SETTINGS_FILENAME);
  let content: string;
  try {
    content = fs.readFileSync(filename, 'utf8');
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error;
    filename = path.join(collectionPath, LEGACY_CUSTOM_SETTINGS_FILENAME);
    try {
      content = fs.readFileSync(filename, 'utf8');
    } catch (legacyError) {
      if (legacyError && typeof legacyError === 'object' && 'code' in legacyError && legacyError.code === 'ENOENT') {
        return { version: 1, requests: {} };
      }
      throw legacyError;
    }
  }
  const data = JSON.parse(content) as Sidecar;
  if (!data || data.version !== 1 || !data.requests || typeof data.requests !== 'object' || Array.isArray(data.requests)) {
    throw new Error(`Invalid custom settings file: ${filename}`);
  }
  for (const key of Object.keys(data.requests)) {
    const stored = data.requests[key];
    const settings: RequestSettings = Array.isArray(stored) ? { queryParamEncoding: stored } : stored;
    if (!settings || typeof settings !== 'object') throw new Error(`Invalid custom settings file: ${filename}`);
    if (settings.bearerTokenPrefix !== undefined && typeof settings.bearerTokenPrefix !== 'string') {
      throw new Error(`Invalid custom settings file: ${filename}`);
    }
    const encodings = settings.queryParamEncoding;
    if (encodings !== undefined && (!Array.isArray(encodings) || encodings.some((entry) => (
      !entry || typeof entry.name !== 'string' || !Number.isInteger(entry.occurrence) || entry.occurrence < 0
      || (entry.encodeName !== undefined && typeof entry.encodeName !== 'boolean')
      || (entry.encodeValue !== undefined && typeof entry.encodeValue !== 'boolean')
      || (entry.encodeValueAsBase64 !== undefined && typeof entry.encodeValueAsBase64 !== 'boolean')
    )))) {
      throw new Error(`Invalid custom settings file: ${filename}`);
    }
    if (settings.pathParams !== undefined && (!Array.isArray(settings.pathParams) || settings.pathParams.some((entry) => (
      !entry || typeof entry.name !== 'string' || typeof entry.value !== 'string'
      || typeof entry.enabled !== 'boolean'
      || (entry.description !== undefined && typeof entry.description !== 'string')
      || (entry.annotations !== undefined && entry.annotations !== null && (!Array.isArray(entry.annotations) || entry.annotations.some((annotation) => (
        !annotation || typeof annotation.name !== 'string'
        || (annotation.value !== undefined && annotation.value !== null && typeof annotation.value !== 'string')
      ))))
    )))) {
      throw new Error(`Invalid custom settings file: ${filename}`);
    }
    Object.defineProperty(data.requests, key, { value: settings, enumerable: true, configurable: true, writable: true });
  }
  return data;
};

const writeSidecar = (collectionPath: string, sidecar: Sidecar): void => {
  const filename = path.join(collectionPath, CUSTOM_SETTINGS_FILENAME);
  const legacy = path.join(collectionPath, LEGACY_CUSTOM_SETTINGS_FILENAME);
  if (!Object.keys(sidecar.requests).length && !fs.existsSync(filename) && !fs.existsSync(legacy)) return;
  const content = `${JSON.stringify(sidecar, null, 2)}\n`;
  if (fs.existsSync(filename) && fs.readFileSync(filename, 'utf8') === content) return;
  const temporary = path.join(collectionPath, `.bruno-custom-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`);
  try {
    fs.writeFileSync(temporary, content, { flag: 'wx' });
    fs.renameSync(temporary, filename);
    if (fs.existsSync(legacy)) fs.unlinkSync(legacy);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
};

const queryParams = (item: CustomSettingsItem): HttpRequestParam[] => {
  return (item.request?.params || []).filter((param) => param.type === 'query');
};

export const loadRequestCustomSettings = <T extends CustomSettingsItem>(collectionPath: string, itemPath: string, item: T): T => {
  const requests = readSidecar(collectionPath).requests;
  const key = requestKey(collectionPath, itemPath);
  if (!Object.prototype.hasOwnProperty.call(requests, key)) return item;
  const settings = requests[key];
  if (settings.bearerTokenPrefix && item.request?.auth?.mode === 'bearer') {
    item.request.auth = {
      ...item.request.auth,
      bearer: { ...item.request.auth.bearer, prefix: settings.bearerTokenPrefix }
    };
  }
  const encodings = settings.queryParamEncoding || [];
  const occurrences = new Map<string, number>();
  for (const param of queryParams(item)) {
    const name = param.name || '';
    const occurrence = occurrences.get(name) || 0;
    occurrences.set(name, occurrence + 1);
    const encoding = encodings.find((entry) => entry.name === name && entry.occurrence === occurrence);
    if (!encoding) continue;
    if (typeof encoding.encodeName === 'boolean') param.encodeName = encoding.encodeName;
    if (typeof encoding.encodeValue === 'boolean') param.encodeValue = encoding.encodeValue;
    if (typeof encoding.encodeValueAsBase64 === 'boolean') param.encodeValueAsBase64 = encoding.encodeValueAsBase64;
  }
  const storedPathParams = settings.pathParams;
  if (storedPathParams?.length && item.request?.params) {
    const fileParams = item.request.params;
    const restored = new Set<string>();
    item.request.params = item.request.params.flatMap((param) => {
      if (param.type !== 'path') return [param];
      const alternatives = storedPathParams.filter((entry) => entry.name === param.name);
      if (!alternatives.length) return [param];
      if (restored.has(param.name || '')) return [];
      restored.add(param.name || '');
      const selected = alternatives.findIndex((entry) => entry.enabled);
      const fileParam = fileParams.find((entry) => entry.type === 'path' && entry.name === param.name && entry.enabled !== false) || param;
      return alternatives.map((entry, index) => ({
        ...entry,
        type: 'path' as const,
        uid: index === selected ? fileParam.uid : uuid(),
        ...(index === selected ? {
          value: fileParam.value,
          description: fileParam.description,
          annotations: fileParam.annotations || entry.annotations
        } : {})
      }));
    });
  }
  return item;
};

const settingsForItem = (item: CustomSettingsItem, format: string): RequestSettings => {
  let params = queryParams(item);
  if (format === 'bru') {
    params = [...params.filter((param) => param.enabled), ...params.filter((param) => !param.enabled)];
  }
  const occurrences = new Map<string, number>();
  const encodings: Encoding[] = [];
  for (const param of params) {
    const name = param.name || '';
    const occurrence = occurrences.get(name) || 0;
    occurrences.set(name, occurrence + 1);
    const encoding: Encoding = { name, occurrence };
    if (param.encodeName === false) encoding.encodeName = false;
    if (param.encodeValue === false) encoding.encodeValue = false;
    if (param.encodeValueAsBase64 === true) encoding.encodeValueAsBase64 = true;
    if (Object.keys(encoding).length > 2) encodings.push(encoding);
  }
  const pathParams = (item.request?.params || []).filter((param) => param.type === 'path');
  const counts = new Map<string, number>();
  for (const param of pathParams) counts.set(param.name || '', (counts.get(param.name || '') || 0) + 1);
  const alternatives: PathParam[] = pathParams
    .filter((param) => (counts.get(param.name || '') || 0) > 1 || param.enabled === false)
    .map((param) => ({
      name: param.name || '',
      value: param.value || '',
      enabled: param.enabled !== false,
      ...(param.description ? { description: param.description } : {}),
      ...(param.annotations?.length ? { annotations: param.annotations } : {})
    }));
  const settings: RequestSettings = {};
  if (encodings.length) settings.queryParamEncoding = encodings;
  if (alternatives.length) settings.pathParams = alternatives;
  const prefix = item.request?.auth?.bearer?.prefix;
  if (prefix && prefix !== 'Bearer') settings.bearerTokenPrefix = prefix;
  return settings;
};

export const migrateLegacyRequestSettings = (collectionPath: string, itemPath: string, item: CustomSettingsItem, format: string): void => {
  const sidecar = readSidecar(collectionPath);
  const key = requestKey(collectionPath, itemPath);
  const settings = settingsForItem(item, format);
  const existing = Object.prototype.hasOwnProperty.call(sidecar.requests, key) ? sidecar.requests[key] : {};
  const merged = { ...settings, ...existing };
  if (Object.keys(merged).length) {
    Object.defineProperty(sidecar.requests, key, { value: merged, enumerable: true, configurable: true, writable: true });
  }
  writeSidecar(collectionPath, sidecar);
};

export const saveRequestCustomSettings = (collectionPath: string, itemPath: string, item: CustomSettingsItem, format: string): void => {
  const sidecar = readSidecar(collectionPath);
  const key = requestKey(collectionPath, itemPath);
  const settings = settingsForItem(item, format);
  if (Object.keys(settings).length) {
    Object.defineProperty(sidecar.requests, key, { value: settings, enumerable: true, configurable: true, writable: true });
  } else {
    delete sidecar.requests[key];
  }
  writeSidecar(collectionPath, sidecar);
};

export const deleteRequestCustomSettings = (collectionPath: string, itemPath: string): void => {
  const sidecar = readSidecar(collectionPath);
  const { key } = operationKey(collectionPath, itemPath, sidecar);
  for (const entry of Object.keys(sidecar.requests)) {
    if (entry === key || entry.startsWith(`${key}/`)) delete sidecar.requests[entry];
  }
  writeSidecar(collectionPath, sidecar);
};

export const copyRequestCustomSettings = (sourceCollectionPath: string, sourcePath: string, targetCollectionPath: string, targetPath: string): void => {
  const source = readSidecar(sourceCollectionPath);
  const target = sameCollection(sourceCollectionPath, targetCollectionPath) ? source : readSidecar(targetCollectionPath);
  const sourceOperation = operationKey(sourceCollectionPath, sourcePath, source);
  const directory = sourceOperation.directory || (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory());
  const sourceKey = directory ? relativeKey(sourceCollectionPath, sourcePath) : sourceOperation.key;
  const targetKey = directory ? relativeKey(targetCollectionPath, targetPath) : requestKey(targetCollectionPath, targetPath);
  if (target === source && targetKey === sourceKey) return;
  const entries = Object.entries(source.requests);
  for (const key of Object.keys(target.requests)) {
    if (key === targetKey || (directory && key.startsWith(`${targetKey}/`))) delete target.requests[key];
  }
  for (const [key, value] of entries) {
    if (key === sourceKey || key.startsWith(`${sourceKey}/`)) {
      Object.defineProperty(target.requests, `${targetKey}${key.slice(sourceKey.length)}`, {
        value, enumerable: true, configurable: true, writable: true
      });
    }
  }
  writeSidecar(targetCollectionPath, target);
};

export const moveRequestCustomSettings = (sourceCollectionPath: string, sourcePath: string, targetCollectionPath: string, targetPath: string): void => {
  const source = readSidecar(sourceCollectionPath);
  const sourceOperation = operationKey(sourceCollectionPath, sourcePath, source);
  const directory = sourceOperation.directory || (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory());
  const key = directory ? relativeKey(sourceCollectionPath, sourcePath) : sourceOperation.key;
  const targetKey = directory ? relativeKey(targetCollectionPath, targetPath) : requestKey(targetCollectionPath, targetPath);
  if (sameCollection(sourceCollectionPath, targetCollectionPath) && key === targetKey) return;
  copyRequestCustomSettings(sourceCollectionPath, sourcePath, targetCollectionPath, targetPath);
  deleteRequestCustomSettings(sourceCollectionPath, sourcePath);
};
