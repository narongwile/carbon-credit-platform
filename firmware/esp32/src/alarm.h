#pragma once
#include "product_profile.h"
#include "oneops.h"

// ===========================================================================
//  Edge alarm fast-path with debounce (spec §8/§9). Replaces "fire on every
//  breach": WARNING needs N consecutive over-threshold readings, CRITICAL is
//  immediate, event channels (door) must persist for a dwell, alarms are
//  de-duplicated on no-change and a sustained CRITICAL only re-fires on a
//  cooldown. The cloud engine still owns the authoritative alarm row.
// ===========================================================================
struct OoAlarmOut { bool fire; OoSeverity sev; };

void       ooAlarmInit(const OoProfile* p);
OoAlarmOut ooAlarmEval(size_t chIdx, const OoChannel& ch, float value, uint64_t nowMs);
