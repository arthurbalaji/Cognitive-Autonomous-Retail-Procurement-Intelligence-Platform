package com.carpip.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public class AuthDtos {

    public record LoginRequest(
        @NotBlank @Email String email,
        @NotBlank String password
    ) {}

    public record RegisterRequest(
        @NotBlank String name,
        @NotBlank @Email String email,
        @NotBlank @Size(min = 8) String password,
        @NotBlank String role,
        @NotBlank String tenantName
    ) {}

    public record RefreshRequest(
        @NotBlank String refreshToken
    ) {}

    public record AuthResponse(
        String token,
        String refreshToken,
        UserDto user
    ) {}

    public record UserDto(
        String id,
        String email,
        String name,
        String role,
        String tenantId,
        String tenantName,
        String tenantType
    ) {}

    public record ErrorResponse(
        String message,
        int status
    ) {}
}
