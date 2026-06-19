#include "gps.h"
#include "config.h"

#if OO_GPS_ENABLE
static HardwareSerial GPS(2);
static char  line[100];
static uint8_t li = 0;
static bool  gFix = false;
static float gLat = 0, gLng = 0, gSpd = 0;

// ddmm.mmmm -> decimal degrees
static float nmeaDeg(const char* f, char hemi) {
  if (!f || !*f) return 0;
  float raw = atof(f);
  int deg = (int)(raw / 100);
  float min = raw - deg * 100;
  float d = deg + min / 60.0f;
  if (hemi == 'S' || hemi == 'W') d = -d;
  return d;
}

static void parseRMC(char* s) {
  // $--RMC,time,status,lat,N/S,lng,E/W,speed,course,date,...
  char* tok[13]; int n = 0;
  for (char* p = strtok(s, ","); p && n < 13; p = strtok(nullptr, ",")) tok[n++] = p;
  if (n < 8) return;
  gFix = (tok[2][0] == 'A');
  if (gFix) {
    gLat = nmeaDeg(tok[3], tok[4][0]);
    gLng = nmeaDeg(tok[5], tok[6][0]);
    gSpd = atof(tok[7]);
  }
}

void ooGpsInit() { GPS.begin(OO_GPS_BAUD, SERIAL_8N1, OO_PIN_GPS_RX, OO_PIN_GPS_TX); }

void ooGpsTick() {
  while (GPS.available()) {
    char c = GPS.read();
    if (c == '\n' || li >= sizeof(line) - 1) {
      line[li] = 0;
      if (strstr(line, "RMC")) parseRMC(line);
      li = 0;
    } else if (c != '\r') line[li++] = c;
  }
}

bool  ooGpsFix()        { return gFix; }
float ooGpsLat()        { return gLat; }
float ooGpsLng()        { return gLng; }
float ooGpsSpeedKnots() { return gSpd; }

#else
void  ooGpsInit() {}
void  ooGpsTick() {}
bool  ooGpsFix()        { return false; }
float ooGpsLat()        { return 0; }
float ooGpsLng()        { return 0; }
float ooGpsSpeedKnots() { return 0; }
#endif
