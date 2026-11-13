const { preferencesUtil } = require('../store/preferences');

const applyGlobalUserAgent = (request) => {
  const userAgent = preferencesUtil.getUserAgent();
  const hasUserAgent = Object.keys(request.headers).some((name) => name.toLowerCase() === 'user-agent');
  if (userAgent && !hasUserAgent) {
    request.headers['User-Agent'] = userAgent;
  }
};

module.exports = { applyGlobalUserAgent };
