#include "ota.h"
#include "config.h"
#include "oneops.h"
#include "identity.h"
#include "timekeeping.h"
#include <ArduinoJson.h>
#include "esp_ota_ops.h"
#include "esp_https_ota.h"
#include "esp_http_client.h"

// ⚠️ esp_https_ota() runs over the ESP-IDF HTTP client / LwIP, i.e. Wi-Fi (or a
// PPP netif). It CANNOT see a TinyGSM AT-socket, so OTA does not work over a
// TinyGSM 4G link. For 4G OTA either (1) bring the modem up as an ESP-IDF PPP
// netif (esp_modem) so this code works unchanged — recommended — or (2) download
// the .bin via TinyGsmClient and write it with esp_ota_begin/write/end. Until
// then, schedule OTA only while the active transport is Wi-Fi.
static QueueHandle_t gOtaQueue = nullptr;   // carries descriptor JSON strings
static bool gPendingVerify = false;

// ---- progress / status helpers --------------------------------------------
static void otaProgress(int pct, const char* status) {
  JsonDocument d;
  d["ts"] = ooEpochMs(); d["pct"] = pct; d["status"] = status; d["fw"] = OO_FW_VERSION;
  char buf[160]; size_t n = serializeJson(d, buf);
  ooEnqueue("ota/progress", buf, n, 1, false, /*prio*/1);
}

// semver "a.b.c" compare: returns true if `cand` is a different, installable
// version than the running image (anti-reflash + basic gate, spec §24).
static bool versionInstallable(const char* cand) {
  if (!cand || !*cand) return false;
  return strcmp(cand, OO_FW_VERSION) != 0;
}

// ---- boot-time rollback arming --------------------------------------------
void ooOtaInit() {
  const esp_partition_t* running = esp_ota_get_running_partition();
  esp_ota_img_states_t st;
  if (esp_ota_get_state_partition(running, &st) == ESP_OK)
    gPendingVerify = (st == ESP_OTA_IMG_PENDING_VERIFY);
  // If pending, the bootloader will roll back unless ooOtaConfirmHealthy() runs.
}

void ooOtaConfirmHealthy() {
  if (gPendingVerify) {
    esp_ota_mark_app_valid_cancel_rollback();
    gPendingVerify = false;
    otaProgress(100, "confirmed");
  }
}

// ---- the actual update -----------------------------------------------------
static esp_err_t runHttpsOta(const char* uri) {
  const OoCerts& c = ooCerts();
  esp_http_client_config_t http{};
  http.url = uri;
  http.timeout_ms = 15000;
  http.keep_alive_enable = true;
  if (c.ca.length()) http.cert_pem = c.ca.c_str();   // pin the artefact-store CA

  esp_https_ota_config_t cfg{};
  cfg.http_config = &http;

  esp_https_ota_handle_t h = nullptr;
  esp_err_t err = esp_https_ota_begin(&cfg, &h);
  if (err != ESP_OK || h == nullptr) return err == ESP_OK ? ESP_FAIL : err;

  int total = esp_https_ota_get_image_size(h);
  int lastPct = -5;
  while ((err = esp_https_ota_perform(h)) == ESP_ERR_HTTPS_OTA_IN_PROGRESS) {
    if (total > 0) {
      int pct = esp_https_ota_get_image_len_read(h) * 100 / total;
      if (pct >= lastPct + 5) { lastPct = pct; otaProgress(pct, "downloading"); }
    }
    vTaskDelay(pdMS_TO_TICKS(20));
  }

  if (err != ESP_OK || !esp_https_ota_is_complete_data_received(h)) {
    esp_https_ota_abort(h);
    return err == ESP_OK ? ESP_FAIL : err;
  }
  // esp_https_ota_finish verifies the image (and secure-boot signature) and
  // sets the boot partition to the inactive A/B slot.
  return esp_https_ota_finish(h);
}

static void doUpdate(const char* json, size_t len) {
  JsonDocument d;
  if (deserializeJson(d, json, len)) { otaProgress(0, "bad descriptor"); return; }
  const char* to  = d["to_version"] | "";
  const char* uri = d["artefact_uri"] | "";

  if (!versionInstallable(to)) { otaProgress(0, "rejected: version"); return; }
  if (!uri[0])                 { otaProgress(0, "rejected: no uri");  return; }
  otaProgress(0, "accepted");

  // Download resilience (spec §24): up to 5 attempts with backoff; on total
  // failure stay on the current slot.
  for (int attempt = 1; attempt <= 5; attempt++) {
    esp_err_t err = runHttpsOta(uri);
    if (err == ESP_OK) {
      otaProgress(100, "verified, rebooting");
      vTaskDelay(pdMS_TO_TICKS(300));
      esp_restart();                 // boots the new slot; pending-verify armed
    }
    otaProgress(0, "download failed, retrying");
    vTaskDelay(pdMS_TO_TICKS(2000 * attempt));
  }
  otaProgress(0, "aborted: stayed on current slot");
}

static void otaTask(void*) {
  char* buf = (char*)malloc(640);
  for (;;) {
    if (xQueueReceive(gOtaQueue, buf, portMAX_DELAY) == pdTRUE)
      doUpdate(buf, strlen(buf));
  }
}

void ooOtaTaskStart() {
  gOtaQueue = xQueueCreate(2, 640);
  xTaskCreatePinnedToCore(otaTask, "OtaTask", 8192, nullptr, 3, nullptr, 0);
}

void ooOtaSubmit(const char* descriptorJson, size_t len) {
  if (!gOtaQueue || len >= 640) return;
  char buf[640];
  memcpy(buf, descriptorJson, len);
  buf[len] = 0;
  xQueueSend(gOtaQueue, buf, 0);
}
