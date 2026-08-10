import os
import sys
import numpy as np

os.chdir(r'd:\CARPIP New\ai-service')
sys.path.insert(0, '.')

from app import create_app
from forecaster import forecaster

app = create_app()

def test():
    with app.app_context():
        # 1. Test inference (will trigger bootstrap if first run)
        with app.test_client() as client:
            print("--- Testing /forecast Endpoint ---")
            # Provide 30 days of synthetic data
            sales = np.random.poisson(10, 30).tolist()
            payload = {
                'sku': 'TEST-01',
                'current_stock': 100,
                'reorder_point': 20,
                'historical_sales': sales
            }
            res = client.post('/api/ai/forecast', json=payload)
            print("Forecast Response:", res.json)
            
            print("\n--- Testing /forecast/train Endpoint ---")
            # Provide new data to trigger incremental training
            new_sales = np.random.poisson(20, 60).tolist()
            train_payload = {
                'historical_sales': new_sales
            }
            res = client.post('/api/ai/forecast/train', json=train_payload)
            print("Train Response:", res.json)
            
            print("\n--- Testing /forecast After Training ---")
            res = client.post('/api/ai/forecast', json=payload)
            print("Forecast Response (After update):", res.json)

if __name__ == '__main__':
    test()
