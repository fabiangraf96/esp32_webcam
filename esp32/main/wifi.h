#pragma once

#include "esp_err.h"

// Connect to the WiFi network configured in secrets.h. Blocks until an IP
// address has been obtained, the retry budget is exhausted, or an internal
// timeout expires; returns ESP_FAIL in the latter two cases.
//
// Channel/BSSID of a successful association are cached in RTC memory so the
// next connect after a deep sleep can skip the full scan.
esp_err_t wifi_connect(void);

// Disassociate and power the radio down. Call before entering deep sleep.
void wifi_shutdown(void);
