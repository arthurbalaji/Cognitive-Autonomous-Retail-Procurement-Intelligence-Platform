package com.carpip.erp;

import com.carpip.common.Json;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Map;

/** Thin blocking HTTP helper for outbound adapter calls. Never throws on 4xx/5xx; connection errors do propagate. */
public final class Http {
    private static final RestClient CLIENT;

    static {
        HttpClient hc = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).version(HttpClient.Version.HTTP_1_1).build();
        JdkClientHttpRequestFactory f = new JdkClientHttpRequestFactory(hc);
        f.setReadTimeout(Duration.ofSeconds(15));
        CLIENT = RestClient.builder().requestFactory(f).build();
    }

    private Http() {
    }

    public record Resp(int status, String body, HttpHeaders headers) {
        public boolean ok() {
            return status >= 200 && status < 300;
        }

        public JsonNode json() {
            return body == null || body.isBlank() ? Json.M.createObjectNode() : Json.read(body);
        }

        public String header(String n) {
            return headers == null ? null : headers.getFirst(n);
        }
    }

    public static Resp call(HttpMethod method, String url, Map<String, String> headers, String body) {
        RestClient.RequestBodySpec spec = CLIENT.method(method).uri(URI.create(url)).headers(h -> {
            if (headers != null) {
                headers.forEach(h::set);
            }
        });
        if (body != null) {
            spec.contentType(org.springframework.http.MediaType.APPLICATION_JSON).body(body);
        }
        ResponseEntity<String> r = spec.retrieve().onStatus(s -> true, (rq, rs) -> { }).toEntity(String.class);
        return new Resp(r.getStatusCode().value(), r.getBody(), r.getHeaders());
    }

    public static Resp get(String url, Map<String, String> headers) {
        return call(HttpMethod.GET, url, headers, null);
    }

    public static Resp post(String url, Map<String, String> headers, String body) {
        return call(HttpMethod.POST, url, headers, body);
    }
}
