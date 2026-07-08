# CARPIP Master Build Blueprint & Execution Directives

## PROJECT OVERVIEW
You are an expert full-stack principal engineer. [cite_start]Your task is to build **CARPIP (Cognitive Autonomous Retail Procurement Intelligence Platform)**[cite: 9]. [cite_start]This is an enterprise-grade, cloud-native B2B platform that automates inventory monitoring, demand forecasting, and multi-agent negotiations between independent retailers and wholesalers[cite: 26]. 

You must deliver a complete, wired, and production-ready system. **DO NOT output placeholder comments like `// implement logic here`. You must write the actual, functional code for every component.**

### Core Tech Stack
* **Frontend:** React 18, Vite, TypeScript, Tailwind CSS, Shadcn UI (for perfect, production-grade components), Zustand (State Management), React Query (Data Fetching).
* **Backend (Core Services):** Java 17+, Spring Boot 3.x (Spring Web, Spring Security with JWT, Spring Data JPA, Spring Kafka).
* [cite_start]**Backend (AI/ML Services):** Python 3.10+, Flask, SQLAlchemy, Scikit-learn (LSTM + XGBoost) [cite: 91][cite_start], LangChain/OpenAI (LLM Orchestration)[cite: 91].
* [cite_start]**Data & Infra:** PostgreSQL 15, Redis (Caching), Apache Kafka (Event Streaming)[cite: 91], Docker, Kubernetes.

### Architecture & System Wiring (End-to-End Flow)
1.  **Ingestion:** The React UI collects ERP/POS credentials. Spring Boot acts as the Integration Gateway, fetching inventory/sales data via adapters and publishing to Kafka (`sales.events`, `inventory.updates`).
2.  **AI Processing:** Flask consumes these Kafka topics. [cite_start]It updates the Scikit-learn forecasting models, calculates the Market Pulse Index (MPI) [cite: 82][cite_start], and detects stockout risks[cite: 31].
3.  [cite_start]**Negotiation Engine:** If stock is low, Flask triggers the LangChain Multi-Agent system (Retailer Agent vs. Wholesaler Agent) [cite: 81] to negotiate a Purchase Order (PO). 
4.  [cite_start]**Fulfillment:** The Adaptive Procurement Algorithm [cite: 84] finalizes the PO, sends it back to Spring Boot via Kafka, which saves it to PostgreSQL and pushes real-time WebSocket updates to the React dashboards.

---

## 1. DATA MODELS & POSTGRESQL SCHEMA
Before writing service logic, scaffold these exact entities in Spring Boot (JPA) and Flask (SQLAlchemy).

* `Tenant`: `id`, `type` (RETAILER | WHOLESALER), `name`, `api_keys` (JSONB), `erp_provider` (String).
* `User`: `id`, `tenant_id`, `email`, `password_hash`, `role` (ADMIN | RETAILER | WHOLESALER).
* `Product`: `id`, `tenant_id`, `sku`, `name`, `category`, `base_price`, `current_stock`, `reorder_point`.
* `Order`: `id`, `retailer_id`, `wholesaler_id`, `status` (PENDING | NEGOTIATING | ACCEPTED | REJECTED), `total_amount`, `created_at`.
* `NegotiationLog`: `id`, `order_id`, `agent_type`, `message_payload` (JSONB), `timestamp`.

---

## 2. PHASED EXECUTION PLAN

Execute the following phases sequentially. Acknowledge completion of each phase before moving to the next.

### PHASE 1: Frontend Scaffold & Perfect UI Foundation
1.  Initialize a Vite + React + TS project.
2.  Install and configure Tailwind CSS and `shadcn/ui`. Initialize core components: Button, Card, Input, Table, Dialog, Toast.
3.  Set up React Router with protected routes based on roles (Admin, Retailer, Wholesaler).
4.  Set up an Axios interceptor to automatically attach JWT tokens to every request and handle 401 refresh logic.

### PHASE 2: Spring Boot Auth & Core API
1.  Initialize Spring Boot. Configure `application.yml` for PostgreSQL, Redis, and Kafka.
2.  Implement `SecurityFilterChain` with a custom `JwtAuthenticationFilter`.
3.  Build the Auth Controller: `/api/auth/register`, `/api/auth/login`. Returns JWT and User details.
4.  Build basic CRUD REST controllers for `Products` and `Orders` using Spring Data JPA.

### PHASE 3: The Integration Gateway & Onboarding Hub (CRITICAL)
1.  **Backend:** Implement an `ErpAdapter` Java interface with methods: `connect()`, `syncInventory()`, `fetchSales()`. 
2.  Create implementations: `ShopifyAdapter`, `CustomRestAdapter`. 
3.  **Frontend:** Build the comprehensive "Connect System" onboarding page. 
    * UI: A grid of elegant Cards featuring logos (Shopify, SAP, Custom API). 
    * When clicked, open a Modal with explicit visual instructions on where to find API keys, and form inputs to save them.
    * Wire this form to a Spring Boot endpoint that tests the connection and returns a success/fail Toast.

### PHASE 4: Kafka Event Streaming & Python AI Setup
1.  **Spring Boot:** Create a `@Scheduled` task that uses the active ERP adapters to poll for recent sales, then uses `KafkaTemplate` to push JSON payloads to a `sales.events` topic.
2.  **Flask:** Initialize the app. Use `confluent-kafka` or `kafka-python` to consume `sales.events`.
3.  **Forecasting:** Write a Pandas/Scikit-learn pipeline in Flask that reads historical sales, predicts next week's demand, and updates the `reorder_point` in the database.

### PHASE 5: Multi-Agent Negotiation Engine (LangChain)
1.  In Flask, set up two LangChain agents using OpenAI/Claude function calling (Strict JSON outputs, no free text).
2.  **Retailer Agent Tools:** `check_forecast()`, `propose_buy_price()`, `accept_offer()`.
3.  **Wholesaler Agent Tools:** `check_inventory_pressure()`, `calculate_mpi_discount()`, `counter_offer()`.
4.  Create an orchestration endpoint `/api/ai/negotiate` that pits these agents against each other for a maximum of 3 turns, logs the JSON transcript to `NegotiationLog`, and finalizes the `Order` status.

### PHASE 6: Perfecting the Dashboards (End-to-End Wiring)
Build out the specific portal views using React Query to fetch data from Spring Boot.
1.  **Retailer Dashboard:**
    * A high-end data table showing SKUs, Current Stock, and AI-Predicted Stockout Dates.
    * A "Negotiations" tab rendering the LLM chat transcript in a clean chat-bubble UI.
2.  **Wholesaler Dashboard:**
    * [cite_start]A dashboard showing the Market Pulse Index (MPI) [cite: 82] as a gauge chart (using Recharts).
    * A grid of incoming automated POs with 1-click "Approve" or "Override" buttons.
3.  **Admin Console:**
    * System health metrics: Kafka topic lag, active API connections, LLM token usage, and total system throughput.

### PHASE 7: Production Readiness
1.  Write a `docker-compose.yml` that seamlessly spins up: PostgreSQL, Redis, Zookeeper, Kafka, Spring Boot app, Flask app, and an Nginx container serving the built React frontend.
2.  Ensure all database connection strings, API keys, and LLM tokens are abstracted via `.env` files and `os.environ` / `@Value` annotations.
3.  Implement global error handling: Spring Boot `@ControllerAdvice`, Flask `@app.errorhandler`, and React Error Boundaries.

**INITIALIZATION COMMAND:**
"I have understood the master blueprint. I will begin with Phase 1: Frontend Scaffold & Perfect UI Foundation. I will write production-ready code, avoid placeholders, and ensure perfect styling with Tailwind/Shadcn. Shall I proceed with the file generation?"