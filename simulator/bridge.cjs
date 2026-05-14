const mqtt = require('mqtt');
const { WebSocketServer } = require('ws');

// 1. Start Local WebSocket Server for the React Frontend
const wss = new WebSocketServer({ port: 8080 });
console.log('🌐 Local WebSocket Bridge started on ws://localhost:8080');

// Keep track of connected UI clients
wss.on('connection', (ws) => {
  console.log('💻 New Frontend Client Connected');
  ws.on('close', () => console.log('💻 Frontend Client Disconnected'));
});

// 2. Connect to the external TCP Mosquitto Broker
const mqttClient = mqtt.connect('mqtt://27.254.143.144:31883', { 
  username: 'admin', 
  password: 'admin1234' 
});

mqttClient.on('connect', () => {
  console.log('✅ Bridge connected to MQTT Broker (TCP)!');
  mqttClient.subscribe('telemetry/node1');
  console.log('📡 Subscribed to topic: telemetry/node1');
});

// 3. Listen for messages and forward them to all WebSocket clients
mqttClient.on('message', (topic, message) => {
  const payload = message.toString();
  console.log(`📥 Received from ${topic}: ${payload}`);
  
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      client.send(payload);
    }
  });
});

mqttClient.on('error', (err) => {
  console.error('❌ MQTT Error:', err.message);
});
