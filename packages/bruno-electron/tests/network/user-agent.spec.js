jest.mock('../../src/store/preferences', () => ({
  preferencesUtil: { getUserAgent: jest.fn() }
}));

const { preferencesUtil } = require('../../src/store/preferences');
const { applyGlobalUserAgent } = require('../../src/utils/user-agent');

describe('global User-Agent for WebSocket and gRPC requests', () => {
  beforeEach(() => {
    preferencesUtil.getUserAgent.mockReturnValue('custom-client/1.0');
  });

  it('adds the configured default to outgoing headers', () => {
    const request = { headers: { Authorization: 'Bearer value' } };
    applyGlobalUserAgent(request);
    expect(request.headers).toEqual({ 'Authorization': 'Bearer value', 'User-Agent': 'custom-client/1.0' });
  });

  it.each(['User-Agent', 'user-agent', 'uSeR-aGeNt'])('preserves explicit %s headers', (name) => {
    const request = { headers: { [name]: 'explicit-client/1.0' } };
    applyGlobalUserAgent(request);
    expect(request.headers).toEqual({ [name]: 'explicit-client/1.0' });
  });

  it('leaves native protocol defaults unchanged when no global override is set', () => {
    preferencesUtil.getUserAgent.mockReturnValue('');
    const request = { headers: {} };
    applyGlobalUserAgent(request);
    expect(request.headers).toEqual({});
  });
});
