const { createHash, timingSafeEqual } = require('node:crypto');

const validKey = value => typeof value === 'string' && /^[\x21-\x7e]{32,512}$/.test(value);

module.exports = function requireGatewayKey(req, res, next) {
  const expected = process.env.GATEWAY_API_KEY;
  if (!validKey(expected)) {
    return res.status(503).json({ error: 'Gateway access is not configured.' });
  }

  const header = req.get('Authorization') || '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!validKey(presented)) {
    return res.status(401).json({ error: 'Gateway authorization required.' });
  }

  const expectedHash = createHash('sha256').update(expected).digest();
  const presentedHash = createHash('sha256').update(presented).digest();
  if (!timingSafeEqual(expectedHash, presentedHash)) {
    return res.status(401).json({ error: 'Gateway authorization required.' });
  }
  next();
};
