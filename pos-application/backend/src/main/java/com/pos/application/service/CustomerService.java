package com.pos.application.service;

import com.pos.application.entity.Customer;
import com.pos.application.entity.Sale;
import com.pos.application.repository.CustomerRepository;
import com.pos.application.repository.SaleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.pos.application.exception.BusinessException;
import com.pos.application.exception.ResourceNotFoundException;

import java.util.List;

@Service
@RequiredArgsConstructor
public class CustomerService {

    private final CustomerRepository customerRepository;
    private final SaleRepository saleRepository;

    public Customer createCustomer(Customer customer) {

        if (customerRepository.existsByPhone(customer.getPhone())) {
            throw new BusinessException(
                    "Customer with this phone number already exists");
        }

        customer.setId(null);
        customer.setActive(true);
        customer.setCreatedAt(java.time.LocalDateTime.now());

        return customerRepository.save(customer);
    }

    public List<Customer> getAllCustomers() {
        return customerRepository.findAll();
    }

    public List<Customer> getActiveCustomers() {
        return customerRepository.findByActiveTrueOrderByNameAsc();
    }

    public Customer getCustomerById(Long id) {
        return customerRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Customer not found"));
    }

    public Customer getCustomerByPhone(String phone) {
        return customerRepository.findByPhone(phone)
                .orElseThrow(() -> new ResourceNotFoundException("Customer not found"));
    }

    public List<Customer> searchCustomers(String name) {
        return customerRepository
                .findByNameContainingIgnoreCaseOrderByNameAsc(name);
    }

    public Customer updateCustomer(Long id, Customer updatedCustomer) {

        Customer customer = getCustomerById(id);

        if (!customer.getPhone().equals(updatedCustomer.getPhone())
                && customerRepository.existsByPhone(updatedCustomer.getPhone())) {
            throw new BusinessException(
                    "Another customer already uses this phone number");
        }

        customer.setName(updatedCustomer.getName());
        customer.setPhone(updatedCustomer.getPhone());
        customer.setEmail(updatedCustomer.getEmail());
        customer.setAddress(updatedCustomer.getAddress());

        return customerRepository.save(customer);
    }

    public Customer deactivateCustomer(Long id) {

        Customer customer = getCustomerById(id);
        customer.setActive(false);

        return customerRepository.save(customer);
    }

    public Customer activateCustomer(Long id) {

        Customer customer = getCustomerById(id);
        customer.setActive(true);

        return customerRepository.save(customer);
    }

    public List<Customer> searchActiveCustomers(String query) {

        if (query == null || query.isBlank()) {
            return customerRepository.findByActiveTrueOrderByNameAsc();
        }

        return customerRepository.searchActiveCustomers(query.trim());
    }

    @Transactional(readOnly = true)
    public List<Sale> getCustomerSales(Long customerId) {

        if (!customerRepository.existsById(customerId)) {
            throw new ResourceNotFoundException("Customer not found");
        }

        return saleRepository.findByCustomerIdOrderByCreatedAtDesc(
                customerId);
    }

}