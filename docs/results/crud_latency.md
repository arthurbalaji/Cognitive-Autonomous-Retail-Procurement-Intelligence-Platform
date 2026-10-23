
Measured on a 12-thread laptop with ALL services running (incl. Kafka, Postgres, 3 ML containers). The paper's 42.1 ms was an i7-12700K workstation, local load. Under 20-way concurrency with a new TCP connection per request these averages are 60-135 ms with no errors; single-client latency is lower.
