package com.carpip.sse;

import com.carpip.auth.Principal;
import com.carpip.common.Json;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** Live event fan-out to browsers. Strictly tenant-filtered; ADMIN sees everything. */
@Component
public class SseHub {
    private static final Logger log = LoggerFactory.getLogger(SseHub.class);
    private final Map<SseEmitter, Principal> clients = new ConcurrentHashMap<>();

    public SseEmitter register(Principal p) {
        SseEmitter em = new SseEmitter(30L * 60 * 1000);
        clients.put(em, p);
        em.onCompletion(() -> clients.remove(em));
        em.onTimeout(() -> clients.remove(em));
        em.onError(e -> clients.remove(em));
        try {
            em.send(SseEmitter.event().name("hello").data("{\"status\":\"connected\"}"));
        } catch (IOException e) {
            clients.remove(em);
        }
        return em;
    }

    public void broadcast(Map<String, Object> message, UUID... tenants) {
        String json = Json.write(message);
        clients.forEach((em, p) -> {
            boolean match = p.isAdmin();
            for (UUID t : tenants) {
                if (t != null && t.equals(p.tenantId())) {
                    match = true;
                }
            }
            if (!match) {
                return;
            }
            try {
                em.send(SseEmitter.event().name("event").data(json));
            } catch (Exception e) {
                clients.remove(em);
            }
        });
    }

    @Scheduled(fixedDelay = 20_000)
    public void heartbeat() {
        clients.forEach((em, p) -> {
            try {
                em.send(SseEmitter.event().comment("ping"));
            } catch (Exception e) {
                clients.remove(em);
            }
        });
    }

    public int clientCount() {
        return clients.size();
    }

    @SuppressWarnings("unused")
    private void unused() {
        log.trace("noop");
    }
}
