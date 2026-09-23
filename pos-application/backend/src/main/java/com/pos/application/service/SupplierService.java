package com.pos.application.service;

import com.pos.application.entity.Supplier;
import com.pos.application.exception.BusinessException;
import com.pos.application.exception.ResourceNotFoundException;
import com.pos.application.repository.SupplierRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
@RequiredArgsConstructor
public class SupplierService {

    private final SupplierRepository supplierRepository;

    public Supplier createSupplier(Supplier supplier) {

        if (supplierRepository.existsByPhone(supplier.getPhone())) {
            throw new BusinessException(
                    "Supplier with this phone number already exists");
        }

        supplier.setId(null);
        supplier.setActive(true);

        return supplierRepository.save(supplier);
    }

    public List<Supplier> getAllSuppliers() {
        return supplierRepository.findAll();
    }

    public List<Supplier> getActiveSuppliers() {
        return supplierRepository.findByActiveTrueOrderByNameAsc();
    }

    public Supplier getSupplierById(Long id) {
        return supplierRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Supplier not found"));
    }

    public Supplier getSupplierByPhone(String phone) {
        return supplierRepository.findByPhone(phone)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Supplier not found"));
    }

    public List<Supplier> searchSuppliers(String query) {

        if (query == null || query.isBlank()) {
            return getActiveSuppliers();
        }

        return supplierRepository.searchActiveSuppliers(
                query.trim());
    }

    public Supplier updateSupplier(
            Long id,
            Supplier updatedSupplier) {

        Supplier supplier = getSupplierById(id);

        if (!supplier.getPhone().equals(updatedSupplier.getPhone())
                && supplierRepository.existsByPhone(
                        updatedSupplier.getPhone())) {

            throw new BusinessException(
                    "Another supplier already uses this phone number");
        }

        supplier.setName(updatedSupplier.getName());
        supplier.setContactPerson(
                updatedSupplier.getContactPerson());
        supplier.setPhone(updatedSupplier.getPhone());
        supplier.setEmail(updatedSupplier.getEmail());
        supplier.setAddress(updatedSupplier.getAddress());
        supplier.setGstNumber(updatedSupplier.getGstNumber());

        return supplierRepository.save(supplier);
    }

    public Supplier deactivateSupplier(Long id) {

        Supplier supplier = getSupplierById(id);

        supplier.setActive(false);

        return supplierRepository.save(supplier);
    }

    public Supplier activateSupplier(Long id) {

        Supplier supplier = getSupplierById(id);

        supplier.setActive(true);

        return supplierRepository.save(supplier);
    }

    public void deleteSupplier(Long id) {

        Supplier supplier = getSupplierById(id);

        supplierRepository.delete(supplier);
    }
}