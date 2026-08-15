import { createHmac } from 'node:crypto';
import { WebhookService } from './webhook.service';

/**
 * These lock in the inbound webhook signature contract.
 *
 * The signature previously covered the request body alone, with no timestamp
 * and no expiry, so any captured delivery could be replayed against the
 * merchant forever. The header is now `t=<unixSeconds>,v1=<hex hmac>` over
 * `"<timestamp>.<body>"`, and anything outside the tolerance window is
 * rejected. Every case below is a way that guarantee can silently break.
 */
describe('WebhookService.verifySignature', () => {
  const secret = 'whsec_' + 'f'.repeat(32);
  const body = JSON.stringify({ id: 'del_1', event: 'payment.succeeded', data: { amount: 500 } });

  const nowSeconds = () => Math.floor(Date.now() / 1000);

  const sign = (withSecret: string, timestamp: number, payload: string): string =>
    createHmac('sha256', withSecret).update(`${timestamp}.${payload}`).digest('hex');

  const header = (timestamp: number, v1: string): string => `t=${timestamp},v1=${v1}`;

  it('accepts a signature produced with the shared secret', () => {
    const t = nowSeconds();
    expect(WebhookService.verifySignature(secret, header(t, sign(secret, t, body)), body)).toBe(
      true,
    );
  });

  it('rejects a signature produced with a different secret', () => {
    const t = nowSeconds();
    const forged = header(t, sign('whsec_wrong', t, body));
    expect(WebhookService.verifySignature(secret, forged, body)).toBe(false);
  });

  it('rejects a body that was tampered with after signing', () => {
    // The signed payload said 500; the delivered body says 500000.
    const t = nowSeconds();
    const authentic = header(t, sign(secret, t, body));
    const tampered = body.replace('500', '500000');

    expect(WebhookService.verifySignature(secret, authentic, tampered)).toBe(false);
  });

  it('rejects a timestamp that has been altered, even with an otherwise valid hmac', () => {
    // The timestamp is inside the signed string, so moving it invalidates v1.
    const t = nowSeconds();
    const v1 = sign(secret, t, body);
    expect(WebhookService.verifySignature(secret, header(t - 10, v1), body)).toBe(false);
  });

  describe('replay protection', () => {
    it.each([
      ['older than the tolerance window', -400],
      ['far in the past', -86_400],
      ['further ahead than the tolerance window', 400],
    ])('rejects a delivery %s', (_label, offsetSeconds) => {
      // A correctly signed but stale capture must not be replayable. This is
      // the regression: without the window check, this returns true forever.
      const t = nowSeconds() + offsetSeconds;
      expect(WebhookService.verifySignature(secret, header(t, sign(secret, t, body)), body)).toBe(
        false,
      );
    });

    it('accepts a delivery inside the default 5-minute tolerance', () => {
      const t = nowSeconds() - 299;
      expect(WebhookService.verifySignature(secret, header(t, sign(secret, t, body)), body)).toBe(
        true,
      );
    });

    it('honours an explicitly widened tolerance', () => {
      const t = nowSeconds() - 400;
      const valid = header(t, sign(secret, t, body));
      expect(WebhookService.verifySignature(secret, valid, body, 600)).toBe(true);
    });
  });

  describe('malformed input', () => {
    it.each([
      ['an empty header', ''],
      ['a header with no key/value pairs', 'garbage'],
      ['a header missing the timestamp', `v1=${'a'.repeat(64)}`],
      ['a non-numeric timestamp', `t=not-a-number,v1=${'a'.repeat(64)}`],
      ['an empty timestamp', `t=,v1=${'a'.repeat(64)}`],
      ['a header missing v1', `t=${Math.floor(Date.now() / 1000)}`],
    ])('rejects %s without throwing', (_label, raw) => {
      expect(() => WebhookService.verifySignature(secret, raw, body)).not.toThrow();
      expect(WebhookService.verifySignature(secret, raw, body)).toBe(false);
    });

    it.each([
      ['too short', 'ab'],
      ['too long', 'a'.repeat(130)],
      ['empty', ''],
      ['not hex at all', 'zzzz'],
    ])('rejects a v1 digest that is %s without throwing', (_label, v1) => {
      // timingSafeEqual throws on length mismatch, so the length guard must
      // run first — otherwise a malformed header becomes a 500, and an
      // attacker gets a free liveness oracle.
      const raw = header(nowSeconds(), v1);
      expect(() => WebhookService.verifySignature(secret, raw, body)).not.toThrow();
      expect(WebhookService.verifySignature(secret, raw, body)).toBe(false);
    });
  });

  it('rejects an empty body signed against a non-empty one', () => {
    const t = nowSeconds();
    expect(WebhookService.verifySignature(secret, header(t, sign(secret, t, body)), '')).toBe(
      false,
    );
  });
});
