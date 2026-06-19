#include "trend.h"
#include <math.h>

#define KEYS  4
#define DEPTH 16
struct Ring { uint64_t ts[DEPTH]; float v[DEPTH]; uint8_t head, count; };
static Ring rings[KEYS] = {};

void ooTrendPush(uint8_t key, uint64_t ts, float value) {
  if (key >= KEYS) return;
  Ring& r = rings[key];
  r.ts[r.head] = ts; r.v[r.head] = value;
  r.head = (r.head + 1) % DEPTH;
  if (r.count < DEPTH) r.count++;
}

float ooTrendPerHour(uint8_t key) {
  if (key >= KEYS) return NAN;
  Ring& r = rings[key];
  if (r.count < 2) return NAN;
  uint8_t newest = (r.head + DEPTH - 1) % DEPTH;
  uint8_t oldest = (r.head + DEPTH - r.count) % DEPTH;
  double dt_h = (double)(r.ts[newest] - r.ts[oldest]) / 3600000.0;
  if (dt_h <= 0) return NAN;
  return (float)((r.v[newest] - r.v[oldest]) / dt_h);
}
