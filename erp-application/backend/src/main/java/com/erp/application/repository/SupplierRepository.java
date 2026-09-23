package com.erp.application.repository;

import com.erp.application.entity.Supplier;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SupplierRepository extends JpaRepository<Supplier, Long> {

    List<Supplier> findByActiveTrue();

    List<Supplier> findByCompanyNameContainingIgnoreCase(String companyName);
}
