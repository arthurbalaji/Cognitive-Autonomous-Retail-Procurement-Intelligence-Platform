package com.pos.application.repository;

import com.pos.application.entity.Customer;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface CustomerRepository extends JpaRepository<Customer, Long> {

    Optional<Customer> findByPhone(String phone);

    boolean existsByPhone(String phone);

    List<Customer> findByActiveTrueOrderByNameAsc();

    List<Customer> findByNameContainingIgnoreCaseOrderByNameAsc(String name);

    @Query("""
                SELECT c
                FROM Customer c
                WHERE c.active = true
                AND (
                    LOWER(c.name) LIKE LOWER(CONCAT('%', :query, '%'))
                    OR c.phone LIKE CONCAT('%', :query, '%')
                )
                ORDER BY c.name ASC
            """)
    List<Customer> searchActiveCustomers(String query);
}