const bruToJson = require('../src/bruToJson');
const jsonToBru = require('../src/jsonToBru');
const collectionBruToJson = require('../src/collectionBruToJson');
const jsonToCollectionBru = require('../src/jsonToCollectionBru');

describe.each([
  ['request', bruToJson, jsonToBru, 'meta {\n  name: Auth\n  type: http\n}\n\nget {\n  url: https://example.com\n  auth: bearer\n}\n\n'],
  ['collection/folder', collectionBruToJson, jsonToCollectionBru, '']
])('Bearer prefix at %s level', (_level, parse, stringify, header) => {
  it.each(['Token', '{{authScheme}}', ''])('reads legacy prefix %j but leaves it out of standard files', (prefix) => {
    const parsed = parse(`${header}auth:bearer {\n  token: {{apiToken}}\n  prefix: ${prefix}\n}\n`);
    expect(parsed.auth.bearer).toEqual({ token: '{{apiToken}}', prefix });
    const serialized = stringify(parsed);
    expect(serialized).not.toContain('prefix:');
    expect(parse(serialized).auth.bearer).toEqual({ token: '{{apiToken}}' });
  });

  it('keeps legacy files unchanged without adding a prefix', () => {
    const parsed = parse(`${header}auth:bearer {\n  token: old-token\n}\n`);
    expect(parsed.auth.bearer).toEqual({ token: 'old-token' });
    const serialized = stringify(parsed);
    expect(serialized).not.toContain('prefix:');
    expect(parse(serialized).auth.bearer).toEqual(parsed.auth.bearer);
  });
});
