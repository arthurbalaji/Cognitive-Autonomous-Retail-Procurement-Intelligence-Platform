package com.pos.application.controller;

import jakarta.validation.constraints.NotNull;

public record InventoryAdjustmentRequest(

                @NotNull(message = "Product ID is required") Long productId,

                @NotNull(message = "Adjustment quantity is required") Integer quantity,

                String notes) {
}