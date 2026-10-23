package com.carpip.common;

import com.carpip.config.AppProps;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;

/** AES-GCM for connector secrets at rest. Format: base64(iv || ciphertext+tag). */
@Component
public class Crypto {
    private final SecretKeySpec key;
    private final SecureRandom rnd = new SecureRandom();

    public Crypto(AppProps props) {
        byte[] k = Base64.getDecoder().decode(props.encKey());
        if (k.length != 32) {
            throw new IllegalStateException("CARPIP_ENC_KEY must be base64 of 32 bytes");
        }
        this.key = new SecretKeySpec(k, "AES");
    }

    public String encrypt(String plain) {
        if (plain == null) {
            return null;
        }
        try {
            byte[] iv = new byte[12];
            rnd.nextBytes(iv);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));
            byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            byte[] out = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, out, 0, iv.length);
            System.arraycopy(ct, 0, out, iv.length, ct.length);
            return Base64.getEncoder().encodeToString(out);
        } catch (Exception e) {
            throw new IllegalStateException("encrypt failed", e);
        }
    }

    public String decrypt(String enc) {
        if (enc == null) {
            return null;
        }
        try {
            byte[] all = Base64.getDecoder().decode(enc);
            byte[] iv = new byte[12];
            System.arraycopy(all, 0, iv, 0, 12);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
            return new String(c.doFinal(all, 12, all.length - 12), StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new IllegalStateException("decrypt failed", e);
        }
    }
}
