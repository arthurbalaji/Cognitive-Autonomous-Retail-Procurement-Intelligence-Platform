import os
from flask import Flask
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from dotenv import load_dotenv

load_dotenv()

db = SQLAlchemy()


def create_app():
    """Application factory for the CARPIP AI Service."""
    app = Flask(__name__)

    # Configuration
    app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get(
        'DATABASE_URL', 'sqlite:///carpip_ai.db'
    )
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY', 'dev-secret-key')

    # Initialize extensions
    db.init_app(app)
    CORS(app, origins=os.environ.get('CORS_ORIGINS', 'http://localhost:5173').split(','))

    # Register blueprints
    from routes.forecast import forecast_bp
    from routes.negotiation import negotiation_bp
    from routes.health import health_bp

    app.register_blueprint(forecast_bp, url_prefix='/api/ai')
    app.register_blueprint(negotiation_bp, url_prefix='/api/ai')
    app.register_blueprint(health_bp, url_prefix='/api/ai')

    # Create tables
    with app.app_context():
        from models import SalesEvent, ForecastResult, NegotiationSession
        try:
            db.create_all()
        except Exception as e:
            app.logger.warning(f"Database table creation notice/race condition handled: {e}")

    # Global error handlers
    @app.errorhandler(400)
    def bad_request(e):
        return {'error': str(e), 'status': 400}, 400

    @app.errorhandler(404)
    def not_found(e):
        return {'error': 'Resource not found', 'status': 404}, 404

    @app.errorhandler(500)
    def internal_error(e):
        return {'error': 'Internal server error', 'status': 500}, 500

    return app


if __name__ == '__main__':
    app = create_app()
    app.run(host='0.0.0.0', port=5000, debug=True)
