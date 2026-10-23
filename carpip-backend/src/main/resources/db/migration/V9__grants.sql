GRANT USAGE ON SCHEMA public TO carpip_intel;
GRANT SELECT ON tenant, product, sales_daily, supplier_offer, supplier_price_history, trade_relationship,
                competitor_price, system_setting, api_key, v_inventory_position TO carpip_intel;
GRANT SELECT, INSERT, UPDATE, DELETE ON intel_mpi_snapshot, intel_forecast, intel_model_registry,
                intel_cdin_round, intel_cdin_update, intel_rdi TO carpip_intel;
GRANT UPDATE (last_used_at) ON api_key TO carpip_intel;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO carpip_intel;
GRANT SELECT ON v_mpi_latest TO carpip_intel;
