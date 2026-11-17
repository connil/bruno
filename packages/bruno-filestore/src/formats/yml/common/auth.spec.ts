import { toBrunoAuth, toOpenCollectionAuth } from './auth';
import parseItem from '../parseItem';
import stringifyItem from '../stringifyItem';
import { parseBruRequest, stringifyBruRequest } from '../../bru';

describe('Bearer token prefix', () => {
  it.each(['Token', ''])('reads legacy BRU prefix %j without writing it into standard files', (prefix) => {
    const item = parseBruRequest(`meta {
  name: Auth
  type: http
}
get {
  url: https://example.com
  auth: bearer
}
auth:bearer {
  token: secret
  prefix: ${prefix}
}
`);
    expect(item.request.auth.bearer).toEqual({ token: 'secret', prefix });
    expect(stringifyItem(item)).not.toContain('prefix:');
    expect(stringifyBruRequest(item)).not.toContain('prefix:');
  });

  it.each(['Token', '{{authScheme}}', ''])('omits custom prefix %j from OpenCollection auth', (prefix) => {
    const auth = { mode: 'bearer' as const, bearer: { token: '{{apiToken}}', prefix } };
    const exported = toOpenCollectionAuth(auth);
    expect(exported).toEqual({ type: 'bearer', token: '{{apiToken}}' });
    const legacy = { type: 'bearer' as const, token: '{{apiToken}}', prefix };
    expect(toBrunoAuth(legacy)?.bearer).toEqual(auth.bearer);
  });

  it.each(['http', 'graphql', 'grpc', 'websocket'])('reads a legacy prefix in %s YAML requests without writing it back', (protocol) => {
    const parsed = parseItem(`info:
  name: Auth
  type: ${protocol}
${protocol}:
  url: https://example.com
  method: GET
  auth:
    type: bearer
    token: "{{apiToken}}"
    prefix: Token
`);
    const serialized = stringifyItem(parsed);
    expect(parsed.request?.auth?.bearer).toEqual({ token: '{{apiToken}}', prefix: 'Token' });
    expect(serialized).not.toContain('prefix:');
    expect(parseItem(serialized).request?.auth?.bearer).toEqual({ token: '{{apiToken}}' });
  });

  it('does not write an empty prefix into YAML', () => {
    const item = parseItem(`info:
  name: Auth
  type: http
http:
  url: https://example.com
  method: GET
  auth:
    type: bearer
    token: token
    prefix: ""
`);
    expect(parseItem(stringifyItem(item)).request?.auth?.bearer).toEqual({ token: 'token' });
  });

  it('does not add a prefix to legacy YAML files', () => {
    const item = parseItem(`info:
  name: Auth
  type: http
http:
  url: https://example.com
  method: GET
  auth:
    type: bearer
    token: old-token
`);
    expect(item.request?.auth?.bearer).toEqual({ token: 'old-token' });
    const serialized = stringifyItem(item);
    expect(serialized).not.toContain('prefix:');
    expect(parseItem(serialized).request?.auth?.bearer).toEqual({ token: 'old-token' });
  });
});
