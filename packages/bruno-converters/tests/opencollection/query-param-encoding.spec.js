import { fromOpenCollectionParams, toOpenCollectionParams } from '../../src/opencollection/common/params';

describe('OpenCollection query parameter encoding', () => {
  it('omits defaults and retains non-default values when exporting and importing', () => {
    const params = [
      { name: 'default', value: 'a', type: 'query', encodeName: true, encodeValue: true, encodeValueAsBase64: false },
      { name: 'custom', value: 'b', type: 'query', encodeName: false, encodeValue: false, encodeValueAsBase64: true }
    ];
    const exported = toOpenCollectionParams(params);
    expect(exported[0]).not.toHaveProperty('extensions');
    expect(exported[1].extensions.bruno.queryParamEncoding).toEqual({
      encodeName: false,
      encodeValue: false,
      encodeValueAsBase64: true
    });
    const imported = fromOpenCollectionParams(exported);
    expect(imported[0].encodeName ?? true).toBe(true);
    expect(imported[0].encodeValue ?? true).toBe(true);
    expect(imported[0].encodeValueAsBase64 ?? false).toBe(false);
    expect(imported[1]).toMatchObject({
      encodeName: false,
      encodeValue: false,
      encodeValueAsBase64: true
    });
  });
});
