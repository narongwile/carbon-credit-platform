const mqtt = require('mqtt');
const client = mqtt.connect('mqtt://27.254.143.144:31883', { username: 'admin', password: 'admin1234', connectTimeout: 3000 });
client.on('connect', () => { console.log('MQTT Connected successfully!'); client.end(); });
client.on('error', (err) => { console.error('MQTT Error:', err.message); client.end(); });
