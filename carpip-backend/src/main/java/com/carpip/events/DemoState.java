package com.carpip.events;

import org.springframework.stereotype.Component;

import java.util.concurrent.atomic.AtomicBoolean;

/** Switches used by the demo scenario panel (simulated Kafka outage). */
@Component
public class DemoState {
    public final AtomicBoolean relayPaused = new AtomicBoolean(false);
    public final AtomicBoolean consumersPaused = new AtomicBoolean(false);
}
