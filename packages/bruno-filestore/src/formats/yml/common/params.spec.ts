import { describe, expect, it } from '@jest/globals';
import { toBrunoParams, toOpenCollectionParams } from './params';
import parseItem from '../parseItem';
import stringifyItem from '../stringifyItem';

describe('query parameter encoding options', () => {
  it('omits encoding options from OpenCollection request parameters', () => {
    const params = [
      {
        uid: 'param-1',
        name: 'search',
        value: 'value',
        type: 'query' as const,
        enabled: true,
        encodeName: false,
        encodeValue: false,
        encodeValueAsBase64: true
      }
    ];

    const openCollectionParams = toOpenCollectionParams(params);
    expect(openCollectionParams?.[0]).not.toHaveProperty('extensions');

    expect(toBrunoParams(openCollectionParams)?.[0]).toMatchObject({
      name: 'search',
      value: 'value',
      type: 'query',
      enabled: true
    });
  });

  it('does not write encoding options into YAML requests', () => {
    const item = parseItem(`info:
  name: encoding
  type: http
http:
  method: GET
  url: https://example.com?search=value
  params:
    - name: search
      value: value
      type: query
`);
    if (!item.request || !('params' in item.request) || !item.request.params?.length) {
      throw new Error('Expected query parameters in the parsed request');
    }
    const param = item.request.params[0];
    param.encodeName = false;
    param.encodeValue = false;
    param.encodeValueAsBase64 = true;

    const reloaded = parseItem(stringifyItem(item));
    if (!reloaded.request || !('params' in reloaded.request) || !reloaded.request.params?.length) {
      throw new Error('Expected query parameters in the reloaded request');
    }
    expect(reloaded.request.params[0]).toMatchObject({ name: 'search' });
    expect(reloaded.request.params[0]).not.toHaveProperty('encodeName');
  });

  it('omits default options when writing but reads previously stored defaults', () => {
    const param = {
      uid: 'param-1',
      name: 'search',
      value: 'value',
      type: 'query' as const,
      encodeName: true,
      encodeValue: true,
      encodeValueAsBase64: false
    };
    const written = toOpenCollectionParams([param]);
    expect(written?.[0]).not.toHaveProperty('extensions');
    const reloaded = toBrunoParams(written)?.[0];
    expect(reloaded?.encodeName ?? true).toBe(true);
    expect(reloaded?.encodeValue ?? true).toBe(true);
    expect(reloaded?.encodeValueAsBase64 ?? false).toBe(false);

    const legacy = [{
      ...written![0],
      extensions: { bruno: { queryParamEncoding: {
        encodeName: true,
        encodeValue: true,
        encodeValueAsBase64: false
      } } }
    }];
    expect(toBrunoParams(legacy)?.[0]).toMatchObject({
      encodeName: true,
      encodeValue: true,
      encodeValueAsBase64: false
    });
  });

  it('reads legacy YAML options but does not write them back', () => {
    const item = parseItem(`info:
  name: encoding
  type: http
http:
  method: GET
  url: https://example.com?search=value
  params:
    - name: search
      value: value
      type: query
      extensions:
        bruno:
          queryParamEncoding:
            encodeName: true
            encodeValue: false
            encodeValueAsBase64: false
`);
    const yaml = stringifyItem(item);
    expect(yaml).not.toContain('encodeName:');
    expect(yaml).not.toContain('encodeValueAsBase64:');
    expect(yaml).not.toContain('encodeValue:');

    const reloaded = parseItem(yaml);
    if (!reloaded.request || !('params' in reloaded.request) || !reloaded.request.params?.length) {
      throw new Error('Expected query parameters in the reloaded request');
    }
    expect(reloaded.request.params[0].encodeName ?? true).toBe(true);
    expect(reloaded.request.params[0].encodeValue ?? true).toBe(true);
    expect(reloaded.request.params[0].encodeValueAsBase64 ?? false).toBe(false);
  });
});
