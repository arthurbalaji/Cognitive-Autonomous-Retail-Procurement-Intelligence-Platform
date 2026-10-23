package com.carpip.common;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HexFormat;

/**
 * Signature schemes (see docs/webhook-signing.md):
 *  - Shopify:  base64(HMAC_SHA256(secret, rawBody))                      header X-Shopify-Hmac-Sha256
 *  - CARPIP:   v1=hex(HMAC_SHA256(secret, ts + "." + eventId + "." + rawBody))   header X-Carpip-Signature
 * Always computed over the RAW request bytes, compared in constant time.
 */
public final class Hmac {
    private Hmac() {
    }

    private static byte[] raw(String secret, byte[] data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return mac.doFinal(data);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    public static String shopify(String secret, byte[] body) {
        return Base64.getEncoder().encodeToString(raw(secret, body));
    }

    public static String carpipHex(String secret, String ts, String eventId, byte[] body) {
        byte[] prefix = (ts + "." + eventId + ".").getBytes(StandardCharsets.UTF_8);
        byte[] all = new byte[prefix.length + body.length];
        System.arraycopy(prefix, 0, all, 0, prefix.length);
        System.arraycopy(body, 0, all, prefix.length, body.length);
        return HexFormat.of().formatHex(raw(secret, all));
    }

    public static String carpipHeader(String secret, String ts, String eventId, byte[] body) {
        return "v1=" + carpipHex(secret, ts, eventId, body);
    }

    public static boolean constantEq(String a, String b) {
        if (a == null || b == null) {
            return false;
        }
        return MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    }

    /** Header may carry several comma-separated "v1=..." values (secret rotation). */
    public static boolean carpipMatches(String header, String secret, String ts, String eventId, byte[] body) {
        if (header == null || secret == null) {
            return false;
        }
        String expected = carpipHex(secret, ts, eventId, body);
        boolean ok = false;
        for (String part : header.split(",")) {
            String p = part.trim();
            if (p.startsWith("v1=") && constantEq(p.substring(3), expected)) {
                ok = true;
            }
        }
        return ok;
    }

    public static String sha256Hex(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
