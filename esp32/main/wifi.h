#pragma once

#include "esp_err.h"

// Connect to the WiFi network configured in secrets.h. Blocks until an IP
// address has been obtained.
esp_err_t wifi_connect(void);
