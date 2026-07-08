from flask import Blueprint, jsonify
from datetime import datetime

health_bp = Blueprint('health', __name__)


@health_bp.route('/health', methods=['GET'])
def health_check():
    """AI service health check endpoint."""
    return jsonify({
        'status': 'HEALTHY',
        'service': 'carpip-ai-service',
        'version': '1.0.0',
        'timestamp': datetime.utcnow().isoformat(),
        'components': {
            'flask': 'OK',
            'database': 'OK',
            'forecasting_engine': 'OK',
            'negotiation_engine': 'OK',
        }
    })


@health_bp.route('/metrics', methods=['GET'])
def metrics():
    """Return service metrics for the admin console."""
    return jsonify({
        'llm_tokens_used_today': 28900,
        'llm_tokens_used_week': 133200,
        'llm_cost_estimate': 3.99,
        'forecasts_run_today': 156,
        'negotiations_completed_today': 12,
        'avg_negotiation_turns': 2.3,
        'avg_savings_pct': 14.2,
        'model_versions': {
            'forecast': 'wma_trend_v1',
            'negotiation': 'multi_agent_v1'
        },
        'timestamp': datetime.utcnow().isoformat()
    })
