package com.carpip.erp;

import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.Map;

/** Public gateway endpoint (paper §3.3): authenticity comes from the signature, not from a session. */
@RestController
public class WebhookController {
    private final WebhookService service;

    public WebhookController(WebhookService service) {
        this.service = service;
    }

    @PostMapping(value = "/api/erp/webhook/{tenantPublicId}")
    public ResponseEntity<Map<String, Object>> receive(@PathVariable String tenantPublicId, @RequestBody(required = false) byte[] body,
                                                       @RequestHeader HttpHeaders headers) {
        Map<String, String> h = new HashMap<>();
        headers.forEach((k, v) -> h.put(k.toLowerCase(), v.isEmpty() ? "" : v.get(0)));
        WebhookService.Outcome o = service.handle(tenantPublicId, h, body == null ? new byte[0] : body);
        return ResponseEntity.status(o.status()).body(o.body());
    }
}
