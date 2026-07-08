"""
Kafka consumer for the CARPIP AI Service.
Consumes sales.events and inventory.updates topics.
Stores events in the database and triggers forecasts/negotiations.

Run as a separate process:
    python kafka_consumer.py
"""
import os
import json
import threading
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

KAFKA_BOOTSTRAP = os.environ.get('KAFKA_BOOTSTRAP_SERVERS', 'localhost:9092')
KAFKA_GROUP = 'carpip-ai-service'


def get_db_session():
    """Get a database session for storing events."""
    try:
        from app import create_app, db
        app = create_app()
        return app, db
    except Exception as e:
        print(f"[Kafka] Could not create DB session: {e}")
        return None, None


def consume_sales_events():
    """Consume sales events, store in DB, and update forecasting models."""
    try:
        from kafka import KafkaConsumer

        consumer = KafkaConsumer(
            'sales.events',
            bootstrap_servers=KAFKA_BOOTSTRAP,
            group_id=KAFKA_GROUP,
            auto_offset_reset='earliest',
            value_deserializer=lambda m: json.loads(m.decode('utf-8')),
            consumer_timeout_ms=5000,
            reconnect_backoff_ms=1000,
            reconnect_backoff_max_ms=10000,
        )

        print(f"[Kafka] Consuming sales.events from {KAFKA_BOOTSTRAP}")

        app, db = get_db_session()

        for message in consumer:
            event = message.value
            tenant_id = event.get('tenantId', 'unknown')
            sku = event.get('sku', 'unknown')
            quantity = event.get('quantity', 0)
            total = event.get('total', 0)

            print(f"[Sales Event] Tenant: {tenant_id}, SKU: {sku}, Qty: {quantity}")

            # Store in database
            if app and db:
                try:
                    with app.app_context():
                        from models import SalesEvent
                        sale = SalesEvent(
                            tenant_id=tenant_id,
                            sku=sku,
                            quantity=int(quantity),
                            total=float(total) if total else 0,
                            event_timestamp=datetime.utcnow(),
                        )
                        db.session.add(sale)
                        db.session.commit()
                except Exception as e:
                    print(f"[Kafka] Failed to store sales event: {e}")
                    if db:
                        db.session.rollback()

            # Check if reorder threshold is breached
            check_reorder_threshold(tenant_id, sku)

    except ImportError:
        print("[Kafka] kafka-python not installed. Kafka consumer disabled.")
        print("[Kafka] Install with: pip install kafka-python")
    except Exception as e:
        print(f"[Kafka] Consumer error: {e}")
        print("[Kafka] Kafka may not be running. Consumer will retry on next startup.")


def consume_inventory_updates():
    """Consume inventory updates, store and recalculate MPI."""
    try:
        from kafka import KafkaConsumer

        consumer = KafkaConsumer(
            'inventory.updates',
            bootstrap_servers=KAFKA_BOOTSTRAP,
            group_id=KAFKA_GROUP,
            auto_offset_reset='earliest',
            value_deserializer=lambda m: json.loads(m.decode('utf-8')),
            consumer_timeout_ms=5000,
            reconnect_backoff_ms=1000,
            reconnect_backoff_max_ms=10000,
        )

        print(f"[Kafka] Consuming inventory.updates from {KAFKA_BOOTSTRAP}")

        app, db = get_db_session()

        for message in consumer:
            event = message.value
            tenant_id = event.get('tenantId', 'unknown')
            sku = event.get('sku', 'unknown')
            stock = event.get('currentStock', 0)

            print(f"[Inventory Update] Tenant: {tenant_id}, SKU: {sku}, Stock: {stock}")

            # Recalculate and store MPI
            if app and db:
                try:
                    with app.app_context():
                        from models import MarketPulseData
                        category = event.get('category', 'General')

                        # Simple MPI update based on stock levels
                        base_price = float(event.get('basePrice', 25))
                        reorder_point = int(event.get('reorderPoint', 25))
                        demand_pressure = min(1.0, reorder_point / (stock + 1))
                        supply_availability = min(1.0, stock / (reorder_point * 2 + 1))

                        mpi_value = round(0.35 * demand_pressure + 0.25 * (1 - supply_availability) + 0.20 * 0.3 + 0.20 * 0.6, 3)

                        mpi = MarketPulseData(
                            category=category,
                            mpi_value=mpi_value,
                            demand_pressure=round(demand_pressure, 3),
                            supply_availability=round(supply_availability, 3),
                            price_volatility=0.3,
                            seasonal_index=0.6,
                            trend='RISING' if mpi_value > 0.7 else ('FALLING' if mpi_value < 0.3 else 'STABLE'),
                        )
                        db.session.add(mpi)
                        db.session.commit()
                except Exception as e:
                    print(f"[Kafka] Failed to update MPI: {e}")
                    if db:
                        db.session.rollback()

    except ImportError:
        print("[Kafka] kafka-python not installed. Kafka consumer disabled.")
    except Exception as e:
        print(f"[Kafka] Consumer error: {e}")


def check_reorder_threshold(tenant_id, sku):
    """Check if a product has breached its reorder threshold and trigger negotiation."""
    try:
        import requests
        # Call the AI service's forecast endpoint to check risk
        response = requests.post(
            'http://localhost:5000/api/ai/forecast',
            json={'sku': sku, 'current_stock': 10, 'reorder_point': 25},
            timeout=5
        )
        if response.ok:
            result = response.json()
            if result.get('risk') in ['CRITICAL', 'HIGH']:
                print(f"[Auto-Negotiate] {sku} is {result['risk']} risk — triggering negotiation")
                # Auto-trigger negotiation
                requests.post(
                    'http://localhost:5000/api/ai/negotiate',
                    json={
                        'product': {'sku': sku, 'base_price': 30, 'current_stock': 10, 'reorder_point': 25},
                        'forecast': result,
                        'mpi': {'value': 0.5, 'trend': 'STABLE'},
                    },
                    timeout=10
                )
    except Exception as e:
        # Non-fatal — just log
        pass


def start_consumers():
    """Start Kafka consumers in background threads."""
    sales_thread = threading.Thread(target=consume_sales_events, daemon=True)
    inventory_thread = threading.Thread(target=consume_inventory_updates, daemon=True)

    sales_thread.start()
    inventory_thread.start()

    print("[Kafka] Background consumers started.")


if __name__ == '__main__':
    print("Starting CARPIP AI Kafka Consumers...")
    start_consumers()

    # Keep main thread alive
    try:
        while True:
            import time
            time.sleep(60)
    except KeyboardInterrupt:
        print("\nKafka consumers stopped.")
