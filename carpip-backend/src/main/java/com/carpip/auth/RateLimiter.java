package com.carpip.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;

/** Fixed-window per-minute counter in Redis. Fails OPEN when Redis is unavailable. */
@Component
public class RateLimiter {
    private static final Logger log = LoggerFactory.getLogger(RateLimiter.class);
    private final StringRedisTemplate redis;

    public RateLimiter(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public boolean allow(String scope, int limitPerMinute) {
        try {
            String k = "rl:" + scope + ":" + (Instant.now().getEpochSecond() / 60);
            Long n = redis.opsForValue().increment(k);
            if (n != null && n == 1L) {
                redis.expire(k, Duration.ofSeconds(120));
            }
            return n == null || n <= limitPerMinute;
        } catch (Exception e) {
            log.debug("rate limiter unavailable, failing open: {}", e.getMessage());
            return true;
        }
    }

    public void deny(String jti, Instant until) {
        try {
            Duration ttl = Duration.between(Instant.now(), until);
            if (!ttl.isNegative()) {
                redis.opsForValue().set("jwt:deny:" + jti, "1", ttl);
            }
        } catch (Exception e) {
            log.warn("could not store jwt denylist entry: {}", e.getMessage());
        }
    }

    public boolean denied(String jti) {
        try {
            return Boolean.TRUE.equals(redis.hasKey("jwt:deny:" + jti));
        } catch (Exception e) {
            return false;
        }
    }
}
