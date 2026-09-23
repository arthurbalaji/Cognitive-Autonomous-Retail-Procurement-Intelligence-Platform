package com.pos.application.service;

import com.pos.application.repository.SaleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Service
@RequiredArgsConstructor
public class SalesReportService {

        private final SaleRepository saleRepository;

        @Transactional(readOnly = true)
        public SalesReport getSalesReport(
                        LocalDate startDate,
                        LocalDate endDate) {

                if (endDate.isBefore(startDate)) {
                        throw new IllegalArgumentException(
                                        "End date cannot be before start date");
                }

                LocalDateTime start = startDate.atStartOfDay();
                LocalDateTime end = endDate.plusDays(1).atStartOfDay();

                BigDecimal revenue = saleRepository.getTotalRevenueBetween(
                                start,
                                end);

                long completedSales = saleRepository.countCompletedSalesBetween(start, end);

                long cancelledSales = saleRepository.countCancelledSalesBetween(start, end);

                return new SalesReport(
                                startDate,
                                endDate,
                                revenue,
                                completedSales,
                                cancelledSales);
        }

        public record SalesReport(
                        LocalDate startDate,
                        LocalDate endDate,
                        BigDecimal revenue,
                        long completedSales,
                        long cancelledSales) {
        }
}