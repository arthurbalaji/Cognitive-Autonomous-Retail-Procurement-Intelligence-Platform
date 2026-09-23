package com.pos.application.repository;

import com.pos.application.entity.Supplier;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface SupplierRepository
        extends JpaRepository<Supplier, Long> {

    boolean existsByPhone(String phone);

    Optional<Supplier> findByPhone(String phone);

    List<Supplier> findByActiveTrueOrderByNameAsc();

    List<Supplier> findByNameContainingIgnoreCaseOrderByNameAsc(
            String name);

    @Query("""
                SELECT s
                FROM Supplier s
                WHERE s.active = true
                AND (
                    LOWER(s.name) LIKE LOWER(CONCAT('%', :query, '%'))
                    OR LOWER(COALESCE(s.contactPerson, '')) LIKE LOWER(CONCAT('%', :query, '%'))
                    OR LOWER(s.phone) LIKE LOWER(CONCAT('%', :query, '%'))
                    OR LOWER(COALESCE(s.gstNumber, '')) LIKE LOWER(CONCAT('%', :query, '%'))
                )
                ORDER BY s.name ASC
            """)
    List<Supplier> searchActiveSuppliers(
            @Param("query") String query);
}