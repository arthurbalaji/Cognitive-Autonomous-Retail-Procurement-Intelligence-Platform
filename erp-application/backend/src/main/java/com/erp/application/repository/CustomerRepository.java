package com.erp.application.repository;

import com.erp.application.entity.Customer;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface CustomerRepository extends JpaRepository<Customer, Long> {

    List<Customer> findByActiveTrue();

    List<Customer> findByCompanyNameContainingIgnoreCase(String companyName);
}
