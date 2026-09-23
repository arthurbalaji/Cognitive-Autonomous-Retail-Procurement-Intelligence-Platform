package com.pos.application.repository;

import com.pos.application.entity.InventoryTransaction;
import com.pos.application.entity.InventoryTransactionType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface InventoryTransactionRepository
                extends JpaRepository<InventoryTransaction, Long> {

        List<InventoryTransaction> findByProductIdOrderByCreatedAtDesc(Long productId);

        List<InventoryTransaction> findByTypeOrderByCreatedAtDesc(
                        InventoryTransactionType type);
}