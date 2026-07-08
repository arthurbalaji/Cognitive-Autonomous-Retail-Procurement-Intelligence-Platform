package com.carpip.repository;

import com.carpip.entity.NegotiationLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface NegotiationLogRepository extends JpaRepository<NegotiationLog, String> {
    List<NegotiationLog> findByOrderIdOrderByTimestampAsc(String orderId);
}
