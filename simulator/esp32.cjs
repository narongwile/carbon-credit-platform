const mqtt = require('mqtt');

// Connect to external Mosquitto broker
const client = mqtt.connect('mqtt://27.254.143.144:31883', { 
  username: 'admin', 
  password: 'admin1234' 
});

client.on('connect', () => {
  console.log('✅ ESP32 Simulator connected to MQTT Broker!');
  
  // Publish telemetry every 2 seconds
  setInterval(() => {
    const data = {
      id: '1',
      mac: '00:1A:2B:3C:4D:01',
      temperature: Number((3.9 + (Math.random() - 0.5) * 1.5).toFixed(1)), // random 3.15 to 4.65
      doorOpen: Math.random() > 0.95, // 5% chance the door is open
      timestamp: new Date().toISOString()
    };
    
    client.publish('telemetry/node1', JSON.stringify(data));
    console.log(`[${data.timestamp}] Published Node 1: ${data.temperature}°C, Door: ${data.doorOpen ? 'OPEN' : 'CLOSED'}`);
  }, 2000); 
});

client.on('error', (err) => {
  console.error('❌ MQTT Error:', err.message);
});
