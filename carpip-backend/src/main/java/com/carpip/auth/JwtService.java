package com.carpip.auth;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.interfaces.DecodedJWT;
import com.carpip.config.AppProps;
import com.carpip.domain.AppUser;
import com.carpip.domain.Tenant;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Set;
import java.util.UUID;

/** Stateless HS256 (HMAC256) tokens, 24h validity, claims: sub, tid, role, jti. */
@Service
public class JwtService {
    private final Algorithm alg;

    public JwtService(AppProps props) {
        if (props.jwtSecret() == null || props.jwtSecret().length() < 32) {
            throw new IllegalStateException("JWT_SECRET must be >= 32 chars");
        }
        this.alg = Algorithm.HMAC256(props.jwtSecret());
    }

    public String issue(AppUser u, Tenant t) {
        Instant now = Instant.now();
        return JWT.create()
                .withSubject(u.id.toString())
                .withClaim("tid", t.id.toString())
                .withClaim("role", t.type)
                .withJWTId(UUID.randomUUID().toString())
                .withIssuedAt(now)
                .withExpiresAt(now.plus(24, ChronoUnit.HOURS))
                .sign(alg);
    }

    public Instant expiry(String token) {
        return JWT.decode(token).getExpiresAtAsInstant();
    }

    public Principal verify(String token) {
        DecodedJWT j = JWT.require(alg).acceptLeeway(30).build().verify(token);
        return new Principal(UUID.fromString(j.getSubject()), UUID.fromString(j.getClaim("tid").asString()),
                j.getClaim("role").asString(), "USER", Set.of(), j.getId());
    }
}
