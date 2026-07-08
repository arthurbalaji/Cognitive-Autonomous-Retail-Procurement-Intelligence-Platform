# CARPIP — Cognitive Autonomous Retail Procurement Intelligence Platform

<p align="center">
  <strong>Enterprise-grade B2B platform for AI-powered inventory monitoring, demand forecasting, and multi-agent procurement negotiations</strong>
</p>

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Nginx (Port 80)                        │
│                    React Frontend (Static)                      │
└───────────────┬───────────────────────────┬─────────────────────┘
                │ /api/*                    │ /api/ai/*
    ┌───────────▼───────────┐   ┌───────────▼───────────┐
    │   Spring Boot (8080)  │   │     Flask (5000)       │
    │  Auth, CRUD, Gateway  │   │  AI/ML, Negotiation    │
    └───────┬───────┬───────┘   └───────┬───────┬────────┘
            │       │                   │       │
    ┌───────▼───┐   │           ┌───────▼───┐   │
    │ PostgreSQL│   └──►Kafka◄──┘   │ Scikit  │   │
    │   (5432)  │     (9092)        │ Learn   │   │
    └───────────┘                   └─────────┘   │
    ┌───────────┐                                 │
    │   Redis   │◄────────────────────────────────┘
    │   (6379)  │
    └───────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, Vite, TypeScript, Tailwind CSS, Shadcn UI, Zustand, React Query, Recharts |
| **Core Backend** | Java 17, Spring Boot 3.3, Spring Security (JWT), Spring Data JPA, Spring Kafka |
| **AI/ML Service** | Python 3.11, Flask, SQLAlchemy, Scikit-learn, NumPy, Pandas |
| **Database** | PostgreSQL 15, Redis 7 |
| **Messaging** | Apache Kafka |
| **Infrastructure** | Docker, Docker Compose, Nginx |

## Quick Start

### Prerequisites
- Node.js 18+
- Java 17+
- Python 3.10+
- Docker & Docker Compose

### 1. Clone & Configure
```bash
cp .env.example .env
# Edit .env with your values (especially JWT_SECRET and OPENAI_API_KEY)
```

### 2. Start Infrastructure (Docker)
```bash
docker-compose up -d postgres redis zookeeper kafka
```

### 3. Start Backend
```bash
cd backend
mvn spring-boot:run
```

### 4. Start AI Service
```bash
cd ai-service
pip install -r requirements.txt
python app.py
```

### 5. Start Frontend
```bash
cd frontend
npm install
npm run dev
```

### 6. Access the App
- **Frontend**: http://localhost:5173
- **Spring Boot API**: http://localhost:8080
- **Flask AI API**: http://localhost:5000
- **H2 Console** (dev): http://localhost:8080/h2-console

### Production Deployment
```bash
# Build frontend
cd frontend && npm run build

# Start everything
docker-compose up -d
# Access at http://localhost:80
```

## Project Structure

```
CARPIP/
├── frontend/                 # React + Vite + TypeScript
│   ├── src/
│   │   ├── components/ui/   # Shadcn UI components
│   │   ├── layouts/         # Dashboard layout
│   │   ├── pages/           # Page components
│   │   ├── stores/          # Zustand stores
│   │   ├── hooks/           # Custom hooks
│   │   ├── lib/             # Utilities (axios, cn)
│   │   ├── routes/          # Route guards
│   │   └── types/           # TypeScript types
│   └── package.json
│
├── backend/                  # Spring Boot 3.x
│   └── src/main/java/com/carpip/
│       ├── config/          # Security, Kafka config
│       ├── controller/      # REST controllers
│       ├── dto/             # Data transfer objects
│       ├── entity/          # JPA entities
│       ├── exception/       # Global error handling
│       ├── integration/     # ERP adapters
│       ├── repository/      # Spring Data repos
│       ├── security/        # JWT filter & service
│       └── service/         # Business logic
│
├── ai-service/               # Flask + Python
│   ├── routes/              # Blueprint routes
│   ├── models.py            # SQLAlchemy models
│   ├── app.py               # Application factory
│   └── kafka_consumer.py    # Kafka event consumer
│
├── nginx/                    # Nginx reverse proxy
├── docker-compose.yml        # All services
└── .env.example              # Environment template
```

## Key Features

- **🔐 JWT Authentication** with role-based access (Admin, Retailer, Wholesaler)
- **📊 Real-time Dashboards** with Recharts visualizations
- **🤖 AI Demand Forecasting** using weighted moving average with trend analysis
- **🤝 Multi-Agent Negotiation** — Retailer vs. Wholesaler AI agents
- **📈 Market Pulse Index (MPI)** — composite market demand indicator
- **🔌 ERP Integration** — Shopify, SAP, Custom REST API adapters
- **📨 Event-Driven Architecture** via Apache Kafka
- **🐳 Docker-ready** — one-command deployment

## API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/refresh` | Refresh token |

### Products
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/products` | List products |
| POST | `/api/products` | Create product |
| PUT | `/api/products/{id}` | Update product |
| DELETE | `/api/products/{id}` | Delete product |
| GET | `/api/products/low-stock` | Get low-stock alerts |

### Orders
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/orders` | List orders |
| POST | `/api/orders` | Create order |
| PATCH | `/api/orders/{id}/status` | Update order status |

### AI Service
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ai/forecast` | Run demand forecast |
| POST | `/api/ai/forecast/batch` | Batch forecast |
| GET | `/api/ai/mpi` | Get Market Pulse Index |
| POST | `/api/ai/negotiate` | Run AI negotiation |
| GET | `/api/ai/negotiate/demo` | Demo negotiation |
| GET | `/api/ai/health` | AI service health |
| GET | `/api/ai/metrics` | AI service metrics |

### Integrations
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/integrations/test` | Test ERP connection |
| POST | `/api/integrations/connect` | Establish ERP connection |

## License

MIT
