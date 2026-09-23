package com.pos.application.service;

import com.pos.application.entity.Product;
import com.pos.application.repository.ProductRepository;
import com.pos.application.repository.SaleRepository;
import com.pos.application.repository.CustomerRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
public class DashboardService {

        private final SaleRepository saleRepository;
        private final ProductRepository productRepository;
        private final CustomerRepository customerRepository;

        @Transactional(readOnly = true)
        public DashboardSummary getTodaySummary() {

                LocalDateTime start = LocalDate.now().atStartOfDay();
                LocalDateTime end = start.plusDays(1);
                long totalProducts = productRepository.count();
                long totalCustomers = customerRepository.count();

                BigDecimal revenue = saleRepository.getTotalRevenueBetween(
                                start,
                                end);

                long completedSales = saleRepository.countCompletedSalesBetween(
                                start,
                                end);

                long cancelledSales = saleRepository.countCancelledSalesBetween(
                                start,
                                end);

                List<Product> lowStockProducts = productRepository.findLowStockProducts();

                return new DashboardSummary(
                                revenue,
                                completedSales,
                                cancelledSales,
                                lowStockProducts,
                                totalProducts,
                                totalCustomers);
        }

        public record DashboardSummary(
                        BigDecimal revenue,
                        long completedSales,
                        long cancelledSales,
                        List<Product> lowStockProducts,
                        long totalProducts,
                        long totalCustomers) {
        }
}