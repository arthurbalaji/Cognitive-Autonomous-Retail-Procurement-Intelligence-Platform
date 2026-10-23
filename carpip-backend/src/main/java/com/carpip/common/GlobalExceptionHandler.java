package com.carpip.common;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.LinkedHashMap;
import java.util.Map;

/** RFC 7807 problem+json for every error path. */
@RestControllerAdvice
public class GlobalExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    private ResponseEntity<Map<String, Object>> problem(HttpStatus st, String code, String detail) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("type", "about:blank");
        b.put("title", st.getReasonPhrase());
        b.put("status", st.value());
        b.put("code", code);
        b.put("detail", detail);
        return ResponseEntity.status(st).contentType(MediaType.APPLICATION_PROBLEM_JSON).body(b);
    }

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Map<String, Object>> api(ApiException e) {
        return problem(e.status, e.code, e.getMessage());
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class, IllegalArgumentException.class})
    public ResponseEntity<Map<String, Object>> bad(Exception e) {
        return problem(HttpStatus.BAD_REQUEST, "BAD_REQUEST", e.getMessage());
    }

    @ExceptionHandler(OptimisticLockingFailureException.class)
    public ResponseEntity<Map<String, Object>> lock(OptimisticLockingFailureException e) {
        return problem(HttpStatus.CONFLICT, "CONCURRENT_MODIFICATION", "resource was modified concurrently, retry");
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<Map<String, Object>> integrity(DataIntegrityViolationException e) {
        log.warn("integrity violation: {}", e.getMostSpecificCause().getMessage());
        return problem(HttpStatus.CONFLICT, "CONFLICT", e.getMostSpecificCause().getMessage());
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> other(Exception e) {
        log.error("unhandled", e);
        return problem(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL", e.getClass().getSimpleName() + ": " + e.getMessage());
    }
}
