import os
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.optim as optim
import xgboost as xgb
from sklearn.preprocessing import MinMaxScaler
import logging

logger = logging.getLogger(__name__)

class LSTMModel(nn.Module):
    def __init__(self, input_size=1, hidden_size=64, num_layers=2, output_size=1):
        super(LSTMModel, self).__init__()
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        self.lstm = nn.LSTM(input_size, hidden_size, num_layers, batch_first=True, dropout=0.2 if num_layers > 1 else 0.0)
        self.fc = nn.Linear(hidden_size, output_size)

    def forward(self, x):
        h0 = torch.zeros(self.num_layers, x.size(0), self.hidden_size).to(x.device)
        c0 = torch.zeros(self.num_layers, x.size(0), self.hidden_size).to(x.device)
        out, _ = self.lstm(x, (h0, c0))
        out = self.fc(out[:, -1, :])
        return out


class EnsembleForecaster:
    def __init__(self, model_dir='models/saved'):
        self.model_dir = model_dir
        os.makedirs(self.model_dir, exist_ok=True)
        
        self.lstm_path = os.path.join(self.model_dir, 'lstm_model.pth')
        self.xgb_path = os.path.join(self.model_dir, 'xgb_model.json')
        
        self.seq_length = 14  # lookback period
        self.forecast_horizon = 7 # predict next 7 days sum
        
        self.lstm_model = LSTMModel(input_size=1, hidden_size=64, num_layers=2, output_size=1)
        self.xgb_model = xgb.XGBRegressor(
            n_estimators=100, 
            learning_rate=0.1, 
            max_depth=5, 
            objective='reg:squarederror'
        )
        self.scaler = MinMaxScaler()
        self.is_trained = False
        
        self._load_models()

    def _load_models(self):
        try:
            if os.path.exists(self.lstm_path) and os.path.exists(self.xgb_path):
                self.lstm_model.load_state_dict(torch.load(self.lstm_path))
                self.xgb_model.load_model(self.xgb_path)
                self.is_trained = True
                logger.info("Loaded pre-trained forecasting models.")
            else:
                logger.info("No pre-trained models found. Will use fallback or require training.")
        except Exception as e:
            logger.error(f"Error loading models: {e}")

    def _save_models(self):
        torch.save(self.lstm_model.state_dict(), self.lstm_path)
        self.xgb_model.save_model(self.xgb_path)

    def _prepare_data(self, history):
        """Prepare timeseries data for training/inference."""
        # Need at least seq_length + forecast_horizon data points for training
        if len(history) < self.seq_length + self.forecast_horizon:
            return None, None, None
            
        data = np.array(history).reshape(-1, 1)
        
        # Scale based on the local max to keep relative trends
        max_val = data.max() if data.max() > 0 else 1
        data_scaled = data / max_val
        
        X, y = [], []
        for i in range(len(data_scaled) - self.seq_length - self.forecast_horizon + 1):
            X.append(data_scaled[i:(i + self.seq_length)])
            y.append(np.sum(data_scaled[(i + self.seq_length):(i + self.seq_length + self.forecast_horizon)]))
            
        return np.array(X), np.array(y), max_val

    def train_incremental(self, historical_sales):
        """Train or fine-tune models incrementally with new data."""
        X, y, max_val = self._prepare_data(historical_sales)
        
        if X is None or len(X) == 0:
            logger.warning("Not enough data to train.")
            return False

        # --- Train XGBoost ---
        X_xgb = X.reshape(X.shape[0], -1)  # Flatten for XGB
        if self.is_trained:
            # Incremental learning
            self.xgb_model.fit(X_xgb, y, xgb_model=self.xgb_path)
        else:
            self.xgb_model.fit(X_xgb, y)

        # --- Train LSTM ---
        X_tensor = torch.tensor(X, dtype=torch.float32)
        y_tensor = torch.tensor(y, dtype=torch.float32).view(-1, 1)
        
        criterion = nn.MSELoss()
        optimizer = optim.Adam(self.lstm_model.parameters(), lr=0.001)
        
        self.lstm_model.train()
        epochs = 10 if self.is_trained else 50 # fine-tune or train from scratch
        for epoch in range(epochs):
            optimizer.zero_grad()
            outputs = self.lstm_model(X_tensor)
            loss = criterion(outputs, y_tensor)
            loss.backward()
            optimizer.step()

        self.is_trained = True
        self._save_models()
        return True

    def predict(self, recent_history):
        """Predict next 7 days demand."""
        if not self.is_trained or len(recent_history) < self.seq_length:
            return None

        recent_seq = recent_history[-self.seq_length:]
        max_val = max(recent_seq) if max(recent_seq) > 0 else 1
        seq_scaled = np.array(recent_seq) / max_val
        
        # XGB Prediction
        X_xgb = seq_scaled.reshape(1, -1)
        xgb_pred = self.xgb_model.predict(X_xgb)[0]
        
        # LSTM Prediction
        self.lstm_model.eval()
        with torch.no_grad():
            X_tensor = torch.tensor(seq_scaled.reshape(1, self.seq_length, 1), dtype=torch.float32)
            lstm_pred = self.lstm_model(X_tensor).item()
            
        # Ensemble average
        ensemble_pred_scaled = (xgb_pred + lstm_pred) / 2.0
        
        # Inverse transform
        predicted_demand = ensemble_pred_scaled * max_val
        
        return max(1, int(predicted_demand))

# Singleton instance
forecaster = EnsembleForecaster()

def bootstrap_m5_data():
    """Generates training data from the M5 dataset and trains the initial model."""
    if forecaster.is_trained:
        return
        
    logger.info("Bootstrapping ML forecasting models with M5 Dataset...")
    
    try:
        # Load just the first row of the M5 dataset for initial training
        dataset_path = r'd:\CARPIP New\M5 Forecasting Accuracy\sales_train_evaluation.csv'
        if not os.path.exists(dataset_path):
            logger.error(f"M5 dataset not found at {dataset_path}")
            return
            
        df = pd.read_csv(dataset_path, nrows=1)
        # In M5, daily sales start from the 7th column (index 6): d_1, d_2, etc.
        m5_sales = df.iloc[0, 6:].values.astype(int).tolist()
        
        # Train on the extracted time series
        forecaster.train_incremental(m5_sales)
        logger.info("Bootstrapping with M5 dataset complete.")
    except Exception as e:
        logger.error(f"Error bootstrapping with M5 data: {e}")
