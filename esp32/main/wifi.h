#pragma once

#include "esp_err.h"

// Connect to the WiFi network configured in secrets.h and start the mDNS
// responder. Blocks until an IP address has been obtained.
esp_err_t wifi_connect(void);
