from app import db
from datetime import datetime


class SalesEvent(db.Model):
    """Stores raw sales events consumed from Kafka."""
    __tablename__ = 'ai_sales_events'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    tenant_id = db.Column(db.String(64), nullable=False, index=True)
    sku = db.Column(db.String(64), nullable=False, index=True)
    quantity = db.Column(db.Integer, nullable=False)
    total = db.Column(db.Numeric(12, 2))
    event_timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class ForecastResult(db.Model):
    """Stores demand forecast results per SKU."""
    __tablename__ = 'ai_forecast_results'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    tenant_id = db.Column(db.String(64), nullable=False, index=True)
    sku = db.Column(db.String(64), nullable=False)
    predicted_demand = db.Column(db.Integer, nullable=False)
    predicted_stockout_date = db.Column(db.DateTime)
    confidence = db.Column(db.Float)
    model_version = db.Column(db.String(32))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class NegotiationSession(db.Model):
    """Stores multi-agent negotiation sessions."""
    __tablename__ = 'ai_negotiation_sessions'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    order_id = db.Column(db.String(64), nullable=False, index=True)
    retailer_id = db.Column(db.String(64), nullable=False)
    wholesaler_id = db.Column(db.String(64), nullable=False)
    sku = db.Column(db.String(64), nullable=False)
    initial_quantity = db.Column(db.Integer)
    final_quantity = db.Column(db.Integer)
    initial_price = db.Column(db.Numeric(10, 2))
    final_price = db.Column(db.Numeric(10, 2))
    turns = db.Column(db.Integer, default=0)
    status = db.Column(db.String(20), default='PENDING')
    transcript = db.Column(db.Text)  # JSON transcript
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    completed_at = db.Column(db.DateTime)


class MarketPulseData(db.Model):
    """Stores Market Pulse Index (MPI) calculations."""
    __tablename__ = 'ai_market_pulse'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    category = db.Column(db.String(64), index=True)
    mpi_value = db.Column(db.Float, nullable=False)
    demand_pressure = db.Column(db.Float)
    supply_availability = db.Column(db.Float)
    price_volatility = db.Column(db.Float)
    seasonal_index = db.Column(db.Float)
    trend = db.Column(db.String(20))
    calculated_at = db.Column(db.DateTime, default=datetime.utcnow)
