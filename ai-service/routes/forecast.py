from flask import Blueprint, jsonify, request
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
import json

forecast_bp = Blueprint('forecast', __name__)


def generate_forecast(historical_sales, current_stock, reorder_point):
    """
    Demand forecasting pipeline using weighted moving average + trend analysis.
    In production, replace with trained LSTM + XGBoost ensemble.
    """
    if not historical_sales or len(historical_sales) < 3:
        # Not enough data — use simple estimation
        avg_daily = current_stock / 14 if current_stock > 0 else 5
        predicted_demand = int(avg_daily * 7)
        days_until_stockout = int(current_stock / avg_daily) if avg_daily > 0 else 30
        return {
            'predicted_demand_7d': predicted_demand,
            'predicted_stockout_date': (datetime.utcnow() + timedelta(days=days_until_stockout)).isoformat(),
            'confidence': 0.65,
            'model': 'simple_estimation'
        }

    # Convert to pandas Series
    sales_series = pd.Series(historical_sales)

    # Weighted Moving Average (recent data weighted more)
    weights = np.exp(np.linspace(-1, 0, len(sales_series)))
    weights /= weights.sum()
    wma = np.average(sales_series, weights=weights)

    # Trend calculation
    if len(sales_series) >= 7:
        recent_avg = sales_series[-3:].mean()
        older_avg = sales_series[-7:-3].mean() if len(sales_series) >= 7 else sales_series[:-3].mean()
        trend_factor = recent_avg / older_avg if older_avg > 0 else 1.0
    else:
        trend_factor = 1.0

    # 7-day demand prediction with trend adjustment
    predicted_daily = wma * trend_factor
    predicted_demand = max(1, int(predicted_daily * 7))

    # Stockout prediction
    daily_consumption = predicted_daily if predicted_daily > 0 else 1
    days_until_stockout = max(1, int(current_stock / daily_consumption))
    stockout_date = datetime.utcnow() + timedelta(days=days_until_stockout)

    # Confidence based on data quality
    data_quality = min(1.0, len(sales_series) / 30)
    variance_penalty = 1.0 - min(0.3, sales_series.std() / (sales_series.mean() + 1) * 0.5)
    confidence = round(data_quality * variance_penalty * 0.95, 2)

    return {
        'predicted_demand_7d': predicted_demand,
        'predicted_stockout_date': stockout_date.isoformat(),
        'confidence': confidence,
        'trend_factor': round(trend_factor, 3),
        'daily_consumption_rate': round(predicted_daily, 2),
        'model': 'wma_trend_v1'
    }


def calculate_mpi(category_data):
    """
    Calculate Market Pulse Index (MPI) — a composite indicator of market conditions.
    
    MPI = 0.35 * demand_pressure + 0.25 * (1 - supply_availability) 
        + 0.20 * price_volatility + 0.20 * seasonal_index
    
    Range: 0.0 (low activity) to 1.0 (extreme demand)
    """
    # Demand pressure: ratio of total demand to available supply
    total_demand = sum(item.get('predicted_demand', 0) for item in category_data)
    total_supply = sum(item.get('current_stock', 0) for item in category_data)
    demand_pressure = min(1.0, total_demand / (total_supply + 1))

    # Supply availability: inverse of stockout risk
    at_risk = sum(1 for item in category_data if item.get('current_stock', 0) <= item.get('reorder_point', 0))
    total_items = max(1, len(category_data))
    supply_availability = 1.0 - (at_risk / total_items)

    # Price volatility: simulated (in production, computed from historical price data)
    prices = [item.get('base_price', 0) for item in category_data if item.get('base_price', 0) > 0]
    if prices:
        price_std = np.std(prices) / (np.mean(prices) + 1)
        price_volatility = min(1.0, price_std * 2)
    else:
        price_volatility = 0.3

    # Seasonal index: time-based factor
    month = datetime.utcnow().month
    # Q4 and early Q1 = high demand season
    seasonal_map = {1: 0.8, 2: 0.5, 3: 0.4, 4: 0.5, 5: 0.6, 6: 0.6,
                    7: 0.7, 8: 0.6, 9: 0.7, 10: 0.8, 11: 0.9, 12: 0.95}
    seasonal_index = seasonal_map.get(month, 0.5)

    # Compute composite MPI
    mpi = (0.35 * demand_pressure +
           0.25 * (1 - supply_availability) +
           0.20 * price_volatility +
           0.20 * seasonal_index)

    mpi = round(min(1.0, max(0.0, mpi)), 3)

    # Determine trend
    if mpi > 0.7:
        trend = 'RISING'
    elif mpi < 0.3:
        trend = 'FALLING'
    else:
        trend = 'STABLE'

    return {
        'value': mpi,
        'trend': trend,
        'factors': {
            'demand_pressure': round(demand_pressure, 3),
            'supply_availability': round(supply_availability, 3),
            'price_volatility': round(price_volatility, 3),
            'seasonal_index': round(seasonal_index, 3),
        },
        'last_updated': datetime.utcnow().isoformat()
    }


@forecast_bp.route('/forecast', methods=['POST'])
def run_forecast():
    """Run demand forecast for a product."""
    data = request.get_json()

    sku = data.get('sku', 'UNKNOWN')
    current_stock = data.get('current_stock', 100)
    reorder_point = data.get('reorder_point', 25)
    historical_sales = data.get('historical_sales', [])

    # If no historical data, generate synthetic data
    if not historical_sales:
        np.random.seed(hash(sku) % 2**32)
        historical_sales = list(np.random.poisson(lam=8, size=30).astype(int))

    result = generate_forecast(historical_sales, current_stock, reorder_point)
    result['sku'] = sku
    result['current_stock'] = current_stock
    result['reorder_point'] = reorder_point

    # Determine risk level
    days = (datetime.fromisoformat(result['predicted_stockout_date']) - datetime.utcnow()).days
    if days <= 3:
        result['risk'] = 'CRITICAL'
    elif days <= 7:
        result['risk'] = 'HIGH'
    elif days <= 14:
        result['risk'] = 'MEDIUM'
    else:
        result['risk'] = 'LOW'

    return jsonify(result)


@forecast_bp.route('/forecast/batch', methods=['POST'])
def batch_forecast():
    """Run demand forecast for multiple products."""
    data = request.get_json()
    products = data.get('products', [])

    results = []
    for product in products:
        historical = product.get('historical_sales', [])
        if not historical:
            np.random.seed(hash(product.get('sku', '')) % 2**32)
            historical = list(np.random.poisson(lam=8, size=30).astype(int))

        forecast = generate_forecast(
            historical,
            product.get('current_stock', 100),
            product.get('reorder_point', 25)
        )
        forecast['sku'] = product.get('sku')
        results.append(forecast)

    return jsonify({'forecasts': results})


@forecast_bp.route('/mpi', methods=['GET', 'POST'])
def get_mpi():
    """Get the current Market Pulse Index.
    Accepts optional POST body with real product data from the backend.
    Falls back to mock data when no products are provided.
    """
    products_data = None

    if request.method == 'POST':
        data = request.get_json(silent=True)
        if data and 'products' in data:
            products_data = data['products']

    if not products_data:
        # Fallback to mock product data
        products_data = [
            {'sku': 'SKU-001', 'current_stock': 45, 'reorder_point': 50, 'base_price': 79.99, 'predicted_demand': 60},
            {'sku': 'SKU-002', 'current_stock': 230, 'reorder_point': 100, 'base_price': 24.99, 'predicted_demand': 80},
            {'sku': 'SKU-003', 'current_stock': 12, 'reorder_point': 25, 'base_price': 34.50, 'predicted_demand': 40},
            {'sku': 'SKU-004', 'current_stock': 89, 'reorder_point': 60, 'base_price': 19.99, 'predicted_demand': 35},
            {'sku': 'SKU-005', 'current_stock': 5, 'reorder_point': 30, 'base_price': 45.00, 'predicted_demand': 25},
        ]

    mpi = calculate_mpi(products_data)
    mpi['data_source'] = 'live' if request.method == 'POST' else 'mock'
    mpi['product_count'] = len(products_data)
    return jsonify(mpi)


@forecast_bp.route('/mpi/calculate', methods=['POST'])
def calculate_mpi_endpoint():
    """Calculate MPI from provided product data."""
    data = request.get_json()
    products = data.get('products', [])

    if not products:
        return jsonify({'error': 'No product data provided'}), 400

    mpi = calculate_mpi(products)
    return jsonify(mpi)
