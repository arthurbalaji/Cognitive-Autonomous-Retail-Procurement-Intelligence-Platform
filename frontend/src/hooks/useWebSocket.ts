import { useEffect, useRef, useState, useCallback } from 'react';
import { Client, IMessage } from '@stomp/stompjs';
import { useQueryClient } from '@tanstack/react-query';

type ConnectionStatus = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

interface WebSocketMessage {
  type: string;
  timestamp: string;
  tenantId?: string;
  orderId?: string;
  [key: string]: any;
}

/**
 * React hook for STOMP WebSocket connection to Spring Boot.
 * Auto-connects on mount, auto-reconnects on disconnect,
 * and invalidates React Query caches on relevant events.
 */
export function useWebSocket(tenantId?: string) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('DISCONNECTED');
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const clientRef = useRef<Client | null>(null);
  const queryClient = useQueryClient();

  const connect = useCallback(() => {
    if (clientRef.current?.active) return;

    const token = localStorage.getItem('carpip_token');
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

    const client = new Client({
      brokerURL: wsUrl,
      connectHeaders: token ? { Authorization: `Bearer ${token}` } : {},
      reconnectDelay: 5000,
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,

      onConnect: () => {
        setConnectionStatus('CONNECTED');
        console.log('[WebSocket] Connected to CARPIP real-time feed');

        // Subscribe to tenant-specific topics
        if (tenantId) {
          client.subscribe(`/topic/inventory/${tenantId}`, (msg: IMessage) => {
            const data = JSON.parse(msg.body) as WebSocketMessage;
            setLastMessage(data);
            // Invalidate products cache to trigger React Query refetch
            queryClient.invalidateQueries({ queryKey: ['products'] });
          });

          client.subscribe(`/topic/orders/${tenantId}`, (msg: IMessage) => {
            const data = JSON.parse(msg.body) as WebSocketMessage;
            setLastMessage(data);
            // Invalidate orders and stats caches
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            queryClient.invalidateQueries({ queryKey: ['order-stats'] });
            queryClient.invalidateQueries({ queryKey: ['auto-procurement-orders'] });
          });

          client.subscribe(`/topic/sync/${tenantId}`, (msg: IMessage) => {
            const data = JSON.parse(msg.body) as WebSocketMessage;
            setLastMessage(data);
            // Invalidate all data caches after sync
            queryClient.invalidateQueries({ queryKey: ['products'] });
            queryClient.invalidateQueries({ queryKey: ['orders'] });
            queryClient.invalidateQueries({ queryKey: ['integration-status'] });
            queryClient.invalidateQueries({ queryKey: ['sync-history'] });
          });
        }

        // Subscribe to system-wide alerts
        client.subscribe('/topic/system', (msg: IMessage) => {
          const data = JSON.parse(msg.body) as WebSocketMessage;
          setLastMessage(data);
        });
      },

      onDisconnect: () => {
        setConnectionStatus('DISCONNECTED');
        console.log('[WebSocket] Disconnected');
      },

      onStompError: (frame) => {
        setConnectionStatus('ERROR');
        console.error('[WebSocket] STOMP error:', frame.headers['message']);
      },

      onWebSocketError: () => {
        setConnectionStatus('ERROR');
      },
    });

    setConnectionStatus('CONNECTING');
    client.activate();
    clientRef.current = client;
  }, [tenantId, queryClient]);

  const disconnect = useCallback(() => {
    if (clientRef.current?.active) {
      clientRef.current.deactivate();
      clientRef.current = null;
      setConnectionStatus('DISCONNECTED');
    }
  }, []);

  // Auto-connect on mount, disconnect on unmount
  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    connectionStatus,
    isConnected: connectionStatus === 'CONNECTED',
    lastMessage,
    connect,
    disconnect,
  };
}

/**
 * Hook to subscribe to negotiation-specific updates for a given orderId.
 */
export function useNegotiationWebSocket(orderId?: string) {
  const [transcript, setTranscript] = useState<WebSocketMessage[]>([]);
  const clientRef = useRef<Client | null>(null);

  useEffect(() => {
    if (!orderId) return;

    const token = localStorage.getItem('carpip_token');
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

    const client = new Client({
      brokerURL: wsUrl,
      connectHeaders: token ? { Authorization: `Bearer ${token}` } : {},
      reconnectDelay: 5000,

      onConnect: () => {
        client.subscribe(`/topic/negotiations/${orderId}`, (msg: IMessage) => {
          const data = JSON.parse(msg.body) as WebSocketMessage;
          setTranscript(prev => [...prev, data]);
        });
      },
    });

    client.activate();
    clientRef.current = client;

    return () => {
      client.deactivate();
    };
  }, [orderId]);

  return { transcript };
}
