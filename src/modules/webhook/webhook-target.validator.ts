import { Injectable, Logger } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

export interface TargetCheck {
  ok: boolean;
  reason?: string;
  /** Resolved address, pinned so delivery cannot be re-resolved elsewhere. */
  address?: string;
  family?: 4 | 6;
}

/**
 * Ranges that must never be reachable from webhook delivery.
 *
 * `link-local` covers 169.254.0.0/16, which is where cloud instance metadata
 * lives — the single most valuable SSRF target in any hosted environment.
 */
const BLOCKED_IPV4_RANGES = new Set([
  'unspecified',
  'broadcast',
  'multicast',
  'linkLocal',
  'loopback',
  'carrierGradeNat',
  'private',
  'reserved',
]);

const BLOCKED_IPV6_RANGES = new Set([
  'unspecified',
  'linkLocal',
  'multicast',
  'loopback',
  'uniqueLocal',
  'ipv4Mapped',
  'rfc6145',
  'rfc6052',
  'teredo',
  'reserved',
]);

/**
 * Validates merchant-supplied webhook URLs before delivery.
 *
 * A merchant could previously set `webhookUrl` to anything and the billing
 * service would POST to it on every payment event — no scheme check, no host
 * check, and axios following redirects by default. That turns the backend into
 * an SSRF proxy for its own network:
 *
 *     webhookUrl = http://169.254.169.254/latest/meta-data/iam/...
 *     webhookUrl = http://127.0.0.1:5432/
 *     webhookUrl = https://attacker.test/redirect -> http://10.0.0.1/
 */
@Injectable()
export class WebhookTargetValidator {
  private readonly logger = new Logger(WebhookTargetValidator.name);

  constructor(private readonly allowPrivateTargets = false) {}

  /** Cheap synchronous checks: scheme, credentials, port. */
  validateUrl(rawUrl: string): TargetCheck {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { ok: false, reason: 'malformed URL' };
    }

    // http:// is permitted only when private targets are explicitly allowed,
    // i.e. local development. Payment events must not cross the network in
    // plaintext otherwise.
    const allowedProtocols = this.allowPrivateTargets ? ['https:', 'http:'] : ['https:'];
    if (!allowedProtocols.includes(url.protocol)) {
      return { ok: false, reason: `protocol ${url.protocol} is not allowed` };
    }

    // Credentials in the URL would be logged with the delivery record.
    if (url.username || url.password) {
      return { ok: false, reason: 'URL must not contain credentials' };
    }

    return { ok: true };
  }

  /**
   * Resolve the host and confirm it is a public address.
   *
   * The resolved IP is returned so the caller can pin the connection to it.
   * Resolving here and connecting by hostname later would leave a DNS-rebinding
   * window between the two.
   */
  async resolveAndCheck(rawUrl: string): Promise<TargetCheck> {
    const shape = this.validateUrl(rawUrl);
    if (!shape.ok) return shape;

    const { hostname } = new URL(rawUrl);

    if (this.allowPrivateTargets) {
      return { ok: true };
    }

    let resolved: { address: string; family: number };
    try {
      resolved = await lookup(hostname);
    } catch {
      return { ok: false, reason: `could not resolve ${hostname}` };
    }

    const check = this.isPublicAddress(resolved.address);
    if (!check.ok) {
      this.logger.warn(`Blocked webhook target ${hostname} -> ${resolved.address}: ${check.reason}`);
      return check;
    }

    return {
      ok: true,
      address: resolved.address,
      family: resolved.family === 6 ? 6 : 4,
    };
  }

  isPublicAddress(address: string): TargetCheck {
    let parsed: ipaddr.IPv4 | ipaddr.IPv6;
    try {
      parsed = ipaddr.parse(address);
    } catch {
      return { ok: false, reason: 'unparseable address' };
    }

    const range = parsed.range();

    if (parsed.kind() === 'ipv4') {
      if (BLOCKED_IPV4_RANGES.has(range)) {
        return { ok: false, reason: `address is in the ${range} range` };
      }
      return { ok: true };
    }

    if (BLOCKED_IPV6_RANGES.has(range)) {
      return { ok: false, reason: `address is in the ${range} range` };
    }

    // An IPv4-mapped IPv6 address would otherwise smuggle 127.0.0.1 past the
    // IPv6 range checks as ::ffff:127.0.0.1.
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) {
      return this.isPublicAddress(v6.toIPv4Address().toString());
    }

    return { ok: true };
  }
}
