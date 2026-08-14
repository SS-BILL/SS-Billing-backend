import { WebhookTargetValidator } from './webhook-target.validator';

/**
 * These assert the SSRF boundary. If any "blocked" case starts passing, a
 * merchant can point the billing service at internal infrastructure.
 */
describe('WebhookTargetValidator', () => {
  const validator = new WebhookTargetValidator(false);

  describe('address filtering', () => {
    it.each([
      ['cloud metadata', '169.254.169.254'],
      ['loopback', '127.0.0.1'],
      ['private 10/8', '10.0.0.5'],
      ['private 192.168/16', '192.168.1.1'],
      ['private 172.16/12', '172.16.0.1'],
      ['unspecified', '0.0.0.0'],
      ['carrier-grade NAT', '100.64.0.1'],
      ['IPv6 loopback', '::1'],
      ['IPv6 unique local', 'fd00::1'],
      ['IPv6 link local', 'fe80::1'],
      ['IPv4-mapped loopback', '::ffff:127.0.0.1'],
    ])('blocks %s', (_label, address) => {
      expect(validator.isPublicAddress(address).ok).toBe(false);
    });

    it.each([['1.1.1.1'], ['8.8.8.8'], ['93.184.216.34'], ['2606:4700:4700::1111']])(
      'allows public address %s',
      (address) => {
        expect(validator.isPublicAddress(address).ok).toBe(true);
      },
    );

    it('rejects an unparseable address', () => {
      expect(validator.isPublicAddress('not-an-ip').ok).toBe(false);
    });
  });

  describe('URL validation', () => {
    it('accepts an https URL', () => {
      expect(validator.validateUrl('https://hooks.example.com/ss-billing').ok).toBe(true);
    });

    it('rejects plaintext http when private targets are disallowed', () => {
      expect(validator.validateUrl('http://hooks.example.com/x').ok).toBe(false);
    });

    it.each([['ftp://example.com/x'], ['file:///etc/passwd'], ['gopher://example.com']])(
      'rejects non-http scheme %s',
      (url) => {
        expect(validator.validateUrl(url).ok).toBe(false);
      },
    );

    it('rejects URLs carrying credentials', () => {
      // These would otherwise be written into the delivery record.
      expect(validator.validateUrl('https://user:pass@example.com/hook').ok).toBe(false);
    });

    it('rejects a malformed URL', () => {
      expect(validator.validateUrl('not a url').ok).toBe(false);
    });
  });

  describe('development mode', () => {
    const permissive = new WebhookTargetValidator(true);

    it('allows http when private targets are explicitly enabled', () => {
      expect(permissive.validateUrl('http://localhost:4000/hook').ok).toBe(true);
    });

    it('skips resolution entirely', async () => {
      await expect(permissive.resolveAndCheck('http://localhost:4000/hook')).resolves.toEqual({
        ok: true,
      });
    });
  });
});
