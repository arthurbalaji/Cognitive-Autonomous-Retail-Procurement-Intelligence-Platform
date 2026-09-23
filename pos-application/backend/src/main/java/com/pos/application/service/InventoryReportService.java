package com.pos.application.service;

import com.pos.application.entity.Product;
import com.pos.application.repository.ProductRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
public class InventoryReportService {

        private final ProductRepository productRepository;

        @Transactional(readOnly = true)
        public InventorySummary getInventorySummary() {

                long totalProducts = productRepository.count();

                long totalStockUnits = productRepository.getTotalStockUnits();

                List<Product> lowStockProducts = productRepository.findLowStockProducts();

                long outOfStockProducts = productRepository.countOutOfStockProducts();

                return new InventorySummary(
                                totalProducts,
                                totalStockUnits,
                                lowStockProducts,
                                outOfStockProducts);
        }

        public record InventorySummary(
                        long totalProducts,
                        long totalStockUnits,
                        List<Product> lowStockProducts,
                        long outOfStockProducts) {
        }
}