package com.carpip.inventory;

import com.carpip.procurement.ProcurementService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

/** Facade: apply stock change with optimistic-lock retries (3x, jittered), then evaluate the reorder threshold. */
@Service
public class InventoryService {
    private static final Logger log = LoggerFactory.getLogger(InventoryService.class);
    private final InventoryApplier applier;
    private final ProcurementService procurement;

    public InventoryService(InventoryApplier applier, ProcurementService procurement) {
        this.applier = applier;
        this.procurement = procurement;
    }

    public InventoryApplier.Result apply(UUID tenantId, UUID productId, String mode, int qty, Instant sourceVersion,
                                         String reason, String reference, String dedupeGroup, String eventId) {
        OptimisticLockingFailureException last = null;
        for (int attempt = 0; attempt < 4; attempt++) {
            try {
                InventoryApplier.Result r = applier.apply(tenantId, productId, mode, qty, sourceVersion, reason, reference, dedupeGroup, eventId);
                if (r.outcome() == InventoryApplier.Outcome.APPLIED) {
                    try {
                        procurement.evaluate(productId, "THRESHOLD");
                    } catch (Exception e) {
                        log.warn("threshold evaluation failed for {}: {}", productId, e.getMessage());
                    }
                }
                return r;
            } catch (OptimisticLockingFailureException e) {
                last = e;
                try {
                    Thread.sleep(20L + ThreadLocalRandom.current().nextInt(60));
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
        throw last == null ? new IllegalStateException("inventory apply failed") : last;
    }
}
