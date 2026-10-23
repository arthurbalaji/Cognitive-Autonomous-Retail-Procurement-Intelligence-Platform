package com.carpip.erp;

import com.carpip.common.ApiException;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Component
public class AdapterRegistry {
    private final Map<String, ErpAdapter> byType = new HashMap<>();

    public AdapterRegistry(List<ErpAdapter> adapters) {
        adapters.forEach(a -> byType.put(a.type(), a));
    }

    public ErpAdapter get(String type) {
        ErpAdapter a = byType.get(type);
        if (a == null) {
            throw ApiException.bad("UNKNOWN_CONNECTOR", "no adapter for connector type " + type);
        }
        return a;
    }
}
