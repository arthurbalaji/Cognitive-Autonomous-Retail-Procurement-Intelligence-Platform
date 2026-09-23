package com.pos.application.repository;

import com.pos.application.entity.PurchaseItem;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface PurchaseItemRepository
        extends JpaRepository<PurchaseItem, Long> {

    List<PurchaseItem> findByProductId(Long productId);

    List<PurchaseItem> findByPurchaseId(Long purchaseId);
}