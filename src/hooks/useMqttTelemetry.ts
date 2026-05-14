import { useState, useEffect } from 'react';

export interface TelemetryData {
  id: string;
  mac: string;
  temperature: number;
  doorOpen: boolean;
  timestamp: string;
}

export function useMqttTelemetry(url: string = 'ws://localhost:8080') {
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: NodeJS.Timeout;

    const connect = () => {
      ws = new WebSocket(url);

      ws.onopen = () => {
        console.log("Connected to local MQTT Bridge");
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data: TelemetryData = JSON.parse(event.data);
          setTelemetry(data);
        } catch (e) {
          console.error("Failed to parse telemetry JSON", e);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        // Auto-reconnect every 3 seconds if the bridge goes down
        reconnectTimer = setTimeout(connect, 3000);
      };
      
      ws.onerror = (err) => {
        ws.close();
      };
    };

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null; // Prevent reconnect loop on unmount
        ws.close();
      }
    };
  }, [url]);

  return { telemetry, isConnected };
}
