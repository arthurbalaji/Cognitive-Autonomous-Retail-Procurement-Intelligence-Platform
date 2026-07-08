package com.carpip;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class CarpipApplication {
    public static void main(String[] args) {
        SpringApplication.run(CarpipApplication.class, args);
    }
}
