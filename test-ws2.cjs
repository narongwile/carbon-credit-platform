const mqtt = require('mqtt');
const testPort = (port) => {
  const client = mqtt.connect(`ws://27.254.143.144:${port}`, { username: 'admin', password: 'admin1234', connectTimeout: 3000 });
  client.on('connect', () => { console.log(`WS Connected on ${port}!`); client.end(); });
  client.on('error', (err) => { console.error(`WS Error on ${port}:`, err.message); client.end(); });
}
testPort(9001);
testPort(8080);
testPort(31884);
