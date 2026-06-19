#include "alarm.h"
#include "config.h"

struct St { OoSeverity cur; uint16_t warnN; uint64_t evStart; uint64_t lastFire; };
static St     st[16];
static size_t nCh = 0;

void ooAlarmInit(const OoProfile* p) {
  nCh = p->count < 16 ? p->count : 16;
  for (size_t i = 0; i < nCh; i++) st[i] = {OO_NORMAL, 0, 0, 0};
}

OoAlarmOut ooAlarmEval(size_t i, const OoChannel& ch, float v, uint64_t now) {
  if (i >= nCh) return {false, OO_NORMAL};
  St& s = st[i];

  OoSeverity target;
  if (ch.isEvent) {
    // Duration debounce: an open event must persist before it becomes CRITICAL.
    if (v != 0.0f) {
      if (s.evStart == 0) s.evStart = now;
      target = (now - s.evStart >= OO_EVENT_DEBOUNCE_MS) ? OO_CRITICAL : OO_NORMAL;
    } else { s.evStart = 0; target = OO_NORMAL; }
  } else {
    OoSeverity inst = ooEvalSeverity(ch, v);
    if (inst == OO_CRITICAL) { target = OO_CRITICAL; s.warnN = 0; }
    else if (inst == OO_WARNING) {
      // require N consecutive before promoting NORMAL -> WARNING
      if (s.cur >= OO_WARNING) target = OO_WARNING;
      else target = (++s.warnN >= OO_WARN_CONSEC) ? OO_WARNING : s.cur;
    } else { s.warnN = 0; target = OO_NORMAL; }
  }

  bool fire = false;
  if (target != s.cur) {                          // state change -> publish once
    s.cur = target;
    if (target >= OO_WARNING) { fire = true; s.lastFire = now; }
  } else if (s.cur >= OO_CRITICAL && now - s.lastFire >= OO_ALARM_COOLDOWN_MS) {
    fire = true; s.lastFire = now;                 // re-assert sustained CRITICAL
  }
  return {fire, s.cur};
}
