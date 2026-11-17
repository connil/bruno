import { fromOpenCollectionAuth, toOpenCollectionAuth } from '../../src/opencollection/common/auth';
import { brunoToPostman } from '../../src/postman/bruno-to-postman';
import postmanToBruno from '../../src/postman/postman-to-bruno';

describe('Bearer token prefix conversion', () => {
  it.each(['Token', '{{authScheme}}', ''])('reads legacy prefix %j but does not add it to OpenCollection exports', (prefix) => {
    const auth = { mode: 'bearer', bearer: { token: '{{apiToken}}', prefix } };
    const exported = toOpenCollectionAuth(auth);
    expect(exported).toEqual({ type: 'bearer', token: '{{apiToken}}' });
    expect(fromOpenCollectionAuth({ ...exported, prefix }).bearer).toEqual(auth.bearer);
  });

  it('does not add a prefix to legacy OpenCollection auth', () => {
    const imported = fromOpenCollectionAuth({ type: 'bearer', token: 'token' });
    expect(imported.bearer).toEqual({ token: 'token' });
    expect(toOpenCollectionAuth(imported)).toEqual({ type: 'bearer', token: 'token' });
  });

  it.each([['Token', 'Token secret'], ['Custom', 'Custom secret']])('preserves the Authorization value with prefix %j in Postman', async (prefix, value) => {
    const exported = brunoToPostman({
      name: 'Auth',
      items: [{
        name: 'Request',
        type: 'http-request',
        request: {
          method: 'GET',
          url: 'https://example.com',
          headers: [],
          auth: { mode: 'bearer', bearer: { token: 'secret', prefix } }
        }
      }]
    });
    expect(exported.item[0].request.auth).toEqual({
      type: 'apikey',
      apikey: [
        { key: 'key', value: 'Authorization', type: 'string' },
        { key: 'value', value, type: 'string' },
        { key: 'in', value: 'header', type: 'string' }
      ]
    });
    const { collection } = await postmanToBruno(exported);
    expect(collection.items[0].request.auth.apikey).toMatchObject({
      key: 'Authorization', value, placement: 'header'
    });
  });
});
