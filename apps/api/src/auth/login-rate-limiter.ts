import { createHash } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AUTH_CONFIG } from './auth.types';
import type { AuthConfig } from './auth.types';

interface Bucket {
  attempts: number;
  resetAt: number;
}

@Injectable()
export class LoginRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  consume(username: string, ip: string, now = Date.now()): number | undefined {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    const account = createHash('sha256').update(username).digest('hex');
    const keys = [
      { key: `account:${account}`, limit: this.config.loginMaxAttempts },
      // Reverse-proxied requests share the proxy socket address. Ignore X-Forwarded-For;
      // the account bucket remains independent of client-controlled proxy headers.
      { key: `ip:${ip}`, limit: this.config.loginMaxAttempts * 10 },
    ];
    if (this.buckets.size + keys.filter(({ key }) => !this.buckets.has(key)).length > 2000) {
      return this.config.loginWindowSeconds;
    }
    for (const { key, limit } of keys) {
      const bucket = this.buckets.get(key);
      if (bucket && bucket.attempts >= limit) {
        return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      }
      if (!bucket && this.buckets.size >= 2000) return this.config.loginWindowSeconds;
    }
    for (const { key } of keys) {
      const bucket = this.buckets.get(key) ?? {
        attempts: 0,
        resetAt: now + this.config.loginWindowSeconds * 1000,
      };
      bucket.attempts += 1;
      this.buckets.set(key, bucket);
    }
    return undefined;
  }

  static rejection(): HttpException {
    return new HttpException(
      'Too many login attempts. Try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
