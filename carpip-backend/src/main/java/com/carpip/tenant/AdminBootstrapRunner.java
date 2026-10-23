package com.carpip.tenant;

import com.carpip.config.AppProps;
import com.carpip.domain.AppUser;
import com.carpip.domain.Repos;
import com.carpip.domain.Tenant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.UUID;

/** Creates the platform ADMIN tenant + user from env on first start (idempotent). */
@Component
public class AdminBootstrapRunner implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(AdminBootstrapRunner.class);
    private final Repos.TenantRepo tenants;
    private final Repos.UserRepo users;
    private final AppProps props;

    public AdminBootstrapRunner(Repos.TenantRepo tenants, Repos.UserRepo users, AppProps props) {
        this.tenants = tenants;
        this.users = users;
        this.props = props;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (props.adminPassword() == null || props.adminPassword().length() < 8) {
            log.warn("CARPIP_ADMIN_PASSWORD not set (>= 8 chars); skipping admin bootstrap");
            return;
        }
        List<Tenant> admins = tenants.findByType("ADMIN");
        Tenant t = admins.isEmpty() ? null : admins.get(0);
        if (t == null) {
            t = new Tenant();
            t.id = UUID.randomUUID();
            t.publicId = "ten_platform_admin";
            t.name = "CARPIP Platform";
            t.type = "ADMIN";
            tenants.save(t);
        }
        if (users.findByEmailIgnoreCase(props.adminEmail()).isEmpty()) {
            AppUser u = new AppUser();
            u.id = UUID.randomUUID();
            u.tenantId = t.id;
            u.email = props.adminEmail().toLowerCase();
            u.passwordHash = new BCryptPasswordEncoder().encode(props.adminPassword());
            u.role = "ADMIN";
            u.displayName = "Platform Admin";
            users.save(u);
            log.info("created platform admin {}", u.email);
        }
    }
}
