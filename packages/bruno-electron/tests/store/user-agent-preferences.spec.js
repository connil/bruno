let mockStoreData = {};

jest.mock('electron-store', () => jest.fn().mockImplementation(() => ({
  get: (key, fallback) => mockStoreData[key] ?? fallback,
  set: (key, value) => {
    mockStoreData[key] = value;
  }
})));

const { getPreferences, savePreferences, preferencesUtil } = require('../../src/store/preferences');

describe('global User-Agent preferences', () => {
  beforeEach(() => {
    mockStoreData = {};
  });

  it('keeps automatic defaults for both new and existing preference files', () => {
    expect(preferencesUtil.getUserAgent()).toBe('');
    mockStoreData.preferences = { request: { timeout: 500 } };
    expect(preferencesUtil.getUserAgent()).toBe('');
    expect(getPreferences().request.timeout).toBe(500);
  });

  it('persists a custom User-Agent and supports clearing it', async () => {
    await savePreferences({
      ...getPreferences(),
      request: { ...getPreferences().request, userAgent: '  MyClient/1.0  ' }
    });
    expect(mockStoreData.preferences.request.userAgent).toBe('  MyClient/1.0  ');
    expect(preferencesUtil.getUserAgent()).toBe('MyClient/1.0');

    await savePreferences({
      ...getPreferences(),
      request: { ...getPreferences().request, userAgent: '' }
    });
    expect(preferencesUtil.getUserAgent()).toBe('');
  });

  it.each(['client\r\nInjected: true', 'client\u0000', 'client\u0100'])('rejects invalid HTTP header values: %p', async (userAgent) => {
    const preferences = getPreferences();
    const previous = mockStoreData.preferences;
    await expect(savePreferences({
      ...preferences,
      request: { ...preferences.request, userAgent }
    })).rejects.toThrow('User-Agent contains invalid HTTP header characters');
    expect(mockStoreData.preferences).toBe(previous);
  });
});
