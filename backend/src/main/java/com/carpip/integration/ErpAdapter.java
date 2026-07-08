package com.carpip.integration;

import java.util.List;
import java.util.Map;

/**
 * Interface for ERP system adapters.
 * Each implementation handles connectivity to a specific ERP/POS system.
 */
public interface ErpAdapter {

    /**
     * Test connection to the ERP system.
     * @param credentials Map of credential key-value pairs
     * @return true if connection is successful
     */
    boolean connect(Map<String, String> credentials);

    /**
     * Sync inventory data from the ERP system.
     * @return List of inventory items as Maps
     */
    List<Map<String, Object>> syncInventory();

    /**
     * Fetch recent sales data from the ERP system.
     * @return List of sales records as Maps
     */
    List<Map<String, Object>> fetchSales();

    /**
     * Get the provider name for this adapter.
     */
    String getProviderName();
}
