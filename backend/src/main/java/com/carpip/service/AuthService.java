package com.carpip.service;

import com.carpip.dto.AuthDtos.*;
import com.carpip.entity.Tenant;
import com.carpip.entity.User;
import com.carpip.repository.TenantRepository;
import com.carpip.repository.UserRepository;
import com.carpip.security.JwtService;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;

@Service
public class AuthService {

    private final UserRepository userRepository;
    private final TenantRepository tenantRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;

    public AuthService(UserRepository userRepository, TenantRepository tenantRepository,
                       PasswordEncoder passwordEncoder, JwtService jwtService) {
        this.userRepository = userRepository;
        this.tenantRepository = tenantRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
    }

    @Transactional
    public AuthResponse register(RegisterRequest request) {
        if (userRepository.existsByEmail(request.email())) {
            throw new RuntimeException("Email already registered");
        }

        // Create tenant
        Tenant tenant = new Tenant();
        tenant.setName(request.tenantName());
        tenant.setType(Tenant.TenantType.valueOf(request.role()));
        tenant.setApiKeys(new HashMap<>());
        tenant = tenantRepository.save(tenant);

        // Create user
        User user = new User();
        user.setName(request.name());
        user.setEmail(request.email());
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        user.setRole(User.UserRole.valueOf(request.role()));
        user.setTenant(tenant);
        user = userRepository.save(user);

        // Generate tokens
        String token = jwtService.generateToken(user);
        String refreshToken = jwtService.generateRefreshToken(user);

        return new AuthResponse(token, refreshToken, toUserDto(user));
    }

    public AuthResponse login(LoginRequest request) {
        User user = userRepository.findByEmail(request.email())
                .orElseThrow(() -> new RuntimeException("Invalid email or password"));

        if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw new RuntimeException("Invalid email or password");
        }

        String token = jwtService.generateToken(user);
        String refreshToken = jwtService.generateRefreshToken(user);

        return new AuthResponse(token, refreshToken, toUserDto(user));
    }

    public AuthResponse refresh(RefreshRequest request) {
        if (!jwtService.isTokenValid(request.refreshToken())) {
            throw new RuntimeException("Invalid or expired refresh token");
        }

        String userId = jwtService.extractUserId(request.refreshToken());
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found"));

        String token = jwtService.generateToken(user);
        String newRefreshToken = jwtService.generateRefreshToken(user);

        return new AuthResponse(token, newRefreshToken, toUserDto(user));
    }

    private UserDto toUserDto(User user) {
        return new UserDto(
            user.getId(),
            user.getEmail(),
            user.getName(),
            user.getRole().name(),
            user.getTenant().getId(),
            user.getTenant().getName(),
            user.getTenant().getType().name()
        );
    }
}
