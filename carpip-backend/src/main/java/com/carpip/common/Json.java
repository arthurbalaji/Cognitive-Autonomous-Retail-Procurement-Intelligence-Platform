package com.carpip.common;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

import java.util.Map;

/** Shared ObjectMapper for places that run outside Spring MVC (outbox, adapters, Kafka). */
public final class Json {
    public static final ObjectMapper M = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);

    private Json() {
    }

    public static String write(Object o) {
        try {
            return M.writeValueAsString(o);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("json serialize failed: " + e.getMessage(), e);
        }
    }

    public static JsonNode read(String s) {
        try {
            return M.readTree(s);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("invalid json: " + e.getOriginalMessage(), e);
        }
    }

    public static JsonNode read(byte[] b) {
        try {
            return M.readTree(b);
        } catch (java.io.IOException e) {
            throw new IllegalArgumentException("invalid json: " + e.getMessage(), e);
        }
    }

    public static Map<String, Object> map(String s) {
        try {
            return M.readValue(s, new TypeReference<Map<String, Object>>() {
            });
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("invalid json: " + e.getOriginalMessage(), e);
        }
    }

    public static Map<String, Object> map(Object o) {
        return M.convertValue(o, new TypeReference<Map<String, Object>>() {
        });
    }
}
