package com.carpip.procurement;

import com.carpip.common.Json;
import com.carpip.config.AppProps;
import org.slf4j.MDC;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;

/** HTTP client to the Flask cognitive engine. Auth: X-Internal-Token. */
@Component
public class IntelligenceClient {
    private final RestClient rest;
    private final String token;

    public IntelligenceClient(AppProps props) {
        JdkClientHttpRequestFactory f = new JdkClientHttpRequestFactory();
        f.setReadTimeout(Duration.ofSeconds(75));
        this.rest = RestClient.builder().baseUrl(props.intelligenceUrl()).requestFactory(f).build();
        this.token = props.internalToken();
    }

    private String corr() {
        String c = MDC.get("correlationId");
        return c == null ? UUID.randomUUID().toString() : c;
    }

    public Map<String, Object> post(String path, Object body) {
        String res = rest.post().uri(path).contentType(MediaType.APPLICATION_JSON)
                .header("X-Internal-Token", token).header("X-Correlation-Id", corr())
                .body(Json.write(body)).retrieve().body(String.class);
        return res == null ? Map.of() : Json.map(res);
    }

    public Map<String, Object> get(String path) {
        String res = rest.get().uri(path).header("X-Internal-Token", token).header("X-Correlation-Id", corr())
                .retrieve().body(String.class);
        return res == null ? Map.of() : Json.map(res);
    }

    public Map<String, Object> put(String path, Object body) {
        String res = rest.put().uri(path).contentType(MediaType.APPLICATION_JSON)
                .header("X-Internal-Token", token).body(Json.write(body)).retrieve().body(String.class);
        return res == null ? Map.of() : Json.map(res);
    }

    public Map<String, Object> negotiate(Map<String, Object> req) {
        return post("/api/negotiate", req);
    }
}
