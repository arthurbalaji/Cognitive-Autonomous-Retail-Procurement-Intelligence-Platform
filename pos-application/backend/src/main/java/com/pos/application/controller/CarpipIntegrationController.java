package com.pos.application.controller;

import com.pos.application.entity.Product;
import com.pos.application.entity.Sale;
import com.pos.application.entity.SaleItem;
import com.pos.application.repository.ProductRepository;
import com.pos.application.repository.SaleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;

/**
 * CARPIP Integration Controller for POS.
 * Exposes REST endpoints that CARPIP's RetailerPosAdapter calls
 * to sync inventory and sales data from this POS system.
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class CarpipIntegrationController {

    private final ProductRepository productRepository;
    private final SaleRepository saleRepository;

    /**
     * Health check — CARPIP calls this to verify connectivity.
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        return ResponseEntity.ok(Map.of(
                "status", "UP",
                "service", "pos-backend",
                "timestamp", LocalDateTime.now().toString()
        ));
    }

    /**
     * Inventory endpoint — returns products in the schema that
     * CARPIP's RetailerPosAdapter.syncInventory() expects:
     *   item_code, item_name, category, sell_price, quantity_on_hand, reorder_level
     */
    @GetMapping("/inventory")
    public ResponseEntity<List<Map<String, Object>>> getInventory(
            @RequestParam(value = "store_id", required = false) String storeId) {

        List<Product> products = productRepository.findAll();
        List<Map<String, Object>> result = new ArrayList<>();

        for (Product p : products) {
            if (!p.getActive()) continue;

            Map<String, Object> item = new LinkedHashMap<>();
            item.put("item_code", p.getSku());
            item.put("item_name", p.getName());
            item.put("category", p.getCategory() != null ? p.getCategory().getName() : "General");
            item.put("sell_price", p.getSellingPrice());
            item.put("quantity_on_hand", p.getStockQuantity());
            item.put("reorder_level", p.getReorderLevel());
            item.put("barcode", p.getBarcode());
            result.add(item);
        }

        return ResponseEntity.ok(result);
    }

    /**
     * Transactions endpoint — returns recent sales in the schema that
     * CARPIP's RetailerPosAdapter.fetchSales() expects:
     *   transaction_id, item_code, qty_sold, line_total, transaction_date
     */
    @GetMapping("/transactions")
    public ResponseEntity<List<Map<String, Object>>> getTransactions(
            @RequestParam(value = "store_id", required = false) String storeId,
            @RequestParam(value = "since", required = false, defaultValue = "24h") String since) {

        LocalDateTime cutoff = LocalDateTime.now().minusHours(24);
        if ("48h".equals(since)) cutoff = LocalDateTime.now().minusHours(48);
        if ("7d".equals(since)) cutoff = LocalDateTime.now().minusDays(7);

        List<Sale> sales = saleRepository.findByCreatedAtAfter(cutoff);
        List<Map<String, Object>> result = new ArrayList<>();

        for (Sale sale : sales) {
            for (SaleItem item : sale.getItems()) {
                Map<String, Object> txn = new LinkedHashMap<>();
                txn.put("transaction_id", sale.getInvoiceNumber());
                txn.put("item_code", item.getProduct() != null ? item.getProduct().getSku() : "UNKNOWN");
                txn.put("qty_sold", item.getQuantity());
                txn.put("line_total", item.getTotalAmount());
                txn.put("transaction_date", sale.getCreatedAt().toString());
                txn.put("payment_method", sale.getPaymentMethod() != null ? sale.getPaymentMethod().name() : "CASH");
                result.add(txn);
            }
        }

        return ResponseEntity.ok(result);
    }
}
