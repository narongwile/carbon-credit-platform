#include <Arduino.h>
#include <ArduinoJson.h>


// --- Configuration ---
#define MODEM_BAUDRATE 115200

// SWAPPED PINS: RX=17, TX=18
#define ESP_RX_PIN 18 // Connects to ML307R TX
#define ESP_TX_PIN 17 // Connects to ML307R RX
#define MODEM_PWRKEY_PIN 4

// MQTT Broker Settings
const char *MQTT_HOST = "27.254.143.144";
const char *MQTT_PORT = "31883";
const char *MQTT_USER = "admin";
const char *MQTT_PASS = "admin1234";
const char *MQTT_TOPIC = "carbon/device/gps";

#define STATE_WAIT_DELAY_MS 10000

HardwareSerial ModemSerial(1);

enum SystemState {
  STATE_INIT,
  STATE_CHECK_SIM,
  STATE_CHECK_NETWORK,
  STATE_ACTIVATE_CONTEXT,
  STATE_START_GPS,
  STATE_CONFIG_MQTT,
  STATE_CONNECT_MQTT,
  STATE_READ_GPS,
  STATE_PUBLISH_MQTT,
  STATE_WAIT,
  STATE_ERROR_RECOVERY
};

SystemState currentState = STATE_INIT;
unsigned long stateWaitTimer = 0;
String currentGPSPayload = "";
int errorCount = 0;
const int MAX_SOFT_RETRIES = 3;

String sendATCommand(String cmd, const char *expected_response,
                     unsigned long timeout_ms);
bool isGpsValid(String gnssData, float &lat, float &lng);

void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println("\n--- ESP32-S3 ML307R Diagnostic Mode ---");

  // Power on sequence
  Serial.println("[INFO] Pulsing PWRKEY on GPIO 4...");
  pinMode(MODEM_PWRKEY_PIN, OUTPUT);
  digitalWrite(MODEM_PWRKEY_PIN, LOW);
  delay(2000);
  digitalWrite(MODEM_PWRKEY_PIN, HIGH);
  delay(3000);

  // Initialize Serial with swapped pins
  Serial.println("[INFO] Starting Modem Serial (RX:17, TX:18)...");
  ModemSerial.begin(MODEM_BAUDRATE, SERIAL_8N1, ESP_RX_PIN, ESP_TX_PIN);

  currentState = STATE_INIT;
}

void loop() {
  // --- DEBUG PASSTHROUGH ---
  // If you type AT in the serial monitor, it goes to the modem
  while (ModemSerial.available()) {
    Serial.write(ModemSerial.read());
  }
  while (Serial.available()) {
    ModemSerial.write(Serial.read());
  }

  switch (currentState) {
  case STATE_INIT:
    Serial.println("[STATE] Initializing Modem...");
    errorCount = 0; // Reset error count on successful start
    if (sendATCommand("AT", "OK", 2000).indexOf("OK") != -1) {
      sendATCommand("ATE0", "OK", 1000);
      sendATCommand("AT+CMEE=2", "OK", 1000);
      sendATCommand("ATI", "OK", 1000);
      sendATCommand("AT+CEREG=2", "OK", 1000); // Enable detailed network info
      currentState = STATE_CHECK_SIM;
    } else {
      Serial.println("[ERROR] Modem not responding. Retrying...");
      delay(2000);
    }
    break;

  case STATE_CHECK_SIM:
    if (sendATCommand("AT+CPIN?", "+CPIN: READY", 3000).indexOf("READY") !=
        -1) {
      currentState = STATE_CHECK_NETWORK;
    } else {
      delay(5000);
    }
    break;

  case STATE_CHECK_NETWORK: {
    String res = sendATCommand("AT+CEREG?", "OK", 3000);
    if (res.indexOf(",1") != -1 || res.indexOf(",5") != -1) {
      currentState = STATE_ACTIVATE_CONTEXT;
    } else {
      delay(2000);
    }
  } break;

  case STATE_ACTIVATE_CONTEXT: {
    Serial.println("[INFO] Registered. Activating Context...");
    sendATCommand("AT+CGDCONT=1,\"IP\",\"internet\"", "OK", 2000);
    if (sendATCommand("AT+CGACT=1,1", "OK", 3000).indexOf("OK") != -1) {
      currentState = STATE_START_GPS;
    } else {
      delay(3000);
    }
  } break;

  case STATE_START_GPS: {
    String gnssCap = sendATCommand("AT+CGNSSPWR=?", "OK", 1000);
    if (gnssCap.indexOf("ERROR") != -1) {
      Serial.println("[INFO] This module variant (ML307R-DL) has NO GNSS hardware.");
      Serial.println("[INFO] Attempting LBS (Cell Tower) location as fallback...");
      // Try common LBS commands for this chipset
      sendATCommand("AT+CELLOCATE=1", "OK", 2000);
      currentState = STATE_CONFIG_MQTT;
    } else {
      if (sendATCommand("AT+CGNSSPWR=1", "OK", 2000).indexOf("OK") == -1) {
        sendATCommand("AT+CGNSS=1", "OK", 2000);
      }
      currentState = STATE_CONFIG_MQTT;
    }
  } break;

  case STATE_CONFIG_MQTT:
    {
      Serial.println("[INFO] Connecting to MQTT Broker...");
      
      // 0. Ensure clean state
      sendATCommand("AT+MQTTDISCONN=0", "OK", 2000);
      
      // 1. Configure MQTT parameters for index 0
      sendATCommand("AT+MQTTCFG=\"cid\",0,1", "OK", 2000);
      sendATCommand("AT+MQTTCFG=\"keepalive\",0,60", "OK", 2000);
      sendATCommand("AT+MQTTCFG=\"clean\",0,1", "OK", 2000);
      
      // 2. Connect: AT+MQTTCONN=<index>,"host",port,"clientid","user","pass"
      String cmdConn = String("AT+MQTTCONN=0,\"") + MQTT_HOST + "\"," + MQTT_PORT + 
                       ",\"ESP32_Client\",\"" + MQTT_USER + "\",\"" + MQTT_PASS + "\"";
      
      String res = sendATCommand(cmdConn, "OK", 15000);
      if (res.indexOf("OK") != -1 || res.indexOf("607") != -1) {
          Serial.println("[INFO] MQTT Connected successfully!");
          currentState = STATE_READ_GPS;
        } else {
          Serial.println("[ERROR] MQTTCONN failed. Retrying...");
          currentState = STATE_ERROR_RECOVERY;
        }
    }
    break;

  case STATE_CONNECT_MQTT:
    if (sendATCommand("AT+MQTTCONN=1", "OK", 10000).indexOf("OK") != -1) {
      currentState = STATE_READ_GPS;
    } else {
      delay(5000);
    }
    break;

  case STATE_READ_GPS: {
    JsonDocument doc;
    doc["device"] = "ESP32S3-ML307R";
    doc["uptime"] = millis() / 1000;
    
    // Default static coordinates (Fallback)
    doc["lat"] = 13.7563;
    doc["lng"] = 100.5018;
    String status = "static";

    // Request Network Info
    String regRes = sendATCommand("AT+CEREG?", "OK", 2000);
    
    // Typical response: +CEREG: 2,1,"LAC","CI",7
    if (regRes.indexOf("+CEREG: 2,1") != -1) {
      int firstQuote = regRes.indexOf("\"");
      int secondQuote = regRes.indexOf("\"", firstQuote + 1);
      int thirdQuote = regRes.indexOf("\"", secondQuote + 1);
      int fourthQuote = regRes.indexOf("\"", thirdQuote + 1);
      
      if (firstQuote != -1 && secondQuote != -1 && thirdQuote != -1 && fourthQuote != -1) {
         String lacHex = regRes.substring(firstQuote + 1, secondQuote);
         String ciHex = regRes.substring(thirdQuote + 1, fourthQuote);
         
         // Convert HEX strings to Decimal for Geolocation APIs
         long lacDec = strtol(lacHex.c_str(), NULL, 16);
         long ciDec = strtol(ciHex.c_str(), NULL, 16);
         
         doc["lac"] = lacDec;
         doc["cellid"] = ciDec;
         status = "cell_tower";
         Serial.printf("[INFO] Cell Tower: LAC=%ld, CI=%ld\n", lacDec, ciDec);
      }
    }

    doc["status"] = status;

    currentGPSPayload = "";
    serializeJson(doc, currentGPSPayload);
    currentState = STATE_PUBLISH_MQTT;
  } break;

  case STATE_PUBLISH_MQTT: {
    // Try 6-parameter length format: index, topic, qos, retain, dup, length
    int payloadLen = currentGPSPayload.length();
    String cmd = String("AT+MQTTPUB=0,\"") + MQTT_TOPIC + "\",0,0,0," + String(payloadLen);
    
    ModemSerial.println(cmd);
    Serial.println(">> " + cmd);
    
    unsigned long t_start = millis();
    bool gotPrompt = false;
    while (millis() - t_start < 3000) {
      if (ModemSerial.available()) {
        char c = ModemSerial.read();
        Serial.print(c);
        if (c == '>') {
          gotPrompt = true;
          break;
        }
      }
    }

    if (gotPrompt) {
      ModemSerial.print(currentGPSPayload);
      Serial.println("\n[DATA SENT]");
      
      // Wait for OK response
      unsigned long t_wait = millis();
      while (millis() - t_wait < 5000) {
        if (ModemSerial.available()) {
          String res = ModemSerial.readStringUntil('\n');
          if (res.indexOf("OK") != -1) break;
        }
      }
      
      stateWaitTimer = millis();
      currentState = STATE_WAIT;
    } else {
      Serial.println("\n[ERROR] No '>' prompt received for MQTTPUB");
      currentState = STATE_CONFIG_MQTT;
    }
  } break;

  case STATE_WAIT:
    if (millis() - stateWaitTimer >= STATE_WAIT_DELAY_MS) {
      currentState = STATE_READ_GPS;
    }
    break;

  case STATE_ERROR_RECOVERY:
    errorCount++;
    Serial.printf("[WARN] Error occurred. Count: %d/%d\n", errorCount, MAX_SOFT_RETRIES);
    
    if (errorCount >= MAX_SOFT_RETRIES) {
      Serial.println("[CRITICAL] Max retries reached. Performing Hardware Reset via PWRKEY...");
      digitalWrite(MODEM_PWRKEY_PIN, LOW);
      delay(1500); // Pulse length for shutdown/restart
      digitalWrite(MODEM_PWRKEY_PIN, HIGH);
      delay(10000); // Wait for modem to boot
      errorCount = 0;
    } else {
      delay(5000);
    }
    currentState = STATE_INIT;
    break;
  }
}

String sendATCommand(String cmd, const char *expected_response,
                     unsigned long timeout_ms) {
  String response = "";
  unsigned long t_start = millis();
  while (ModemSerial.available())
    ModemSerial.read();
  ModemSerial.println(cmd);
  Serial.println(">> " + cmd);
  while ((millis() - t_start) < timeout_ms) {
    while (ModemSerial.available())
      response += (char)ModemSerial.read();
    if (response.indexOf(expected_response) != -1)
      break;
  }
  String debugRes = response;
  debugRes.replace("\r", "");
  debugRes.replace("\n", " ");
  Serial.println("<< " + debugRes);
  return response;
}

bool isGpsValid(String gnssData, float &lat, float &lng) {
  // Typical response: +CGNSSINFO: 2,05,01,00,3113.344321,N,12121.234321,E,...
  if (gnssData.indexOf("+CGNSSINFO:") == -1) return false;
  
  int firstComma = gnssData.indexOf(",");
  if (firstComma == -1) return false;
  
  // Count commas to find lat/lng fields (index 4 and 6)
  int commaIndices[10];
  int commaCount = 0;
  int lastPos = 0;
  while ((lastPos = gnssData.indexOf(",", lastPos)) != -1 && commaCount < 10) {
    commaIndices[commaCount++] = lastPos;
    lastPos++;
  }

  if (commaCount < 7) return false;

  String latStr = gnssData.substring(commaIndices[3] + 1, commaIndices[4]);
  String latDir = gnssData.substring(commaIndices[4] + 1, commaIndices[5]);
  String lngStr = gnssData.substring(commaIndices[5] + 1, commaIndices[6]);
  String lngDir = gnssData.substring(commaIndices[6] + 1, commaIndices[7]);

  if (latStr.length() == 0 || lngStr.length() == 0) return false;

  // Convert DDMM.MMMM to Decimal Degrees
  auto convertToDecimal = [](String raw, String dir) -> float {
    if (raw.length() < 4) return 0.0;
    int dotPos = raw.indexOf(".");
    if (dotPos == -1) return 0.0;
    
    String degStr = raw.substring(0, dotPos - 2);
    String minStr = raw.substring(dotPos - 2);
    
    float degrees = degStr.toFloat();
    float minutes = minStr.toFloat();
    float decimal = degrees + (minutes / 60.0);
    
    if (dir == "S" || dir == "W") decimal *= -1.0;
    return decimal;
  };

  lat = convertToDecimal(latStr, latDir);
  lng = convertToDecimal(lngStr, lngDir);
  
  return (lat != 0.0 && lng != 0.0);
}
