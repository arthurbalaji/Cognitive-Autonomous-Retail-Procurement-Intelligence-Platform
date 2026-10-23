package com.carpip.procurement;

import com.carpip.audit.AuditService;
import com.carpip.common.Money;
import com.carpip.config.AppProps;
import com.carpip.domain.Product;
import com.carpip.domain.PurchaseOrder;
import com.carpip.domain.Repos;
import com.carpip.domain.Tenant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Persists the cognitive engine's decision (negotiations, transcripts, PO terms) and routes the PO onward. */
@Service
public class ProcurementResultService {
    private static final Logger log = LoggerFactory.getLogger(ProcurementResultService.class);
    private final Repos.PurchaseOrderRepo pos;
    private final Repos.ProductRepo products;
    private final Repos.TenantRepo tenants;
    private final PurchaseOrderService poService;
    private final JdbcTemplate jdbc;
    private final AuditService audit;
    private final AppProps props;

    public ProcurementResultService(Repos.PurchaseOrderRepo pos, Repos.ProductRepo products, Repos.TenantRepo tenants,
                                    PurchaseOrderService poService, JdbcTemplate jdbc, AuditService audit, AppProps props) {
        this.pos = pos;
        this.products = products;
        this.tenants = tenants;
        this.poService = poService;
        this.jdbc = jdbc;
        this.audit = audit;
        this.props = props;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> m(Object o) {
        return o instanceof Map<?, ?> ? (Map<String, Object>) o : Map.of();
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> l(Object o) {
        return o instanceof List<?> ? (List<Map<String, Object>>) o : List.of();
    }

    private static String s(Object o) {
        return o == null ? null : o.toString();
    }

    private static Integer i(Object o) {
        return o == null ? null : ((Number) o).intValue();
    }

    private static UUID uuidOr(Object o) {
        try {
            return UUID.fromString(String.valueOf(o));
        } catch (Exception e) {
            return UUID.randomUUID();
        }
    }

    @Transactional
    public void apply(UUID poId, UUID runId, Map<String, Object> resp) {
        PurchaseOrder po = pos.findById(poId).orElseThrow();
        if (!"NEGOTIATING".equals(po.status)) {
            log.info("PO {} no longer NEGOTIATING ({}), dropping late decision", po.poNumber, po.status);
            return;
        }
        Tenant retailer = tenants.findById(po.retailerTenantId).orElseThrow();
        Map<String, Object> decision = m(resp.get("decision"));
        String outcome = s(decision.get("outcome"));
        List<Map<String, Object>> ranked = l(decision.get("rankedSuppliers"));
        String selectedId = s(decision.get("selectedSupplierTenantId"));
        String mode = s(resp.get("mode"));
        String model = s(m(resp.get("llm")).get("model"));

        for (Map<String, Object> n : l(resp.get("negotiations"))) {
            persistNegotiation(po, runId, n, ranked, selectedId, mode, model);
        }

        Map<String, Object> stored = new HashMap<>(decision);
        stored.put("mpi", resp.get("mpi"));
        stored.put("explanation", resp.get("explanation"));
        stored.put("mode", mode);
        stored.put("llm", resp.get("llm"));
        po.decision = stored;

        Map<String, Object> timeline = m(decision.get("timeline"));
        if (timeline.get("orderByDate") != null) {
            po.orderByDate = LocalDate.parse(s(timeline.get("orderByDate")));
        }
        if (timeline.get("expectedDeliveryDate") != null) {
            po.expectedDeliveryDate = LocalDate.parse(s(timeline.get("expectedDeliveryDate")));
        }

        if ("ACCEPTED".equals(outcome) && selectedId != null) {
            Map<String, Object> sel = ranked.stream().filter(r -> selectedId.equals(s(r.get("supplierTenantId")))).findFirst().orElse(Map.of());
            BigDecimal price = Money.bd(sel.get("agreedUnitPrice"));
            int qty = i(sel.get("quantity")) == null ? po.quantity : i(sel.get("quantity"));
            BigDecimal base = jdbc.queryForObject("SELECT base_price FROM negotiation WHERE po_id=? AND wholesaler_tenant_id=? ORDER BY created_at DESC LIMIT 1",
                    BigDecimal.class, po.id, UUID.fromString(selectedId));
            po.wholesalerTenantId = UUID.fromString(selectedId);
            po.unitPriceAgreed = price;
            po.basePrice = base;
            po.quantity = qty;
            po.totalAmount = Money.round2(price.multiply(BigDecimal.valueOf(qty)));
            po.discountSavings = base == null ? BigDecimal.ZERO : Money.round2(base.subtract(price).multiply(BigDecimal.valueOf(qty)));
            po.negotiationStatus = "OFF".equals(mode) ? "SKIPPED" : "ACCEPTED";
            po.quoteExpiresAt = Instant.now().plus(props.quoteTtlH(), ChronoUnit.HOURS);
            String autonomy = retailer.setting("autonomy_mode", "AUTO");
            BigDecimal limit = new BigDecimal(retailer.setting("auto_approve_limit_inr", "250000"));
            boolean needsApproval = "MANUAL".equals(po.origin) || po.degraded || "ALWAYS_APPROVE".equals(autonomy)
                    || ("APPROVAL_ABOVE_LIMIT".equals(autonomy) && po.totalAmount.compareTo(limit) > 0);
            finishRun(runId, "DONE", decision, null);
            poService.transition(po, needsApproval ? "PENDING_APPROVAL" : "APPROVED",
                    "negotiation " + outcome + " at " + price + " x " + qty, "system");
            audit.log(po.retailerTenantId, "AGENT", "pipf", "NEGOTIATION_ACCEPTED", "purchase_order", po.id.toString(),
                    Map.of("poNumber", po.poNumber, "price", price.toPlainString(), "mode", String.valueOf(mode)));
            return;
        }
        // REJECTED / NO_SUPPLIERS / NO_FEASIBLE_SUPPLIER
        po.negotiationStatus = "REJECTED";
        po.cancelReason = outcome;
        finishRun(runId, "DONE", decision, null);
        poService.transition(po, "NEGOTIATION_REJECTED", String.valueOf(outcome), "system");
        Product p = products.findById(po.productId).orElseThrow();
        p.reorderBlockedUntil = Instant.now().plus(props.rejectCooldownMin(), ChronoUnit.MINUTES);
        products.save(p);
        audit.log(po.retailerTenantId, "AGENT", "pipf", "NEGOTIATION_" + outcome, "purchase_order", po.id.toString(),
                Map.of("poNumber", po.poNumber, "cooldownMin", props.rejectCooldownMin()));
    }

    /** No candidate suppliers at all: decided locally without calling the engine. */
    @Transactional
    public void noSuppliers(UUID poId, UUID runId) {
        PurchaseOrder po = pos.findById(poId).orElseThrow();
        if (!"NEGOTIATING".equals(po.status)) {
            return;
        }
        po.negotiationStatus = "REJECTED";
        po.cancelReason = "NO_SUPPLIERS";
        po.decision = new HashMap<>(Map.of("outcome", "NO_SUPPLIERS"));
        finishRun(runId, "DONE", Map.of("outcome", "NO_SUPPLIERS"), null);
        poService.transition(po, "NEGOTIATION_REJECTED", "NO_SUPPLIERS: no trade-related supplier lists this item", "system");
        Product p = products.findById(po.productId).orElseThrow();
        p.reorderBlockedUntil = Instant.now().plus(props.rejectCooldownMin(), ChronoUnit.MINUTES);
        products.save(p);
        audit.log(po.retailerTenantId, "AGENT", "pipf", "NEGOTIATION_NO_SUPPLIERS", "purchase_order", po.id.toString(), Map.of("poNumber", po.poNumber));
    }

    @Transactional
    public void markError(UUID poId, UUID runId, String error) {
        PurchaseOrder po = pos.findById(poId).orElseThrow();
        if (!"NEGOTIATING".equals(po.status)) {
            return;
        }
        Map<String, Object> d = new HashMap<>(po.decision == null ? Map.of() : po.decision);
        int attempts = d.get("attempts") instanceof Number n ? n.intValue() + 1 : 1;
        d.put("attempts", attempts);
        d.put("lastError", error);
        po.decision = d;
        finishRun(runId, "ERROR", null, error);
        poService.transition(po, "NEGOTIATION_ERROR", "engine call failed (attempt " + attempts + "): " + error, "system");
    }

    @Transactional
    public void finishRun(UUID runId, String status, Map<String, Object> decision, String error) {
        if (runId == null) {
            return;
        }
        jdbc.update("UPDATE procurement_run SET status=?, decision=?::jsonb, error=?, finished_at=now() WHERE id=?",
                status, decision == null ? null : com.carpip.common.Json.write(decision), error, runId);
    }

    private void persistNegotiation(PurchaseOrder po, UUID runId, Map<String, Object> n, List<Map<String, Object>> ranked,
                                    String selectedId, String mode, String model) {
        UUID nid = uuidOr(n.get("negotiationId"));
        String supplierId = s(n.get("supplierTenantId"));
        Map<String, Object> b = m(n.get("bounds"));
        Map<String, Object> usage = m(n.get("usage"));
        Map<String, Object> rank = ranked.stream().filter(r -> supplierId.equals(s(r.get("supplierTenantId")))).findFirst().orElse(Map.of());
        jdbc.update("INSERT INTO negotiation(id, po_id, run_id, retailer_tenant_id, wholesaler_tenant_id, mode, model_id, status, base_price, floor_price, ceiling_price, " +
                        "retailer_target, retailer_max, mpi_used, final_price, quantity, rank, selected, score, tokens_in, tokens_out, latency_ms, guardrail_interventions) " +
                        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                nid, po.id, runId, po.retailerTenantId, UUID.fromString(supplierId), mode, model, s(n.get("status")),
                Money.bd(b.get("base")), Money.bd(b.get("floor")), Money.bd(b.get("ceiling")), Money.bd(b.get("retailerTarget")),
                Money.bd(b.get("retailerMax")), Money.bd(b.get("mpiUsed")), Money.bd(n.get("finalPrice")), i(n.get("quantity")),
                i(rank.get("rank")), supplierId.equals(selectedId), Money.bd(rank.get("score")),
                i(usage.get("inputTokens")), i(usage.get("outputTokens")), i(usage.get("latencyMs")), i(n.get("guardrailInterventions")));
        for (Map<String, Object> t : l(n.get("turns"))) {
            jdbc.update("INSERT INTO negotiation_log(negotiation_id, turn_no, actor, action, price, deterministic_price, llm_proposed_price, clamped, source, message) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    nid, i(t.get("turn")), s(t.get("actor")), s(t.get("action")), Money.bd(t.get("price")), Money.bd(t.get("deterministicPrice")),
                    Money.bd(t.get("llmProposedPrice")), Boolean.TRUE.equals(t.get("clamped")), s(t.get("source")), s(t.get("message")));
        }
    }

    @SuppressWarnings("unused")
    private static Timestamp ts(Instant i) {
        return Timestamp.from(i);
    }
}
